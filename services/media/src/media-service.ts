import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform, type Readable } from "node:stream";
import type { InternalAuthContext, UploadIntentRequest } from "@bealpha/contracts";
import type { MediaConfig } from "./config.js";
import type { MediaDatabase } from "./database.js";
import { MediaError } from "./errors.js";
import { previewStorageKey } from "./media-preview.js";
import { VEVO_VIDEO_PROFILE_VERSION } from "./vevo-video-profile.js";

type UserContext = InternalAuthContext & { actorId: string; entityId: string; entityPath: string; entityType: string };

function userContext(context: InternalAuthContext): UserContext {
  if (context.authType !== "user" || !context.actorId || !context.entityId || !context.entityPath || !context.entityType) throw new MediaError(403, "FORBIDDEN", "Media access requires an entity membership");
  return context as UserContext;
}

function deliveryActor(context: InternalAuthContext): UserContext {
  const actor = userContext(context);
  if (actor.entityType === "SUB_ACCOUNT" || !actor.entityRole || !["OWNER", "ADMIN"].includes(actor.entityRole)) {
    throw new MediaError(403, "FORBIDDEN", "Owner or administrator role required to retrieve delivery media");
  }
  return actor;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function visiblePath(pathValue: string) {
  return { OR: [{ ownerEntityPath: pathValue }, { ownerEntityPath: { startsWith: `${pathValue}.` } }] };
}

function hasCurrentVevoQc(asset: { type: string; qcProfileVersion?: string | null; qcResult?: unknown }): boolean {
  if (asset.type !== "VIDEO") return true;
  if (asset.qcProfileVersion !== VEVO_VIDEO_PROFILE_VERSION) return false;
  const result = asset.qcResult;
  return Boolean(result && typeof result === "object" && !Array.isArray(result) && (result as { compliant?: unknown }).compliant === true);
}

export class MediaService {
  private activeUploads = 0;
  private activeStreams = 0;

  constructor(private readonly database: MediaDatabase, private readonly config: MediaConfig) {}

  async createUploadIntent(context: InternalAuthContext, input: UploadIntentRequest) {
    const actor = userContext(context);
    if (input.sizeBytes > this.config.uploadMaxBytes) throw new MediaError(413, "PAYLOAD_TOO_LARGE", "Upload exceeds media-service limit");
    if (input.assetType === "IMAGE" && input.sizeBytes > 25 * 1024 * 1024) throw new MediaError(413, "PAYLOAD_TOO_LARGE", "Image exceeds 25 MiB limit");
    if (input.assetType === "IMAGE" && !["image/jpeg", "image/png", "image/webp"].includes(input.contentType)) throw new MediaError(415, "CONTENT_TYPE_MISMATCH", "Unsupported image content type");
    if (input.assetType === "VIDEO") {
      const extension = path.extname(input.fileName).toLowerCase();
      const accepted = (extension === ".mp4" && input.contentType === "video/mp4") ||
        (extension === ".mov" && input.contentType === "video/quicktime");
      if (!accepted) throw new MediaError(415, "CONTENT_TYPE_MISMATCH", "VEVO video masters must be MP4 or MOV");
    }
    const tenantId = actor.tenantId ?? actor.entityId;
    const uploadId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.uploadTtlSeconds * 1000);
    const storageKey = `${tenantId}/${uploadId}/original`;
    await this.database.prisma.$transaction(async transaction => {
      await transaction.uploadIntent.create({
        data: {
          id: uploadId,
          tenantId,
          ownerEntityId: actor.entityId,
          ownerEntityPath: actor.entityPath,
          actorId: actor.actorId,
          assetType: input.assetType,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: BigInt(input.sizeBytes),
          sha256: input.sha256,
          tokenHash: hashToken(token),
          storageKey,
          releaseId: input.releaseId,
          trackId: input.trackId,
          expiresAt
        }
      });
      await transaction.outboxEvent.create({
        data: {
          eventId: randomUUID(),
          version: 1,
          type: "media.upload-intent.created",
          requestId: context.requestId,
          actorId: actor.actorId,
          tenantId,
          entityPath: actor.entityPath,
          payload: { uploadId, assetType: input.assetType, sizeBytes: String(input.sizeBytes) }
        }
      });
    });
    return {
      uploadId,
      method: "PUT" as const,
      url: `${this.config.publicBaseUrl}/media-upload/${uploadId}?token=${encodeURIComponent(token)}`,
      headers: { "content-type": input.contentType, "content-length": String(input.sizeBytes) },
      expiresAt: expiresAt.toISOString(),
      maxBytes: input.sizeBytes
    };
  }

  async listAssets(context: InternalAuthContext) {
    const actor = userContext(context);
    const where = actor.entityType === "SUB_ACCOUNT" ? { ownerEntityId: actor.entityId } : visiblePath(actor.entityPath);
    return this.database.prisma.asset.findMany({ where: { ...where, status: { not: "ARCHIVED" } }, orderBy: { createdAt: "desc" }, take: 100 });
  }

  async getAsset(context: InternalAuthContext, assetId: string) {
    return this.assetForAccess(context, assetId);
  }

  private async assetForAccess(context: InternalAuthContext, assetId: string) {
    const actor = userContext(context);
    const asset = await this.database.prisma.asset.findUnique({ where: { id: assetId } });
    const sameTenant = asset && (actor.entityType === "SUPER_ADMIN" || !actor.tenantId || asset.tenantId === actor.tenantId);
    const accessible = sameTenant && (asset.ownerEntityId === actor.entityId || (actor.entityType !== "SUB_ACCOUNT" && (asset.ownerEntityPath === actor.entityPath || asset.ownerEntityPath.startsWith(`${actor.entityPath}.`))));
    if (!accessible) throw new MediaError(404, "NOT_FOUND", "Media asset not found");
    return asset;
  }

  async publishImage(context: InternalAuthContext, assetId: string, requestId: string) {
    const actor = userContext(context);
    if (actor.entityType === "SUB_ACCOUNT" || (actor.entityType !== "SUPER_ADMIN" && actor.entityRole !== "OWNER" && actor.entityRole !== "ADMIN")) {
      throw new MediaError(403, "FORBIDDEN", "Image publication requires an owner or administrator");
    }
    const asset = await this.assetForAccess(context, assetId);
    if (asset.type !== "IMAGE") throw new MediaError(400, "NOT_IMAGE", "Media asset is not an image");
    if (asset.status !== "READY") throw new MediaError(409, "ASSET_NOT_READY", "Image is not ready for publication");
    if (!asset.publishedAt) {
      const publishedAt = new Date();
      await this.database.prisma.$transaction(async transaction => {
        await transaction.asset.update({ where: { id: asset.id }, data: { publishedAt, publishedById: actor.actorId } });
        await transaction.outboxEvent.create({
          data: {
            eventId: randomUUID(),
            version: 1,
            type: "media.image.published",
            requestId,
            actorId: actor.actorId,
            tenantId: asset.tenantId,
            entityPath: asset.ownerEntityPath,
            payload: { assetId: asset.id, releaseId: asset.releaseId, trackId: asset.trackId, publishedAt: publishedAt.toISOString() },
          },
        });
      });
    }
    return { assetId: asset.id, url: `${this.config.publicBaseUrl}/media-public/${asset.id}` };
  }

  async archiveAsset(context: InternalAuthContext, assetId: string, requestId: string) {
    const actor = userContext(context);
    const asset = await this.assetForAccess(context, assetId);
    const filePath = path.resolve(this.config.storageRoot, asset.storageKey);
    const relative = path.relative(this.config.storageRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new MediaError(404, "NOT_FOUND", "Media asset not found");
    }
    await rm(filePath, { force: true });
    if (asset.type === "AUDIO") {
      await rm(path.resolve(this.config.storageRoot, previewStorageKey(asset.storageKey)), { force: true });
    }
    await this.database.prisma.$transaction(async transaction => {
      await transaction.asset.update({
        where: { id: asset.id },
        data: { status: "ARCHIVED" }
      });
      await transaction.outboxEvent.create({
        data: {
          eventId: randomUUID(),
          version: 1,
          type: "media.asset.archived",
          requestId,
          actorId: actor.actorId,
          tenantId: asset.tenantId,
          entityPath: asset.ownerEntityPath,
          payload: { assetId: asset.id, releaseId: asset.releaseId, trackId: asset.trackId }
        }
      });
    });
  }

  async createStreamGrant(context: InternalAuthContext, assetId: string) {
    const actor = userContext(context);
    const asset = await this.assetForAccess(context, assetId);
    if (asset.status !== "READY") throw new MediaError(409, "ASSET_NOT_READY", "Media asset is not ready for streaming");
    if (asset.type === "AUDIO") {
      const previewPath = path.resolve(this.config.storageRoot, previewStorageKey(asset.storageKey));
      const preview = await stat(previewPath).catch(() => null);
      if (!preview?.isFile() || preview.size === 0) throw new MediaError(409, "PREVIEW_NOT_READY", "Audio preview is not ready for streaming");
    }
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.streamGrantTtlSeconds * 1000);
    await this.database.prisma.streamGrant.create({ data: { assetId: asset.id, tenantId: asset.tenantId, actorId: actor.actorId, tokenHash: hashToken(token), maxUses: this.config.previewGrantMaxUses, expiresAt } });
    return { url: `${this.config.publicBaseUrl}/media-stream/${asset.id}?token=${encodeURIComponent(token)}`, expiresAt: expiresAt.toISOString(), singleUse: this.config.previewGrantMaxUses === 1, maxUses: this.config.previewGrantMaxUses };
  }

  async createDeliveryGrant(context: InternalAuthContext, assetId: string) {
    const actor = deliveryActor(context);
    const asset = await this.assetForAccess(context, assetId);
    if (asset.status !== "READY") throw new MediaError(409, "ASSET_NOT_READY", "Media asset is not ready for delivery");
    if (!hasCurrentVevoQc(asset)) throw new MediaError(409, "VEVO_QC_REQUIRED", "Video asset requires current VEVO technical QC");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + this.config.deliveryGrantTtlSeconds * 1000);
    await this.database.prisma.streamGrant.create({ data: { assetId: asset.id, tenantId: asset.tenantId, actorId: actor.actorId, tokenHash: hashToken(token), purpose: "DELIVERY", maxUses: this.config.deliveryGrantMaxUses, expiresAt } });
    return { assetId: asset.id, token, expiresAt: expiresAt.toISOString(), singleUse: this.config.deliveryGrantMaxUses === 1, maxUses: this.config.deliveryGrantMaxUses, fileName: asset.fileName, contentType: asset.mimeType, sizeBytes: asset.fileSize.toString(), sha256: asset.sha256 };
  }

  async createDeliveryGrants(context: InternalAuthContext, assetIds: string[]) {
    const actor = deliveryActor(context);
    const uniqueIds = [...new Set(assetIds)];
    const assets = await this.database.prisma.asset.findMany({
      where: { id: { in: uniqueIds }, status: "READY", ...visiblePath(actor.entityPath) },
      select: { id: true, tenantId: true, fileName: true, mimeType: true, fileSize: true, sha256: true, type: true, qcProfileVersion: true, qcResult: true },
    });
    if (assets.length !== uniqueIds.length) {
      throw new MediaError(404, "NOT_FOUND", "One or more media assets are unavailable or outside scope");
    }
    if (assets.some(asset => !hasCurrentVevoQc(asset))) {
      throw new MediaError(409, "VEVO_QC_REQUIRED", "One or more video assets require current VEVO technical QC");
    }
    const expiresAt = new Date(Date.now() + this.config.deliveryGrantTtlSeconds * 1000);
    const grants = assets.map(asset => ({ asset, token: randomBytes(32).toString("base64url") }));
    await this.database.prisma.streamGrant.createMany({
      data: grants.map(({ asset, token }) => ({
        assetId: asset.id,
        tenantId: asset.tenantId,
        actorId: actor.actorId,
        tokenHash: hashToken(token),
        purpose: "DELIVERY",
        maxUses: this.config.deliveryGrantMaxUses,
        expiresAt,
      })),
    });
    return grants.map(({ asset, token }) => ({
      assetId: asset.id,
      token,
      expiresAt: expiresAt.toISOString(),
      singleUse: this.config.deliveryGrantMaxUses === 1,
      maxUses: this.config.deliveryGrantMaxUses,
      fileName: asset.fileName,
      contentType: asset.mimeType,
      sizeBytes: asset.fileSize.toString(),
      sha256: asset.sha256,
    }));
  }

  async listArchiveEntries(context: InternalAuthContext, assetId: string) {
    const asset = await this.assetForAccess(context, assetId);
    if (asset.type !== "ARCHIVE") throw new MediaError(400, "NOT_ARCHIVE", "Media asset is not an archive");
    if (asset.status !== "READY") throw new MediaError(409, "ASSET_NOT_READY", "Archive validation is still processing");
    return this.database.prisma.archiveEntry.findMany({ where: { archiveAssetId: asset.id }, select: { entryName: true, asset: { select: { id: true, type: true, fileName: true, fileSize: true, mimeType: true, status: true, processingError: true } } }, orderBy: { entryName: "asc" } });
  }

  async openStream(assetId: string, token: string) {
    if (this.activeStreams >= this.config.streamConcurrency) throw new MediaError(429, "STREAM_BUSY", "Stream concurrency limit reached");
    const grant = await this.database.prisma.streamGrant.findFirst({ where: { assetId, tokenHash: hashToken(token), consumedAt: null, expiresAt: { gt: new Date() } }, include: { asset: true } });
    if (!grant) throw new MediaError(401, "INVALID_STREAM_TOKEN", "Stream token is invalid or expired");
    const claimed = await this.database.prisma.streamGrant.updateMany({ where: { id: grant.id, consumedAt: null, useCount: grant.useCount }, data: { useCount: { increment: 1 }, ...(grant.useCount + 1 >= grant.maxUses ? { consumedAt: new Date() } : {}) } });
    if (claimed.count !== 1) throw new MediaError(401, "INVALID_STREAM_TOKEN", "Stream token use could not be claimed");
    const preview = grant.purpose === "PREVIEW" && grant.asset.type === "AUDIO";
    const storageKey = preview ? previewStorageKey(grant.asset.storageKey) : grant.asset.storageKey;
    const filePath = path.resolve(this.config.storageRoot, storageKey);
    const relative = path.relative(this.config.storageRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new MediaError(404, "NOT_FOUND", "Media asset not found");
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new MediaError(404, "NOT_FOUND", "Media asset not found");
    this.activeStreams += 1;
    const stream = createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      this.activeStreams -= 1;
    };
    stream.once("close", cleanup);
    stream.once("end", cleanup);
    stream.once("error", cleanup);
    return {
      stream,
      sizeBytes: info.size,
      contentType: preview ? "audio/mpeg" : grant.asset.mimeType,
      fileName: preview ? `${path.parse(grant.asset.fileName).name}.preview.mp3` : grant.asset.fileName,
    };
  }

  async openPublicImage(assetId: string) {
    if (this.activeStreams >= this.config.streamConcurrency) throw new MediaError(429, "STREAM_BUSY", "Stream concurrency limit reached");
    const asset = await this.database.prisma.asset.findUnique({ where: { id: assetId } });
    if (!asset || asset.type !== "IMAGE" || asset.status !== "READY" || !asset.publishedAt) throw new MediaError(404, "NOT_FOUND", "Image not found");
    const filePath = path.resolve(this.config.storageRoot, asset.storageKey);
    const relative = path.relative(this.config.storageRoot, filePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new MediaError(404, "NOT_FOUND", "Image not found");
    const info = await stat(filePath).catch(() => null);
    if (!info?.isFile()) throw new MediaError(404, "NOT_FOUND", "Image not found");
    this.activeStreams += 1;
    const stream = createReadStream(filePath, { highWaterMark: 256 * 1024 });
    let cleaned = false;
    const cleanup = () => { if (!cleaned) { cleaned = true; this.activeStreams -= 1; } };
    stream.once("close", cleanup); stream.once("end", cleanup); stream.once("error", cleanup);
    return { stream, sizeBytes: info.size, contentType: asset.mimeType };
  }

  async receiveUpload(uploadId: string, token: string, contentLength: number, contentType: string, body: Readable, requestId: string) {
    if (this.activeUploads >= this.config.uploadConcurrency) throw new MediaError(429, "UPLOAD_BUSY", "Upload concurrency limit reached");
    const intent = await this.database.prisma.uploadIntent.findFirst({ where: { id: uploadId, tokenHash: hashToken(token), status: "PENDING", expiresAt: { gt: new Date() } } });
    if (!intent) throw new MediaError(401, "INVALID_UPLOAD_TOKEN", "Upload token is invalid or expired");
    if (contentLength !== Number(intent.sizeBytes) || contentLength > this.config.uploadMaxBytes) throw new MediaError(413, "UPLOAD_SIZE_MISMATCH", "Content-Length does not match upload intent");
    if (contentType !== intent.contentType) throw new MediaError(415, "CONTENT_TYPE_MISMATCH", "Content-Type does not match upload intent");
    const claimed = await this.database.prisma.uploadIntent.updateMany({ where: { id: intent.id, status: "PENDING" }, data: { status: "UPLOADING" } });
    if (claimed.count !== 1) throw new MediaError(409, "UPLOAD_ALREADY_USED", "Upload intent already used");

    this.activeUploads += 1;
    const directory = path.join(this.config.storageRoot, intent.tenantId, intent.id);
    const temporaryPath = path.join(directory, "upload.tmp");
    const finalPath = path.join(this.config.storageRoot, intent.storageKey);
    let bytes = 0;
    const digest = createHash("sha256");
    try {
      await mkdir(directory, { recursive: true });
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > Number(intent.sizeBytes)) return callback(new Error("UPLOAD_SIZE_EXCEEDED"));
          digest.update(chunk);
          callback(null, chunk);
        }
      });
      await pipeline(body, meter, createWriteStream(temporaryPath, { flags: "wx" }));
      const actualSha256 = digest.digest("hex");
      if (bytes !== Number(intent.sizeBytes) || (intent.sha256 && actualSha256 !== intent.sha256)) throw new Error("UPLOAD_INTEGRITY_MISMATCH");
      await rename(temporaryPath, finalPath);
      const asset = await this.database.prisma.$transaction(async transaction => {
        const created = await transaction.asset.create({ data: { uploadIntentId: intent.id, tenantId: intent.tenantId, ownerEntityId: intent.ownerEntityId, ownerEntityPath: intent.ownerEntityPath, uploaderId: intent.actorId, type: intent.assetType, fileName: intent.fileName, storageKey: intent.storageKey, fileSize: intent.sizeBytes, mimeType: intent.contentType, releaseId: intent.releaseId, trackId: intent.trackId, sha256: actualSha256, status: "PROCESSING" } });
        await transaction.processingJob.create({ data: { assetId: created.id, requestId, type: intent.assetType === "ARCHIVE" ? "VALIDATE_ARCHIVE" : "INSPECT_MEDIA" } });
        await transaction.uploadIntent.update({ where: { id: intent.id }, data: { status: "COMPLETE", consumedAt: new Date() } });
        await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "media.asset.uploaded", requestId, actorId: intent.actorId, tenantId: intent.tenantId, entityPath: intent.ownerEntityPath, payload: { assetId: created.id, uploadId: intent.id, storageKey: intent.storageKey, sizeBytes: intent.sizeBytes.toString(), sha256: actualSha256 } } });
        return created;
      });
      return asset;
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      await this.database.prisma.uploadIntent.update({ where: { id: intent.id }, data: { status: "FAILED", failureCode: error instanceof Error ? error.message.slice(0, 100) : "UPLOAD_FAILED" } }).catch(() => undefined);
      throw new MediaError(422, "UPLOAD_INTEGRITY_FAILED", "Uploaded bytes failed integrity validation");
    } finally {
      this.activeUploads -= 1;
    }
  }
}
