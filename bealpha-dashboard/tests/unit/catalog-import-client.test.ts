import { importCatalogDirect } from "@/lib/catalog-import-client";
import { apiRequest } from "@/lib/api-client";
import { uploadMediaDirect } from "@/lib/media-upload-client";

jest.mock("@/lib/api-client", () => ({ apiRequest: jest.fn(), captureAuthSession: () => ({ signal: new AbortController().signal, requireCurrent: () => {} }) }));
jest.mock("@/lib/media-upload-client", () => ({ uploadMediaDirect: jest.fn() }));

const request = apiRequest as jest.MockedFunction<typeof apiRequest>;
const upload = uploadMediaDirect as jest.MockedFunction<typeof uploadMediaDirect>;

describe("catalog import client", () => {
  beforeEach(() => jest.clearAllMocks());

  it("uploads once through Media and polls the Catalog worker", async () => {
    upload.mockResolvedValue({ assetId: "11111111-1111-4111-8111-111111111111" });
    request
      .mockResolvedValueOnce({ status: "READY" })
      .mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222" })
      .mockResolvedValueOnce({ id: "22222222-2222-4222-8222-222222222222", status: "COMPLETE", releaseCount: 1, trackCount: 10 });
    const file = new File(["zip"], "catalog.zip", { type: "application/zip" });
    await expect(importCatalogDirect(file, "ZIP")).resolves.toMatchObject({ status: "COMPLETE", trackCount: 10 });
    expect(upload).toHaveBeenCalledWith("ARCHIVE", file, {}, undefined);
    expect(request).toHaveBeenNthCalledWith(2, "/api/v1/catalog/imports", expect.objectContaining({ body: expect.stringContaining('"format":"ZIP"') }));
  });
});
