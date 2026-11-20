import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import type { InternalAuthContext } from "@bealpha/contracts";
import type { DistributionConfig } from "../src/config.js";
import type { DistributionDatabase } from "../src/database.js";
import { finalizeApprovedVideoPackage, VevoService } from "../src/vevo-service.js";
import { encryptGrantToken } from "../src/grant-crypto.js";
import { openDeliveryMediaBody, processNextVevoSubmission } from "../src/vevo-worker.js";
import { buildVevoManualPackage } from "../src/vevo-package-builder.js";
import { createExportToken } from "../src/export-token.js";

const ids = { actor: "11111111-1111-4111-8111-111111111111", entity: "22222222-2222-4222-8222-222222222222", tenant: "33333333-3333-4333-8333-333333333333", release: "44444444-4444-4444-8444-444444444444", video: "55555555-5555-4555-8555-555555555555", submission: "66666666-6666-4666-8666-666666666666" };
function context(overrides: Partial<InternalAuthContext> = {}): InternalAuthContext { return { v: 1, requestId: randomUUID(), authType: "user", actorId: ids.actor, entityId: ids.entity, entityType: "SUPER_ADMIN", entityRole: "OWNER", entityPath: "root", roles: ["SUPER_ADMIN"], staffRoles: [], authzVersion: 1, ...overrides }; }
function config(): DistributionConfig { return { nodeEnv: "test", host: "127.0.0.1", port: 4104, logLevel: "silent", trustProxyHops: 0, bodyLimitBytes: 65536, databaseUrl: "postgresql://test:test@localhost/test", dbPoolMax: 1, catalogServiceUrl: "http://catalog", mediaServiceUrl: "http://media", deliveryGrantEncryptionKey: Buffer.alloc(32, 7), redisUrl: "redis://localhost", gatewayContextPublicKeyPem: "", gatewayContextIssuer: "issuer", gatewayContextAudience: "audience", ddexSender: { partyId: "PADPIDA0000000001A", name: "BeAlpha" }, ddexAvsVersionId: "9", dspRecipients: {}, workerPollMs: 1000, workerMaxAttempts: 3, acknowledgementPollMs: 60000, packageRoot: ".", packageMaxBytes: 1024, packageMaxEntries: 10, sftpTargets: {}, publicBaseUrl: "http://localhost", exportDownloadSigningKey: Buffer.alloc(32, 8), exportDownloadTtlSeconds: 900, exportRetentionSeconds: 86400 }; }
function database() { const prisma = { vevoSubmission: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), update: vi.fn() }, vevoSubmissionAsset: { updateMany: vi.fn() }, outboxEvent: { create: vi.fn() }, $transaction: vi.fn() }; prisma.$transaction.mockImplementation(async callback => callback(prisma)); return { prisma }; }
const snapshot = { id: ids.release, tenantId: ids.tenant, type: "VIDEO", format: "SINGLE", status: "LOCKED_FOR_DELIVERY", title: "Video", genre: "Pop", releaseDate: "2026-08-30T00:00:00.000Z", owner: { path: "root.network.label" }, artist: { name: "Artist", vevoChannel: "ArtistVEVO" }, label: { name: "Label" }, territories: ["US"], tracks: [{ title: "Video", isrc: "USABC2600001", videoAssetId: ids.video, vevoNoSlatesOrTitleCards: true, vevoNoLetterboxing: true }] };

describe("persistent VEVO workflow", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("queues a manual package without requiring a partner upload profile", async () => {
    const db = database(); db.prisma.vevoSubmission.findFirst.mockResolvedValue(null); db.prisma.vevoSubmission.create.mockImplementation(({ data }) => ({ ...data, assets: data.assets.create }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(new Response("{}", { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot }), { status: 200 })).mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ assetId: ids.video, token: "s".repeat(43), expiresAt: "2026-08-30T01:00:00.000Z", fileName: "master.mp4", contentType: "video/mp4", sizeBytes: "5", sha256: "a".repeat(64) }] }), { status: 200 })));
    const service = new VevoService(db as unknown as DistributionDatabase, config());
    await expect(service.create(context(), { releaseId: ids.release, idempotencyKey: "vevo-key-1" }, "signed")).resolves.toMatchObject({ releaseId: ids.release });
    expect(db.prisma.vevoSubmission.create).toHaveBeenCalledOnce();
  });

  it("persists trusted tenant scope and encrypted media credentials", async () => {
    const db = database(); db.prisma.vevoSubmission.findFirst.mockResolvedValue(null); db.prisma.vevoSubmission.create.mockImplementation(({ data }) => ({ ...data, assets: data.assets.create }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: ids.release, status: "LOCKED_FOR_DELIVERY" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: snapshot }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: [{ assetId: ids.video, token: "s".repeat(43), expiresAt: "2026-08-30T01:00:00.000Z", fileName: "master.mp4", contentType: "video/mp4", sizeBytes: "5", sha256: "a".repeat(64) }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const service = new VevoService(db as unknown as DistributionDatabase, config());
    await service.create(context({ tenantId: "99999999-9999-4999-8999-999999999999" }), { releaseId: ids.release, idempotencyKey: "vevo-key-2" }, "signed");
    expect(fetchMock).toHaveBeenNthCalledWith(1, `http://catalog/api/v1/catalog/releases/${ids.release}/delivery-lock`, expect.objectContaining({ method: "POST" }));
    const stored = db.prisma.vevoSubmission.create.mock.calls[0][0].data;
    expect(stored).toMatchObject({ tenantId: ids.tenant, entityPath: "root.network.label", isrc: "USABC2600001" });
    expect(stored.assets.create[0].tokenCiphertext).not.toContain("s".repeat(43));
  });

  it("stops before snapshot and media access when Catalog cannot lock the release", async () => {
    const db = database(); const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: "INVALID_WORKFLOW_STATE" } }), { status: 409 })); vi.stubGlobal("fetch", fetchMock);
    const service = new VevoService(db as unknown as DistributionDatabase, config());

    await expect(service.create(context(), { releaseId: ids.release, idempotencyKey: "vevo-key-lock" }, "signed")).rejects.toMatchObject({ code: "INVALID_WORKFLOW_STATE", statusCode: 409 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(db.prisma.vevoSubmission.create).not.toHaveBeenCalled();
  });

  it("exposes manual package download links only to the BeAlpha owner", async () => {
    const db = database();
    db.prisma.vevoSubmission.findMany.mockResolvedValue([{
      id: ids.submission,
      releaseId: ids.release,
      status: "READY_FOR_MANUAL_DELIVERY",
      packagePath: "private/package.zip",
      packageFileName: "video.zip",
      packageSizeBytes: 12n,
      packageExpiresAt: new Date(Date.now() + 60_000),
      assets: [],
    }]);
    const service = new VevoService(db as unknown as DistributionDatabase, config());

    const ownerRows = await service.list(context());
    expect(ownerRows[0]).toMatchObject({ downloadUrl: expect.stringContaining(`/vevo-package/${ids.submission}?token=`) });

    const tenantRows = await service.list(context({ entityType: "ORGANIZATION", entityRole: "OWNER", entityPath: "root.network.label", roles: ["ORGANIZATION"] }));
    expect(tenantRows[0]).not.toHaveProperty("downloadUrl");
  });

  it("marks a package ready without invoking a partner transport", async () => {
    const db = database(); db.prisma.vevoSubmission.findFirst.mockResolvedValue({ id: ids.submission, releaseId: ids.release, tenantId: ids.tenant, entityPath: "root.network.label", actorId: ids.actor, requestId: randomUUID(), isrc: "USABC2600001", status: "PENDING", attempts: 0, metadata: { purpose: "INSERT", isrc: "USABC2600001", title: "Video", label: "Label", genres: ["Pop"], mainArtists: ["Artist"], youtubeChannelName: "ArtistVEVO", startDateTime: "2026-08-30T00:00:00Z", territories: ["US"], videoAssetId: ids.video }, manifestFileName: "USABC2600001.xml", manifestXml: "<VevoFeed/>", manifestSha256: "a".repeat(64), assets: [] }); db.prisma.vevoSubmission.updateMany.mockResolvedValue({ count: 1 });
    const builder = vi.fn().mockResolvedValue({ packagePath: "packages/manual.zip", packageFileName: "video.zip", packageSizeBytes: 10n, packageSha256: "b".repeat(64), packageExpiresAt: new Date(Date.now() + 60_000) });
    await expect(processNextVevoSubmission(db as unknown as DistributionDatabase, config(), builder)).resolves.toBe(true);
    expect(builder).toHaveBeenCalledOnce();
    expect(db.prisma.vevoSubmission.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "READY_FOR_MANUAL_DELIVERY", packageFileName: "video.zip" }) }));
    expect(db.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "distribution.vevo.package-ready", tenantId: ids.tenant }) });
  });

  it("persists an idempotent tenant-scoped package request from the approval saga", async () => {
    const db = database(); db.prisma.vevoSubmission.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: ids.submission }); db.prisma.vevoSubmission.create.mockImplementation(({ data }) => ({ ...data, assets: data.assets.create }));
    const grant = { assetId: ids.video, token: "s".repeat(43), expiresAt: new Date(Date.now() + 60_000).toISOString(), fileName: "master.mp4", contentType: "video/mp4", sizeBytes: "5", sha256: "a".repeat(64) };
    const approved = await finalizeApprovedVideoPackage(db as unknown as DistributionDatabase, config(), ids.submission, snapshot, [grant], randomUUID(), { actorId: ids.actor });
    expect(approved).toMatchObject({ id: ids.submission, tenantId: ids.tenant, entityPath: "root.network.label", idempotencyKey: `approval:${ids.submission}` });
    expect(db.prisma.vevoSubmission.create).toHaveBeenCalledOnce();
    expect(db.prisma.vevoSubmission.create.mock.calls[0][0].data.assets.create[0].tokenCiphertext).not.toContain(grant.token);
    await expect(finalizeApprovedVideoPackage(db as unknown as DistributionDatabase, config(), ids.submission, snapshot, [grant], randomUUID(), { actorId: ids.actor })).resolves.toEqual({ id: ids.submission });
    expect(db.prisma.vevoSubmission.create).toHaveBeenCalledOnce();
  });

  it("sends media grants in an authorization header instead of the request URL", async () => {
    const token = "s".repeat(43);
    const fetchMock = vi.fn().mockResolvedValue(new Response(Buffer.from("data"), {
      status: 200,
      headers: { "content-length": "4", "content-type": "video/mp4" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    await openDeliveryMediaBody(config(), {
      assetId: ids.video,
      tokenCiphertext: encryptGrantToken(token, config().deliveryGrantEncryptionKey),
      expiresAt: new Date(Date.now() + 60_000),
      sizeBytes: 4n,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      `http://media/media-stream/${ids.video}`,
      expect.objectContaining({ headers: { authorization: `Bearer ${token}` } }),
    );
    expect(fetchMock.mock.calls[0][0]).not.toContain(token);
  });

  it("builds a downloadable manual package with assets before the manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-vevo-")); const cfg = { ...config(), packageRoot: root };
    const bytes = Buffer.from("video"); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } })));
    const entriesSeen: string[] = [];
    const output = await buildVevoManualPackage({ id: ids.submission, isrc: "USABC2600001", manifestXml: "<VevoFeed/>", manifestFileName: "USABC2600001.xml", assets: [{ assetId: ids.video, tokenCiphertext: encryptGrantToken("s".repeat(43), cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60_000), sizeBytes: BigInt(bytes.length), sha256: createHash("sha256").update(bytes).digest("hex"), fileName: `resources/${ids.video}.mp4` }] }, cfg, async (_cwd, outputPath, entries) => { entriesSeen.push(...entries); await writeFile(outputPath, Buffer.from("PKmanual")); });
    expect(entriesSeen.at(-2)).toBe("USABC2600001.xml"); expect(entriesSeen.at(-1)).toBe("delivery.complete"); expect(entriesSeen[0]).toContain("resources/");
    expect(await readFile(output.packagePath)).toEqual(Buffer.from("PKmanual")); expect(output.packageFileName).toContain("USABC2600001");
    await rm(root, { recursive: true, force: true });
  });

  it("hashes a package larger than the stream buffer without stalling", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-vevo-hash-"));
    const packageBytes = Buffer.alloc(256 * 1024, 7);
    try {
      const result = await buildVevoManualPackage({
        id: ids.submission, isrc: "USABC2600001", manifestXml: "<fixture/>",
        manifestFileName: "manifest.xml", assets: [],
      }, { ...config(), packageRoot: root, packageMaxBytes: 1024 * 1024 }, async (_cwd, outputPath) => {
        await writeFile(outputPath, packageBytes);
      });
      expect(result.packageSizeBytes).toBe(BigInt(packageBytes.length));
      expect(result.packageSha256).toBe(createHash("sha256").update(packageBytes).digest("hex"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 2000);

  it("rejects an oversized declared package before fetching assets or replacing staging", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-vevo-budget-"));
    const staging = path.join(root, "vevo", ids.submission, "staging");
    await mkdir(staging, { recursive: true });
    const sentinel = path.join(staging, "existing.txt");
    await writeFile(sentinel, "preserve");
    const fetcher = vi.fn().mockRejectedValue(new Error("UNEXPECTED_FETCH"));
    vi.stubGlobal("fetch", fetcher);
    const cfg = { ...config(), packageRoot: root, packageMaxBytes: 14 };
    const asset = { assetId: ids.video, tokenCiphertext: encryptGrantToken("s".repeat(43), cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60_000), sizeBytes: 8n, sha256: "a".repeat(64), fileName: "resources/video.mp4" };
    try {
      await expect(buildVevoManualPackage({ id: ids.submission, isrc: "USABC2600001", manifestXml: "<v/>", manifestFileName: "manifest.xml", assets: [asset, { ...asset, fileName: "resources/second.mp4" }] }, cfg)).rejects.toThrow("VEVO_PACKAGE_TOO_LARGE");
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readFile(sentinel, "utf8")).toBe("preserve");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("streams only a retained in-root package with a valid signed token", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-vevo-download-"));
    const packagePath = path.join(root, "vevo", ids.submission, "manual.zip");
    await mkdir(path.dirname(packagePath), { recursive: true });
    const bytes = Buffer.from("PKdownload"); await writeFile(packagePath, bytes);
    const cfg = { ...config(), packageRoot: root }; const db = database();
    db.prisma.vevoSubmission.findUnique.mockResolvedValue({ id: ids.submission, status: "READY_FOR_MANUAL_DELIVERY", packagePath, packageFileName: "video.zip", packageSizeBytes: BigInt(bytes.length), packageExpiresAt: new Date(Date.now() + 60_000) });
    const service = new VevoService(db as unknown as DistributionDatabase, cfg);

    await expect(service.openPackage(ids.submission, "0.invalid")).rejects.toMatchObject({ code: "INVALID_PACKAGE_TOKEN" });
    const opened = await service.openPackage(ids.submission, createExportToken(ids.submission, 60, cfg.exportDownloadSigningKey));
    expect(opened).toMatchObject({ fileName: "video.zip", sizeBytes: bytes.length }); opened.stream.destroy();

    db.prisma.vevoSubmission.findUnique.mockResolvedValue({ id: ids.submission, status: "READY_FOR_MANUAL_DELIVERY", packagePath: path.join(root, "..", "outside.zip"), packageFileName: "video.zip", packageSizeBytes: BigInt(bytes.length), packageExpiresAt: new Date(Date.now() + 60_000) });
    await expect(service.openPackage(ids.submission, createExportToken(ids.submission, 60, cfg.exportDownloadSigningKey))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await rm(root, { recursive: true, force: true });
  });
});
