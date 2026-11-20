import { execFile } from "node:child_process";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { validateCatalogImportSource } from "./archive-validator.js";
import { loadMediaConfig } from "./config.js";
import { createMediaDatabase, type MediaDatabase } from "./database.js";
import { materializeArchiveEntries } from "./archive-materializer.js";
import { createAudioPreview, previewStorageKey } from "./media-preview.js";
import { Prisma } from "./generated/media-prisma-v2/client.js";
import { parseFrameRate, validateVevoVideoProbe, VevoVideoQcError } from "./vevo-video-profile.js";

const execute = promisify(execFile);

function storagePath(root: string, key: string): string {
  const resolved = path.resolve(root, key);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("STORAGE_PATH_INVALID");
  return resolved;
}

async function inspectMedia(filePath: string, type: string) {
  if (type === "IMAGE") {
    const handle = await open(filePath, "r");
    try {
      const header = Buffer.alloc(12);
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      const jpeg = bytesRead >= 3 && header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
      const png = bytesRead >= 8 && header.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const webp = bytesRead >= 12 && header.subarray(0, 4).toString("ascii") === "RIFF" && header.subarray(8, 12).toString("ascii") === "WEBP";
      if (!jpeg && !png && !webp) throw new Error("IMAGE_MAGIC_INVALID");
      return {};
    } finally { await handle.close(); }
  }
  if (type === "SUBTITLE") return {};
  const { stdout } = await execute("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", filePath], { timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  const probe = JSON.parse(stdout) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const audio = probe.streams?.find(stream => stream.codec_type === "audio");
  const video = probe.streams?.find(stream => stream.codec_type === "video");
  let vevoQc: ReturnType<typeof validateVevoVideoProbe> | undefined;
  if (type === "AUDIO") {
    const codec = String(audio?.codec_name ?? "");
    const sampleRate = Number(audio?.sample_rate ?? 0);
    const bitDepth = Number(audio?.bits_per_raw_sample ?? audio?.bits_per_sample ?? 0);
    if (!audio || !codec.startsWith("pcm_") || sampleRate < 44100 || ![16, 24].includes(bitDepth)) throw new Error("AUDIO_MASTER_SPEC_INVALID");
  }
  if (type === "VIDEO") {
    vevoQc = validateVevoVideoProbe({
      formatName: String(probe.format?.format_name ?? ""),
      formatBitRate: Number(probe.format?.bit_rate ?? 0) || undefined,
      video: video ? {
        codecName: String(video.codec_name ?? ""),
        pixelFormat: String(video.pix_fmt ?? ""),
        bitRate: Number(video.bit_rate ?? 0) || undefined,
        width: Number(video.width ?? 0),
        height: Number(video.height ?? 0),
        frameRate: String(video.avg_frame_rate ?? video.r_frame_rate ?? ""),
        fieldOrder: String(video.field_order ?? "unknown"),
        hasBFrames: Number(video.has_b_frames ?? 0),
      } : undefined,
      audio: audio ? {
        codecName: String(audio.codec_name ?? ""),
        channels: Number(audio.channels ?? 0),
        sampleRate: Number(audio.sample_rate ?? 0),
        bitRate: Number(audio.bit_rate ?? 0) || undefined,
      } : undefined,
    });
  }
  if (["CANVAS", "MOTION"].includes(type) && !video) throw new Error("VIDEO_STREAM_MISSING");
  return {
    durationSeconds: Math.round(Number(probe.format?.duration ?? 0)) || null,
    sampleRate: audio ? Number(audio.sample_rate ?? 0) || null : null,
    bitRate: Number(probe.format?.bit_rate ?? audio?.bit_rate ?? video?.bit_rate ?? 0) || null,
    channels: audio ? Number(audio.channels ?? 0) || null : null,
    bitDepth: audio ? Number(audio.bits_per_raw_sample ?? audio.bits_per_sample ?? 0) || null : null,
    codec: String((audio ?? video)?.codec_name ?? "") || null,
    width: video ? Number(video.width ?? 0) || null : null,
    height: video ? Number(video.height ?? 0) || null : null,
    frameRate: video ? parseFrameRate(String(video.avg_frame_rate ?? video.r_frame_rate ?? ""))?.toFixed(3) ?? null : null,
    videoCodec: video ? String(video.codec_name ?? "") || null : null,
    audioCodec: audio ? String(audio.codec_name ?? "") || null : null,
    ...(vevoQc ? {
      qcProfile: vevoQc.profile,
      qcProfileVersion: vevoQc.profileVersion,
      qcResult: vevoQc as unknown as Prisma.InputJsonValue,
      qcValidatedAt: new Date(),
    } : {}),
  };
}

export async function processNextMediaJob(
  database: MediaDatabase,
  storageRoot: string,
  maxAttempts: number,
  previewer: (source: string, destination: string) => Promise<void> = createAudioPreview,
): Promise<boolean> {
  const job = await database.prisma.processingJob.findFirst({ where: { status: "PENDING", availableAt: { lte: new Date() } }, include: { asset: true }, orderBy: { createdAt: "asc" } });
  if (!job) return false;
  const claimed = await database.prisma.processingJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count !== 1) return true;
  try {
    const filePath = storagePath(storageRoot, job.asset.storageKey);
    let mediaMetadata: Awaited<ReturnType<typeof inspectMedia>> | null = null;
    let eventValidation: Record<string, string | number | null | undefined>;
    if (job.type === "VALIDATE_ARCHIVE") {
      const archive = await validateCatalogImportSource(filePath, job.asset.fileName, job.asset.mimeType);
      const materializedAssets = archive.kind === "ZIP" ? await materializeArchiveEntries(database, job.asset, filePath, storageRoot, job.requestId) : 0;
      eventValidation = archive.kind === "ZIP"
        ? { kind: archive.kind, entries: archive.entries, compressedBytes: archive.compressedBytes.toString(), expandedBytes: archive.expandedBytes.toString(), materializedAssets }
        : { kind: archive.kind, bytes: archive.bytes };
    } else {
      mediaMetadata = await inspectMedia(filePath, job.asset.type);
      if (job.asset.type === "AUDIO") {
        await previewer(filePath, storagePath(storageRoot, previewStorageKey(job.asset.storageKey)));
      }
      eventValidation = mediaMetadata;
    }
    await database.prisma.$transaction(async transaction => {
      await transaction.asset.update({ where: { id: job.assetId }, data: { status: "READY", processedAt: new Date(), processingError: null, ...(mediaMetadata ?? {}) } });
      await transaction.processingJob.update({ where: { id: job.id }, data: { status: "COMPLETE", lockedAt: null, lastError: null } });
      await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "media.asset.ready", requestId: job.requestId, actorId: job.asset.uploaderId, tenantId: job.asset.tenantId, entityPath: job.asset.ownerEntityPath, payload: { assetId: job.assetId, validation: eventValidation } } });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "MEDIA_PROCESSING_FAILED";
    const terminal = job.attempts + 1 >= maxAttempts;
    const failedQc = error instanceof VevoVideoQcError ? error.result : null;
    await database.prisma.$transaction(async transaction => {
      await transaction.processingJob.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING", lockedAt: null, lastError: message, availableAt: new Date(Date.now() + Math.min(60000, 1000 * 2 ** job.attempts)) } });
      if (terminal) await transaction.asset.update({
        where: { id: job.assetId },
        data: {
          status: "ERROR",
          processingError: message,
          ...(failedQc ? {
            qcProfile: failedQc.profile,
            qcProfileVersion: failedQc.profileVersion,
            qcResult: failedQc as unknown as Prisma.InputJsonValue,
            qcValidatedAt: new Date(),
          } : {}),
        },
      });
    });
  }
  return true;
}

export async function cleanupExpiredArchiveSources(database: MediaDatabase, storageRoot: string, retentionSeconds: number): Promise<number> {
  const assets = await database.prisma.asset.findMany({ where: { type: "ARCHIVE", status: "READY", processedAt: { lt: new Date(Date.now() - retentionSeconds * 1000) } }, take: 10, orderBy: { processedAt: "asc" } });
  for (const asset of assets) {
    await rm(storagePath(storageRoot, asset.storageKey), { force: true });
    await database.prisma.$transaction(async transaction => {
      await transaction.asset.update({ where: { id: asset.id }, data: { status: "ARCHIVED" } });
      await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "media.archive-source.expired", requestId: randomUUID(), actorId: asset.uploaderId, tenantId: asset.tenantId, entityPath: asset.ownerEntityPath, payload: { assetId: asset.id, retentionSeconds } } });
    });
  }
  return assets.length;
}

export async function runMediaWorker(): Promise<void> {
  const config = loadMediaConfig();
  const database = createMediaDatabase(config);
  await database.prisma.processingJob.updateMany({ where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } }, data: { status: "PENDING", lockedAt: null } });
  let stopping = false;
  let lastCleanupAt = 0;
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  while (!stopping) {
    const processed = await processNextMediaJob(database, config.storageRoot, config.workerMaxAttempts);
    if (Date.now() - lastCleanupAt >= 60000) { await cleanupExpiredArchiveSources(database, config.storageRoot, config.archiveRetentionSeconds); lastCleanupAt = Date.now(); }
    if (!processed) await new Promise(resolve => setTimeout(resolve, config.workerPollMs));
  }
  await database.close();
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runMediaWorker();
}
