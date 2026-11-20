type Client = typeof import("@/lib/api-client");
type Streams = typeof import("@/lib/stream-url");
const reference = "media-asset:10000000-0000-4000-8000-000000000001";
function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: status === 403 ? { code: "FORBIDDEN", message: "Not permitted" } : null, requestId: "fixture" }), { status });
}

describe("stream capability cache auth lifetime", () => {
  const originalFetch = global.fetch;
  let client: Client;
  let streams: Streams;
  let fetchMock: jest.Mock;
  let account: string;
  let clock: jest.SpyInstance;
  let start: number;

  beforeEach(async () => {
    jest.resetModules();
    start = Date.now();
    clock = jest.spyOn(Date, "now").mockReturnValue(start);
    account = "A";
    fetchMock = jest.fn((url: string) => url.endsWith("/refresh")
      ? Promise.resolve(response({ accessToken: account, expiresIn: 900, user: {} }))
      : account === "B" ? Promise.resolve(response(null, 403))
      : Promise.resolve(response({ url: "https://media.fixture/stream?token=A", expiresAt: new Date(start + 60_000).toISOString() })));
    global.fetch = fetchMock;
    client = await import("@/lib/api-client");
    streams = process.env.STREAM_CACHE_TEST_SOURCE
      ? jest.requireActual<Streams>(process.env.STREAM_CACHE_TEST_SOURCE)
      : await import("@/lib/stream-url");
  });
  afterEach(() => { streams.clearStreamTokenCache(); jest.restoreAllMocks(); global.fetch = originalFetch; });

  it("does not return account A's cached capability after changing to B", async () => {
    await streams.getSignedStreamUrl("audio", reference);
    account = "B";
    client.clearAccessToken();
    await expect(streams.getSignedStreamUrl("audio", reference)).rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stream-grants"))).toHaveLength(2);
  });

  it("reuses an unexpired capability only in the same auth lifetime", async () => {
    const first = await streams.getSignedStreamUrl("audio", reference);
    await expect(streams.getSignedStreamUrl("audio", reference)).resolves.toBe(first);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stream-grants"))).toHaveLength(1);
  });

  it("rejects a grant that expires while its response is delayed", async () => {
    const fallback = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith("/stream-grants")) clock.mockReturnValue(start + 61_000);
      return fallback(url);
    });
    await expect(streams.getSignedStreamUrl("audio", reference)).rejects.toThrow("Invalid media grant expiry");
  });

  it("does not publish/cache a response after its auth context changes at the consumer boundary", async () => {
    const request = client.apiRequest;
    jest.spyOn(client, "apiRequest").mockImplementationOnce(async <T>(path: string, init?: RequestInit): Promise<T> => {
      const value = await request<T>(path, init);
      account = "B";
      client.clearAccessToken();
      return value;
    });
    await expect(streams.getSignedStreamUrl("audio", reference)).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    await expect(streams.getSignedStreamUrl("audio", reference)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not let an old in-flight response refill an explicitly cleared cache", async () => {
    const request = client.apiRequest;
    jest.spyOn(client, "apiRequest").mockImplementationOnce(async <T>(path: string, init?: RequestInit): Promise<T> => {
      const value = await request<T>(path, init);
      streams.clearStreamTokenCache();
      return value;
    });
    await streams.getSignedStreamUrl("audio", reference);
    await streams.getSignedStreamUrl("audio", reference);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/stream-grants"))).toHaveLength(2);
  });
});
