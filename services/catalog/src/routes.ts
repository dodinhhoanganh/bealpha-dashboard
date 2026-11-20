import { businessTierSchema, catalogImportRequestSchema, entityPathSchema, INTERNAL_CONTEXT_HEADER, isrcSchema, normalizeTenantHostname, subAccountLabelAccessSchema, tenantBrandUpdateSchema, tenantDomainCreateSchema, tenantDomainMutationSchema, upcEanSchema, vevoChannelNameSchema, type InternalAuthContext } from "@bealpha/contracts";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CatalogService } from "./catalog-service.js";
import { successEnvelope } from "./response.js";
import type { CatalogConfig } from "./config.js";
import { searchDspArtists } from "./dsp-search.js";
import type { CatalogImportService } from "./catalog-import-service.js";
import { Prisma } from "./generated/prisma-v2/client.js";
import { CatalogError } from "./errors.js";
import { assertVevoReleaseReady } from "./vevo-readiness.js";

const uuid = z.string().uuid();
const nullableString = z.string().trim().min(1).max(2048).nullable();
const entity = z.object({ businessTier: businessTierSchema.optional(), parentId: uuid, entityType: z.enum(["SYSTEM_ADMIN", "ORGANIZATION", "SUB_ACCOUNT"]), officialName: z.string().trim().min(1).max(255), description: z.string().trim().max(10000).optional(), metadata: z.record(z.string().max(100), z.string().max(500)).optional() }).strict();
const entityPatch = z.object({ officialName: z.string().trim().min(1).max(255).optional(), description: z.string().trim().max(10000).nullable().optional(), metadata: z.record(z.string().max(100), z.string().max(500)).nullable().optional(), isActive: z.boolean().optional() }).strict().refine(value => Object.keys(value).length > 0);
const label = z.object({ name: z.string().trim().min(1).max(255), tenantId: uuid.optional(), description: z.string().trim().max(10000).optional(), dpid: z.string().trim().max(128).optional(), ddexPartyName: z.string().trim().max(255).optional(), logoUrl: z.string().url().max(2048).optional() }).strict();
const labelPatch = label.omit({ tenantId: true }).partial().extend({ description: z.string().trim().max(10000).nullable().optional(), dpid: z.string().trim().max(128).nullable().optional(), ddexPartyName: z.string().trim().max(255).nullable().optional(), logoUrl: z.string().url().max(2048).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0);
const artist = z.object({ name: z.string().trim().min(1).max(255), bio: z.string().trim().max(10000).optional(), spotifyId: z.string().trim().max(128).optional(), appleMusicId: z.string().trim().max(128).optional(), vevoChannel: vevoChannelNameSchema.optional(), vevoBio: z.string().trim().max(1000).optional(), vevoBannerUrl: z.string().url().max(2048).optional(), labelId: uuid.optional(), isni: z.string().trim().max(32).optional(), ipi: z.string().trim().max(32).optional(), dpid: z.string().trim().max(128).optional(), imageUrl: z.string().url().max(2048).optional() }).strict();
const artistPatch = artist.partial().extend({ bio: z.string().trim().max(10000).nullable().optional(), spotifyId: z.string().trim().max(128).nullable().optional(), appleMusicId: z.string().trim().max(128).nullable().optional(), vevoChannel: vevoChannelNameSchema.nullable().optional(), vevoBio: z.string().trim().max(1000).nullable().optional(), vevoBannerUrl: z.string().url().max(2048).nullable().optional(), labelId: uuid.nullable().optional(), isni: z.string().trim().max(32).nullable().optional(), ipi: z.string().trim().max(32).nullable().optional(), dpid: z.string().trim().max(128).nullable().optional(), imageUrl: z.string().url().max(2048).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0);
const release = z.object({ title: z.string().trim().min(1).max(500), ean: upcEanSchema.optional(), type: z.enum(["AUDIO", "VIDEO"]).optional(), format: z.enum(["SINGLE", "EP", "ALBUM", "COMPILATION"]).optional(), genre: z.string().trim().max(100).optional(), releaseDate: z.coerce.date(), displayArtist: z.string().trim().max(500).optional(), coverUrl: z.string().url().max(2048).optional(), artistId: uuid.optional(), labelId: uuid.optional() }).strict();
const releasePatch = release.partial().extend({ ean: upcEanSchema.nullable().optional(), releaseDate: z.coerce.date().optional(), displayArtist: nullableString.optional(), coverUrl: z.string().url().max(2048).nullable().optional(), genre: z.string().trim().max(100).nullable().optional(), artistId: uuid.nullable().optional(), labelId: uuid.nullable().optional() }).strict();
const denyReleaseSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();
const submitReleaseSchema = z.object({
  dspIds: z.array(z.string().regex(/^[a-z0-9_]{2,64}$/)).min(1).max(50).refine(items => new Set(items).size === items.length, "DSP IDs must be unique")
}).strict();
const distributionRecipientsEnvelope = z.object({ data: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{2,64}$/), name: z.string().min(1).max(255) }).strict()).max(100) });
const decimalPercent = z.string().regex(/^\d{1,3}(\.\d{1,2})?$/).refine(value => Number(value) <= 100);
const languageCode = z.string().trim().regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/).max(35);
const track = z.object({ title: z.string().trim().min(1).max(500), isrc: isrcSchema.optional(), trackNumber: z.number().int().min(1).max(999).optional(), discNumber: z.number().int().min(1).max(99).optional(), duration: z.number().int().min(0).max(86400).optional(), artistId: uuid.optional(), audioAssetId: uuid.optional(), videoAssetId: uuid.optional(), thumbnailAssetId: uuid.optional(), captionAssetId: uuid.optional(), captionLanguage: languageCode.optional(), canvasAssetId: uuid.optional(), motionAssetId: uuid.optional(), admAssetId: uuid.optional(), compositionId: uuid.optional(), recordingLabelShare: decimalPercent.optional() }).strict();
const trackPatch = track.partial().extend({ isrc: isrcSchema.nullable().optional(), duration: z.number().int().min(0).max(86400).nullable().optional(), artistId: uuid.nullable().optional(), audioAssetId: uuid.nullable().optional(), videoAssetId: uuid.nullable().optional(), thumbnailAssetId: uuid.nullable().optional(), captionAssetId: uuid.nullable().optional(), captionLanguage: languageCode.nullable().optional(), canvasAssetId: uuid.nullable().optional(), motionAssetId: uuid.nullable().optional(), admAssetId: uuid.nullable().optional(), compositionId: uuid.nullable().optional(), recordingLabelShare: decimalPercent.nullable().optional() }).strict();
function validateCaptionPair(value: { captionAssetId?: string | null; captionLanguage?: string | null }, context: z.RefinementCtx) {
  if (Boolean(value.captionAssetId) !== Boolean(value.captionLanguage)) {
    context.addIssue({ code: "custom", path: ["captionLanguage"], message: "Caption asset and language must be provided together" });
  }
}
const trackPayload = track.superRefine(validateCaptionPair);
const trackPatchPayload = trackPatch.superRefine(validateCaptionPair);
const emptyToUndefined = (value: unknown) => value === "" || value === null ? undefined : value;
const draftUuid = z.preprocess(emptyToUndefined, uuid.optional());
const draftIsrc = z.preprocess(emptyToUndefined, isrcSchema.optional());
const draftEan = z.preprocess(emptyToUndefined, upcEanSchema.optional());
const draftUrl = z.preprocess(emptyToUndefined, z.string().max(2048).refine(value => value.startsWith("/media-public/") || URL.canParse(value)).optional());
const trackDraft = z.object({ id: draftUuid, title: z.string().trim().min(1).max(500), isrc: draftIsrc, trackNumber: z.coerce.number().int().min(1).max(999).optional(), discNumber: z.coerce.number().int().min(1).max(99).optional(), duration: z.coerce.number().int().min(0).max(86400).optional(), artistId: draftUuid, audioAssetId: draftUuid, videoAssetId: draftUuid, thumbnailAssetId: draftUuid, captionAssetId: draftUuid, captionLanguage: z.preprocess(emptyToUndefined, languageCode.optional()), canvasAssetId: draftUuid, motionAssetId: draftUuid, admAssetId: draftUuid, compositionId: draftUuid, recordingLabelShare: z.preprocess(emptyToUndefined, decimalPercent.optional()) }).passthrough().superRefine(validateCaptionPair);
const releaseDraft = z.object({ title: z.string().trim().min(1).max(500), ean: draftEan, type: z.enum(["AUDIO", "VIDEO"]).optional(), format: z.enum(["SINGLE", "EP", "ALBUM", "COMPILATION"]).optional(), genre: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()), releaseDate: z.coerce.date(), displayArtist: z.preprocess(emptyToUndefined, z.string().trim().max(500).optional()), coverUrl: draftUrl, artistId: draftUuid, labelId: draftUuid, tracks: z.array(trackDraft).min(1).max(10000) }).passthrough();
const releaseListQuery = z.object({ workQueue: z.enum(["true", "false"]).transform(value => value === "true").optional(), entityId: uuid.optional(), status: z.enum(["DRAFT", "PENDING_ORG_APPROVAL", "ORG_REJECTED", "PENDING_SYS_APPROVAL", "SYS_REJECTED", "PENDING_SUPER_APPROVAL", "SUPER_REJECTED", "APPROVED", "SCHEDULED", "LOCKED_FOR_DELIVERY", "DELIVERED", "RELEASED", "TAKEDOWN"]).optional(), limit: z.coerce.number().int().min(1).max(200).optional() }).strict();
const exportSnapshotQuery = z.object({ releaseId: uuid.optional() }).strict();
const author = z.object({ name: z.string().trim().min(1).max(255), role: z.string().trim().min(1).max(100), shareBasisPoints: z.number().int().min(0).max(10000).optional() }).strict();
const compositionBase = z.object({ title: z.string().trim().min(1).max(500), subtitle: z.string().trim().max(500).optional(), alternativeTitle: z.string().trim().max(500).optional(), iswc: z.string().trim().regex(/^T-?\d{3}\.\d{3}\.\d{3}-?\d$/).optional(), catalogueNumber: z.string().trim().max(128).optional(), genre: z.string().trim().max(100).optional(), creationDate: z.coerce.date().optional(), lyricsLanguages: z.string().trim().max(255).optional(), territories: z.string().trim().min(1).max(2048).optional(), excludingTerritories: z.string().trim().max(2048).optional(), contractPeriodBegins: z.coerce.date().optional(), contractPeriodEnds: z.coerce.date().optional(), contractNumber: z.string().trim().max(128).optional(), authors: z.array(author).max(100).optional() }).strict();
function validateAuthorShares(value: { authors?: Array<{ shareBasisPoints?: number }> | null }, ctx: z.RefinementCtx) {
  if (!value.authors?.some(item => item.shareBasisPoints !== undefined)) return;
  if (value.authors.some(item => item.shareBasisPoints === undefined) || value.authors.reduce((sum, item) => sum + (item.shareBasisPoints ?? 0), 0) !== 10000) ctx.addIssue({ code: "custom", path: ["authors"], message: "Author shares must total 10000 basis points" });
}
const composition = compositionBase.superRefine(validateAuthorShares);
const compositionPatch = compositionBase.partial().extend({ subtitle: z.string().trim().max(500).nullable().optional(), alternativeTitle: z.string().trim().max(500).nullable().optional(), iswc: z.string().trim().regex(/^T-?\d{3}\.\d{3}\.\d{3}-?\d$/).nullable().optional(), catalogueNumber: z.string().trim().max(128).nullable().optional(), genre: z.string().trim().max(100).nullable().optional(), creationDate: z.coerce.date().nullable().optional(), lyricsLanguages: z.string().trim().max(255).nullable().optional(), excludingTerritories: z.string().trim().max(2048).nullable().optional(), contractPeriodBegins: z.coerce.date().nullable().optional(), contractPeriodEnds: z.coerce.date().nullable().optional(), contractNumber: z.string().trim().max(128).nullable().optional(), authors: z.array(author).max(100).nullable().optional() }).strict().refine(value => Object.keys(value).length > 0).superRefine(validateAuthorShares);
const playlist = z.object({ name: z.string().trim().min(1).max(200), platform: z.string().trim().min(1).max(100), coverUrl: z.string().url().max(2048).optional(), followers: z.number().int().min(0).max(2147483647).optional(), plays: z.number().int().min(0).max(2147483647).optional(), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/).optional(), externalId: z.string().trim().min(1).max(255).optional() }).strict();
const labelAccessReplacement = subAccountLabelAccessSchema.pick({ labelIds: true });
const mediaAssetEvidence = z.object({
  id: uuid,
  type: z.enum(["AUDIO", "VIDEO", "CANVAS", "MOTION", "SUBTITLE", "ARCHIVE", "IMAGE"]),
  status: z.enum(["PENDING", "PROCESSING", "READY", "ERROR", "ARCHIVED"]),
  qcProfileVersion: z.string().nullable().optional(),
  qcResult: z.unknown().optional()
}).passthrough();
const scopedMediaAssetEvidence = mediaAssetEvidence.extend({ tenantId: uuid, ownerEntityId: uuid, ownerEntityPath: entityPathSchema });
type MediaAssetEvidence = z.infer<typeof mediaAssetEvidence>;
type ScopedMediaAssetEvidence = z.infer<typeof scopedMediaAssetEvidence>;
const mediaAssetReference = /^media-asset:([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

const MEDIA_REFERENCE_FIELDS = [
  "audioAssetId",
  "videoAssetId",
  "thumbnailAssetId",
  "captionAssetId",
  "canvasAssetId",
  "motionAssetId",
  "admAssetId",
] as const;

function expectedAssetType(field: (typeof MEDIA_REFERENCE_FIELDS)[number]): readonly string[] {
  switch (field) {
    case "audioAssetId": return ["AUDIO"];
    case "videoAssetId": return ["VIDEO"];
    case "thumbnailAssetId": return ["IMAGE"];
    case "captionAssetId": return ["SUBTITLE"];
    case "canvasAssetId": return ["CANVAS"];
    case "motionAssetId": return ["MOTION"];
    case "admAssetId": return ["AUDIO"];
  }
}

async function fetchScopedMediaAsset(
  config: CatalogConfig,
  requestId: string,
  signedContext: string,
  assetId: string,
): Promise<ScopedMediaAssetEvidence> {
  const response = await fetch(`${config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(assetId)}`, {
    headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null);
  if (!response) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media asset service is unavailable");
  if (response.status === 404) throw new CatalogError(404, "NOT_FOUND", "Media asset is outside catalog scope");
  if (!response.ok) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media asset service is unavailable");
  const envelope = await response.json().catch(() => null) as { data?: unknown } | null;
  const parsed = scopedMediaAssetEvidence.safeParse(envelope?.data);
  if (!parsed.success) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media asset response is invalid");
  return parsed.data;
}

async function validateMediaReferences(
  config: CatalogConfig,
  requestId: string,
  context: InternalAuthContext | undefined,
  signedContext: string | string[] | undefined,
  tracks: readonly Record<string, unknown>[],
  coverUrl?: string,
): Promise<void> {
  const references = new Map<string, Set<(typeof MEDIA_REFERENCE_FIELDS)[number]>>();
  for (const track of tracks) {
    for (const field of MEDIA_REFERENCE_FIELDS) {
      const value = track[field];
      if (typeof value !== "string") continue;
      const fields = references.get(value) ?? new Set();
      fields.add(field);
      references.set(value, fields);
    }
  }
  const coverAssetId = coverUrl ? mediaAssetReference.exec(coverUrl)?.[1] : undefined;
  if (coverAssetId) {
    const fields = references.get(coverAssetId) ?? new Set<(typeof MEDIA_REFERENCE_FIELDS)[number]>();
    fields.add("thumbnailAssetId");
    references.set(coverAssetId, fields);
  }
  if (references.size === 0) return;
  if (context?.authType !== "user" || !context.entityId || !context.entityPath || !context.entityType) {
    throw new CatalogError(403, "FORBIDDEN", "Catalog access requires an entity membership");
  }
  if (typeof signedContext !== "string") throw new CatalogError(401, "UNAUTHENTICATED", "Signed Gateway context required");
  const entries = [...references];
  let cursor = 0;
  const validateNext = async (): Promise<void> => {
    while (cursor < entries.length) {
      const current = entries[cursor++];
      if (!current) return;
      const [assetId, fields] = current;
      const asset = await fetchScopedMediaAsset(config, requestId, signedContext, assetId);
      const tenantId = context.tenantId ?? context.entityId;
      const inScope = context.entityType === "SUPER_ADMIN"
        || (context.entityType === "SUB_ACCOUNT"
          ? asset.tenantId === tenantId && asset.ownerEntityId === context.entityId
          : context.entityType === "ORGANIZATION"
            ? asset.tenantId === tenantId && (asset.ownerEntityPath === context.entityPath || asset.ownerEntityPath.startsWith(`${context.entityPath}.`))
            : asset.ownerEntityPath === context.entityPath || asset.ownerEntityPath.startsWith(`${context.entityPath}.`));
      if (!inScope) {
        throw new CatalogError(404, "NOT_FOUND", "Media asset is outside catalog scope");
      }
      if (!["PENDING", "PROCESSING", "READY"].includes(asset.status) || [...fields].some(field => !expectedAssetType(field).includes(asset.type))) {
        throw new CatalogError(422, "VALIDATION_ERROR", "Media asset type or state does not match its catalog field");
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, entries.length) }, validateNext));
}

async function publishPublicImage(config: CatalogConfig, requestId: string, signedContext: string | string[] | undefined, reference?: string | null) {
  const assetId = reference ? mediaAssetReference.exec(reference)?.[1] : undefined;
  if (!assetId) return;
  if (typeof signedContext !== "string") throw new CatalogError(401, "UNAUTHENTICATED", "Signed Gateway context required");
  const response = await fetch(`${config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(assetId)}/publication`, {
    method: "POST",
    headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext },
    signal: AbortSignal.timeout(5000)
  }).catch(() => null);
  if (!response?.ok) throw new CatalogError(422, "VALIDATION_ERROR", "Public image could not be published");
}

function serializeTenantDomain(domain: { id: string; tenantId: string; hostname: string; status: string; version: number; verifiedAt: Date | null; lastCheckedAt: Date | null }) {
  return {
    id: domain.id,
    tenantId: domain.tenantId,
    hostname: domain.hostname,
    status: domain.status,
    version: domain.version,
    verifiedAt: domain.verifiedAt?.toISOString() ?? null,
    lastCheckedAt: domain.lastCheckedAt?.toISOString() ?? null
  };
}

function metadata(value: Record<string, unknown>, coreKeys: string[]): Prisma.InputJsonObject {
  return Object.fromEntries(Object.entries(value).filter(([key, item]) => !coreKeys.includes(key) && item !== undefined)) as Prisma.InputJsonObject;
}

const RELEASE_CORE_KEYS = ["title", "ean", "type", "format", "genre", "releaseDate", "displayArtist", "coverUrl", "artistId", "labelId", "tracks"];
const TRACK_CORE_KEYS = ["id", "title", "isrc", "trackNumber", "discNumber", "duration", "artistId", "audioAssetId", "videoAssetId", "thumbnailAssetId", "captionAssetId", "captionLanguage", "canvasAssetId", "motionAssetId", "admAssetId", "compositionId", "recordingLabelShare"];

function draftInput(value: z.infer<typeof releaseDraft>) {
  const tracks = value.tracks.map(trackValue => ({ ...Object.fromEntries(TRACK_CORE_KEYS.map(key => [key, trackValue[key]]).filter(([, item]) => item !== undefined)), metadata: metadata(trackValue, TRACK_CORE_KEYS) }));
  return { ...Object.fromEntries(RELEASE_CORE_KEYS.filter(key => key !== "tracks").map(key => [key, value[key]]).filter(([, item]) => item !== undefined)), metadata: metadata(value, RELEASE_CORE_KEYS), tracks };
}

function mergeMetadata<T extends { metadata?: unknown }>(value: T) {
  const extra = value.metadata && typeof value.metadata === "object" && !Array.isArray(value.metadata) ? value.metadata as Record<string, unknown> : {};
  return { ...extra, ...value, metadata: undefined };
}

function serializeRelease<T extends { totalSizeBytes: bigint; metadata?: unknown; tracks?: Array<{ metadata?: unknown }> }>(value: T) {
  const merged = mergeMetadata(value);
  return { ...merged, totalSizeBytes: value.totalSizeBytes.toString(), ...(value.tracks ? { tracks: value.tracks.map(mergeMetadata) } : {}) };
}

export function registerCatalogRoutes(app: FastifyInstance, service: CatalogService, config: CatalogConfig, importService?: CatalogImportService) {
  app.get("/api/v1/catalog/public-tenant-brand", async request => {
    const forwardedHost = request.headers["x-forwarded-host"];
    if (typeof forwardedHost !== "string") throw new CatalogError(400, "VALIDATION_ERROR", "Verified request hostname required");
    return successEnvelope(request.id, await service.resolvePublicTenantBrand(forwardedHost));
  });
  app.get("/api/v1/catalog/tenant-brand", async request => successEnvelope(request.id, await service.getTenantBrand(request.authContext!)));
  app.patch("/api/v1/catalog/tenant-brand", async request => {
    const input = tenantBrandUpdateSchema.parse(request.body);
    if (input.logoAssetId) {
      const actor = request.authContext;
      if (actor?.authType !== "user" || actor.entityType !== "ORGANIZATION" || actor.entityRole !== "OWNER" || !actor.entityId) {
        throw new CatalogError(403, "FORBIDDEN", "Organization owner role required to manage branding");
      }
      const signedContext = request.headers[INTERNAL_CONTEXT_HEADER];
      if (typeof signedContext !== "string") throw new CatalogError(401, "UNAUTHENTICATED", "Signed Gateway context required");
      const response = await fetch(`${config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(input.logoAssetId)}`, {
        headers: { "x-request-id": request.id, [INTERNAL_CONTEXT_HEADER]: signedContext },
        signal: AbortSignal.timeout(5000)
      }).catch(() => null);
      if (!response?.ok) throw new CatalogError(422, "VALIDATION_ERROR", "Brand logo asset is unavailable");
      const envelope = await response.json() as { data?: { id?: string; type?: string; status?: string; ownerEntityId?: string; tenantId?: string } };
      if (envelope.data?.id !== input.logoAssetId || envelope.data.type !== "IMAGE" || envelope.data.status !== "READY" || envelope.data.ownerEntityId !== actor.entityId || envelope.data.tenantId !== actor.entityId) {
        throw new CatalogError(422, "VALIDATION_ERROR", "Brand logo must be a ready image owned by the tenant");
      }
      await publishPublicImage(config, request.id, signedContext, `media-asset:${input.logoAssetId}`);
    }
    return successEnvelope(request.id, await service.updateTenantBrand(request.authContext!, input));
  });
  app.get("/api/v1/catalog/tenant-domains", async request => successEnvelope(request.id, (await service.listTenantDomains(request.authContext!)).map(serializeTenantDomain)));
  app.post("/api/v1/catalog/tenant-domains", async (request, reply) => {
    const result = await service.createTenantDomain(request.authContext!, tenantDomainCreateSchema.parse(request.body));
    reply.code(201);
    return successEnvelope(request.id, { domain: serializeTenantDomain(result.domain), verification: result.verification });
  });
  app.post<{ Params: { id: string } }>("/api/v1/catalog/tenant-domains/:id/verify", async request => {
    const input = tenantDomainMutationSchema.parse(request.body);
    return successEnvelope(request.id, serializeTenantDomain(await service.verifyTenantDomain(request.authContext!, uuid.parse(request.params.id), input.expectedVersion)));
  });
  app.delete<{ Params: { id: string } }>("/api/v1/catalog/tenant-domains/:id", async request => {
    const input = tenantDomainMutationSchema.parse(request.body);
    await service.deleteTenantDomain(request.authContext!, uuid.parse(request.params.id), input.expectedVersion);
    return successEnvelope(request.id, { success: true });
  });
  app.get<{ Querystring: { hostname?: string } }>("/api/v1/catalog/internal/tenant-domains/resolve", async request => {
    if (request.authContext?.authType !== "service" || request.authContext.serviceId !== "gateway") {
      throw new CatalogError(403, "FORBIDDEN", "Gateway service context required");
    }
    const hostname = z.string().trim().min(4).max(253).transform((value, ctx) => {
      try { return normalizeTenantHostname(value); }
      catch { ctx.addIssue({ code: "custom", message: "Invalid hostname" }); return z.NEVER; }
    }).parse(request.query.hostname);
    return successEnvelope(request.id, await service.resolveTenantDomain(hostname));
  });
  app.get("/api/v1/catalog/entities", async request => successEnvelope(request.id, await service.listEntities(request.authContext!)));
  app.post("/api/v1/catalog/entities", async (request, reply) => { const result = await service.createEntity(request.authContext!, entity.parse(request.body)); reply.code(201); return successEnvelope(request.id, result); });
  app.patch<{ Params: { id: string } }>("/api/v1/catalog/entities/:id", async request => successEnvelope(request.id, await service.updateEntity(request.authContext!, uuid.parse(request.params.id), entityPatch.parse(request.body))));
  app.get<{ Params: { id: string } }>("/api/v1/catalog/entities/:id/label-access", async request => successEnvelope(request.id, await service.listSubAccountLabelAccess(request.authContext!, uuid.parse(request.params.id))));
  app.put<{ Params: { id: string } }>("/api/v1/catalog/entities/:id/label-access", async request => { const input = labelAccessReplacement.parse(request.body); return successEnvelope(request.id, await service.replaceSubAccountLabelAccess(request.authContext!, uuid.parse(request.params.id), input.labelIds)); });
  app.get("/api/v1/catalog/labels", async request => successEnvelope(request.id, await service.listLabels(request.authContext!)));
  app.post("/api/v1/catalog/labels", async (request, reply) => { const input = label.parse(request.body); await publishPublicImage(config, request.id, request.headers[INTERNAL_CONTEXT_HEADER], input.logoUrl); const result = await service.createLabel(request.authContext!, input); reply.code(201); return successEnvelope(request.id, result); });
  app.get<{ Params: { id: string } }>("/api/v1/catalog/labels/:id", async request => successEnvelope(request.id, await service.getLabel(request.authContext!, uuid.parse(request.params.id))));
  app.patch<{ Params: { id: string } }>("/api/v1/catalog/labels/:id", async request => { const input = labelPatch.parse(request.body); await publishPublicImage(config, request.id, request.headers[INTERNAL_CONTEXT_HEADER], input.logoUrl); return successEnvelope(request.id, await service.updateLabel(request.authContext!, uuid.parse(request.params.id), input)); });
  app.delete<{ Params: { id: string } }>("/api/v1/catalog/labels/:id", async request => { await service.deleteLabel(request.authContext!, uuid.parse(request.params.id)); return successEnvelope(request.id, { success: true }); });
  app.get("/api/v1/catalog/artists", async request => successEnvelope(request.id, await service.listArtists(request.authContext!)));
  app.post("/api/v1/catalog/artists", async (request, reply) => { const input = artist.parse(request.body); await Promise.all([publishPublicImage(config, request.id, request.headers[INTERNAL_CONTEXT_HEADER], input.imageUrl), publishPublicImage(config, request.id, request.headers[INTERNAL_CONTEXT_HEADER], input.vevoBannerUrl)]); const result = await service.createArtist(request.authContext!, input); reply.code(201); return successEnvelope(request.id, result); });
  app.get<{ Params: { id: string } }>("/api/v1/catalog/artists/:id", async request => successEnvelope(request.id, await service.getArtist(request.authContext!, uuid.parse(request.params.id))));
  app.patch<{ Params: { id: string } }>("/api/v1/catalog/artists/:id", async request => { const input = artistPatch.parse(request.body); await Promise.all([publishPublicImage(config, request.id, request.headers[INTERNAL_CONTEXT_HEADER], input.imageUrl), publishPublicImage(config, request.id, request.headers[INTERNAL_CONTEXT_HEADER], input.vevoBannerUrl)]); return successEnvelope(request.id, await service.updateArtist(request.authContext!, uuid.parse(request.params.id), input)); });
  app.delete<{ Params: { id: string } }>("/api/v1/catalog/artists/:id", async request => { await service.deleteArtist(request.authContext!, uuid.parse(request.params.id)); return successEnvelope(request.id, { success: true }); });
  app.get<{ Querystring: { q?: string } }>("/api/v1/catalog/artists/search-dsp", async request => { const query = z.string().trim().min(2).max(80).parse(request.query.q); return successEnvelope(request.id, { query, ...(await searchDspArtists(query, config)) }); });
  app.get("/api/v1/catalog/releases", async request => successEnvelope(request.id, (await service.listReleases(request.authContext!, releaseListQuery.parse(request.query))).map(serializeRelease)));
  app.get("/api/v1/catalog/releases/export-snapshot", async request => successEnvelope(request.id, (await service.getExportSnapshot(request.authContext!, exportSnapshotQuery.parse(request.query).releaseId)).map(serializeRelease)));
  app.post("/api/v1/catalog/releases", async (request, reply) => {
    const input = draftInput(releaseDraft.parse(request.body));
    await validateMediaReferences(config, request.id, request.authContext, request.headers[INTERNAL_CONTEXT_HEADER], input.tracks, input.coverUrl);
    const result = await service.createReleaseDraft(request.authContext!, input);
    reply.code(201);
    return successEnvelope(request.id, serializeRelease(result));
  });
  app.get<{ Params: { id: string } }>("/api/v1/catalog/releases/:id", async request => successEnvelope(request.id, serializeRelease(await service.getRelease(request.authContext!, uuid.parse(request.params.id)))));
  app.get<{ Params: { id: string } }>("/api/v1/catalog/releases/:id/distribution-snapshot", async request => successEnvelope(request.id, serializeRelease(await service.getDistributionSnapshot(request.authContext!, uuid.parse(request.params.id)))));
  app.patch<{ Params: { id: string } }>("/api/v1/catalog/releases/:id", async request => {
    const input = draftInput(releaseDraft.parse(request.body));
    await validateMediaReferences(config, request.id, request.authContext, request.headers[INTERNAL_CONTEXT_HEADER], input.tracks, input.coverUrl);
    return successEnvelope(request.id, serializeRelease(await service.updateReleaseDraft(request.authContext!, uuid.parse(request.params.id), input)));
  });
  app.delete<{ Params: { id: string } }>("/api/v1/catalog/releases/:id", async request => { await service.deleteRelease(request.authContext!, uuid.parse(request.params.id)); return successEnvelope(request.id, { success: true }); });
  app.post<{ Params: { id: string } }>("/api/v1/catalog/releases/:id/submit", async request => {
    const releaseId = uuid.parse(request.params.id);
    const submission = submitReleaseSchema.parse(request.body ?? {});
    const snapshot = await service.getDistributionSnapshot(request.authContext!, releaseId);
    const signedContext = request.headers[INTERNAL_CONTEXT_HEADER];
    if (typeof signedContext !== "string") throw new CatalogError(401, "UNAUTHENTICATED", "Signed Gateway context required");
    await validateMediaReferences(
      config,
      request.id,
      request.authContext,
      signedContext,
      snapshot.tracks,
      snapshot.coverUrl ?? undefined,
    );
    if (!config.distributionServiceUrl) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Distribution target catalog is unavailable");
    const recipientsResponse = await fetch(`${config.distributionServiceUrl}/api/v1/distribution/recipients?releaseType=${snapshot.type}`, {
      headers: { "x-request-id": request.id, [INTERNAL_CONTEXT_HEADER]: signedContext },
      signal: AbortSignal.timeout(5000)
    }).catch(() => null);
    if (!recipientsResponse?.ok) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Distribution target catalog is unavailable");
    const recipients = distributionRecipientsEnvelope.safeParse(await recipientsResponse.json().catch(() => null));
    if (!recipients.success) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Distribution target catalog response is invalid");
    const configuredTargets = new Set(recipients.data.data.map(item => item.id));
    if (submission.dspIds.some(id => !configuredTargets.has(id))) throw new CatalogError(400, "DSP_NOT_CONFIGURED", "One or more selected DSPs are not configured");
    if (snapshot.type === "VIDEO") {
      const cache = new Map<string, MediaAssetEvidence | null>();
      const fetchAssetEvidence = async (assetId: string) => {
        const cached = cache.get(assetId);
        if (cached !== undefined) return cached;
        const response = await fetch(`${config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(assetId)}`, {
          headers: { "x-request-id": request.id, [INTERNAL_CONTEXT_HEADER]: signedContext },
          signal: AbortSignal.timeout(5000),
        }).catch(() => null);
        if (!response) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media QC service is unavailable");
        if (response.status === 404) { cache.set(assetId, null); return null; }
        if (!response.ok) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media QC service is unavailable");
        const envelope = await response.json().catch(() => null) as { data?: unknown } | null;
        const parsed = mediaAssetEvidence.safeParse(envelope?.data);
        if (!parsed.success) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media QC response is invalid");
        cache.set(assetId, parsed.data);
        return parsed.data;
      };
      await assertVevoReleaseReady(snapshot, fetchAssetEvidence);
    }
    return successEnvelope(request.id, await service.submitRelease(request.authContext!, releaseId, {
      vevoValidated: snapshot.type === "VIDEO",
      targetDsps: submission.dspIds,
      ...(snapshot.type === "VIDEO" ? { expectedUpdatedAt: snapshot.updatedAt } : {}),
    }));
  });
  app.post<{ Params: { id: string } }>("/api/v1/catalog/releases/:id/approve", async request => {
    return successEnvelope(request.id, await service.approveRelease(request.authContext!, uuid.parse(request.params.id)));
  });
  app.post<{ Params: { id: string } }>("/api/v1/catalog/releases/:id/delivery-lock", async request => successEnvelope(request.id, serializeRelease(await service.lockReleaseForDelivery(request.authContext!, uuid.parse(request.params.id)))));
  app.post<{ Params: { id: string } }>("/api/v1/catalog/releases/:id/deny", async request => successEnvelope(request.id, await service.denyRelease(request.authContext!, uuid.parse(request.params.id), denyReleaseSchema.parse(request.body ?? {}).reason)));
  app.post<{ Params: { releaseId: string } }>("/api/v1/catalog/releases/:releaseId/tracks", async (request, reply) => {
    const input = trackPayload.parse(request.body);
    await validateMediaReferences(config, request.id, request.authContext, request.headers[INTERNAL_CONTEXT_HEADER], [input]);
    const result = await service.createTrack(request.authContext!, uuid.parse(request.params.releaseId), input);
    reply.code(201);
    return successEnvelope(request.id, result);
  });
  app.get<{ Params: { id: string } }>("/api/v1/catalog/tracks/:id", async request => successEnvelope(request.id, await service.getTrack(request.authContext!, uuid.parse(request.params.id))));
  app.get<{ Params: { id: string } }>("/api/v1/catalog/tracks/:id/analytics-scope", async request => successEnvelope(request.id, await service.getTrackAnalyticsScope(request.authContext!, uuid.parse(request.params.id))));
  app.patch<{ Params: { id: string } }>("/api/v1/catalog/tracks/:id", async request => {
    const input = trackPatchPayload.parse(request.body);
    await validateMediaReferences(config, request.id, request.authContext, request.headers[INTERNAL_CONTEXT_HEADER], [input]);
    return successEnvelope(request.id, await service.updateTrack(request.authContext!, uuid.parse(request.params.id), input));
  });
  app.delete<{ Params: { id: string } }>("/api/v1/catalog/tracks/:id", async request => { await service.deleteTrack(request.authContext!, uuid.parse(request.params.id)); return successEnvelope(request.id, { success: true }); });
  app.get("/api/v1/catalog/compositions", async request => successEnvelope(request.id, await service.listCompositions(request.authContext!)));
  app.post("/api/v1/catalog/compositions", async (request, reply) => { const result = await service.createComposition(request.authContext!, composition.parse(request.body)); reply.code(201); return successEnvelope(request.id, result); });
  app.get<{ Params: { id: string } }>("/api/v1/catalog/compositions/:id", async request => successEnvelope(request.id, await service.getComposition(request.authContext!, uuid.parse(request.params.id))));
  app.patch<{ Params: { id: string } }>("/api/v1/catalog/compositions/:id", async request => successEnvelope(request.id, await service.updateComposition(request.authContext!, uuid.parse(request.params.id), compositionPatch.parse(request.body))));
  app.delete<{ Params: { id: string } }>("/api/v1/catalog/compositions/:id", async request => { await service.deleteComposition(request.authContext!, uuid.parse(request.params.id)); return successEnvelope(request.id, { success: true }); });
  app.get("/api/v1/catalog/playlists", async request => successEnvelope(request.id, (await service.listPlaylists(request.authContext!)).map(value => ({ ...value, trackCount: value._count.tracks, cover: value.coverUrl }))));
  app.post("/api/v1/catalog/playlists", async (request, reply) => { const result = await service.createPlaylist(request.authContext!, playlist.parse(request.body)); reply.code(201); return successEnvelope(request.id, result); });
  if (importService) {
    app.post("/api/v1/catalog/imports", async (request, reply) => {
      const signedContext = request.headers[INTERNAL_CONTEXT_HEADER];
      const result = await importService.create(request.authContext!, catalogImportRequestSchema.parse(request.body), typeof signedContext === "string" ? signedContext : "");
      reply.code(202);
      return successEnvelope(request.id, result);
    });
    app.get<{ Params: { id: string } }>("/api/v1/catalog/imports/:id", async request => successEnvelope(request.id, await importService.get(request.authContext!, uuid.parse(request.params.id))));
  }
}
