import { describe, expect, it, vi } from "vitest";
import { VEVO_VIDEO_PROFILE_VERSION } from "@bealpha/contracts";
import { assertVevoReleaseReady, type VevoReleaseReadinessInput } from "../src/vevo-readiness.js";

const videoAssetId = "55555555-5555-4555-8555-555555555555";

function release(overrides: Partial<VevoReleaseReadinessInput> = {}): VevoReleaseReadinessInput {
  return {
    type: "VIDEO",
    format: "SINGLE",
    title: "Video",
    genre: "Pop",
    releaseDate: new Date("2026-08-30T00:00:00Z"),
    metadata: { territories: ["US", "VN"] },
    artist: { name: "Artist", vevoChannel: "ArtistVEVO" },
    label: { name: "Label" },
    tracks: [{
      title: "Video",
      isrc: "USABC2600001",
      videoAssetId,
      metadata: { vevoNoSlatesOrTitleCards: true, vevoNoLetterboxing: true },
    }],
    ...overrides,
  };
}

describe("VEVO release readiness", () => {
  it("accepts one video with required metadata and current QC evidence", async () => {
    const lookup = vi.fn().mockResolvedValue({
      id: videoAssetId,
      type: "VIDEO",
      status: "READY",
      qcProfileVersion: VEVO_VIDEO_PROFILE_VERSION,
      qcResult: { compliant: true },
    });
    await expect(assertVevoReleaseReady(release(), lookup)).resolves.toMatchObject({
      purpose: "INSERT",
      isrc: "USABC2600001",
      youtubeChannelName: "ArtistVEVO",
      territories: ["US", "VN"],
      videoAssetId,
    });
  });

  it("rejects multi-track video releases before approval", async () => {
    const input = release();
    input.tracks.push({ title: "Second", isrc: "USABC2600002", videoAssetId: "66666666-6666-4666-8666-666666666666" });
    await expect(assertVevoReleaseReady(input, vi.fn())).rejects.toMatchObject({
      code: "VEVO_RELEASE_INCOMPLETE",
      statusCode: 409,
    });
  });

  it("rejects stale or missing technical QC evidence", async () => {
    const lookup = vi.fn().mockResolvedValue({
      id: videoAssetId,
      type: "VIDEO",
      status: "READY",
      qcProfileVersion: "stale",
      qcResult: { compliant: true },
    });
    await expect(assertVevoReleaseReady(release(), lookup)).rejects.toMatchObject({
      code: "VEVO_RELEASE_INCOMPLETE",
      statusCode: 409,
    });
  });

  it("requires a valid VEVO channel and explicit territories", async () => {
    await expect(assertVevoReleaseReady(release({
      artist: { name: "Artist", vevoChannel: "invalid channel VEVO" },
      metadata: { territories: [] },
    }), vi.fn())).rejects.toMatchObject({ code: "VEVO_RELEASE_INCOMPLETE" });
  });

  it("requires server-side editorial policy attestations", async () => {
    const input = release();
    input.tracks[0]!.metadata = { vevoNoSlatesOrTitleCards: false, vevoNoLetterboxing: true };
    const lookup = vi.fn().mockResolvedValue({
      id: videoAssetId,
      type: "VIDEO",
      status: "READY",
      qcProfileVersion: VEVO_VIDEO_PROFILE_VERSION,
      qcResult: { compliant: true },
    });
    await expect(assertVevoReleaseReady(input, lookup)).rejects.toMatchObject({
      code: "VEVO_RELEASE_INCOMPLETE",
      statusCode: 409,
    });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not impose VEVO policy on audio releases", async () => {
    await expect(assertVevoReleaseReady(release({ type: "AUDIO" }), vi.fn())).resolves.toBeNull();
  });
});
