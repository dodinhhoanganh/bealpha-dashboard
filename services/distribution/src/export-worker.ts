import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { writeCatalogWorkbook, type CatalogExportRelease } from "./catalog-export-builder.js";
import type { DistributionConfig } from "./config.js";
import type { DistributionDatabase } from "./database.js";
import { decryptGrantToken } from "./grant-crypto.js";
import { runZip } from "./package-builder.js";
import { catalogSnapshotSchema, coverAssetId, coverResourceFileName, resourceFileName } from "./ern.js";
import { sanitizePreparationError } from "./approved-audio-preparation.js";

const releaseSchema = z.object({ id: z.string().uuid(), title: z.string(), tracks: z.array(z.object({ id: z.string().uuid(), title: z.string(), isrc: z.string().optional(), discNumber: z.number().optional(), trackNumber: z.number().optional(), audioAssetId: z.string().uuid().nullable().optional() }).passthrough()).max(10000) }).passthrough();
const grantSchema = z.object({ assetId: z.string().uuid(), token: z.string(), expiresAt: z.string().datetime({ offset: true }), fileName: z.string(), contentType: z.string(), sizeBytes: z.string().regex(/^\d+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const destinationSchema = z.object({ recipientId: z.string().regex(/^[a-z0-9_]{2,64}$/), ernXml: z.string().min(1) }).strict();
const payloadSchema = z.union([
  z.object({ releases: z.array(releaseSchema).max(10000), grants: z.array(grantSchema).max(10000) }),
  z.object({ kind: z.literal("DDEX_PACKAGE"), snapshot: z.unknown(), destinations: z.array(destinationSchema).min(1).max(64).refine(items => new Set(items.map(item => item.recipientId)).size === items.length, "Duplicate DDEX destination"), grants: z.array(grantSchema).max(10000), createdAt: z.string().datetime({ offset: true }) })
]);

function clean(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(0, 180) || "file";
}

async function sha256(filePath: string) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(filePath), new Transform({ transform(chunk: Buffer, _encoding, callback) { hash.update(chunk); callback(null, chunk); } }), new Transform({ transform(_chunk, _encoding, callback) { callback(); } }));
  return hash.digest("hex");
}

async function downloadAsset(assetId: string, tokenCiphertext: string, outputPath: string, expectedBytes: bigint, expectedSha256: string, expiresAt: string, config: DistributionConfig) {
  if (new Date(expiresAt) <= new Date()) throw new Error("EXPORT_MEDIA_GRANT_EXPIRED");
  const token = decryptGrantToken(tokenCiphertext, config.deliveryGrantEncryptionKey);
  const response = await fetch(`${config.mediaServiceUrl}/media-stream/${encodeURIComponent(assetId)}`, { headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`EXPORT_MEDIA_FETCH_FAILED_${response.status}`);
  const declared = response.headers.get("content-length");
  if (!declared || BigInt(declared) !== expectedBytes) throw new Error("EXPORT_MEDIA_SIZE_MISMATCH");
  let received = 0n; const hash = createHash("sha256");
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) { received += BigInt(chunk.length); hash.update(chunk); if (received > expectedBytes) return callback(new Error("EXPORT_MEDIA_SIZE_MISMATCH")); callback(null, chunk); } });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(outputPath, { flags: "wx" }));
  if (received !== expectedBytes) throw new Error("EXPORT_MEDIA_SIZE_MISMATCH");
  if (hash.digest("hex") !== expectedSha256) throw new Error("EXPORT_MEDIA_CHECKSUM_MISMATCH");
}

function choreographyTimestamp(value: Date) {
  if (Number.isNaN(value.getTime())) throw new Error("DELIVERY_SNAPSHOT_TIMESTAMP_INVALID");
  return value.toISOString().replace(/[-:TZ.]/g, "").slice(0, 17);
}

export async function buildCatalogExport(job: { id: string; format: "XLSX" | "ZIP"; payload: unknown }, config: DistributionConfig, zipper: typeof runZip = runZip) {
  const payload = payloadSchema.parse(job.payload);
  const root = path.resolve(config.packageRoot, "exports", job.id);
  const staging = path.join(root, "staging");
  await rm(root, { recursive: true, force: true });
  await mkdir(staging, { recursive: true });
  if ("kind" in payload) {
    if (job.format !== "ZIP") throw new Error("DDEX_PACKAGE_REQUIRES_ZIP");
    const snapshot = catalogSnapshotSchema.parse(payload.snapshot);
    const coverId = snapshot.coverUrl ? coverAssetId(snapshot.coverUrl) : undefined;
    const entryCount = payload.destinations.length * (snapshot.tracks.length + (coverId ? 1 : 0) + 1);
    if (entryCount > config.packageMaxEntries) throw new Error("DELIVERY_PACKAGE_TOO_MANY_ENTRIES");
    const grants = new Map(payload.grants.map(grant => [grant.assetId, grant]));
    const cache = path.join(staging, ".media-cache"); await mkdir(cache, { recursive: true });
    let packageBytes = payload.destinations.reduce((sum, destination) => sum + Buffer.byteLength(destination.ernXml), 0);
    for (const grant of payload.grants) packageBytes += Number(BigInt(grant.sizeBytes) * BigInt(payload.destinations.length));
    if (!Number.isSafeInteger(packageBytes) || packageBytes > config.packageMaxBytes) throw new Error("DELIVERY_PACKAGE_TOO_LARGE");
    for (const grant of payload.grants) await downloadAsset(grant.assetId, grant.token, path.join(cache, grant.assetId), BigInt(grant.sizeBytes), grant.sha256, grant.expiresAt, config);
    const folderName = `N_${snapshot.ean}_${choreographyTimestamp(new Date(payload.createdAt))}`; const entries: string[] = [];
    for (const destination of payload.destinations) {
      const destinationRoot = path.join(staging, destination.recipientId, folderName); await mkdir(path.join(destinationRoot, "resources"), { recursive: true }); await mkdir(path.join(destinationRoot, "acknowledgements"), { recursive: true });
      for (const [index, track] of snapshot.tracks.entries()) {
        const grant = grants.get(track.audioAssetId); if (!grant) throw new Error("DELIVERY_GRANT_MISSING");
        const relative = `${destination.recipientId}/${folderName}/resources/${resourceFileName(snapshot, index, { fileName: grant.fileName, contentType: grant.contentType, sizeBytes: BigInt(grant.sizeBytes) })}`;
        await copyFile(path.join(cache, grant.assetId), path.join(staging, ...relative.split("/"))); entries.push(relative);
      }
      if (coverId) {
        const grant = grants.get(coverId); if (!grant) throw new Error("DELIVERY_COVER_GRANT_MISSING");
        const relative = `${destination.recipientId}/${folderName}/resources/${coverResourceFileName(snapshot, { fileName: grant.fileName, contentType: grant.contentType, sizeBytes: BigInt(grant.sizeBytes), sha256: grant.sha256 })}`;
        await copyFile(path.join(cache, grant.assetId), path.join(staging, ...relative.split("/"))); entries.push(relative);
      }
      const manifestRelative = `${destination.recipientId}/${folderName}/${snapshot.ean}.xml`; await writeFile(path.join(staging, ...manifestRelative.split("/")), destination.ernXml, { encoding: "utf8", flag: "wx" }); entries.push(manifestRelative);
    }
    const outputPath = path.join(root, `${job.id}.zip`);
    await zipper(staging, outputPath, entries);
    const outputInfo = await stat(outputPath);
    if (outputInfo.size > config.packageMaxBytes) throw new Error("EXPORT_TOO_LARGE");
    return { outputPath, fileName: `${clean(snapshot.title)}_DDEX_targets.zip`, contentType: "application/zip", sizeBytes: BigInt(outputInfo.size), sha256: await sha256(outputPath) };
  }
  const workbookName = "catalog.xlsx";
  const workbookPath = path.join(staging, workbookName);
  await writeCatalogWorkbook(workbookPath, payload.releases as CatalogExportRelease[], zipper);
  const workbookInfo = await stat(workbookPath);
  if (workbookInfo.size > config.packageMaxBytes) throw new Error("EXPORT_TOO_LARGE");
  let outputPath = workbookPath;
  let fileName = `bealpha_catalog_${new Date().toISOString().slice(0, 10)}.xlsx`;
  let contentType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (job.format === "ZIP") {
    const tracks = payload.releases.flatMap(release => release.tracks);
    if (tracks.length + 1 > config.packageMaxEntries) throw new Error("EXPORT_TOO_MANY_ENTRIES");
    const grants = new Map(payload.grants.map(grant => [grant.assetId, grant]));
    let totalBytes = BigInt(workbookInfo.size);
    const entries = [workbookName];
    await mkdir(path.join(staging, "resources"), { recursive: true });
    for (const track of tracks) {
      if (!track.audioAssetId) throw new Error("EXPORT_ASSET_MISSING");
      const grant = grants.get(track.audioAssetId);
      if (!grant) throw new Error("EXPORT_GRANT_MISSING");
      const expectedBytes = BigInt(grant.sizeBytes);
      totalBytes += expectedBytes;
      if (totalBytes > BigInt(config.packageMaxBytes)) throw new Error("EXPORT_TOO_LARGE");
      const extension = /^\.[A-Za-z0-9]{1,8}$/.test(path.extname(grant.fileName)) ? path.extname(grant.fileName).toLowerCase() : ".bin";
      const resourceName = `${String(track.discNumber ?? 1).padStart(2, "0")}_${String(track.trackNumber ?? 1).padStart(4, "0")}_${clean(track.isrc ?? track.id)}${extension}`;
      const relativePath = `resources/${resourceName}`;
      await downloadAsset(grant.assetId, grant.token, path.join(staging, "resources", resourceName), expectedBytes, grant.sha256, grant.expiresAt, config);
      entries.push(relativePath);
    }
    outputPath = path.join(root, `${job.id}.zip`);
    await zipper(staging, outputPath, entries);
    fileName = `${clean(payload.releases[0]?.title ?? "release")}_bealpha_DDEX_${new Date().toISOString().slice(0, 10)}.zip`;
    contentType = "application/zip";
  }
  const outputInfo = await stat(outputPath);
  if (outputInfo.size > config.packageMaxBytes) throw new Error("EXPORT_TOO_LARGE");
  return { outputPath, fileName, contentType, sizeBytes: BigInt(outputInfo.size), sha256: await sha256(outputPath) };
}

export async function processNextExportJob(database: DistributionDatabase, config: DistributionConfig): Promise<boolean> {
  const job = await database.prisma.exportJob.findFirst({ where: { status: "PENDING", availableAt: { lte: new Date() }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "asc" } });
  if (!job) return false;
  const claimed = await database.prisma.exportJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count !== 1) return true;
  try {
    const output = await buildCatalogExport(job, config);
    await database.prisma.exportJob.update({ where: { id: job.id }, data: { status: "COMPLETE", lockedAt: null, lastError: null, ...output } });
  } catch (error) {
    const automaticDdex = job.payload && typeof job.payload === "object" && (job.payload as { kind?: unknown }).kind === "DDEX_PACKAGE";
    const message = automaticDdex ? sanitizePreparationError(error) : error instanceof Error ? error.message.slice(0, 1000) : "EXPORT_FAILED";
    const terminal = job.attempts + 1 >= config.workerMaxAttempts;
    await database.prisma.exportJob.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING", lockedAt: null, lastError: message, availableAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** job.attempts)) } });
  }
  return true;
}
