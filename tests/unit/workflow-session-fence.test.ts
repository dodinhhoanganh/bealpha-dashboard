type Client = typeof import("@/lib/api-client");
type ExportClient = typeof import("@/lib/catalog-export-client");
type ImportClient = typeof import("@/lib/catalog-import-client");
type UploadClient = typeof import("@/lib/media-upload-client");

function response(data: unknown): Response {
  return new Response(JSON.stringify({ data, error: null, requestId: "fixture" }), { status: 200 });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
const assetId = "10000000-0000-4000-8000-000000000001";
class UploadRequest {
  static instances: UploadRequest[] = [];
  static finishImmediately = false;
  status = 201;
  responseText = JSON.stringify({ data: { id: assetId, fileName: "catalog.zip", storageKey: "fixture", fileSize: "3", mimeType: "application/zip", status: "PROCESSING" }, error: null });
  upload: { onprogress?: (event: ProgressEvent) => void } = {};
  onerror?: () => void;
  onabort?: () => void;
  onload?: () => void;
  open = jest.fn();
  setRequestHeader = jest.fn();
  abort = jest.fn(() => this.onabort?.());
  send = jest.fn(() => { if (UploadRequest.finishImmediately) this.onload?.(); });
  constructor() { UploadRequest.instances.push(this); }
}

describe("multi-step workflow auth lifetime", () => {
  const originalFetch = global.fetch;
  const originalXhr = global.XMLHttpRequest;
  let fetchMock: jest.Mock;
  let client: Client;
  let exporter: ExportClient;
  let importer: ImportClient;
  let uploader: UploadClient;
  let account: string;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    account = "A";
    UploadRequest.instances = [];
    UploadRequest.finishImmediately = false;
    global.XMLHttpRequest = UploadRequest as unknown as typeof XMLHttpRequest;
    fetchMock = jest.fn((url: string) => url.endsWith("/refresh")
      ? Promise.resolve(response({ accessToken: account, expiresIn: 900, user: {} }))
      : Promise.reject(new Error(`Unexpected fixture request: ${url}`)));
    global.fetch = fetchMock;
    if (process.env.WORKFLOW_TEST_ROOT) {
      jest.doMock("@/lib/api-client", () => jest.requireActual<Client>(`${process.env.WORKFLOW_TEST_ROOT}/api-client.ts`));
      jest.doMock("@/lib/media-upload-client", () => jest.requireActual<UploadClient>(`${process.env.WORKFLOW_TEST_ROOT}/media-upload-client.ts`));
      client = jest.requireMock<Client>("@/lib/api-client");
      uploader = jest.requireMock<UploadClient>("@/lib/media-upload-client");
      exporter = jest.requireActual<ExportClient>(`${process.env.WORKFLOW_TEST_ROOT}/catalog-export-client.ts`);
      importer = jest.requireActual<ImportClient>(`${process.env.WORKFLOW_TEST_ROOT}/catalog-import-client.ts`);
    } else {
      client = await import("@/lib/api-client");
      exporter = await import("@/lib/catalog-export-client");
      importer = await import("@/lib/catalog-import-client");
      uploader = await import("@/lib/media-upload-client");
    }
  });
  afterEach(() => { jest.useRealTimers(); global.fetch = originalFetch; global.XMLHttpRequest = originalXhr; });
  const switchAccount = () => { account = "B"; client.clearAccessToken(); };
  const observe = <T>(promise: Promise<T>) => promise.then(value => ({ value, error: null }), error => ({ value: null, error }));
  const intent = () => response({ url: "https://media.fixture/media-upload/A?token=fixture", headers: { "content-type": "application/zip" } });

  it("does not poll an old export job with the new account", async () => {
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url === "/api/v1/distribution/exports") return Promise.resolve(response({ id: "job-A", status: "pending" }));
      if (url.endsWith("/exports/job-A")) return Promise.resolve(response({ id: "job-A", status: "complete", downloadUrl: "https://download.fixture/A" }));
      if (url === "https://download.fixture/A") return Promise.resolve(new Response("PACKAGE-A"));
      return fallback(url, init);
    });
    const pending = observe(exporter.fetchCatalogExport("zip"));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);
    switchAccount();
    await jest.advanceTimersByTimeAsync(1500);
    expect((await pending).error).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/exports/job-A"))).toBe(false);
  });

  it("fences a pending signed download response", async () => {
    const body = deferred<Response>();
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => url === "/api/v1/distribution/exports"
      ? Promise.resolve(response({ id: "job-A", status: "complete", downloadUrl: "https://download.fixture/A" }))
      : url === "https://download.fixture/A" ? body.promise : fallback(url, init));
    const pending = observe(exporter.fetchCatalogExport("zip"));
    await jest.advanceTimersByTimeAsync(0);
    const download = fetchMock.mock.calls.find(([url]) => url === "https://download.fixture/A")!;
    switchAccount();
    body.resolve(new Response("PACKAGE-A"));
    expect((await pending).error).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect((download[1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("aborts only the pending signed XHR and suppresses late progress/result", async () => {
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => url.endsWith("/upload-intents") ? Promise.resolve(intent()) : fallback(url, init));
    const progress = jest.fn();
    const pending = observe(uploader.uploadMediaDirect("ARCHIVE", new File(["zip"], "catalog.zip"), {}, progress));
    await jest.advanceTimersByTimeAsync(0);
    const xhr = UploadRequest.instances[0]!;
    switchAccount();
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 2, total: 3 } as ProgressEvent);
    xhr.onload?.();
    expect((await pending).error).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(xhr.abort).toHaveBeenCalled();
    expect(progress).not.toHaveBeenCalled();
  });

  it.each(["asset", "import"])("stops %s polling before reusing an old asset/job in the new account", async stage => {
    UploadRequest.finishImmediately = true;
    let assetReads = 0;
    let jobReads = 0;
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith("/upload-intents")) return Promise.resolve(intent());
      if (url.includes("/media/assets/")) return Promise.resolve(response({ status: stage === "asset" && ++assetReads === 1 ? "PROCESSING" : "READY" }));
      if (url === "/api/v1/catalog/imports") return Promise.resolve(response({ id: "import-A" }));
      if (url.endsWith("/imports/import-A")) return Promise.resolve(response({ id: "import-A", status: stage === "import" && ++jobReads === 1 ? "PROCESSING" : "COMPLETE", releaseCount: 1, trackCount: 1 }));
      return fallback(url, init);
    });
    const pending = observe(importer.importCatalogDirect(new File(["zip"], "catalog.zip"), "ZIP"));
    await jest.advanceTimersByTimeAsync(0);
    expect(jest.getTimerCount()).toBe(1);
    const calls = fetchMock.mock.calls.length;
    switchAccount();
    await jest.advanceTimersByTimeAsync(1000);
    expect((await pending).error).toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    expect(fetchMock.mock.calls).toHaveLength(calls);
  });

  it("preserves same-session uploads and detaches completed XHR cancellation", async () => {
    UploadRequest.finishImmediately = true;
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, init: RequestInit) => url.endsWith("/upload-intents") ? Promise.resolve(intent()) : fallback(url, init));
    await expect(uploader.uploadMediaDirect("ARCHIVE", new File(["zip"], "catalog.zip"), {})).resolves.toMatchObject({ assetId });
    switchAccount();
    expect(UploadRequest.instances[0]!.abort).not.toHaveBeenCalled();
  });
});
