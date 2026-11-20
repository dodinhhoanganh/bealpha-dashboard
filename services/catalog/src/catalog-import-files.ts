import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable, Transform } from "node:stream";

import unzipper from "unzipper";

function safeEntryName(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized.length > 0 && normalized.length <= 1024 && !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized) && !normalized.split("/").includes("..");
}

export async function downloadImportSource(url: string, outputPath: string, expectedBytes: bigint, maxBytes: bigint): Promise<void> {
  if (expectedBytes <= 0n || expectedBytes > maxBytes) throw new Error("CATALOG_IMPORT_SOURCE_TOO_LARGE");
  const response = await fetch(url, { signal: AbortSignal.timeout(60 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error(`CATALOG_IMPORT_MEDIA_FETCH_FAILED_${response.status}`);
  const declared = response.headers.get("content-length");
  if (!declared || BigInt(declared) !== expectedBytes) throw new Error("CATALOG_IMPORT_SOURCE_SIZE_MISMATCH");
  let received = 0n;
  const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
    received += BigInt(chunk.length);
    if (received > expectedBytes || received > maxBytes) return callback(new Error("CATALOG_IMPORT_SOURCE_SIZE_MISMATCH"));
    callback(null, chunk);
  } });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(outputPath, { flags: "wx" }));
  if (received !== expectedBytes) throw new Error("CATALOG_IMPORT_SOURCE_SIZE_MISMATCH");
}

export async function extractImportManifests(archivePath: string, outputDirectory: string, maxEntries: number, maxManifestBytes: number): Promise<{ xmlFiles: string[]; spreadsheet?: { path: string; format: "CSV" | "XLSX" } }> {
  const parser = createReadStream(archivePath).pipe(unzipper.Parse({ forceStream: true }));
  let entries = 0;
  let totalXmlBytes = 0;
  const xmlFiles: string[] = [];
  let spreadsheet: { path: string; format: "CSV" | "XLSX" } | undefined;
  const names = new Set<string>();
  for await (const entry of parser) {
    entries += 1;
    if (entries > maxEntries) throw new Error("CATALOG_IMPORT_TOO_MANY_ENTRIES");
    if (!safeEntryName(entry.path)) throw new Error("CATALOG_IMPORT_UNSAFE_ENTRY");
    const normalizedName = entry.path.replace(/\\/g, "/").toLowerCase();
    if (names.has(normalizedName)) throw new Error("CATALOG_IMPORT_DUPLICATE_ENTRY");
    names.add(normalizedName);
    const spreadsheetFormat = normalizedName.endsWith(".csv") ? "CSV" : normalizedName.endsWith(".xlsx") || normalizedName.endsWith(".xls") ? "XLSX" : undefined;
    if (entry.type === "File" && (normalizedName.endsWith(".xml") || spreadsheetFormat)) {
      if (spreadsheetFormat && spreadsheet) throw new Error("CATALOG_IMPORT_MULTIPLE_SPREADSHEETS");
      const outputPath = path.join(outputDirectory, `ddex-${String(xmlFiles.length + 1).padStart(5, "0")}.xml`);
      const manifestPath = spreadsheetFormat ? path.join(outputDirectory, `manifest.${spreadsheetFormat.toLowerCase()}`) : outputPath;
      let received = 0;
      const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        totalXmlBytes += chunk.length;
        if (received > maxManifestBytes || totalXmlBytes > maxManifestBytes) return callback(new Error("CATALOG_IMPORT_MANIFEST_TOO_LARGE"));
        callback(null, chunk);
      } });
      await pipeline(entry, meter, createWriteStream(manifestPath, { flags: "wx" }));
      if (spreadsheetFormat) spreadsheet = { path: manifestPath, format: spreadsheetFormat };
      else xmlFiles.push(outputPath);
    } else {
      entry.autodrain();
    }
  }
  if (xmlFiles.length > 0 && spreadsheet) throw new Error("CATALOG_IMPORT_AMBIGUOUS_MANIFEST");
  if (xmlFiles.length === 0 && !spreadsheet) throw new Error("CATALOG_IMPORT_MANIFEST_NOT_FOUND");
  for (const file of xmlFiles) if (!(await stat(file).catch(() => null))?.isFile()) throw new Error("CATALOG_IMPORT_XML_NOT_FOUND");
  return { xmlFiles, ...(spreadsheet ? { spreadsheet } : {}) };
}

export async function prepareImportDirectory(root: string, importId: string): Promise<string> {
  const resolvedRoot = path.resolve(root);
  const directory = path.resolve(resolvedRoot, importId);
  if (!directory.startsWith(`${resolvedRoot}${path.sep}`)) throw new Error("CATALOG_IMPORT_PATH_INVALID");
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  return directory;
}

export async function cleanupImportDirectory(directory: string): Promise<void> {
  await rm(directory, { recursive: true, force: true });
}
