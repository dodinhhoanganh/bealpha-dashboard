import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InternalAuthContext } from "@bealpha/contracts";
import type { DistributionConfig } from "../src/config.js";
import type { DistributionDatabase } from "../src/database.js";
import { DistributionService } from "../src/distribution-service.js";
import { processNextAcknowledgementPoll, processNextAcknowledgementPollWhenEnabled, processNextDeliveryJob, processNextDeliveryJobWhenEnabled } from "../src/worker.js";
import { buildDeliveryPackage } from "../src/package-builder.js";
import { decryptGrantToken, encryptGrantToken } from "../src/grant-crypto.js";
import { buildCatalogExport } from "../src/export-worker.js";
import { createExportToken, verifyExportToken } from "../src/export-token.js";
import { DistributionSagaOutboxRelay } from "../src/saga-outbox-relay.js";
import { approvedAudioAssetIds, finalizeApprovedAudioPackage } from "../src/saga-worker.js";
import { ExportService } from "../src/export-service.js";

const ids = { actor: "11111111-1111-4111-8111-111111111111", entity: "22222222-2222-4222-8222-222222222222", tenant: "33333333-3333-4333-8333-333333333333", otherTenant: "99999999-9999-4999-8999-999999999999", release: "44444444-4444-4444-8444-444444444444", track: "55555555-5555-4555-8555-555555555555", snapshot: "66666666-6666-4666-8666-666666666666", delivery: "77777777-7777-4777-8777-777777777777", asset: "88888888-8888-4888-8888-888888888888" };
function context(overrides: Partial<InternalAuthContext> = {}): InternalAuthContext { return { v: 1, requestId: randomUUID(), authType: "user", actorId: ids.actor, entityId: ids.entity, entityType: "ORGANIZATION", entityRole: "OWNER", tenantId: ids.tenant, entityPath: "root.system.org", roles: ["ORGANIZATION"], staffRoles: [], authzVersion: 1, ...overrides }; }
function config(): DistributionConfig { return { nodeEnv: "test", host: "127.0.0.1", port: 4104, logLevel: "silent", trustProxyHops: 0, bodyLimitBytes: 65536, databaseUrl: "postgresql://test:test@localhost:5432/test", dbPoolMax: 1, catalogServiceUrl: "http://catalog:4102", mediaServiceUrl: "http://media:4103", deliveryGrantEncryptionKey: Buffer.alloc(32, 7), redisUrl: "redis://localhost:6379", gatewayContextPublicKeyPem: "", gatewayContextIssuer: "bealpha-gateway", gatewayContextAudience: "bealpha-services", ddexSender: { partyId: "PADPIDA0000000001A", name: "BeAlpha" }, ddexAvsVersionId: "9", dspRecipients: { spotify: { partyId: "PADPIDA1234567890A", name: "Spotify" } }, sftpDeliveryEnabled: true, workerPollMs: 1000, workerMaxAttempts: 5, acknowledgementPollMs: 60000, packageRoot: ".", packageMaxBytes: 50 * 1024 * 1024 * 1024, packageMaxEntries: 10000, sftpTargets: {}, publicBaseUrl: "http://localhost:8080", exportDownloadSigningKey: Buffer.alloc(32, 9), exportDownloadTtlSeconds: 900, exportRetentionSeconds: 86400 }; }
function database() {
  const prisma = {
    delivery: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn(), findMany: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    deliverySnapshot: { findUnique: vi.fn(), aggregate: vi.fn(), create: vi.fn() },
    deliveryJob: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, deliveryAssetGrant: { createMany: vi.fn(), updateMany: vi.fn() }, deliveryAcknowledgement: { findFirst: vi.fn(), create: vi.fn() }, exportJob: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), create: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn(), findMany: vi.fn() }, outboxEvent: { create: vi.fn(), findMany: vi.fn(), update: vi.fn() }, $transaction: vi.fn()
  };
  prisma.$transaction.mockImplementation(async callback => callback(prisma));
  return { prisma };
}
const catalogSnapshot = { id: ids.release, title: "Single", ean: "123456789012", type: "AUDIO", format: "SINGLE", status: "LOCKED_FOR_DELIVERY", tenantId: ids.tenant, displayArtist: "Artist", releaseDate: "2026-08-30T00:00:00.000Z", genre: "Pop", cLine: "2026 Label", pLine: "2026 Label", metadata: { targetDsps: ["spotify"] }, label: { name: "Label" }, tracks: [{ id: ids.track, title: "Track", isrc: "USABC2600001", trackNumber: 1, discNumber: 1, duration: 180, displayArtist: "Artist", explicitContent: "NONE", audioAssetId: ids.asset }] };
function grantResponse() { return new Response(JSON.stringify({ data: { assetId: ids.asset, token: "g".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString(), singleUse: false, maxUses: 5, fileName: "master.wav", contentType: "audio/wav", sizeBytes: "4", sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" } }), { status: 200, headers: { "content-type": "application/json" } }); }
function scopeResponse(tenantId = ids.tenant, entityPath = "root.system.org.sub") { return new Response(JSON.stringify({ data: { tenantId, owner: { path: entityPath } } }), { status: 200, headers: { "content-type": "application/json" } }); }
function acknowledgementXml(acknowledgementMessageId = "ACK-001") { return `<?xml version="1.0" encoding="UTF-8"?><ernc:AcknowledgementMessage xmlns:ernc="http://ddex.net/xml/ern-c-sftp/181" AvsVersionId="9"><MessageHeader><MessageId>${acknowledgementMessageId}</MessageId><MessageSender><PartyId>PADPIDA1234567890A</PartyId></MessageSender><MessageRecipient><PartyId>PADPIDA0000000001A</PartyId></MessageRecipient><MessageCreatedDateTime>2026-08-22T00:00:00Z</MessageCreatedDateTime></MessageHeader><ReleaseStatus><ReleaseId><ICPN>123456789012</ICPN></ReleaseId><ReleaseStatus>SuccessfullyIngestedByReleaseDistributor</ReleaseStatus><Acknowledgement><MessageType>NewReleaseMessage</MessageType><MessageId>BA-${ids.delivery}</MessageId><MessageStatus><Status>FileOK</Status></MessageStatus></Acknowledgement></ReleaseStatus></ernc:AcknowledgementMessage>`; }

describe("distribution invariants", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("lists configured recipients without exposing party IDs", () => {
    const cfg = { ...config(), storeTargets: { apple_music: { name: "Apple Music", recipientId: "spotify", releaseTypes: ["AUDIO" as const] }, vevo: { name: "VEVO", recipientId: "spotify", releaseTypes: ["VIDEO" as const] } } };
    const service = new DistributionService(database() as unknown as DistributionDatabase, cfg, vi.fn());
    expect(service.listRecipients(context(), "AUDIO")).toEqual([{ id: "apple_music", name: "Apple Music" }]);
    expect(service.listRecipients(context(), "VIDEO")).toEqual([{ id: "vevo", name: "VEVO" }]);
  });
  it("scopes delivery detail by entity path", async () => {
    const db = database();
    db.prisma.delivery.findFirst.mockResolvedValue({ id: ids.delivery });
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn());
    await expect(service.getDelivery(context(), ids.delivery)).resolves.toEqual({ id: ids.delivery });
    expect(db.prisma.delivery.findFirst).toHaveBeenCalledWith({
      where: { id: ids.delivery, OR: [{ entityPath: "root.system.org" }, { entityPath: { startsWith: "root.system.org." } }] },
      include: { snapshot: true, acknowledgements: { orderBy: { receivedAt: "desc" }, take: 20 } }
    });
  });
  it("V14 returns an existing delivery for the same tenant-scoped idempotency key", async () => {
    const db = database(); const existing = { id: ids.delivery, idempotencyKey: "delivery-key-0001", tenantId: ids.tenant, snapshot: { id: ids.snapshot } }; db.prisma.delivery.findFirst.mockResolvedValue(existing);
    const fetchMock = vi.fn().mockResolvedValue(scopeResponse()); vi.stubGlobal("fetch", fetchMock);
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn());
    await expect(service.createDelivery(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }), { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage", idempotencyKey: "delivery-key-0001" }, "signed")).resolves.toBe(existing);
    expect(db.prisma.delivery.findFirst).toHaveBeenCalledWith({ where: { tenantId: ids.tenant, idempotencyKey: "delivery-key-0001" }, include: { snapshot: true } });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(db.prisma.delivery.create).not.toHaveBeenCalled();
  });
  it("V14 uses trusted Catalog ownership instead of dispatcher tenant claims", async () => {
    const db = database(); db.prisma.delivery.findFirst.mockResolvedValue(null); db.prisma.delivery.create.mockResolvedValue({ id: ids.delivery, releaseId: ids.release }); db.prisma.outboxEvent.create.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(scopeResponse(ids.otherTenant, "root.system.other.child")));
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn());
    await service.createDelivery(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: ids.tenant, entityPath: "root.forged", roles: ["SUPER_ADMIN"] }), { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage", idempotencyKey: "shared-across-tenants" }, "signed");
    expect(db.prisma.delivery.findFirst).toHaveBeenCalledWith({ where: { tenantId: ids.otherTenant, idempotencyKey: "shared-across-tenants" }, include: { snapshot: true } });
    expect(db.prisma.delivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: ids.otherTenant, entityPath: "root.system.other.child" }) });
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: ids.otherTenant, entityPath: "root.system.other.child" }) });
  });
  it("V14 stores the delivery request and saga outbox event atomically", async () => {
    const db = database(); db.prisma.delivery.findUnique.mockResolvedValue(null); db.prisma.delivery.create.mockResolvedValue({ id: ids.delivery, releaseId: ids.release }); db.prisma.outboxEvent.create.mockResolvedValue({});
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(scopeResponse()));
    const current = context(); const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn());
    await service.createDelivery({ ...current, entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }, { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage", idempotencyKey: "delivery-key-0002" }, "signed");
    expect(db.prisma.delivery.create).toHaveBeenCalledWith({ data: expect.objectContaining({ releaseId: ids.release, tenantId: ids.tenant, entityPath: "root.system.org.sub", status: "INITIALIZING" }) });
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "distribution.snapshot.requested", requestId: current.requestId, payload: expect.objectContaining({ deliveryId: ids.delivery, releaseId: ids.release }) }) });
  });
  it("V4 blocks sub-accounts from dispatch", async () => {
    const db = database(); const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn());
    await expect(service.createDelivery(context({ entityType: "SUB_ACCOUNT", roles: ["SUB_ACCOUNT"] }), { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage", idempotencyKey: "delivery-key-0003" }, "signed")).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });
  it("V4 blocks organization owners and system managers from dispatch", async () => {
    const db = database(); const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn());
    const request = { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage", idempotencyKey: "delivery-key-0004" } as const;
    await expect(service.createDelivery(context(), request, "signed")).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    await expect(service.createDelivery(context({ entityType: "SYSTEM_ADMIN", entityRole: "ADMIN", roles: ["SYSTEM_ADMIN"] }), request, "signed")).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(db.prisma.delivery.create).not.toHaveBeenCalled();
  });
  it("fails closed globally when automated SFTP delivery is disabled", async () => {
    const db = database();
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    const service = new DistributionService(db as unknown as DistributionDatabase, { ...config(), sftpDeliveryEnabled: false }, vi.fn());
    await expect(service.createDelivery(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }), { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage", idempotencyKey: "manual-only-0001" }, "signed")).rejects.toMatchObject({ code: "AUTOMATED_DELIVERY_DISABLED", statusCode: 409 });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.prisma.delivery.create).not.toHaveBeenCalled();
  });
  it("does not claim or transport queued delivery jobs while SFTP delivery is disabled", async () => {
    const db = database(); const transport = { send: vi.fn() };
    await expect(processNextDeliveryJobWhenEnabled(false, db as unknown as DistributionDatabase, transport, 3)).resolves.toBe(false);
    expect(db.prisma.deliveryJob.findFirst).not.toHaveBeenCalled();
    expect(transport.send).not.toHaveBeenCalled();
  });
  it("does not poll SFTP acknowledgements while automated delivery is disabled", async () => {
    const db = database(); const transport = { poll: vi.fn() }; const recorder = { recordTransportAcknowledgement: vi.fn() };
    await expect(processNextAcknowledgementPollWhenEnabled(false, db as unknown as DistributionDatabase, transport, recorder, 60000)).resolves.toBe(false);
    expect(db.prisma.delivery.findFirst).not.toHaveBeenCalled();
    expect(transport.poll).not.toHaveBeenCalled();
  });
  it("blocks accountants from exporting delivery packages", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new ExportService(database() as unknown as DistributionDatabase, config());
    await expect(service.createExport(
      context({ entityRole: "ACCOUNTANT" }),
      { format: "zip", releaseId: ids.release },
      "signed"
    )).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("lists automatic DDEX packages with release identity for the manual-delivery UI", async () => {
    const db = database();
    db.prisma.exportJob.findMany.mockResolvedValue([{
      id: ids.delivery, format: "ZIP", status: "COMPLETE", fileName: "Single_DDEX.zip",
      contentType: "application/zip", sizeBytes: 42n, sha256: "a".repeat(64), lastError: null,
      expiresAt: new Date("2026-08-23T00:00:00.000Z"), createdAt: new Date("2026-08-22T00:00:00.000Z"),
      updatedAt: new Date("2026-08-22T00:01:00.000Z"),
      payload: { kind: "DDEX_PACKAGE", snapshot: { id: ids.release, title: "Single" }, destinations: [{ recipientId: "spotify" }] }
    }]);
    const service = new ExportService(db as unknown as DistributionDatabase, config());
    await expect(service.listExports(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", entityPath: "root", roles: ["SUPER_ADMIN"] }))).resolves.toEqual([
      expect.objectContaining({ releaseId: ids.release, releaseTitle: "Single", targetDsps: ["spotify"], format: "zip", status: "complete", downloadUrl: expect.stringContaining("/distribution-export/") })
    ]);
    await expect(service.listExports(context())).resolves.toEqual([]);
  });
  it("V14 fails closed when XSD validation rejects XML", async () => {
    const db = database(); db.prisma.delivery.findUnique.mockResolvedValue(null); vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ data: catalogSnapshot }), { status: 200 })).mockResolvedValueOnce(grantResponse()));
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn().mockRejectedValue(new Error("XSD_INVALID")));
    await expect(service.previewDelivery(context(), { releaseId: ids.release, dsp: "spotify", ernVersion: "4.3", messageType: "NewReleaseMessage" }, "signed")).rejects.toThrow("XSD_INVALID"); expect(db.prisma.delivery.create).not.toHaveBeenCalled();
  });
  it("persists a matching DSP acknowledgement and confirms the delivery atomically", async () => {
    const db = database();
    db.prisma.delivery.findFirst.mockResolvedValue({ id: ids.delivery, tenantId: ids.tenant, entityPath: "root.system.org.sub", dsp: "spotify", messageId: `BA-${ids.delivery}`, status: "SENT", sentAt: new Date(), snapshot: { payload: catalogSnapshot } });
    db.prisma.deliveryAcknowledgement.findFirst.mockResolvedValue(null);
    const stored = { id: ids.snapshot, deliveryId: ids.delivery };
    db.prisma.deliveryAcknowledgement.create.mockResolvedValue(stored);
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn().mockResolvedValue(undefined));
    const fileName = `ACK_BA-${ids.delivery}_20260822000000000.xml`;
    await expect(service.recordAcknowledgement(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }), ids.delivery, { fileName, xml: acknowledgementXml() })).resolves.toBe(stored);
    expect(db.prisma.delivery.updateMany).toHaveBeenCalledWith({ where: { id: ids.delivery, status: "SENT" }, data: expect.objectContaining({ status: "CONFIRMED", lastError: null }) });
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "distribution.delivery.confirmed", tenantId: ids.tenant, entityPath: "root.system.org.sub" }) });
  });
  it("rejects an acknowledgement replayed against another delivery", async () => {
    const db = database();
    db.prisma.delivery.findFirst.mockResolvedValue({ id: ids.delivery, tenantId: ids.tenant, entityPath: "root.system.org.sub", dsp: "spotify", messageId: `BA-${ids.delivery}`, status: "SENT", sentAt: new Date(), snapshot: { payload: catalogSnapshot } });
    db.prisma.deliveryAcknowledgement.findFirst.mockResolvedValue({ id: ids.snapshot, deliveryId: ids.release });
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn().mockResolvedValue(undefined));
    const fileName = `ACK_BA-${ids.delivery}_20260822000000000.xml`;
    await expect(service.recordAcknowledgement(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }), ids.delivery, { fileName, xml: acknowledgementXml() })).rejects.toMatchObject({ code: "DDEX_ACK_REPLAY", statusCode: 409 });
    expect(db.prisma.deliveryAcknowledgement.create).not.toHaveBeenCalled();
  });
  it("records an automatically polled acknowledgement with the immutable snapshot audit context", async () => {
    const db = database();
    const requestId = randomUUID();
    db.prisma.delivery.findUnique.mockResolvedValue({ id: ids.delivery, tenantId: ids.tenant, entityPath: "root.system.org.sub", dsp: "spotify", messageId: `BA-${ids.delivery}`, status: "SENT", sentAt: new Date(), snapshot: { payload: catalogSnapshot, requestId, createdById: ids.actor } });
    db.prisma.deliveryAcknowledgement.findFirst.mockResolvedValue(null);
    db.prisma.deliveryAcknowledgement.create.mockResolvedValue({ id: ids.snapshot, deliveryId: ids.delivery });
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn().mockResolvedValue(undefined));
    await service.recordTransportAcknowledgement(ids.delivery, { fileName: `ACK_BA-${ids.delivery}_20260822000000000.xml`, xml: acknowledgementXml() });
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ requestId, actorId: ids.actor, type: "distribution.delivery.confirmed" }) });
  });
  it("never regresses a terminal delivery when a later distinct acknowledgement arrives", async () => {
    const db = database();
    db.prisma.delivery.findUnique.mockResolvedValue({ id: ids.delivery, tenantId: ids.tenant, entityPath: "root.system.org.sub", dsp: "spotify", messageId: `BA-${ids.delivery}`, status: "CONFIRMED", sentAt: new Date(), snapshot: { payload: catalogSnapshot, requestId: randomUUID(), createdById: ids.actor } });
    db.prisma.deliveryAcknowledgement.findFirst.mockResolvedValue(null);
    db.prisma.deliveryAcknowledgement.create.mockResolvedValue({ id: ids.snapshot, deliveryId: ids.delivery });
    const service = new DistributionService(db as unknown as DistributionDatabase, config(), vi.fn().mockResolvedValue(undefined));
    await service.recordTransportAcknowledgement(ids.delivery, { fileName: `ACK_BA-${ids.delivery}_20260822000000000.xml`, xml: acknowledgementXml("ACK-002") });
    expect(db.prisma.delivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ids.delivery, status: "SENT" } }));
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "distribution.delivery.acknowledged" }) });
  });
  it("polls a due sent delivery and applies partner acknowledgements through the trusted recorder", async () => {
    const db = database();
    db.prisma.delivery.findFirst.mockResolvedValue({ id: ids.delivery, dsp: "spotify", messageId: `BA-${ids.delivery}`, remoteFolder: "N_123456789012_20260821123456789", ackPollAttempts: 0 });
    db.prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    const acknowledgement = { fileName: `ACK_BA-${ids.delivery}_20260822000000000.xml`, xml: acknowledgementXml() };
    const transport = { poll: vi.fn().mockResolvedValue([acknowledgement]) };
    const recorder = { recordTransportAcknowledgement: vi.fn().mockResolvedValue({}) };
    await expect(processNextAcknowledgementPoll(db as unknown as DistributionDatabase, transport, recorder, 60000)).resolves.toBe(true);
    expect(recorder.recordTransportAcknowledgement).toHaveBeenCalledWith(ids.delivery, acknowledgement);
    expect(db.prisma.delivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: ids.delivery, status: "SENT" }, data: expect.objectContaining({ ackPollLockedAt: null, ackPollLastError: null }) }));
  });
  it("persists ACK polling backoff without failing the transported delivery", async () => {
    const db = database();
    db.prisma.delivery.findFirst.mockResolvedValue({ id: ids.delivery, dsp: "spotify", messageId: `BA-${ids.delivery}`, remoteFolder: "N_123456789012_20260821123456789", ackPollAttempts: 1 });
    db.prisma.delivery.updateMany.mockResolvedValue({ count: 1 });
    await expect(processNextAcknowledgementPoll(db as unknown as DistributionDatabase, { poll: vi.fn().mockRejectedValue(new Error("SFTP_UNAVAILABLE")) }, { recordTransportAcknowledgement: vi.fn() }, 60000)).resolves.toBe(true);
    expect(db.prisma.delivery.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ ackPollLockedAt: null, ackPollLastError: "SFTP_UNAVAILABLE" }) }));
    expect(db.prisma.delivery.updateMany.mock.calls.at(-1)?.[0].data).not.toHaveProperty("status");
  });
  it("V14 relays saga requests with an idempotent BullMQ job id", async () => {
    const db = database(); const eventId = randomUUID(); const current = context();
    db.prisma.outboxEvent.findMany.mockResolvedValue([{ id: randomUUID(), eventId, requestId: current.requestId, payload: { deliveryId: ids.delivery, releaseId: ids.release, actor: current } }]);
    db.prisma.outboxEvent.update.mockResolvedValue({});
    const queue = { add: vi.fn().mockResolvedValue({}) };
    const relay = new DistributionSagaOutboxRelay(db as unknown as DistributionDatabase, queue as never, 1000, 10);
    await relay.flush();
    expect(queue.add).toHaveBeenCalledWith("GenerateSnapshotJob", expect.objectContaining({ deliveryId: ids.delivery, requestId: current.requestId }), expect.objectContaining({ jobId: eventId }));
    expect(db.prisma.outboxEvent.update).toHaveBeenCalledWith({ where: { id: expect.any(String) }, data: { publishedAt: expect.any(Date), lastError: null } });
  });
  it("V14 retries a failed transport without marking delivery sent", async () => {
    const db = database();
    db.prisma.deliveryJob.findFirst.mockResolvedValue({ id: ids.track, deliveryId: ids.delivery, attempts: 0, delivery: { id: ids.delivery, dsp: "spotify", snapshot: { ernXml: "<ern/>", createdById: ids.actor, requestId: randomUUID() } } });
    db.prisma.deliveryJob.updateMany.mockResolvedValue({ count: 1 });
    const transport = { send: vi.fn().mockRejectedValue(new Error("SFTP_UNAVAILABLE")) };
    expect(await processNextDeliveryJob(db as unknown as DistributionDatabase, transport, 3)).toBe(true);
    expect(db.prisma.delivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", lastError: "SFTP_UNAVAILABLE" }) }));
    expect(db.prisma.deliveryJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PENDING", lastError: "SFTP_UNAVAILABLE" }) }));
  });
  it("V14 marks only confirmed transport work sent and preserves request trace", async () => {
    const db = database(); const requestId = randomUUID();
    db.prisma.deliveryJob.findFirst.mockResolvedValue({ id: ids.track, deliveryId: ids.delivery, attempts: 0, delivery: { id: ids.delivery, dsp: "spotify", snapshot: { ernXml: "<ern/>", createdById: ids.actor, requestId } } });
    db.prisma.deliveryJob.updateMany.mockResolvedValue({ count: 1 });
    const transport = { send: vi.fn().mockResolvedValue({ remoteFolder: "N_123456789012_20260822000000000" }) };
    await processNextDeliveryJob(db as unknown as DistributionDatabase, transport, 3);
    expect(db.prisma.delivery.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "SENT" }) }));
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "distribution.delivery.sent", requestId }) });
  });
  it("V13 spools asset bytes to disk and writes ERN last without exposing grant token", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-distribution-")); const cfg = { ...config(), packageRoot: root, packageMaxBytes: 1024 };
    const token = "t".repeat(43); const ciphertext = encryptGrantToken(token, cfg.deliveryGrantEncryptionKey); expect(ciphertext).not.toContain(token); expect(decryptGrantToken(ciphertext, cfg.deliveryGrantEncryptionKey)).toBe(token);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("wave"), { status: 200, headers: { "content-length": "4", "content-disposition": "attachment; filename=master.wav" } })));
    const output = await buildDeliveryPackage({ id: ids.delivery, createdAt: new Date("2026-08-21T12:34:56.789Z"), messageType: "NewReleaseMessage", snapshot: { ernXml: "<ern/>", payload: catalogSnapshot, createdAt: new Date("2026-08-22T00:00:00.000Z") }, assetGrants: [{ assetId: ids.asset, tokenCiphertext: ciphertext, expiresAt: new Date(Date.now() + 60000), fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4n, sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" }] }, cfg);
    expect(output.folderName).toBe("N_123456789012_20260821123456789");
    expect(output.entries.at(-1)).toBe("123456789012.xml"); expect(output.entries[0]).toMatch(/^resources\/123456789012_T1_SoundRecording_001\.wav$/); expect(await readFile(path.join(output.rootPath, output.entries[0]!))).toEqual(Buffer.from("wave"));
    expect(fetch).toHaveBeenCalledWith(`${cfg.mediaServiceUrl}/media-stream/${ids.asset}`, expect.objectContaining({ headers: { authorization: `Bearer ${token}` }, redirect: "error" })); await rm(root, { recursive: true, force: true });
  });
  it("rejects DDEX media whose SHA-256 does not match the signed delivery grant", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-ddex-integrity-"));
    const cfg = { ...config(), packageRoot: root, packageMaxBytes: 1024 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("wave"), { status: 200, headers: { "content-length": "4" } })));
    await expect(buildDeliveryPackage({ id: ids.delivery, createdAt: new Date(), messageType: "NewReleaseMessage", snapshot: { ernXml: "<ern/>", payload: catalogSnapshot, createdAt: new Date() }, assetGrants: [{ assetId: ids.asset, tokenCiphertext: encryptGrantToken("t".repeat(43), cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60000), fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4n, sha256: "0".repeat(64) }] }, cfg)).rejects.toThrow("DELIVERY_MEDIA_CHECKSUM_MISMATCH");
    await rm(root, { recursive: true, force: true });
  });
  it("V13 writes XLSX exports to disk and signs short-lived direct downloads", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-export-"));
    const cfg = { ...config(), packageRoot: root, packageMaxBytes: 1024 * 1024 };
    const output = await buildCatalogExport({ id: ids.delivery, format: "XLSX", payload: { releases: [catalogSnapshot], grants: [] } }, cfg, async (cwd, outputPath, entries) => {
      expect(entries).toContain("xl/worksheets/sheet1.xml");
      expect(await readFile(path.join(cwd, "xl", "worksheets", "sheet1.xml"), "utf8")).toContain("USABC2600001");
      await writeFile(outputPath, Buffer.from("PK-export"));
    });
    expect((await readFile(output.outputPath)).subarray(0, 2).toString()).toBe("PK");
    expect(output.sizeBytes).toBeGreaterThan(0n);
    const token = createExportToken(ids.delivery, 60, cfg.exportDownloadSigningKey);
    expect(verifyExportToken(ids.delivery, token, cfg.exportDownloadSigningKey)).toBe(true);
    expect(verifyExportToken(ids.release, token, cfg.exportDownloadSigningKey)).toBe(false);
    await rm(root, { recursive: true, force: true });
  });
  it("prepares a downloadable DDEX ZIP from Media without creating transport work", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-manual-ddex-"));
    const cfg = { ...config(), packageRoot: root, packageMaxBytes: 1024 * 1024 };
    const token = "m".repeat(43);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("wave"), { status: 200, headers: { "content-length": "4" } })));
    const output = await buildCatalogExport({ id: ids.delivery, format: "ZIP", payload: { kind: "DDEX_PACKAGE", snapshot: { ...catalogSnapshot, metadata: { targetDsps: ["spotify", "apple_music"] } }, destinations: [{ recipientId: "apple_music", ernXml: "<ern recipient='apple'/>", }, { recipientId: "spotify", ernXml: "<ern recipient='spotify'/>", }], createdAt: "2026-08-22T00:00:00.000Z", grants: [{ assetId: ids.asset, token: encryptGrantToken(token, cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "master.wav", contentType: "audio/wav", sizeBytes: "4", sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" }] } }, cfg, async (cwd, outputPath, entries) => {
      expect(entries.filter(entry => entry.endsWith("123456789012.xml"))).toHaveLength(2);
      expect(entries[0]).toMatch(/^apple_music\/N_123456789012_\d+\/resources\//);
      const appleManifest = entries.find(entry => entry.startsWith("apple_music/") && entry.endsWith(".xml"))!;
      const spotifyManifest = entries.find(entry => entry.startsWith("spotify/") && entry.endsWith(".xml"))!;
      expect(await readFile(path.join(cwd, ...appleManifest.split("/")), "utf8")).toContain("recipient='apple'");
      expect(await readFile(path.join(cwd, ...spotifyManifest.split("/")), "utf8")).toContain("recipient='spotify'");
      await writeFile(outputPath, Buffer.from("PK-ddex"));
    });
    expect(output.fileName).toBe("Single_DDEX_targets.zip");
    expect(fetch).toHaveBeenCalledWith(`${cfg.mediaServiceUrl}/media-stream/${ids.asset}`, expect.objectContaining({ headers: { authorization: `Bearer ${token}` }, redirect: "error" }));
    expect(fetch).toHaveBeenCalledTimes(1);
    await rm(root, { recursive: true, force: true });
  });
  it("includes one verified cover resource in every automatic DDEX target package", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-cover-ddex-"));
    const cfg = { ...config(), packageRoot: root, packageMaxBytes: 1024 * 1024 };
    const coverAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const coverBytes = Buffer.from("cover-image");
    const coverSha256 = createHash("sha256").update(coverBytes).digest("hex");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(Buffer.from("wave"), { status: 200, headers: { "content-length": "4" } }))
      .mockResolvedValueOnce(new Response(coverBytes, { status: 200, headers: { "content-length": String(coverBytes.length) } }));
    vi.stubGlobal("fetch", fetchMock);
    const token = "m".repeat(43); const coverToken = "c".repeat(43);
    const coverSnapshot = { ...catalogSnapshot, coverUrl: `media-asset:${coverAssetId}` };
    await buildCatalogExport({ id: ids.delivery, format: "ZIP", payload: { kind: "DDEX_PACKAGE", snapshot: coverSnapshot, destinations: [{ recipientId: "spotify", ernXml: "<ern/>" }], createdAt: "2026-08-22T00:00:00.000Z", grants: [
      { assetId: ids.asset, token: encryptGrantToken(token, cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "master.wav", contentType: "audio/wav", sizeBytes: "4", sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" },
      { assetId: coverAssetId, token: encryptGrantToken(coverToken, cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "cover.jpg", contentType: "image/jpeg", sizeBytes: String(coverBytes.length), sha256: coverSha256 }
    ] } }, cfg, async (cwd, outputPath, entries) => {
      const coverEntry = entries.find(entry => entry.endsWith("resources/123456789012_FrontCoverImage_001.jpg"));
      expect(coverEntry).toBeTruthy();
      expect(await readFile(path.join(cwd, ...coverEntry!.split("/")))).toEqual(coverBytes);
      await writeFile(outputPath, Buffer.from("PK-cover"));
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(2, `${cfg.mediaServiceUrl}/media-stream/${coverAssetId}`, expect.objectContaining({ headers: { authorization: `Bearer ${coverToken}` } }));
    await rm(root, { recursive: true, force: true });
  });
  it("requests each approved-audio grant once, including the opaque cover asset", () => {
    const coverAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    expect(approvedAudioAssetIds({ ...catalogSnapshot, coverUrl: `media-asset:${coverAssetId}` })).toEqual([ids.asset, coverAssetId]);
  });
  it("counts cover artwork against the automatic DDEX package entry limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-cover-limit-"));
    const coverAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await expect(buildCatalogExport({ id: ids.delivery, format: "ZIP", payload: { kind: "DDEX_PACKAGE", snapshot: { ...catalogSnapshot, coverUrl: `media-asset:${coverAssetId}` }, destinations: [{ recipientId: "spotify", ernXml: "<ern/>" }], grants: [], createdAt: "2026-08-22T00:00:00.000Z" } }, { ...config(), packageRoot: root, packageMaxEntries: 2 })).rejects.toThrow("DELIVERY_PACKAGE_TOO_MANY_ENTRIES");
    await rm(root, { recursive: true, force: true });
  });
  it("persists automatic DDEX work only as an export artifact, never as SFTP delivery work", async () => {
    const db = database();
    db.prisma.exportJob.findUnique.mockResolvedValue({ id: ids.delivery, status: "RUNNING", payload: { kind: "DDEX_PACKAGE", phase: "PREPARING" } });
    db.prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    db.prisma.exportJob.findUniqueOrThrow.mockResolvedValue({ id: ids.delivery, status: "PENDING" });
    const cfg = { ...config(), autoPrepareDdexPackages: true, dspRecipients: { ...config().dspRecipients, apple_music: { partyId: "PADPIDA1234567890B", name: "Apple Music" } } };
    const validator = vi.fn().mockResolvedValue(undefined);
    const coverAssetId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    await finalizeApprovedAudioPackage(db as never, cfg as never, ids.delivery, { ...catalogSnapshot, coverUrl: `media-asset:${coverAssetId}`, metadata: { targetDsps: ["spotify", "apple_music", "spotify"] } }, [
      { assetId: ids.asset, token: "g".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "master.wav", contentType: "audio/wav", sizeBytes: "4", sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" },
      { assetId: coverAssetId, token: "c".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "cover.jpg", contentType: "image/jpeg", sizeBytes: "11", sha256: "a".repeat(64) }
    ], "2026-08-22T00:00:00.000Z", randomUUID(), context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", entityPath: "root", roles: ["SUPER_ADMIN"] }), validator);
    expect(validator).toHaveBeenCalledTimes(2);
    expect(db.prisma.exportJob.updateMany).toHaveBeenCalledWith({ where: { id: ids.delivery, status: "RUNNING" }, data: expect.objectContaining({ status: "PENDING", payload: expect.objectContaining({ kind: "DDEX_PACKAGE", destinations: [expect.objectContaining({ recipientId: "apple_music", ernXml: expect.stringContaining("123456789012_FrontCoverImage_001.jpg") }), expect.objectContaining({ recipientId: "spotify", ernXml: expect.stringContaining("123456789012_FrontCoverImage_001.jpg") })] }) }) });
    expect(db.prisma.exportJob.create).not.toHaveBeenCalled();
    expect(db.prisma.delivery.create).not.toHaveBeenCalled();
    expect(db.prisma.deliveryJob.create).not.toHaveBeenCalled();
  });
  it("fails the automatic package when a release-selected recipient has no approved profile", async () => {
    const db = database(); db.prisma.exportJob.findUnique.mockResolvedValue({ id: ids.delivery, status: "RUNNING", payload: { kind: "DDEX_PACKAGE", phase: "PREPARING" } }); db.prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    const cfg = { ...config(), autoPrepareDdexPackages: true };
    await expect(finalizeApprovedAudioPackage(db as never, cfg as never, ids.delivery, { ...catalogSnapshot, coverUrl: "media-asset:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", metadata: { targetDsps: ["spotify", "unconfigured_dsp"] } }, [], "2026-08-22T00:00:00.000Z", randomUUID(), context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", entityPath: "root", roles: ["SUPER_ADMIN"] }), vi.fn())).rejects.toThrow("recipient is not configured: unconfigured_dsp");
    expect(db.prisma.exportJob.create).not.toHaveBeenCalled();
    expect(db.prisma.exportJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ids.delivery, status: "RUNNING" }, data: expect.objectContaining({ status: "FAILED", lastError: expect.stringMatching(/^DDEX_PREPARATION_FAILED:/) }) }));
  });

  it("lets a fresh grant result recover a preparation previously marked failed", async () => {
    const db = database();
    const coverId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    db.prisma.exportJob.findUnique
      .mockResolvedValueOnce({ id: ids.delivery, status: "FAILED" })
      .mockResolvedValueOnce({ id: ids.delivery, status: "RUNNING", payload: { kind: "DDEX_PACKAGE", phase: "PREPARING" } });
    db.prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    db.prisma.exportJob.findUniqueOrThrow.mockResolvedValue({ id: ids.delivery, status: "PENDING" });
    const cfg = { ...config(), autoPrepareDdexPackages: true };
    await finalizeApprovedAudioPackage(db as never, cfg as never, ids.delivery, { ...catalogSnapshot, coverUrl: `media-asset:${coverId}` }, [
      { assetId: ids.asset, token: "n".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "fresh.wav", contentType: "audio/wav", sizeBytes: "4", sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" },
      { assetId: coverId, token: "c".repeat(43), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "fresh.jpg", contentType: "image/jpeg", sizeBytes: "11", sha256: "a".repeat(64) }
    ], "2026-08-22T00:00:00.000Z", randomUUID(), context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", entityPath: "root", roles: ["SUPER_ADMIN"] }), vi.fn().mockResolvedValue(undefined));
    expect(db.prisma.exportJob.updateMany).toHaveBeenNthCalledWith(1, { where: { id: ids.delivery, status: "FAILED" }, data: { status: "RUNNING", lockedAt: null, lastError: null, attempts: 0 } });
    expect(db.prisma.exportJob.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: ids.delivery, status: "RUNNING" }, data: expect.objectContaining({ status: "PENDING", payload: expect.objectContaining({ grants: expect.arrayContaining([expect.objectContaining({ fileName: "fresh.wav" })]) }) }) }));
  });

  it("retries an expired automatic package through snapshot and fresh media grants without duplicating its record", async () => {
    const db = database();
    const occurredAt = "2026-08-22T00:00:00.000Z";
    const failed = { id: ids.delivery, tenantId: ids.tenant, entityPath: "root.system.org", actorId: ids.actor, requestId: randomUUID(), format: "ZIP", status: "FAILED", fileName: null, contentType: null, sizeBytes: null, sha256: null, lastError: "DDEX_PREPARATION_FAILED: EXPORT_MEDIA_GRANT_EXPIRED", expiresAt: new Date("2026-08-23T00:00:00.000Z"), createdAt: new Date(), updatedAt: new Date(), payload: { kind: "DDEX_PACKAGE", approvalEventId: ids.delivery, approvalOccurredAt: occurredAt, approverEntityId: ids.entity, snapshot: { ...catalogSnapshot, id: ids.release }, destinations: [{ recipientId: "spotify", ernXml: "<ern/>" }], grants: [{ assetId: ids.asset, token: "expired-ciphertext", expiresAt: "2026-08-21T00:00:00.000Z" }], createdAt: occurredAt } };
    db.prisma.exportJob.findUnique.mockResolvedValue(failed);
    db.prisma.exportJob.upsert.mockResolvedValue(failed);
    db.prisma.exportJob.updateMany.mockResolvedValue({ count: 1 });
    db.prisma.exportJob.findUniqueOrThrow.mockResolvedValue({ ...failed, status: "RUNNING", lastError: null });
    db.prisma.exportJob.findFirst.mockResolvedValue({ ...failed, status: "RUNNING", lastError: null });
    const publish = vi.fn().mockResolvedValue(undefined);
    const service = new ExportService(db as unknown as DistributionDatabase, config(), publish);
    await service.retryApprovedAudioPackage(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }), ids.delivery);
    expect(db.prisma.exportJob.upsert).toHaveBeenCalledTimes(1);
    expect(db.prisma.exportJob.create).not.toHaveBeenCalled();
    expect(publish).toHaveBeenCalledWith(ids.delivery, expect.objectContaining({ packageId: ids.delivery, releaseId: ids.release }));
    expect(publish.mock.calls[0]?.[1]).not.toHaveProperty("grants");
  });
});
