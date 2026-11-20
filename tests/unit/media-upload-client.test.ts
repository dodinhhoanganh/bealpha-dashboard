import { apiRequest } from "@/lib/api-client";
import { uploadMediaDirect } from "@/lib/media-upload-client";

jest.mock("@/lib/api-client", () => ({ apiRequest: jest.fn(), captureAuthSession: () => ({ signal: new AbortController().signal, requireCurrent: () => {} }) }));

class SuccessfulUploadRequest {
  status = 201;
  responseText = JSON.stringify({
    data: {
      id: "55555555-5555-4555-8555-555555555555",
      fileName: "cover.jpg",
      storageKey: "private/original",
      fileSize: "4",
      mimeType: "image/jpeg",
      status: "PROCESSING",
    },
    error: null,
  });
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onerror?: () => void;
  onabort?: () => void;
  onload?: () => void;
  open = jest.fn();
  setRequestHeader = jest.fn();
  send = jest.fn(() => this.onload?.());
}

describe("media upload client", () => {
  const originalXhr = global.XMLHttpRequest;

  beforeEach(() => {
    jest.clearAllMocks();
    global.XMLHttpRequest = SuccessfulUploadRequest as unknown as typeof XMLHttpRequest;
    (apiRequest as jest.Mock).mockResolvedValue({
      url: "https://media.example.com/media-upload/upload?token=secret",
      headers: { "content-type": "image/jpeg" },
    });
  });

  afterAll(() => { global.XMLHttpRequest = originalXhr; });

  it("returns an opaque reference for an image instead of a public or capability URL", async () => {
    const result = await uploadMediaDirect("IMAGE", new File(["jpeg"], "cover.jpg", { type: "image/jpeg" }), {});

    expect(result).toMatchObject({
      assetId: "55555555-5555-4555-8555-555555555555",
      reference: "media-asset:55555555-5555-4555-8555-555555555555",
      url: "media-asset:55555555-5555-4555-8555-555555555555",
    });
    expect(String(result.url)).not.toContain("token=");
    expect(String(result.url)).not.toContain("/media-public/");
  });
});
