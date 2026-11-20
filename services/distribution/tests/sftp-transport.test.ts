import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DistributionConfig } from "../src/config.js";
import { encryptGrantToken } from "../src/grant-crypto.js";
import { buildDeliveryPackage, type PackageDelivery } from "../src/package-builder.js";
import { catalogSnapshotSchema, generateErn } from "../src/ern.js";
import { SftpAcknowledgementTransport, SftpDeliveryTransport } from "../src/sftp-transport.js";

const ids = { release: "44444444-4444-4444-8444-444444444444", track: "55555555-5555-4555-8555-555555555555", tenant: "33333333-3333-4333-8333-333333333333", delivery: "77777777-7777-4777-8777-777777777777", asset: "88888888-8888-4888-8888-888888888888" };
const snapshot = { id: ids.release, title: "Single", ean: "123456789012", type: "AUDIO", format: "SINGLE", status: "LOCKED_FOR_DELIVERY", tenantId: ids.tenant, displayArtist: "Artist", releaseDate: "2026-08-30T00:00:00.000Z", genre: "Pop", cLine: "2026 Label", pLine: "2026 Label", label: { name: "Label" }, tracks: [{ id: ids.track, title: "Track", isrc: "USABC2600001", trackNumber: 1, discNumber: 1, duration: 180, displayArtist: "Artist", explicitContent: "NONE", audioAssetId: ids.asset }] } as const;

function config(packageRoot: string): DistributionConfig {
  return {
    packageRoot,
    packageMaxBytes: 1024,
    packageMaxEntries: 10,
    mediaServiceUrl: "http://media:4103",
    deliveryGrantEncryptionKey: Buffer.alloc(32, 7),
    sftpTargets: { spotify: { host: "sftp.example.com", port: 22, username: "delivery", remoteDir: "/incoming", privateKeyPath: "/run/secrets/key", knownHostsPath: "/run/secrets/known_hosts", priority: "N" } }
  } as unknown as DistributionConfig;
}

function delivery(messageType: "NewReleaseMessage" | "TakedownMessage", cfg: DistributionConfig): PackageDelivery & { dsp: string } {
  return {
    id: ids.delivery,
    createdAt: new Date("2026-08-21T12:34:56.789Z"),
    dsp: "spotify",
    messageType,
    snapshot: { ernXml: "<ern/>", payload: snapshot, createdAt: new Date("2026-08-22T00:00:00.000Z") },
    assetGrants: messageType === "TakedownMessage" ? [] : [{ assetId: ids.asset, tokenCiphertext: encryptGrantToken("t".repeat(43), cfg.deliveryGrantEncryptionKey), expiresAt: new Date(Date.now() + 60000), fileName: "master.wav", contentType: "audio/wav", sizeBytes: 4n, sha256: "4b125ec99a74470517f9f51ac1a70eafa3dbd1ddd4bae409fe59a98ed720a3a4" }]
  };
}

async function writeProbeDestination(batch: string, content: string) {
  const destination = /^get\s+"[^"]+"\s+"([^"]+)"$/m.exec(batch)?.[1];
  if (!destination) throw new Error("TEST_PROBE_DESTINATION_MISSING");
  await writeFile(destination, content, "utf8");
}

describe("DDEX SFTP transport", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("includes the signed cover resource before the ERN manifest", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-ddex-cover-"));
    const cfg = config(root);
    const coverId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const coverBytes = Buffer.from("cover");
    const input = delivery("NewReleaseMessage", cfg);
    input.snapshot.payload = { ...snapshot, coverUrl: `media-asset:${coverId}` };
    input.assetGrants.push({ ...input.assetGrants[0]!, assetId: coverId, fileName: "cover.jpg", contentType: "image/jpeg", sizeBytes: BigInt(coverBytes.length), sha256: createHash("sha256").update(coverBytes).digest("hex") });
    input.snapshot.ernXml = generateErn({
      snapshot: catalogSnapshotSchema.parse(input.snapshot.payload), sender: { partyId: "PADPIDA0000000001A", name: "BeAlpha" }, recipient: { partyId: "PADPIDA1234567890A", name: "DSP" },
      messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: "9", messageId: "cover-fixture", messageThreadId: "cover-thread", createdAt: input.createdAt,
      assets: new Map(input.assetGrants.map(grant => [grant.assetId, grant])),
    });
    cfg.packageMaxBytes = Buffer.byteLength(input.snapshot.ernXml) + 9;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const bytes = url.endsWith(coverId) ? coverBytes : Buffer.from("wave");
      return new Response(bytes, { status: 200, headers: { "content-length": String(bytes.length) } });
    }));
    try {
      const result = await buildDeliveryPackage(input, cfg);
      const cover = "resources/123456789012_FrontCoverImage_001.jpg";
      expect(result.entries).toContain(cover);
      expect(input.snapshot.ernXml).toContain(`<URI>${cover}</URI>`);
      expect(await readFile(path.join(result.rootPath, cover))).toEqual(coverBytes);
      expect(result.entries.at(-1)).toBe("123456789012.xml");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it.each(["missing", "entries", "bytes"])("rejects a cover with invalid %s budget/grant before download", async mode => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-ddex-cover-budget-"));
    const cfg = config(root);
    const input = delivery("NewReleaseMessage", cfg);
    const coverId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    input.snapshot.payload = { ...snapshot, coverUrl: `media-asset:${coverId}` };
    if (mode !== "missing") input.assetGrants.push({ ...input.assetGrants[0]!, assetId: coverId, fileName: "cover.jpg", contentType: "image/jpeg" });
    if (mode === "entries") cfg.packageMaxEntries = 2;
    if (mode === "bytes") cfg.packageMaxBytes = 13;
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    try {
      await expect(buildDeliveryPackage(input, cfg)).rejects.toThrow(mode === "missing" ? "DELIVERY_GRANT_MISSING" : mode === "entries" ? "DELIVERY_PACKAGE_TOO_MANY_ENTRIES" : "DELIVERY_PACKAGE_TOO_LARGE");
      expect(fetcher).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(["bytes", "entries"])("preflights package %s before downloads or replacing existing files", async limit => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-ddex-budget-"));
    const cfg = { ...config(root), packageMaxBytes: limit === "bytes" ? 5 : 1024, packageMaxEntries: limit === "entries" ? 1 : 10 };
    const destination = path.join(root, ids.delivery);
    await mkdir(destination);
    const sentinel = path.join(destination, "existing.txt");
    await writeFile(sentinel, "preserve");
    const fetcher = vi.fn().mockRejectedValue(new Error("UNEXPECTED_FETCH"));
    vi.stubGlobal("fetch", fetcher);
    try {
      await expect(buildDeliveryPackage(delivery("NewReleaseMessage", cfg), cfg)).rejects.toThrow(limit === "bytes" ? "DELIVERY_PACKAGE_TOO_LARGE" : "DELIVERY_PACKAGE_TOO_MANY_ENTRIES");
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readFile(sentinel, "utf8")).toBe("preserve");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects an oversized takedown manifest without binary resources", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-ddex-manifest-budget-"));
    const cfg = { ...config(root), packageMaxBytes: 5 };
    try {
      await expect(buildDeliveryPackage(delivery("TakedownMessage", cfg), cfg)).rejects.toThrow("DELIVERY_PACKAGE_TOO_LARGE");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("uploads every resource before the ERN completion signal", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-sftp-"));
    const cfg = config(root);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(Buffer.from("wave"), { status: 200, headers: { "content-length": "4" } })));
    const runner = vi.fn().mockRejectedValueOnce(new Error("REMOTE_MISSING")).mockResolvedValueOnce(undefined);
    await new SftpDeliveryTransport(cfg, runner).send(delivery("NewReleaseMessage", cfg));

    const upload = runner.mock.calls[1]![1] as string;
    const commands = upload.trim().split("\n");
    const puts = commands.filter(command => command.startsWith("put "));
    expect(puts).toHaveLength(2);
    expect(puts[0]).toContain("/resources/");
    expect(puts[1]).toContain("123456789012.xml");
    expect(commands.at(-1)).toMatch(/^rename /);
    await rm(root, { recursive: true, force: true });
  });

  it("builds a takedown folder without media binaries", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-takedown-"));
    const cfg = config(root);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const artifact = await buildDeliveryPackage(delivery("TakedownMessage", cfg), cfg);
    expect(artifact.entries).toEqual(["123456789012.xml"]);
    expect(fetchMock).not.toHaveBeenCalled();
    await rm(root, { recursive: true, force: true });
  });

  it("treats an exact remote ERN as an idempotent retry", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-sftp-retry-"));
    const cfg = config(root);
    const runner = vi.fn(async (_target, batch: string) => writeProbeDestination(batch, "<ern/>"));
    await expect(new SftpDeliveryTransport(cfg, runner).send(delivery("TakedownMessage", cfg))).resolves.toEqual({ remoteFolder: "N_123456789012_20260821123456789" });
    expect(runner).toHaveBeenCalledOnce();
    await rm(root, { recursive: true, force: true });
  });

  it("fails closed when a retry finds different ERN content", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-sftp-conflict-"));
    const cfg = config(root);
    const runner = vi.fn(async (_target, batch: string) => writeProbeDestination(batch, "<different/>"));
    await expect(new SftpDeliveryTransport(cfg, runner).send(delivery("TakedownMessage", cfg))).rejects.toThrow("SFTP_REMOTE_FOLDER_CONFLICT");
    expect(runner).toHaveBeenCalledOnce();
    await rm(root, { recursive: true, force: true });
  });

  it("recovers when an ambiguous upload error actually completed remotely", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "bealpha-sftp-ambiguous-"));
    const cfg = config(root);
    const runner = vi.fn()
      .mockRejectedValueOnce(new Error("REMOTE_MISSING"))
      .mockRejectedValueOnce(new Error("CONNECTION_LOST_AFTER_RENAME"))
      .mockImplementationOnce(async (_target, batch: string) => writeProbeDestination(batch, "<ern/>"));
    await expect(new SftpDeliveryTransport(cfg, runner).send(delivery("TakedownMessage", cfg))).resolves.toEqual({ remoteFolder: "N_123456789012_20260821123456789" });
    expect(runner).toHaveBeenCalledTimes(3);
    await rm(root, { recursive: true, force: true });
  });

  it("lists only matching ACK files and downloads them from the delivery acknowledgement folder", async () => {
    const cfg = config(".");
    const fileName = `ACK_BA-${ids.delivery}_20260822000000000.xml`;
    const runner = vi.fn(async (_target, batch: string) => {
      if (batch.startsWith("ls ")) return `${fileName}\n../../escape.xml\nACK_OTHER_20260822000000000.xml\n`;
      const destination = /^get\s+"[^"]+"\s+"([^"]+)"$/m.exec(batch)?.[1];
      if (!destination) throw new Error("TEST_DESTINATION_MISSING");
      await writeFile(destination, "<ack/>", "utf8");
      return "";
    });
    await expect(new SftpAcknowledgementTransport(cfg, runner).poll({ id: ids.delivery, dsp: "spotify", messageId: `BA-${ids.delivery}`, remoteFolder: "N_123456789012_20260821123456789" })).resolves.toEqual([{ fileName, xml: "<ack/>" }]);
    expect(runner).toHaveBeenCalledTimes(2);
  });
});
