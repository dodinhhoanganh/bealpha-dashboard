import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { applyVevoAcknowledgement, UnconfiguredVevoFeedAdapter, VevoFeedAdapter, type VevoFeedSubmission, type VevoObjectStore } from "../src/vevo-feed.js";

const videoAssetId = "55555555-5555-4555-8555-555555555555";

function submission(): VevoFeedSubmission {
  const object = (fileName: string, body: string) => ({
    fileName,
    contentType: fileName.endsWith(".xml") ? "application/xml" : "video/mp4",
    sizeBytes: BigInt(Buffer.byteLength(body)),
    sha256: "a".repeat(64),
    openBody: async () => Readable.from(body),
  });
  return {
    submissionId: randomUUID(),
    metadata: {
      purpose: "INSERT",
      isrc: "USABC2600001",
      title: "Video",
      label: "Label",
      genres: ["Pop"],
      mainArtists: ["Artist"],
      youtubeChannelName: "ArtistVEVO",
      startDateTime: "2026-08-30T00:00:00Z",
      territories: ["US"],
      videoAssetId,
    },
    assets: [{ ...object("resources/video.mp4", "video"), assetId: videoAssetId, role: "VIDEO" }],
    manifest: object("manifest.xml", "<xml/>")
  };
}

function store() {
  return { putObject: vi.fn().mockResolvedValue(undefined), getObject: vi.fn().mockResolvedValue(null) };
}

describe("VEVO feed adapter", () => {
  it("uploads every asset before committing the manifest ingest signal", async () => {
    const objectStore = store();
    const adapter = new VevoFeedAdapter(objectStore as VevoObjectStore, "feed/bealpha");
    const result = await adapter.submit(submission());
    expect(objectStore.putObject).toHaveBeenCalledTimes(2);
    expect(objectStore.putObject.mock.calls[0][0].key).toContain("resources/video.mp4");
    expect(objectStore.putObject.mock.calls[1][0].key).toBe(result.manifestKey);
    expect(result.state).toBe("SENT_AWAITING_ACK");
  });

  it("does not commit a manifest after an asset upload failure", async () => {
    const objectStore = store();
    objectStore.putObject.mockRejectedValueOnce(new Error("S3_FAILED"));
    const adapter = new VevoFeedAdapter(objectStore as VevoObjectStore, "feed/bealpha");
    await expect(adapter.submit(submission())).rejects.toThrow("S3_FAILED");
    expect(objectStore.putObject).toHaveBeenCalledTimes(1);
  });

  it("keeps an absent receipt pending and confirms only a valid success receipt", async () => {
    const objectStore = store();
    const adapter = new VevoFeedAdapter(objectStore as VevoObjectStore, "feed/bealpha");
    const sent = await adapter.submit(submission());
    expect(await adapter.pollAcknowledgement(sent, "USABC2600001")).toBeNull();
    objectStore.getObject.mockImplementation((key: string) => Promise.resolve(key.includes("success-") ? Buffer.from('{"ok":true}') : null));
    const acknowledgement = await adapter.pollAcknowledgement(sent, "USABC2600001", new Date("2026-08-22T00:00:00Z"));
    expect(acknowledgement).toMatchObject({ outcome: "SUCCESS", isrc: "USABC2600001", receiptSha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(applyVevoAcknowledgement("SENT", acknowledgement!)).toEqual({ status: "CONFIRMED", confirmedAt: new Date("2026-08-22T00:00:00Z"), lastError: null });
  });

  it("maps a failure receipt to FAILED and sanitizes its diagnostic", async () => {
    const objectStore = store();
    const adapter = new VevoFeedAdapter(objectStore as VevoObjectStore, "feed/bealpha");
    const sent = await adapter.submit(submission());
    objectStore.getObject.mockImplementation((key: string) => Promise.resolve(key.includes("failure-") ? Buffer.from('{"message":"missing asset\\nretry"}') : null));
    const acknowledgement = await adapter.pollAcknowledgement(sent, "USABC2600001", new Date("2026-08-22T00:00:00Z"));
    expect(applyVevoAcknowledgement("SENT", acknowledgement!)).toEqual({ status: "FAILED", confirmedAt: null, lastError: "missing asset retry" });
  });

  it("fails closed for conflicting or malformed success receipts", async () => {
    const objectStore = store();
    const adapter = new VevoFeedAdapter(objectStore as VevoObjectStore, "feed/bealpha");
    const sent = await adapter.submit(submission());
    objectStore.getObject.mockResolvedValue(Buffer.from("{}"));
    await expect(adapter.pollAcknowledgement(sent, "USABC2600001")).rejects.toThrow("VEVO_RECEIPT_CONFLICT");
    objectStore.getObject.mockImplementation((key: string) => Promise.resolve(key.includes("success-") ? Buffer.from("not-json") : null));
    await expect(adapter.pollAcknowledgement(sent, "USABC2600001")).rejects.toThrow("VEVO_SUCCESS_RECEIPT_INVALID");
  });

  it("never simulates partner delivery when the adapter is unconfigured", async () => {
    await expect(new UnconfiguredVevoFeedAdapter().submit()).rejects.toThrow("VEVO_PARTNER_ADAPTER_NOT_CONFIGURED");
  });
});
