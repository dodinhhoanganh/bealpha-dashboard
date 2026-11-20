import {
  clearStreamTokenCache,
  extractSafeStreamSubPath,
  extractStreamSubPath,
  getSignedStreamUrl,
  resolveMediaReference,
} from "@/lib/stream-url";

jest.mock("@/lib/api-client", () => {
  const signal = new AbortController().signal;
  return { apiRequest: jest.fn(), captureAuthSession: () => ({ signal, requireCurrent: () => {} }) };
});

import { apiRequest } from "@/lib/api-client";

describe("extractSafeStreamSubPath", () => {
  beforeEach(() => {
    clearStreamTokenCache();
    jest.clearAllMocks();
  });

  it("rejects non-asset media paths", () => {
    expect(extractSafeStreamSubPath("/uploads/audio/track.wav")).toBe("");
    expect(extractStreamSubPath("https://uploads.example.test/track.wav")).toBe("");
  });

  it("preserves media asset references for grant creation", () => {
    expect(extractStreamSubPath("media-asset:55555555-5555-4555-8555-555555555555")).toBe(
      "media-asset:55555555-5555-4555-8555-555555555555",
    );
  });

  it("requests Media stream grants through the API Gateway", async () => {
    clearStreamTokenCache();
    (apiRequest as jest.Mock).mockResolvedValue({
      url: "https://media.example.com/media-stream/asset?token=secret",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(
      getSignedStreamUrl("audio", "media-asset:55555555-5555-4555-8555-555555555555"),
    ).resolves.toBe("https://media.example.com/media-stream/asset?token=secret");
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/v1/media/assets/55555555-5555-4555-8555-555555555555/stream-grants",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("resolves opaque image references through an authorized stream grant", async () => {
    clearStreamTokenCache();
    (apiRequest as jest.Mock).mockResolvedValue({
      url: "https://media.example.com/media-stream/image?token=secret",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    await expect(resolveMediaReference("image", "media-asset:55555555-5555-4555-8555-555555555555"))
      .resolves.toContain("/media-stream/image?token=");
    expect(apiRequest).toHaveBeenCalledWith(
      "/api/v1/media/assets/55555555-5555-4555-8555-555555555555/stream-grants",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("leaves already-public and external image URLs unchanged", async () => {
    await expect(resolveMediaReference("image", "https://images.example.com/artist.jpg"))
      .resolves.toBe("https://images.example.com/artist.jpg");
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
