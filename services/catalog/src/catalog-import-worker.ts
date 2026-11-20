import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { cleanupImportDirectory, downloadImportSource, extractImportManifests, prepareImportDirectory } from "./catalog-import-files.js";
import { loadCatalogConfig, type CatalogConfig } from "./config.js";
import { createCatalogDatabase, type CatalogDatabase } from "./database.js";
import { parseDdexXml, type DdexImportRelease } from "./ddex-import-parser.js";
import { decryptGrantToken } from "./grant-crypto.js";
import { mapSpreadsheetRows } from "./spreadsheet-catalog-mapper.js";
import { parseCsv, parseXlsx } from "./spreadsheet-import-parser.js";
import { z } from "zod";

const archiveEntriesSchema = z.array(z.object({ entryName: z.string(), asset: z.object({ id: z.string().uuid(), type: z.enum(["AUDIO", "VIDEO", "IMAGE"]), fileName: z.string(), status: z.string() }) })).max(10000);

export async function processNextCatalogImport(database: CatalogDatabase, config: CatalogConfig): Promise<boolean> {
  const job = await database.prisma.catalogImportJob.findFirst({ where: { status: "PENDING", availableAt: { lte: new Date() } }, include: { catalogImport: true }, orderBy: { createdAt: "asc" } });
  if (!job) return false;
  const claimed = await database.prisma.catalogImportJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count !== 1) return true;
  const directory = await prepareImportDirectory(config.importRoot, job.importId);
  try {
    await database.prisma.catalogImport.update({ where: { id: job.importId }, data: { status: "PROCESSING", lastError: null } });
    if (job.catalogImport.grantExpiresAt <= new Date()) throw new Error("CATALOG_IMPORT_GRANT_EXPIRED");
    const token = decryptGrantToken(job.catalogImport.tokenCiphertext, config.importGrantEncryptionKey);
    const extension = job.catalogImport.format.toLowerCase();
    const sourcePath = path.join(directory, `source.${extension}`);
    await downloadImportSource(`${config.mediaServiceUrl}/media-stream/${encodeURIComponent(job.catalogImport.assetId)}?token=${encodeURIComponent(token)}`, sourcePath, job.catalogImport.sourceSizeBytes, BigInt(config.importMaxBytes));
    const releases: DdexImportRelease[] = [];
    const archiveEntries = archiveEntriesSchema.parse(job.catalogImport.archiveEntries ?? []);
    if (job.catalogImport.format === "XML") {
      releases.push(...await parseDdexXml(sourcePath, config.importMaxEntries));
    } else if (job.catalogImport.format === "CSV") {
      releases.push(...mapSpreadsheetRows(await parseCsv(sourcePath), archiveEntries));
    } else if (job.catalogImport.format === "XLSX") {
      releases.push(...mapSpreadsheetRows(await parseXlsx(sourcePath, directory), archiveEntries));
    } else {
      const manifests = await extractImportManifests(sourcePath, directory, config.importMaxEntries, config.importMaxXmlBytes);
      for (const xmlPath of manifests.xmlFiles) releases.push(...await parseDdexXml(xmlPath, config.importMaxEntries));
      if (manifests.spreadsheet) {
        const rows = manifests.spreadsheet.format === "CSV" ? await parseCsv(manifests.spreadsheet.path) : await parseXlsx(manifests.spreadsheet.path, directory);
        releases.push(...mapSpreadsheetRows(rows, archiveEntries));
      }
    }
    if (releases.reduce((sum, release) => sum + release.tracks.length, 0) > config.importMaxEntries) throw new Error("DDEX_TOO_MANY_RESOURCES");
    const trackCount = releases.reduce((sum, release) => sum + release.tracks.length, 0);
    await database.prisma.$transaction(async transaction => {
      const artistIds = new Map<string, string>();
      const labelIds = new Map<string, string>();
      for (const release of releases) {
        let artistId: string | undefined;
        if (release.artistName) {
          artistId = artistIds.get(release.artistName.toLowerCase());
          if (!artistId) {
            const existing = await transaction.artist.findFirst({ where: { tenantId: job.catalogImport.tenantId, name: release.artistName } });
            artistId = existing?.id ?? (await transaction.artist.create({ data: { tenantId: job.catalogImport.tenantId, name: release.artistName } })).id;
            artistIds.set(release.artistName.toLowerCase(), artistId);
          }
        }
        let labelId: string | undefined;
        if (release.labelName) {
          labelId = labelIds.get(release.labelName.toLowerCase());
          if (!labelId) {
            const existing = await transaction.label.findFirst({ where: { tenantId: job.catalogImport.tenantId, name: release.labelName } });
            labelId = existing?.id ?? (await transaction.label.create({ data: { tenantId: job.catalogImport.tenantId, name: release.labelName } })).id;
            labelIds.set(release.labelName.toLowerCase(), labelId);
          }
        }
        const duplicateEan = release.ean ? await transaction.release.findUnique({ where: { ean: release.ean }, select: { id: true } }) : null;
        const created = await transaction.release.create({ data: { title: release.title, ...(release.ean && !duplicateEan ? { ean: release.ean } : {}), type: release.type, format: release.format, ...(release.genre ? { genre: release.genre } : {}), releaseDate: release.releaseDate, ...(release.displayArtist ? { displayArtist: release.displayArtist } : {}), ...(release.coverUrl ? { coverUrl: release.coverUrl } : {}), ...(artistId ? { artistId } : {}), ...(labelId ? { labelId } : {}), tenantId: job.catalogImport.tenantId, ownerId: job.catalogImport.ownerEntityId } });
        for (const track of release.tracks) {
          const duplicateIsrc = track.isrc ? await transaction.track.findUnique({ where: { isrc: track.isrc }, select: { id: true } }) : null;
          await transaction.track.create({ data: { releaseId: created.id, title: track.title, ...(track.isrc && !duplicateIsrc ? { isrc: track.isrc } : {}), trackNumber: track.trackNumber, discNumber: track.discNumber, ...(track.duration !== undefined ? { duration: track.duration } : {}), ...(track.audioAssetId ? { audioAssetId: track.audioAssetId } : {}) } });
        }
      }
      const completedAt = new Date();
      await transaction.catalogImport.update({ where: { id: job.importId }, data: { status: "COMPLETE", releaseCount: releases.length, trackCount, completedAt } });
      await transaction.catalogImportJob.update({ where: { id: job.id }, data: { status: "COMPLETE", lockedAt: null, lastError: null } });
      await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "catalog.import.completed", requestId: job.catalogImport.requestId, actorId: job.catalogImport.actorId, tenantId: job.catalogImport.tenantId, entityPath: job.catalogImport.entityPath, payload: { importId: job.importId, releaseCount: releases.length, trackCount } } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "CATALOG_IMPORT_FAILED";
    const terminal = job.attempts + 1 >= config.importWorkerMaxAttempts || message === "CATALOG_IMPORT_GRANT_EXPIRED";
    await database.prisma.$transaction(async transaction => {
      await transaction.catalogImportJob.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING", lockedAt: null, lastError: message, availableAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** job.attempts)) } });
      await transaction.catalogImport.update({ where: { id: job.importId }, data: { status: terminal ? "FAILED" : "PENDING", lastError: message } });
    });
  } finally {
    await cleanupImportDirectory(directory).catch(() => undefined);
  }
  return true;
}

export async function runCatalogImportWorker() {
  const config = loadCatalogConfig();
  const database = createCatalogDatabase(config);
  await database.prisma.catalogImportJob.updateMany({ where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } }, data: { status: "PENDING", lockedAt: null } });
  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  while (!stopping) {
    if (!(await processNextCatalogImport(database, config))) await new Promise(resolve => setTimeout(resolve, config.importWorkerPollMs));
  }
  await database.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runCatalogImportWorker();
