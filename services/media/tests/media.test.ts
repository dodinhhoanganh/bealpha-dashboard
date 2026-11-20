import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INTERNAL_CONTEXT_HEADER, REQUEST_ID_HEADER, type InternalAuthContext } from "@bealpha/contracts";
import { buildMediaApp } from "../src/app.js";
import type { MediaConfig } from "../src/config.js";
import type { MediaDatabase } from "../src/database.js";
import { MediaService } from "../src/media-service.js";
import { validateCatalogImportSource, validateZipArchive } from "../src/archive-validator.js";
import { processNextMediaJob } from "../src/worker.js";
import { VEVO_VIDEO_PROFILE_VERSION } from "../src/vevo-video-profile.js";

const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  entity: "22222222-2222-4222-8222-222222222222",
  tenant: "33333333-3333-4333-8333-333333333333",
  upload: "44444444-4444-4444-8444-444444444444",
  asset: "55555555-5555-4555-8555-555555555555"
};

function context(overrides: Partial<InternalAuthContext> = {}): InternalAuthContext {
  return { v: 1, requestId: randomUUID(), authType: "user", actorId: ids.actor, entityId: ids.entity, entityType: "SUB_ACCOUNT", entityRole: "OWNER", tenantId: ids.tenant, entityPath: "root.system.org.sub", roles: ["SUB_ACCOUNT"], staffRoles: [], authzVersion: 1, ...overrides };
}

function config(storageRoot: string): MediaConfig {
  return { nodeEnv: "test", host: "127.0.0.1", port: 4103, logLevel: "silent", trustProxyHops: 0, controlBodyLimitBytes: 32768, databaseUrl: "postgresql://test:test@localhost:5432/test", dbPoolMax: 1, redisUrl: "redis://localhost:6379", gatewayContextPublicKeyPem: "", gatewayContextIssuer: "bealpha-gateway", gatewayContextAudience: "bealpha-services", publicBaseUrl: "https://media.example.com", storageRoot, uploadTtlSeconds: 900, uploadMaxBytes: 50 * 1024 * 1024 * 1024, uploadConcurrency: 2, streamGrantTtlSeconds: 60, previewGrantMaxUses: 8, deliveryGrantTtlSeconds: 3600, deliveryGrantMaxUses: 5, streamConcurrency: 4, workerPollMs: 1000, workerMaxAttempts: 3, archiveRetentionSeconds: 86400 };
}

function fakeDatabase() {
  const prisma = {
    uploadIntent: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    asset: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
    streamGrant: { create: vi.fn(), createMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    processingJob: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    archiveEntry: { create: vi.fn(), findMany: vi.fn().mockResolvedValue([]) },
    outboxEvent: { create: vi.fn() },
    $transaction: vi.fn()
  };
  prisma.$transaction.mockImplementation(async callback => callback(prisma));
  return { prisma };
}

function storedZip(name: string, data: Buffer, declaredExpanded = data.length): Buffer {
  const fileName = Buffer.from(name);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(declaredExpanded, 22);
  local.writeUInt16LE(fileName.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(declaredExpanded, 24);
  central.writeUInt16LE(fileName.length, 28);
  const centralOffset = local.length + fileName.length + data.length;
  const centralSize = central.length + fileName.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, fileName, data, central, fileName, eocd]);
}

describe("media service invariants", () => {
  const roots: string[] = [];
  afterEach(async () => Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))));

  it("V11 uses owner-only scope for sub-accounts and delimited paths for organizations", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findMany.mockResolvedValue([]);
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    await service.listAssets(context());
    await service.listAssets(context({ entityType: "ORGANIZATION", entityPath: "root.system.org1", tenantId: undefined, roles: ["ORGANIZATION"] }));
    expect(database.prisma.asset.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { ownerEntityId: ids.entity, status: { not: "ARCHIVED" } } }));
    expect(database.prisma.asset.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { OR: [{ ownerEntityPath: "root.system.org1" }, { ownerEntityPath: { startsWith: "root.system.org1." } }], status: { not: "ARCHIVED" } } }));
  });

  it("bounds public image uploads to 25 MiB and approved MIME types", async () => {
    const service = new MediaService(fakeDatabase() as unknown as MediaDatabase, config("."));
    await expect(service.createUploadIntent(context(), { assetType: "IMAGE", fileName: "cover.jpg", contentType: "image/jpeg", sizeBytes: 25 * 1024 * 1024 + 1 })).rejects.toMatchObject({ code: "PAYLOAD_TOO_LARGE" });
    await expect(service.createUploadIntent(context(), { assetType: "IMAGE", fileName: "cover.svg", contentType: "image/svg+xml", sizeBytes: 100 })).rejects.toMatchObject({ code: "CONTENT_TYPE_MISMATCH" });
  });

  it("accepts MP4 and MOV video intents but rejects MKV", async () => {
    const service = new MediaService(fakeDatabase() as unknown as MediaDatabase, config("."));
    await expect(service.createUploadIntent(context(), { assetType: "VIDEO", fileName: "master.mp4", contentType: "video/mp4", sizeBytes: 100 })).resolves.toMatchObject({ method: "PUT" });
    await expect(service.createUploadIntent(context(), { assetType: "VIDEO", fileName: "master.mov", contentType: "video/quicktime", sizeBytes: 100 })).resolves.toMatchObject({ method: "PUT" });
    await expect(service.createUploadIntent(context(), { assetType: "VIDEO", fileName: "master.mkv", contentType: "video/x-matroska", sizeBytes: 100 })).rejects.toMatchObject({ code: "CONTENT_TYPE_MISMATCH", statusCode: 415 });
  });

  it("serves only explicitly published ready image assets from bounded storage paths", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-public-image-")); roots.push(root);
    const storageKey = `${ids.tenant}/${ids.asset}/original`; await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true }); await writeFile(path.join(root, storageKey), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const database = fakeDatabase(); database.prisma.asset.findUnique.mockResolvedValue({ id: ids.asset, type: "IMAGE", status: "READY", publishedAt: new Date(), storageKey, mimeType: "image/jpeg" });
    const opened = await new MediaService(database as unknown as MediaDatabase, config(root)).openPublicImage(ids.asset);
    const chunks: Buffer[] = []; for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks)).toEqual(Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  it("keeps ready images private until an authorized publication decision", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      type: "IMAGE",
      status: "READY",
      publishedAt: null,
      storageKey: `${ids.tenant}/${ids.asset}/original`,
      mimeType: "image/jpeg",
    });
    const service = new MediaService(database as unknown as MediaDatabase, config("."));

    await expect(service.openPublicImage(ids.asset)).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("publishes an image only for an owner or admin in the same tenant subtree", async () => {
    const asset = {
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      type: "IMAGE",
      status: "READY",
      publishedAt: null,
    };
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue(asset);
    database.prisma.asset.update.mockResolvedValue({ ...asset, publishedAt: new Date() });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    const organizationOwner = context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityPath: "root.system.org",
      roles: ["ORGANIZATION"],
    });

    await expect(service.publishImage(organizationOwner, ids.asset, organizationOwner.requestId)).resolves.toEqual({
      assetId: ids.asset,
      url: `https://media.example.com/media-public/${ids.asset}`,
    });
    expect(database.prisma.asset.update).toHaveBeenCalledWith({
      where: { id: ids.asset },
      data: { publishedAt: expect.any(Date), publishedById: ids.actor },
    });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "media.image.published", tenantId: ids.tenant, entityPath: asset.ownerEntityPath }) });
  });

  it("rejects publication by sub-accounts, accountants, and another tenant", async () => {
    const asset = {
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      type: "IMAGE",
      status: "READY",
      publishedAt: null,
    };
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue(asset);
    const service = new MediaService(database as unknown as MediaDatabase, config("."));

    await expect(service.publishImage(context(), ids.asset, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    await expect(service.publishImage(context({ entityType: "ORGANIZATION", entityRole: "ACCOUNTANT", entityPath: "root.system.org", roles: ["ORGANIZATION"] }), ids.asset, randomUUID())).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    await expect(service.publishImage(context({ tenantId: randomUUID(), entityType: "ORGANIZATION", entityRole: "OWNER", entityPath: "root.system.org", roles: ["ORGANIZATION"] }), ids.asset, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.asset.update).not.toHaveBeenCalled();
  });

  it("V11 archives only scoped assets and removes stored bytes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-media-archive-"));
    roots.push(root);
    const storageKey = `${ids.tenant}/${ids.asset}/original`;
    const filePath = path.join(root, storageKey);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "audio");
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      storageKey,
      releaseId: null,
      trackId: null
    });
    database.prisma.asset.update.mockResolvedValue({});
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new MediaService(database as unknown as MediaDatabase, config(root));

    await service.archiveAsset(context(), ids.asset, randomUUID());

    await expect(readFile(filePath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(database.prisma.asset.update).toHaveBeenCalledWith({
      where: { id: ids.asset },
      data: { status: "ARCHIVED" }
    });
  });

  it("I7 creates control-plane intent without storing the raw token", async () => {
    const database = fakeDatabase();
    database.prisma.uploadIntent.create.mockResolvedValue({});
    database.prisma.outboxEvent.create.mockResolvedValue({});
    database.prisma.processingJob.create.mockResolvedValue({});
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    const result = await service.createUploadIntent(context(), { assetType: "AUDIO", fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4, sha256: "a".repeat(64) });
    const stored = database.prisma.uploadIntent.create.mock.calls[0][0].data;
    expect(result.url).toContain(`/media-upload/${result.uploadId}?token=`);
    expect(stored.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.url).not.toContain(stored.tokenHash);
    expect(stored.tenantId).toBe(ids.tenant);
  });

  it("V7 streams bytes to disk and verifies size plus SHA-256", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-media-"));
    roots.push(root);
    const bytes = Buffer.from("wave");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const database = fakeDatabase();
    database.prisma.uploadIntent.findFirst.mockResolvedValue({ id: ids.upload, tenantId: ids.tenant, ownerEntityId: ids.entity, ownerEntityPath: "root.system.org.sub", actorId: ids.actor, assetType: "AUDIO", fileName: "master.wav", contentType: "audio/wav", sizeBytes: BigInt(bytes.length), sha256: null, storageKey: `${ids.tenant}/${ids.upload}/original`, releaseId: null, trackId: null });
    database.prisma.uploadIntent.updateMany.mockResolvedValue({ count: 1 });
    database.prisma.uploadIntent.update.mockResolvedValue({});
    database.prisma.asset.create.mockResolvedValue({ id: ids.asset, fileSize: BigInt(bytes.length), frameRate: null });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new MediaService(database as unknown as MediaDatabase, config(root));
    const token = "x".repeat(43);
    await service.receiveUpload(ids.upload, token, bytes.length, "audio/wav", Readable.from(bytes), randomUUID());
    expect(await readFile(path.join(root, ids.tenant, ids.upload, "original"))).toEqual(bytes);
    expect(database.prisma.uploadIntent.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: ids.upload, status: "PENDING" } }));
    expect(database.prisma.asset.create).toHaveBeenCalledOnce();
    expect(database.prisma.asset.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ sha256 })
    });
  });

  it("V12 grants only a generated derivative for lossless audio", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-preview-grant-"));
    roots.push(root);
    const storageKey = `${ids.tenant}/${ids.asset}/original`;
    await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
    await writeFile(path.join(root, ids.tenant, ids.asset, "preview.mp3"), "preview");
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({ id: ids.asset, tenantId: ids.tenant, ownerEntityId: ids.entity, ownerEntityPath: "root.system.org.sub", status: "READY", type: "AUDIO", mimeType: "audio/wav", fileName: "master.wav", fileSize: 4n, storageKey });
    const service = new MediaService(database as unknown as MediaDatabase, config(root));
    await expect(service.createStreamGrant(context(), ids.asset)).resolves.toMatchObject({ singleUse: false, maxUses: 8 });
    expect(database.prisma.streamGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ maxUses: 8 }) });
  });

  it("V12 rejects audio preview grants until derivative processing completes", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({ id: ids.asset, tenantId: ids.tenant, ownerEntityId: ids.entity, ownerEntityPath: "root.system.org.sub", status: "READY", type: "AUDIO", mimeType: "audio/wav", fileName: "master.wav", fileSize: 4n, storageKey: `${ids.tenant}/${ids.asset}/original` });
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    await expect(service.createStreamGrant(context(), ids.asset)).rejects.toMatchObject({ code: "PREVIEW_NOT_READY", statusCode: 409 });
    expect(database.prisma.streamGrant.create).not.toHaveBeenCalled();
  });

  it("V12 permits a bounded-use lossless master grant only through signed delivery control", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({ id: ids.asset, tenantId: ids.tenant, ownerEntityId: ids.entity, ownerEntityPath: "root.system.org.sub", status: "READY", type: "AUDIO", mimeType: "audio/wav", fileName: "master.wav", fileSize: 4n });
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    const grant = await service.createDeliveryGrant(context({ entityType: "ORGANIZATION", entityPath: "root.system.org", roles: ["ORGANIZATION"] }), ids.asset);
    expect(grant.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(grant).toMatchObject({ singleUse: false, maxUses: 5, fileName: "master.wav", contentType: "audio/wav", sizeBytes: "4" });
    expect(database.prisma.streamGrant.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assetId: ids.asset, tenantId: ids.tenant, actorId: ids.actor, purpose: "DELIVERY", maxUses: 5, tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) });
  });

  it("fails closed for a video delivery grant without current VEVO QC evidence", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      status: "READY",
      type: "VIDEO",
      mimeType: "video/mp4",
      fileName: "master.mp4",
      fileSize: 4n,
      qcProfileVersion: "stale-profile",
      qcResult: { compliant: true },
    });
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    await expect(service.createDeliveryGrant(context({ entityType: "ORGANIZATION", entityPath: "root.system.org", roles: ["ORGANIZATION"] }), ids.asset)).rejects.toMatchObject({
      code: "VEVO_QC_REQUIRED",
      statusCode: 409,
    });
    expect(database.prisma.streamGrant.create).not.toHaveBeenCalled();
  });

  it("grants a technically compliant video only with versioned QC evidence", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      status: "READY",
      type: "VIDEO",
      mimeType: "video/mp4",
      fileName: "master.mp4",
      fileSize: 4n,
      qcProfileVersion: VEVO_VIDEO_PROFILE_VERSION,
      qcResult: { compliant: true },
    });
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    await expect(service.createDeliveryGrant(context({ entityType: "ORGANIZATION", entityPath: "root.system.org", roles: ["ORGANIZATION"] }), ids.asset)).resolves.toMatchObject({
      fileName: "master.mp4",
      contentType: "video/mp4",
    });
  });

  it("V11 bulk delivery grants reject assets outside the signed entity subtree", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findMany.mockResolvedValue([]);
    const service = new MediaService(database as unknown as MediaDatabase, config("."));

    await expect(service.createDeliveryGrants(context({ entityType: "ORGANIZATION", entityPath: "root.system.org", roles: ["ORGANIZATION"] }), [ids.asset])).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.asset.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: { in: [ids.asset] }, status: "READY" }) }));
    expect(database.prisma.streamGrant.createMany).not.toHaveBeenCalled();
  });

  it.each([
    { entityType: "SUB_ACCOUNT", entityRole: "OWNER", entityPath: "root.system.org.sub", roles: ["SUB_ACCOUNT"] },
    { entityType: "ORGANIZATION", entityRole: "REVIEWER", entityPath: "root.system.org", roles: ["ORGANIZATION"] },
    { entityType: "ORGANIZATION", entityRole: "ACCOUNTANT", entityPath: "root.system.org", roles: ["ORGANIZATION"] },
    { entityType: "ORGANIZATION", entityRole: "MEMBER", entityPath: "root.system.org", roles: ["ORGANIZATION"] },
  ] satisfies Array<Partial<InternalAuthContext>>)("prevents $entityType/$entityRole from minting original-media delivery grants", async denied => {
    const database = fakeDatabase();
    const service = new MediaService(database as unknown as MediaDatabase, config("."));
    const deniedActor = context(denied);

    await expect(service.createDeliveryGrant(deniedActor, ids.asset)).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    await expect(service.createDeliveryGrants(deniedActor, [ids.asset])).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
    expect(database.prisma.asset.findUnique).not.toHaveBeenCalled();
    expect(database.prisma.asset.findMany).not.toHaveBeenCalled();
  });

  it("V12 claims a stream grant once and streams from bounded storage path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-stream-"));
    roots.push(root);
    const storageKey = `${ids.tenant}/${ids.asset}/preview.mp3`;
    const directory = path.join(root, ids.tenant, ids.asset);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(root, storageKey), Buffer.from("preview"));
    const database = fakeDatabase();
    database.prisma.streamGrant.findFirst.mockResolvedValue({ id: ids.upload, assetId: ids.asset, purpose: "PREVIEW", useCount: 0, maxUses: 1, asset: { type: "AUDIO", storageKey: `${ids.tenant}/${ids.asset}/original`, mimeType: "audio/wav", fileName: "master.wav" } });
    database.prisma.streamGrant.updateMany.mockResolvedValue({ count: 1 });
    const service = new MediaService(database as unknown as MediaDatabase, config(root));
    const opened = await service.openStream(ids.asset, "x".repeat(43));
    const chunks: Buffer[] = [];
    for await (const chunk of opened.stream) chunks.push(Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString()).toBe("preview");
    expect(opened).toMatchObject({ contentType: "audio/mpeg", fileName: "master.preview.mp3" });
    expect(database.prisma.streamGrant.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: ids.upload, consumedAt: null }) }));
  });

  it("V15 caps concurrent media streams", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-stream-load-"));
    roots.push(root);
    const storageKey = `${ids.tenant}/${ids.asset}/cover.jpg`;
    await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
    await writeFile(path.join(root, storageKey), Buffer.from("image"));
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({ id: ids.asset, type: "IMAGE", status: "READY", publishedAt: new Date(), storageKey, mimeType: "image/jpeg" });
    const service = new MediaService(database as unknown as MediaDatabase, config(root));
    const opened = await Promise.all(Array.from({ length: 4 }, () => service.openPublicImage(ids.asset)));
    await expect(service.openPublicImage(ids.asset)).rejects.toMatchObject({ code: "STREAM_BUSY", statusCode: 429 });
    const closed = opened.map(item => once(item.stream, "close"));
    opened.forEach(item => item.stream.destroy());
    await Promise.all(closed);
  });

  it("V15 caps concurrent uploads before accepting more bodies", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-upload-load-"));
    roots.push(root);
    const database = fakeDatabase();
    database.prisma.uploadIntent.findFirst.mockImplementation(({ where }: { where: { id: string } }) => Promise.resolve({ id: where.id, tenantId: ids.tenant, ownerEntityId: ids.entity, ownerEntityPath: "root.system.org.sub", actorId: ids.actor, assetType: "AUDIO", fileName: "master.wav", contentType: "audio/wav", sizeBytes: 1n, sha256: null, storageKey: `${ids.tenant}/${where.id}/original`, releaseId: null, trackId: null }));
    database.prisma.uploadIntent.updateMany.mockResolvedValue({ count: 1 });
    const service = new MediaService(database as unknown as MediaDatabase, config(root));
    const firstBody = new PassThrough();
    const secondBody = new PassThrough();
    const first = service.receiveUpload(randomUUID(), "x".repeat(43), 1, "audio/wav", firstBody, randomUUID());
    const second = service.receiveUpload(randomUUID(), "x".repeat(43), 1, "audio/wav", secondBody, randomUUID());
    await vi.waitFor(() => expect(database.prisma.uploadIntent.updateMany).toHaveBeenCalledTimes(2));
    await expect(service.receiveUpload(randomUUID(), "x".repeat(43), 1, "audio/wav", Readable.from("x"), randomUUID())).rejects.toMatchObject({ code: "UPLOAD_BUSY", statusCode: 429 });
    firstBody.destroy(new Error("test cleanup"));
    secondBody.destroy(new Error("test cleanup"));
    await Promise.allSettled([first, second]);
  });

  it("V13 accepts bounded ZIP entries without extracting", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-zip-"));
    roots.push(root);
    const archive = path.join(root, "catalog.zip");
    await writeFile(archive, storedZip("disc1/track01.wav", Buffer.from("wave")));
    await expect(validateZipArchive(archive)).resolves.toMatchObject({ entries: 1, compressedBytes: 4n, expandedBytes: 4n });
  });

  it("V13 rejects ZIP traversal and ratio bombs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-zip-bad-"));
    roots.push(root);
    const traversal = path.join(root, "traversal.zip");
    const bomb = path.join(root, "bomb.zip");
    await writeFile(traversal, storedZip("../evil.wav", Buffer.from("x")));
    await writeFile(bomb, storedZip("track.wav", Buffer.from("x"), 1000));
    await expect(validateZipArchive(traversal)).rejects.toThrow("ZIP_UNSAFE_PATH");
    await expect(validateZipArchive(bomb)).rejects.toThrow("ZIP_RATIO_INVALID");
  });

  it("accepts bounded DDEX XML and rejects doctypes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-xml-"));
    roots.push(root);
    const valid = path.join(root, "ern.xml");
    const unsafe = path.join(root, "unsafe.xml");
    await writeFile(valid, `<?xml version="1.0"?><NewReleaseMessage/>`);
    await writeFile(unsafe, `<?xml version="1.0"?><!DOCTYPE x><x/>`);
    await expect(validateCatalogImportSource(valid, "ern.xml", "application/xml")).resolves.toMatchObject({ kind: "XML" });
    await expect(validateCatalogImportSource(unsafe, "unsafe.xml", "application/xml")).rejects.toThrow("DDEX_XML_DOCTYPE_FORBIDDEN");
  });

  it("V8 worker claims and completes one archive job atomically", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-worker-"));
    roots.push(root);
    const storageKey = `${ids.tenant}/${ids.asset}/catalog.zip`;
    await mkdir(path.dirname(path.join(root, storageKey)), { recursive: true });
    await writeFile(path.join(root, storageKey), storedZip("track.wav", Buffer.from("wave")));
    const database = fakeDatabase();
    database.prisma.processingJob.findFirst.mockResolvedValue({ id: ids.upload, assetId: ids.asset, requestId: randomUUID(), type: "VALIDATE_ARCHIVE", attempts: 0, asset: { id: ids.asset, storageKey, fileName: "catalog.zip", mimeType: "application/zip", type: "ARCHIVE", uploaderId: ids.actor, tenantId: ids.tenant, ownerEntityPath: "root.system.org.sub" } });
    database.prisma.processingJob.updateMany.mockResolvedValue({ count: 1 });
    database.prisma.processingJob.update.mockResolvedValue({});
    database.prisma.asset.update.mockResolvedValue({});
    database.prisma.outboxEvent.create.mockResolvedValue({});
    expect(await processNextMediaJob(database as unknown as MediaDatabase, root, 3)).toBe(true);
    expect(database.prisma.asset.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "READY" }) }));
    expect(database.prisma.processingJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "COMPLETE" }) }));
    expect(database.prisma.archiveEntry.create).toHaveBeenCalledWith({ data: expect.objectContaining({ archiveAssetId: ids.asset, entryName: "track.wav" }) });
    expect(database.prisma.asset.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "AUDIO", fileName: "track.wav", status: "PROCESSING" }) });
  });
});

describe("media HTTP boundary", () => {
  let privateKey: CryptoKey;
  let testConfig: MediaConfig;
  beforeAll(async () => {
    const keys = await generateKeyPair("ES256", { extractable: true });
    privateKey = keys.privateKey;
    testConfig = { ...config("."), gatewayContextPublicKeyPem: await exportSPKI(keys.publicKey) };
  });
  async function headers(requestId: string, overrides: Partial<InternalAuthContext> = {}) {
    const token = await new SignJWT({ ...context(overrides), requestId }).setProtectedHeader({ alg: "ES256" }).setIssuer(testConfig.gatewayContextIssuer).setAudience(testConfig.gatewayContextAudience).setIssuedAt().setExpirationTime("30s").sign(privateKey);
    return { [REQUEST_ID_HEADER]: requestId, [INTERNAL_CONTEXT_HEADER]: token };
  }
  it("V4 requires signed context and V5 rejects tenant injection", async () => {
    const service = { createUploadIntent: vi.fn() } as unknown as MediaService;
    const app = await buildMediaApp({ config: testConfig, service, logger: false });
    const missing = await app.inject({ method: "POST", url: "/api/v1/media/upload-intents", payload: {} });
    expect(missing.statusCode, missing.body).toBe(401);
    const requestId = randomUUID();
    const response = await app.inject({ method: "POST", url: "/api/v1/media/upload-intents", headers: await headers(requestId), payload: { assetType: "AUDIO", fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4, sha256: "a".repeat(64), tenantId: ids.tenant } });
    expect(response.statusCode, response.body).toBe(400);
    expect(service.createUploadIntent).not.toHaveBeenCalled();
    await app.close();
  });

  it("keeps delivery stream tokens out of request URLs", async () => {
    const token = "a".repeat(43);
    const service = {
      openStream: vi.fn().mockResolvedValue({
        stream: Readable.from(Buffer.from("data")),
        sizeBytes: 4,
        contentType: "video/mp4",
        fileName: "master.mp4",
      }),
    } as unknown as MediaService;
    const app = await buildMediaApp({ config: testConfig, service, logger: false });

    const requestUrl = `/media-stream/${ids.asset}`;
    const response = await app.inject({
      method: "GET",
      url: requestUrl,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(service.openStream).toHaveBeenCalledWith(ids.asset, token);
    expect(requestUrl).not.toContain(token);
    await app.close();
  });

  it("publishes images only through the authenticated control plane", async () => {
    const database = fakeDatabase();
    database.prisma.asset.findUnique.mockResolvedValue({
      id: ids.asset,
      tenantId: ids.tenant,
      ownerEntityId: ids.entity,
      ownerEntityPath: "root.system.org.sub",
      type: "IMAGE",
      status: "READY",
      publishedAt: null,
      releaseId: null,
      trackId: null,
    });
    database.prisma.asset.update.mockResolvedValue({});
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const app = await buildMediaApp({ config: testConfig, service: new MediaService(database as unknown as MediaDatabase, testConfig), logger: false });

    const missing = await app.inject({ method: "POST", url: `/api/v1/media/assets/${ids.asset}/publication` });
    expect(missing.statusCode, missing.body).toBe(401);
    const requestId = randomUUID();
    const published = await app.inject({
      method: "POST",
      url: `/api/v1/media/assets/${ids.asset}/publication`,
      headers: await headers(requestId, { entityType: "ORGANIZATION", entityRole: "OWNER", entityPath: "root.system.org", roles: ["ORGANIZATION"] }),
    });
    expect(published.statusCode, published.body).toBe(200);
    expect(published.json().data).toEqual({ assetId: ids.asset, url: `https://media.example.com/media-public/${ids.asset}` });
    await app.close();
  });
});
