import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { Readable } from "node:stream";
import { entityPathSchema, INTERNAL_CONTEXT_HEADER, vevoSubmissionMetadataSchema, vevoSubmissionRequestSchema, type InternalAuthContext, type VevoSubmissionMetadata, type VevoSubmissionRequest } from "@bealpha/contracts";
import { z } from "zod";
import type { DistributionConfig } from "./config.js";
import type { DistributionDatabase } from "./database.js";
import { DistributionError } from "./errors.js";
import { encryptGrantToken } from "./grant-crypto.js";
import { buildVevoManifest, type VevoFeedAssetRole } from "./vevo-feed.js";
import { createExportToken, verifyExportToken } from "./export-token.js";
import { openPackageDownload } from "./package-download-file.js";

type Actor = InternalAuthContext & { actorId: string; entityId: string; entityPath: string; entityType: string };
const uuid = z.string().uuid();
const videoSnapshot = z.object({
  id: uuid, tenantId: uuid, type: z.literal("VIDEO"), format: z.literal("SINGLE"), status: z.enum(["LOCKED_FOR_DELIVERY", "DELIVERED", "RELEASED"]), title: z.string(), genre: z.string().min(1), releaseDate: z.string().datetime({ offset: true }),
  owner: z.object({ path: entityPathSchema }).passthrough(), artist: z.object({ name: z.string().min(1), vevoChannel: z.string().min(1) }).passthrough(), label: z.object({ name: z.string().min(1) }).passthrough(),
  territories: z.array(z.string()).min(1), madeForKids: z.boolean().optional(), youtubeUnlisted: z.boolean().optional(),
  tracks: z.array(z.object({ title: z.string().min(1), isrc: z.string(), videoAssetId: uuid, thumbnailAssetId: uuid.nullish(), captionAssetId: uuid.nullish(), captionLanguage: z.string().nullish(), madeForKids: z.boolean().optional(), youtubeUnlisted: z.boolean().optional() }).passthrough()).length(1),
}).passthrough();
const grantSchema = z.object({ assetId: uuid, token: z.string().min(40).max(128), expiresAt: z.string().datetime({ offset: true }), fileName: z.string().min(1).max(500), contentType: z.string().min(1).max(255), sizeBytes: z.string().regex(/^\d+$/), sha256: z.string().regex(/^[a-f0-9]{64}$/) });
const grantsEnvelope = z.object({ data: z.array(grantSchema) });

function actor(context: InternalAuthContext): Actor {
  if (context.authType !== "user" || !context.actorId || !context.entityId || !context.entityPath || !context.entityType) throw new DistributionError(403, "FORBIDDEN", "Distribution requires entity membership");
  return context as Actor;
}
function dispatcher(context: InternalAuthContext): Actor {
  const current = actor(context);
  if (current.entityType !== "SUPER_ADMIN" || current.entityRole !== "OWNER") throw new DistributionError(403, "FORBIDDEN", "BeAlpha owner approval required for VEVO submission");
  return current;
}
function visible(entityPath: string) { return { OR: [{ entityPath }, { entityPath: { startsWith: `${entityPath}.` } }] }; }
function publicSubmission<T extends { id: string; status: string; assets?: Array<{ sizeBytes: bigint; tokenCiphertext?: string }>; manifestXml?: string; packagePath?: string | null; packageSizeBytes?: bigint | null; packageExpiresAt?: Date | null }>(value: T, config: DistributionConfig, includePackageAccess = false) {
  const { manifestXml: _manifestXml, packagePath: _packagePath, packageSizeBytes, ...submission } = value;
  const ready = includePackageAccess && value.status === "READY_FOR_MANUAL_DELIVERY" && value.packageExpiresAt && value.packageExpiresAt > new Date();
  return { ...submission, packageSizeBytes: packageSizeBytes?.toString() ?? null, assets: value.assets?.map(({ tokenCiphertext: _token, sizeBytes, ...asset }) => ({ ...asset, sizeBytes: sizeBytes.toString() })), ...(ready ? { downloadUrl: `${config.publicBaseUrl}/vevo-package/${value.id}?token=${encodeURIComponent(createExportToken(value.id, config.exportDownloadTtlSeconds, config.exportDownloadSigningKey))}` } : {}) };
}
function roleFor(metadata: VevoSubmissionMetadata, assetId: string): VevoFeedAssetRole {
  if (metadata.videoAssetId === assetId) return "VIDEO";
  if (metadata.thumbnailAssetId === assetId) return "IMAGE";
  if (metadata.captionAssetId === assetId) return "CAPTION";
  throw new DistributionError(422, "VEVO_ASSET_MISMATCH", "Media grant does not match VEVO metadata");
}
function deliveryFileName(assetId: string, original: string): string {
  const extension = path.extname(original).toLowerCase();
  if (!/^\.[a-z0-9]{1,8}$/.test(extension)) throw new DistributionError(422, "VEVO_ASSET_FORMAT_INVALID", "VEVO asset filename has an unsupported extension");
  return `resources/${assetId}${extension}`;
}

export async function finalizeApprovedVideoPackage(
  database: DistributionDatabase,
  config: DistributionConfig,
  packageId: string,
  snapshotPayload: unknown,
  rawGrants: unknown[],
  requestId: string,
  approvalActor: { actorId: string }
) {
  const snapshot = videoSnapshot.parse(snapshotPayload);
  if (snapshot.status !== "LOCKED_FOR_DELIVERY") throw new Error("Automatic VEVO package requires a delivery-locked release");
  const idempotencyKey = `approval:${packageId}`;
  const existing = await database.prisma.vevoSubmission.findFirst({ where: { tenantId: snapshot.tenantId, idempotencyKey }, include: { assets: true } });
  if (existing) return existing;
  const track = snapshot.tracks[0]!;
  const metadata = vevoSubmissionMetadataSchema.parse({ purpose: "INSERT", isrc: track.isrc, title: track.title, label: snapshot.label.name, genres: [snapshot.genre], mainArtists: [snapshot.artist.name], youtubeChannelName: snapshot.artist.vevoChannel, startDateTime: snapshot.releaseDate, territories: snapshot.territories, videoAssetId: track.videoAssetId, thumbnailAssetId: track.thumbnailAssetId ?? undefined, captionAssetId: track.captionAssetId ?? undefined, captionLanguage: track.captionLanguage ?? undefined, madeForKids: track.madeForKids ?? snapshot.madeForKids, youtubeUnlisted: track.youtubeUnlisted ?? snapshot.youtubeUnlisted });
  const assetIds = [metadata.videoAssetId, metadata.thumbnailAssetId, metadata.captionAssetId].filter((value): value is string => Boolean(value));
  const parsedGrants = rawGrants.map(grant => grantSchema.parse(grant));
  if (parsedGrants.length !== assetIds.length || new Set(parsedGrants.map(grant => grant.assetId)).size !== assetIds.length || parsedGrants.some(grant => !assetIds.includes(grant.assetId))) throw new Error("Automatic VEVO media grants are incomplete");
  const assets = parsedGrants.map(grant => ({ ...grant, role: roleFor(metadata, grant.assetId), fileName: deliveryFileName(grant.assetId, grant.fileName) }));
  const manifestXml = buildVevoManifest(metadata, Object.fromEntries(assets.map(asset => [asset.role, asset.fileName])));
  const manifestFileName = "manifest.xml";
  return database.prisma.vevoSubmission.create({ data: { id: packageId, releaseId: snapshot.id, tenantId: snapshot.tenantId, entityPath: snapshot.owner.path, actorId: approvalActor.actorId, requestId, idempotencyKey, isrc: metadata.isrc, metadata, manifestXml, manifestFileName, manifestSha256: createHash("sha256").update(manifestXml).digest("hex"), assets: { create: assets.map(asset => ({ assetId: asset.assetId, role: asset.role, tokenCiphertext: encryptGrantToken(asset.token, config.deliveryGrantEncryptionKey), fileName: asset.fileName, contentType: asset.contentType, sizeBytes: BigInt(asset.sizeBytes), sha256: asset.sha256, expiresAt: new Date(asset.expiresAt) })) } }, include: { assets: true } });
}

export class VevoService {
  constructor(private readonly database: DistributionDatabase, private readonly config: DistributionConfig) {}

  private async lockRelease(releaseId: string, requestId: string, signedContext: string): Promise<void> {
    const response = await fetch(`${this.config.catalogServiceUrl}/api/v1/catalog/releases/${encodeURIComponent(releaseId)}/delivery-lock`, { method: "POST", headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!response) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Catalog delivery lock unavailable");
    if (response.status === 404) throw new DistributionError(404, "NOT_FOUND", "Video release not found");
    if (response.status === 403) throw new DistributionError(403, "FORBIDDEN", "BeAlpha owner cannot lock this release");
    if (response.status === 409) throw new DistributionError(409, "INVALID_WORKFLOW_STATE", "Video release must be approved before VEVO submission");
    if (!response.ok) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Catalog delivery lock unavailable");
  }

  async create(context: InternalAuthContext, rawInput: VevoSubmissionRequest, signedContext: string) {
    const current = dispatcher(context); const input = vevoSubmissionRequestSchema.parse(rawInput);
    await this.lockRelease(input.releaseId, context.requestId, signedContext);
    const response = await fetch(`${this.config.catalogServiceUrl}/api/v1/catalog/releases/${encodeURIComponent(input.releaseId)}/distribution-snapshot`, { headers: { "x-request-id": context.requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!response || response.status === 404) throw new DistributionError(404, "NOT_FOUND", "Video release not found");
    if (!response.ok) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Catalog snapshot unavailable");
    const envelope = await response.json().catch(() => null) as { data?: unknown } | null;
    const parsed = videoSnapshot.safeParse(envelope?.data);
    if (!parsed.success) throw new DistributionError(422, "VEVO_PROFILE_INCOMPLETE", "Release does not satisfy the VEVO delivery profile");
    const snapshot = parsed.data;
    const existing = await this.database.prisma.vevoSubmission.findFirst({ where: { tenantId: snapshot.tenantId, idempotencyKey: input.idempotencyKey }, include: { assets: true } });
    if (existing) return publicSubmission(existing, this.config);
    const track = snapshot.tracks[0]!;
    const metadata = vevoSubmissionMetadataSchema.parse({ purpose: "INSERT", isrc: track.isrc, title: track.title, label: snapshot.label.name, genres: [snapshot.genre], mainArtists: [snapshot.artist.name], youtubeChannelName: snapshot.artist.vevoChannel, startDateTime: snapshot.releaseDate, territories: snapshot.territories, videoAssetId: track.videoAssetId, thumbnailAssetId: track.thumbnailAssetId ?? undefined, captionAssetId: track.captionAssetId ?? undefined, captionLanguage: track.captionLanguage ?? undefined, madeForKids: track.madeForKids ?? snapshot.madeForKids, youtubeUnlisted: track.youtubeUnlisted ?? snapshot.youtubeUnlisted });
    const assetIds = [metadata.videoAssetId, metadata.thumbnailAssetId, metadata.captionAssetId].filter((value): value is string => Boolean(value));
    const grantResponse = await fetch(`${this.config.mediaServiceUrl}/api/v1/media/delivery-grants`, { method: "POST", headers: { "content-type": "application/json", "x-request-id": context.requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, body: JSON.stringify({ assetIds }), signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!grantResponse?.ok) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "VEVO media delivery grants unavailable");
    const grants = grantsEnvelope.parse(await grantResponse.json()).data;
    if (grants.length !== assetIds.length || new Set(grants.map(grant => grant.assetId)).size !== assetIds.length) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "VEVO media grants are incomplete");
    const assets = grants.map(grant => ({ ...grant, role: roleFor(metadata, grant.assetId), fileName: deliveryFileName(grant.assetId, grant.fileName) }));
    const manifestXml = buildVevoManifest(metadata, Object.fromEntries(assets.map(asset => [asset.role, asset.fileName])));
    const manifestFileName = "manifest.xml"; const manifestSha256 = createHash("sha256").update(manifestXml).digest("hex");
    const created = await this.database.prisma.vevoSubmission.create({ data: { id: randomUUID(), releaseId: snapshot.id, tenantId: snapshot.tenantId, entityPath: snapshot.owner.path, actorId: current.actorId, requestId: context.requestId, idempotencyKey: input.idempotencyKey, isrc: metadata.isrc, metadata, manifestXml, manifestFileName, manifestSha256, assets: { create: assets.map(asset => ({ assetId: asset.assetId, role: asset.role, tokenCiphertext: encryptGrantToken(asset.token, this.config.deliveryGrantEncryptionKey), fileName: asset.fileName, contentType: asset.contentType, sizeBytes: BigInt(asset.sizeBytes), sha256: asset.sha256, expiresAt: new Date(asset.expiresAt) })) } }, include: { assets: true } });
    return publicSubmission(created, this.config);
  }

  async list(context: InternalAuthContext) { const current = actor(context); const includePackageAccess = current.entityType === "SUPER_ADMIN" && current.entityRole === "OWNER"; return (await this.database.prisma.vevoSubmission.findMany({ where: visible(current.entityPath), include: { assets: true }, orderBy: { createdAt: "desc" }, take: 100 })).map(value => publicSubmission(value, this.config, includePackageAccess)); }
  async get(context: InternalAuthContext, submissionId: string) { const current = actor(context); const submission = await this.database.prisma.vevoSubmission.findFirst({ where: { id: submissionId, ...visible(current.entityPath) }, include: { assets: true } }); if (!submission) throw new DistributionError(404, "NOT_FOUND", "VEVO submission not found"); return publicSubmission(submission, this.config, current.entityType === "SUPER_ADMIN" && current.entityRole === "OWNER"); }
  async openPackage(submissionId: string, token: string) {
    if (!verifyExportToken(submissionId, token, this.config.exportDownloadSigningKey)) throw new DistributionError(401, "INVALID_PACKAGE_TOKEN", "Package token is invalid or expired");
    const submission = await this.database.prisma.vevoSubmission.findUnique({ where: { id: submissionId } });
    if (!submission || submission.status !== "READY_FOR_MANUAL_DELIVERY" || !submission.packagePath || !submission.packageFileName || !submission.packageSizeBytes || !submission.packageExpiresAt || submission.packageExpiresAt <= new Date()) throw new DistributionError(404, "NOT_FOUND", "VEVO package is unavailable");
    const opened = await openPackageDownload(this.config.packageRoot, submission.packagePath, submission.packageSizeBytes, "VEVO package is unavailable");
    return { ...opened, fileName: submission.packageFileName };
  }
}
