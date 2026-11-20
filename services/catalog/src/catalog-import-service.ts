import { randomUUID } from "node:crypto";

import { INTERNAL_CONTEXT_HEADER, type CatalogImportRequest, type InternalAuthContext } from "@bealpha/contracts";
import { z } from "zod";

import type { CatalogConfig } from "./config.js";
import type { CatalogDatabase } from "./database.js";
import { CatalogError } from "./errors.js";
import { encryptGrantToken } from "./grant-crypto.js";

type ImportActor = InternalAuthContext & { actorId: string; entityId: string; entityPath: string; entityType: string };
const grantEnvelopeSchema = z.object({ data: z.object({ assetId: z.string().uuid(), token: z.string().min(40).max(128), expiresAt: z.string().datetime({ offset: true }), fileName: z.string().min(1).max(500), contentType: z.string().min(1).max(255), sizeBytes: z.string().regex(/^\d+$/) }) });
const archiveEntriesEnvelopeSchema = z.object({ data: z.array(z.object({ entryName: z.string().min(1).max(1024), asset: z.object({ id: z.string().uuid(), type: z.enum(["AUDIO", "VIDEO", "IMAGE"]), fileName: z.string().min(1).max(255), status: z.enum(["PENDING", "PROCESSING", "READY", "ERROR", "ARCHIVED"]) }) })).max(10000) });

function actor(context: InternalAuthContext): ImportActor {
  if (context.authType !== "user" || !context.actorId || !context.entityId || !context.entityPath || !context.entityType) throw new CatalogError(403, "FORBIDDEN", "Catalog import requires entity membership");
  if (context.entityType === "SUB_ACCOUNT") throw new CatalogError(403, "FORBIDDEN", "Organization or above required for catalog import");
  if (!context.entityRole || !["OWNER", "ADMIN"].includes(context.entityRole)) throw new CatalogError(403, "FORBIDDEN", "Entity manager role required for catalog import");
  return context as ImportActor;
}

function visible(path: string) {
  return { OR: [{ entityPath: path }, { entityPath: { startsWith: `${path}.` } }] };
}

export class CatalogImportService {
  constructor(private readonly database: CatalogDatabase, private readonly config: CatalogConfig) {}

  async create(context: InternalAuthContext, input: CatalogImportRequest, signedContext: string) {
    const current = actor(context);
    const response = await fetch(`${this.config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(input.assetId)}/delivery-grants`, { method: "POST", headers: { "x-request-id": context.requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (response?.status === 409) throw new CatalogError(409, "ASSET_NOT_READY", "Archive validation is still processing");
    if (!response?.ok) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media delivery grant unavailable");
    const grant = grantEnvelopeSchema.parse(await response.json()).data;
    const sourceName = grant.fileName.toLowerCase();
    if (input.format === "XML" && !sourceName.endsWith(".xml")) throw new CatalogError(400, "IMPORT_FORMAT_MISMATCH", "XML import requires an .xml Media asset");
    if (input.format === "ZIP" && !sourceName.endsWith(".zip")) throw new CatalogError(400, "IMPORT_FORMAT_MISMATCH", "ZIP import requires a .zip Media asset");
    if (input.format === "CSV" && !sourceName.endsWith(".csv")) throw new CatalogError(400, "IMPORT_FORMAT_MISMATCH", "CSV import requires a .csv Media asset");
    if (input.format === "XLSX" && !sourceName.endsWith(".xlsx")) throw new CatalogError(400, "IMPORT_FORMAT_MISMATCH", "XLSX import requires an .xlsx Media asset");
    let archiveEntries: z.infer<typeof archiveEntriesEnvelopeSchema>["data"] = [];
    if (input.format === "ZIP") {
      const entriesResponse = await fetch(`${this.config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(input.assetId)}/archive-entries`, { headers: { "x-request-id": context.requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!entriesResponse?.ok) throw new CatalogError(503, "UPSTREAM_UNAVAILABLE", "Media archive entries unavailable");
      archiveEntries = archiveEntriesEnvelopeSchema.parse(await entriesResponse.json()).data;
    }
    const sourceSizeBytes = BigInt(grant.sizeBytes);
    if (sourceSizeBytes > BigInt(this.config.importMaxBytes)) throw new CatalogError(413, "IMPORT_TOO_LARGE", "Catalog import exceeds configured limit");
    const tenantId = current.tenantId ?? current.entityId;
    return this.database.prisma.$transaction(async transaction => {
      const catalogImport = await transaction.catalogImport.create({ data: { assetId: input.assetId, tenantId, ownerEntityId: current.entityId, entityPath: current.entityPath, actorId: current.actorId, requestId: context.requestId, format: input.format, tokenCiphertext: encryptGrantToken(grant.token, this.config.importGrantEncryptionKey), grantExpiresAt: new Date(grant.expiresAt), sourceFileName: grant.fileName, sourceContentType: grant.contentType, sourceSizeBytes, ...(archiveEntries.length > 0 ? { archiveEntries } : {}) } });
      await transaction.catalogImportJob.create({ data: { importId: catalogImport.id } });
      await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "catalog.import.requested", requestId: context.requestId, actorId: current.actorId, tenantId, entityPath: current.entityPath, payload: { importId: catalogImport.id, assetId: input.assetId, format: input.format } } });
      return { id: catalogImport.id, assetId: catalogImport.assetId, format: catalogImport.format, status: catalogImport.status, createdAt: catalogImport.createdAt };
    });
  }

  async get(context: InternalAuthContext, importId: string) {
    const current = actor(context);
    const result = await this.database.prisma.catalogImport.findFirst({ where: { id: importId, ...visible(current.entityPath) }, select: { id: true, assetId: true, format: true, status: true, releaseCount: true, trackCount: true, lastError: true, completedAt: true, createdAt: true, updatedAt: true } });
    if (!result) throw new CatalogError(404, "NOT_FOUND", "Catalog import not found");
    return result;
  }
}
