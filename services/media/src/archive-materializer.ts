import { createHash, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { MAX_ZIP_BYTES, MAX_ZIP_ENTRIES } from "@bealpha/contracts";
import unzipper from "unzipper";

import type { MediaDatabase } from "./database.js";

interface ArchiveAsset {
  id: string;
  tenantId: string;
  ownerEntityId: string;
  ownerEntityPath: string;
  uploaderId: string;
}

const AUDIO_TYPES: Record<string, string> = { ".wav": "audio/wav", ".flac": "audio/flac", ".aif": "audio/aiff", ".aiff": "audio/aiff", ".mp3": "audio/mpeg", ".aac": "audio/aac", ".ogg": "audio/ogg", ".m4a": "audio/mp4", ".alac": "audio/mp4", ".wma": "audio/x-ms-wma" };
const IMAGE_TYPES: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const VIDEO_TYPES: Record<string, string> = { ".mov": "video/quicktime", ".mp4": "video/mp4" };

function entryType(fileName: string): { type: "AUDIO" | "IMAGE" | "VIDEO"; contentType: string; maxBytes: number } | undefined {
  const extension = path.extname(fileName).toLowerCase();
  if (AUDIO_TYPES[extension]) return { type: "AUDIO", contentType: AUDIO_TYPES[extension], maxBytes: MAX_ZIP_BYTES };
  if (IMAGE_TYPES[extension]) return { type: "IMAGE", contentType: IMAGE_TYPES[extension], maxBytes: 25 * 1024 * 1024 };
  if (VIDEO_TYPES[extension]) return { type: "VIDEO", contentType: VIDEO_TYPES[extension], maxBytes: MAX_ZIP_BYTES };
  return undefined;
}

function safeEntryName(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return normalized.length > 0 && normalized.length <= 1024 && !normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized) && !normalized.split("/").some(part => part === ".." || part === ".");
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function materializeArchiveEntries(database: MediaDatabase, archive: ArchiveAsset, archivePath: string, storageRoot: string, requestId: string): Promise<number> {
  const parser = createReadStream(archivePath).pipe(unzipper.Parse({ forceStream: true }));
  const existing = await database.prisma.archiveEntry.findMany({ where: { archiveAssetId: archive.id }, select: { entryName: true } });
  const completed = new Set(existing.map(item => item.entryName.toLowerCase()));
  const seenPaths = new Set<string>();
  const seenFileNames = new Set<string>();
  let entryCount = 0;
  let materializedCount = existing.length;
  let totalBytes = 0;

  for await (const entry of parser) {
    entryCount += 1;
    if (entryCount > MAX_ZIP_ENTRIES) throw new Error("ZIP_TOO_MANY_ENTRIES");
    if (!safeEntryName(entry.path)) throw new Error("ZIP_UNSAFE_PATH");
    const normalizedPath = entry.path.replace(/\\/g, "/").toLowerCase();
    if (seenPaths.has(normalizedPath)) throw new Error("ZIP_DUPLICATE_ENTRY");
    seenPaths.add(normalizedPath);
    const fileName = path.basename(entry.path);
    const media = entry.type === "File" ? entryType(fileName) : undefined;
    if (!media) {
      entry.autodrain();
      continue;
    }
    if (fileName.length > 255) throw new Error("ZIP_ENTRY_NAME_TOO_LONG");
    const normalizedFileName = fileName.toLowerCase();
    if (seenFileNames.has(normalizedFileName)) throw new Error("ZIP_DUPLICATE_MEDIA_NAME");
    seenFileNames.add(normalizedFileName);
    if (completed.has(normalizedPath)) {
      entry.autodrain();
      continue;
    }

    const uploadId = deterministicUuid(`${archive.id}:${normalizedPath}:upload`);
    const assetId = deterministicUuid(`${archive.id}:${normalizedPath}:asset`);
    const storageKey = `${archive.tenantId}/${uploadId}/original`;
    const outputPath = path.resolve(storageRoot, storageKey);
    const relative = path.relative(storageRoot, outputPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("STORAGE_PATH_INVALID");
    await rm(path.dirname(outputPath), { recursive: true, force: true });
    await mkdir(path.dirname(outputPath), { recursive: true });
    let bytes = 0;
    const digest = createHash("sha256");
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      totalBytes += chunk.length;
      if (bytes > media.maxBytes || totalBytes > MAX_ZIP_BYTES * 2) return callback(new Error("ZIP_EXPANDED_TOO_LARGE"));
      digest.update(chunk);
      callback(null, chunk);
    } });
    try {
      await pipeline(entry, meter, createWriteStream(outputPath, { flags: "wx" }));
      if (bytes <= 0) throw new Error("ZIP_EMPTY_MEDIA_ENTRY");
      const sha256 = digest.digest("hex");
      const now = new Date();
      await database.prisma.$transaction(async transaction => {
        await transaction.uploadIntent.create({ data: { id: uploadId, tenantId: archive.tenantId, ownerEntityId: archive.ownerEntityId, ownerEntityPath: archive.ownerEntityPath, actorId: archive.uploaderId, assetType: media.type, fileName, contentType: media.contentType, sizeBytes: BigInt(bytes), sha256, tokenHash: createHash("sha256").update(randomBytes(32)).digest("hex"), storageKey, status: "COMPLETE", expiresAt: now, consumedAt: now } });
        await transaction.asset.create({ data: { id: assetId, uploadIntentId: uploadId, tenantId: archive.tenantId, ownerEntityId: archive.ownerEntityId, ownerEntityPath: archive.ownerEntityPath, uploaderId: archive.uploaderId, type: media.type, fileName, storageKey, fileSize: BigInt(bytes), mimeType: media.contentType, sha256, status: "PROCESSING" } });
        await transaction.archiveEntry.create({ data: { archiveAssetId: archive.id, assetId, entryName: normalizedPath } });
        await transaction.processingJob.create({ data: { assetId, requestId, type: "INSPECT_MEDIA" } });
      });
      materializedCount += 1;
    } catch (error) {
      await rm(path.dirname(outputPath), { recursive: true, force: true }).catch(() => undefined);
      throw error;
    }
  }
  return materializedCount;
}
