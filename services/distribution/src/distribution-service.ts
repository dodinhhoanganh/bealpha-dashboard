import { randomUUID } from "node:crypto";
import { entityPathSchema, INTERNAL_CONTEXT_HEADER, type DdexAcknowledgementRequest, type DeliveryRequest, type InternalAuthContext } from "@bealpha/contracts";
import { resolveDspRecipient, type DistributionConfig } from "./config.js";
import type { DistributionDatabase } from "./database.js";
import { DistributionError } from "./errors.js";
import { catalogSnapshotSchema, generateErn, snapshotHash, validateAgainstXsd, type CatalogSnapshot } from "./ern.js";
import { Prisma } from "./generated/distribution-prisma2/client.js";
import { encryptGrantToken } from "./grant-crypto.js";
import { z } from "zod";
import { acknowledgementOutcome, assertAcknowledgementMatches, parseAcknowledgement } from "./acknowledgement.js";

type Actor = InternalAuthContext & { actorId: string; entityId: string; entityPath: string; entityType: string };
type AcknowledgementDelivery = { id: string; tenantId: string; entityPath: string; dsp: string; messageId: string; status: string; sentAt: Date | null; snapshot: { payload: unknown; requestId: string; createdById: string } | null };
function actor(context: InternalAuthContext): Actor { if (context.authType !== "user" || !context.actorId || !context.entityId || !context.entityPath || !context.entityType) throw new DistributionError(403, "FORBIDDEN", "Distribution requires entity membership"); return context as Actor; }
function dispatcher(context: InternalAuthContext): Actor {
  const current = actor(context);
  if (current.entityType !== "SUPER_ADMIN" || current.entityRole !== "OWNER") {
    throw new DistributionError(403, "FORBIDDEN", "BeAlpha owner approval required for distribution");
  }
  return current;
}
function visible(path: string) { return { OR: [{ entityPath: path }, { entityPath: { startsWith: `${path}.` } }] }; }
const mediaGrantEnvelopeSchema = z.object({ data: z.object({ assetId: z.string().uuid(), token: z.string().min(40).max(128), expiresAt: z.string().datetime({ offset: true }), singleUse: z.boolean(), maxUses: z.number().int().min(1).max(20), fileName: z.string().min(1).max(500), contentType: z.string().min(1).max(255), sizeBytes: z.string().regex(/^\d+$/) }) });
const deliveryScopeEnvelopeSchema = z.object({ data: z.object({ tenantId: z.string().uuid(), owner: z.object({ path: entityPathSchema }) }) });

export class DistributionService {
  constructor(private readonly database: DistributionDatabase, private readonly config: DistributionConfig, private readonly validator: (xml: string, xsd?: string) => Promise<void> = validateAgainstXsd) {}
  private async fetchDeliveryScope(releaseId: string, requestId: string, signedContext: string) {
    const response = await fetch(`${this.config.catalogServiceUrl}/api/v1/catalog/releases/${encodeURIComponent(releaseId)}/distribution-snapshot`, { headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!response || response.status === 404) throw new DistributionError(404, "NOT_FOUND", "Release not found");
    if (!response.ok) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Catalog ownership scope unavailable");
    const parsed = deliveryScopeEnvelopeSchema.safeParse(await response.json());
    if (!parsed.success) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Catalog ownership scope is invalid");
    return { tenantId: parsed.data.data.tenantId, entityPath: parsed.data.data.owner.path };
  }
  private async fetchSnapshot(releaseId: string, requestId: string, signedContext: string): Promise<CatalogSnapshot> {
    const response = await fetch(`${this.config.catalogServiceUrl}/api/v1/catalog/releases/${encodeURIComponent(releaseId)}/distribution-snapshot`, { headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
    if (!response || response.status === 404) throw new DistributionError(404, "NOT_FOUND", "Release not found");
    if (!response.ok) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Catalog snapshot unavailable");
    const envelope = await response.json() as { data?: unknown };
    const parsed = catalogSnapshotSchema.safeParse(envelope.data);
    if (!parsed.success) throw new DistributionError(422, "DDEX_PROFILE_INCOMPLETE", "Release does not satisfy the ERN 4.3 audio profile");
    return parsed.data;
  }
  private async fetchAssetGrants(snapshot: CatalogSnapshot, requestId: string, signedContext: string) {
    const assetIds = [...new Set(snapshot.tracks.map(track => track.audioAssetId).filter((id): id is string => Boolean(id)))];
    if (assetIds.length !== snapshot.tracks.length) throw new DistributionError(422, "DELIVERY_ASSET_MISSING", "Every track requires a ready audio master");
    const grants: Array<{ assetId: string; tokenCiphertext: string; expiresAt: Date; fileName: string; contentType: string; sizeBytes: bigint }> = [];
    for (const assetId of assetIds) {
      const response = await fetch(`${this.config.mediaServiceUrl}/api/v1/media/assets/${encodeURIComponent(assetId)}/delivery-grants`, { method: "POST", headers: { "x-request-id": requestId, [INTERNAL_CONTEXT_HEADER]: signedContext }, signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!response?.ok) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "Media delivery grant unavailable");
      const grant = mediaGrantEnvelopeSchema.parse(await response.json()).data;
      grants.push({ assetId: grant.assetId, tokenCiphertext: encryptGrantToken(grant.token, this.config.deliveryGrantEncryptionKey), expiresAt: new Date(grant.expiresAt), fileName: grant.fileName, contentType: grant.contentType, sizeBytes: BigInt(grant.sizeBytes) });
    }
    return grants;
  }
  async createDelivery(context: InternalAuthContext, input: DeliveryRequest, signedContext: string) {
    const current = dispatcher(context);
    if (!this.config.sftpDeliveryEnabled) throw new DistributionError(409, "AUTOMATED_DELIVERY_DISABLED", "Download the prepared DDEX package for manual external delivery");
    const scope = await this.fetchDeliveryScope(input.releaseId, context.requestId, signedContext);
    const tenantId = scope.tenantId;
    const existing = await this.database.prisma.delivery.findFirst({ where: { tenantId, idempotencyKey: input.idempotencyKey }, include: { snapshot: true } });
    if (existing) return existing;
    const recipient = resolveDspRecipient(this.config, input.dsp);
    if (!recipient) throw new DistributionError(400, "VALIDATION_ERROR", "DSP is not configured");
    
    return this.database.prisma.$transaction(async transaction => {
      const deliveryId = randomUUID();
      const delivery = await transaction.delivery.create({
        data: {
          id: deliveryId,
          snapshotId: null,
          releaseId: input.releaseId,
          tenantId,
          entityPath: scope.entityPath,
          dsp: input.dsp,
          ernVersion: input.ernVersion,
          messageType: input.messageType,
          messageId: `BA-${deliveryId}`,
          messageThreadId: `BA-${input.releaseId}-${input.dsp}`,
          releaseProfileVersionId: "SimpleAudioSingle",
          idempotencyKey: input.idempotencyKey,
          status: "INITIALIZING"
        }
      });
      
      await transaction.outboxEvent.create({
        data: {
          eventId: randomUUID(),
          version: 1,
          type: "distribution.snapshot.requested",
          requestId: context.requestId,
          actorId: current.actorId,
          tenantId,
          entityPath: scope.entityPath,
          payload: {
            deliveryId: delivery.id,
            releaseId: input.releaseId,
            actor: current
          }
        }
      });
      
      return { ...delivery, snapshot: null };
    });
  }
  listRecipients(context: InternalAuthContext, releaseType?: "AUDIO" | "VIDEO") {
    actor(context);
    return Object.entries(this.config.storeTargets ?? this.config.dspRecipients)
      .filter(([, target]) => !releaseType || !("releaseTypes" in target) || !target.releaseTypes || target.releaseTypes.includes(releaseType))
      .map(([id, target]) => ({ id, name: target.name }));
  }
  async previewDelivery(context: InternalAuthContext, input: Omit<DeliveryRequest, "idempotencyKey">, signedContext: string) {
    actor(context);
    const recipient = resolveDspRecipient(this.config, input.dsp);
    if (!recipient) throw new DistributionError(400, "VALIDATION_ERROR", "DSP is not configured");
    const snapshot = await this.fetchSnapshot(input.releaseId, context.requestId, signedContext);
    const grants = input.messageType === "TakedownMessage" ? [] : await this.fetchAssetGrants(snapshot, context.requestId, signedContext);
    const previewId = randomUUID();
    const xml = generateErn({ snapshot, sender: this.config.ddexSender, recipient, messageType: input.messageType, ernVersion: input.ernVersion, avsVersionId: this.config.ddexAvsVersionId, messageId: `PREVIEW-${previewId}`, messageThreadId: `BA-${input.releaseId}-${input.dsp}`, createdAt: new Date(), assets: new Map(grants.map(grant => [grant.assetId, grant])) });
    await this.validator(xml, this.config.xsdPath);
    return { xml };
  }
  async getDelivery(context: InternalAuthContext, deliveryId: string) {
    const current = actor(context);
    const delivery = await this.database.prisma.delivery.findFirst({
      where: { id: deliveryId, ...visible(current.entityPath) },
      include: { snapshot: true, acknowledgements: { orderBy: { receivedAt: "desc" }, take: 20 } }
    });
    if (!delivery) throw new DistributionError(404, "NOT_FOUND", "Delivery not found");
    return delivery;
  }
  async listDeliveries(context: InternalAuthContext) { const current = actor(context); return this.database.prisma.delivery.findMany({ where: visible(current.entityPath), include: { snapshot: { select: { id: true, sha256: true, version: true, createdAt: true } } }, orderBy: { createdAt: "desc" }, take: 100 }); }

  async recordAcknowledgement(context: InternalAuthContext, deliveryId: string, input: DdexAcknowledgementRequest) {
    const current = dispatcher(context);
    const delivery = await this.database.prisma.delivery.findFirst({ where: { id: deliveryId, ...visible(current.entityPath) }, include: { snapshot: true } });
    return this.persistAcknowledgement(delivery, input, context.requestId, current.actorId);
  }

  async recordTransportAcknowledgement(deliveryId: string, input: DdexAcknowledgementRequest) {
    const delivery = await this.database.prisma.delivery.findUnique({ where: { id: deliveryId }, include: { snapshot: true } });
    return this.persistAcknowledgement(delivery, input, delivery?.snapshot?.requestId, delivery?.snapshot?.createdById);
  }

  private async persistAcknowledgement(delivery: AcknowledgementDelivery | null, input: DdexAcknowledgementRequest, requestId?: string, actorId?: string) {
    if (!delivery?.snapshot) throw new DistributionError(404, "NOT_FOUND", "Delivery not found");
    if (!delivery.sentAt || !["SENT", "CONFIRMED", "FAILED"].includes(delivery.status)) throw new DistributionError(409, "INVALID_WORKFLOW_STATE", "Delivery has not been transported");
    if (!requestId || !actorId) throw new DistributionError(500, "ACK_AUDIT_CONTEXT_MISSING", "Acknowledgement audit context is unavailable");
    const recipient = resolveDspRecipient(this.config, delivery.dsp);
    if (!recipient) throw new DistributionError(503, "UPSTREAM_UNAVAILABLE", "DSP configuration is unavailable");
    await this.validator(input.xml, this.config.acknowledgementXsdPath).catch(() => { throw new DistributionError(422, "DDEX_ACK_INVALID", "Acknowledgement does not validate against the configured ERN-C schema"); });
    let acknowledgement: ReturnType<typeof parseAcknowledgement>;
    try {
      acknowledgement = parseAcknowledgement(input.xml);
      const snapshot = catalogSnapshotSchema.parse(delivery.snapshot.payload);
      assertAcknowledgementMatches(acknowledgement, { fileName: input.fileName, messageId: delivery.messageId, releaseId: snapshot.ean, senderPartyId: recipient.partyId, recipientPartyId: this.config.ddexSender.partyId });
    } catch {
      throw new DistributionError(422, "DDEX_ACK_INVALID", "Acknowledgement does not match this delivery");
    }
    const existing = await this.database.prisma.deliveryAcknowledgement.findFirst({ where: { OR: [{ rawSha256: acknowledgement.rawSha256 }, { senderPartyId: acknowledgement.senderPartyId, acknowledgementMessageId: acknowledgement.acknowledgementMessageId }] } });
    if (existing) {
      if (existing.deliveryId !== delivery.id) throw new DistributionError(409, "DDEX_ACK_REPLAY", "Acknowledgement was already applied to another delivery");
      return existing;
    }
    const outcome = acknowledgementOutcome(acknowledgement);
    const informationText = acknowledgement.errorText ?? acknowledgement.fileStatuses.map(item => item.information).filter(Boolean).join("; ");
    const information = informationText ? informationText.slice(0, 1000) : undefined;
    try {
      return await this.database.prisma.$transaction(async transaction => {
        const receivedAt = new Date();
        const stored = await transaction.deliveryAcknowledgement.create({ data: { deliveryId: delivery.id, acknowledgementMessageId: acknowledgement.acknowledgementMessageId, referencedMessageId: acknowledgement.referencedMessageId, senderPartyId: acknowledgement.senderPartyId, supplyChainStatus: acknowledgement.supplyChainStatus, fileStatuses: acknowledgement.fileStatuses as Prisma.InputJsonValue, information, fileName: input.fileName, rawSha256: acknowledgement.rawSha256, messageCreatedAt: acknowledgement.messageCreatedAt } });
        const transition = delivery.status === "SENT";
        await transaction.delivery.updateMany({ where: { id: delivery.id, status: "SENT" }, data: outcome === "CONFIRMED" ? { status: "CONFIRMED", confirmedAt: receivedAt, lastError: null, ackPollLockedAt: null, ackPollAfter: null } : outcome === "FAILED" ? { status: "FAILED", lastError: information ?? `DSP acknowledgement: ${acknowledgement.supplyChainStatus}`, ackPollLockedAt: null, ackPollAfter: null } : { status: "SENT" } });
        const eventOutcome = transition ? outcome : "SENT";
        await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: eventOutcome === "CONFIRMED" ? "distribution.delivery.confirmed" : eventOutcome === "FAILED" ? "distribution.delivery.rejected" : "distribution.delivery.acknowledged", requestId, actorId, tenantId: delivery.tenantId, entityPath: delivery.entityPath, payload: { deliveryId: delivery.id, acknowledgementId: stored.id, outcome, supplyChainStatus: acknowledgement.supplyChainStatus } } });
        return stored;
      });
    } catch (error) {
      if (!(typeof error === "object" && error !== null && "code" in error && error.code === "P2002")) throw error;
      const raced = await this.database.prisma.deliveryAcknowledgement.findFirst({ where: { OR: [{ rawSha256: acknowledgement.rawSha256 }, { senderPartyId: acknowledgement.senderPartyId, acknowledgementMessageId: acknowledgement.acknowledgementMessageId }] } });
      if (raced?.deliveryId === delivery.id) return raced;
      throw new DistributionError(409, "DDEX_ACK_REPLAY", "Acknowledgement was already applied to another delivery");
    }
  }
}
