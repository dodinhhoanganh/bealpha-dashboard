type Client = typeof import("@/lib/api-client");

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function response(data: unknown, status = 200): Response {
  return new Response(JSON.stringify({ data, error: status === 401 ? { code: "UNAUTHENTICATED", message: "Expired" } : null, requestId: "id" }), { status });
}

function session(token: string): Response {
  return response({ accessToken: token, expiresIn: 900, user: { id: token, entityId: token } });
}

describe("browser auth session fencing", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;
  let client: Client;

  beforeEach(async () => {
    jest.resetModules();
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    client = process.env.AUTH_CLIENT_TEST_SOURCE
      ? jest.requireActual<Client>(process.env.AUTH_CLIENT_TEST_SOURCE)
      : await import("@/lib/api-client");
  });
  afterEach(() => { global.fetch = originalFetch; });

  it("rejects a refresh completed after clearing the session", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const pending = client.refreshAccessToken();
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    client.clearAccessToken();
    old.resolve(session("A"));
    await rejected;
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
    fetchMock.mockResolvedValueOnce(session("B")).mockResolvedValueOnce(response({ tenant: "B" }));
    await expect(client.apiRequest("/api/v1/catalog/releases")).resolves.toEqual({ tenant: "B" });
    expect(fetchMock.mock.calls[2]![1].headers.get("Authorization")).toBe("Bearer B");
  });

  it.each(["success", "failure"])("an old refresh %s cannot replace/clear the new login token", async result => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(session("B"));
    const pending = client.refreshAccessToken();
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    await client.startAuthSession("/api/v1/auth/login", { email: "B" });
    if (result === "success") old.resolve(session("A")); else old.reject(new Error("Old network failure"));
    await rejected;
    fetchMock.mockResolvedValueOnce(response({ tenant: "B" }));
    await expect(client.apiRequest("/api/v1/catalog/releases")).resolves.toEqual({ tenant: "B" });
    expect(fetchMock.mock.calls[2]![0]).toBe("/api/v1/catalog/releases");
    expect(fetchMock.mock.calls[2]![1].headers.get("Authorization")).toBe("Bearer B");
  });

  it("old refresh cleanup cannot clear the newer single-flight request", async () => {
    const old = deferred<Response>();
    const next = deferred<Response>();
    fetchMock.mockImplementation((url: string) => url.endsWith("/refresh")
      ? fetchMock.mock.calls.filter(([path]) => String(path).endsWith("/refresh")).length === 1 ? old.promise : next.promise
      : Promise.resolve(response({ tenant: "B" })));
    const pending = client.refreshAccessToken();
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    client.clearAccessToken();
    const firstRequest = client.apiRequest("/api/v1/catalog/releases");
    old.resolve(session("A"));
    await rejected;
    const secondRequest = client.apiRequest("/api/v1/notifications");
    next.resolve(session("B"));
    await expect(Promise.all([firstRequest, secondRequest])).resolves.toEqual([{ tenant: "B" }, { tenant: "B" }]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/refresh"))).toHaveLength(2);
  });

  it("a newer login supersedes the pending older login", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise).mockResolvedValueOnce(session("B"));
    const pending = client.startAuthSession("/api/v1/auth/login", { email: "A" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    await client.startAuthSession("/api/v1/auth/login", { email: "B" });
    old.resolve(session("A"));
    await rejected;
    expect((fetchMock.mock.calls[0]![1] as RequestInit).signal?.aborted).toBe(true);
  });

  it("clearing a pending login prevents late session resurrection", async () => {
    const old = deferred<Response>();
    fetchMock.mockReturnValueOnce(old.promise);
    const pending = client.startAuthSession("/api/v1/auth/2fa/verify", { code: "000000" });
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    client.clearAccessToken();
    old.resolve(session("A"));
    await rejected;
  });

  it("discards old-account response data after switching login", async () => {
    const old = deferred<Response>();
    fetchMock.mockResolvedValueOnce(session("A")).mockReturnValueOnce(old.promise).mockResolvedValueOnce(session("B"));
    await client.startAuthSession("/api/v1/auth/login", { email: "A" });
    const pending = client.apiRequest("/api/v1/catalog/releases");
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    await client.startAuthSession("/api/v1/auth/login", { email: "B" });
    old.resolve(response({ secretTenant: "A" }));
    await rejected;
  });

  it("does not replay an old-account mutation with the new-account token after 401", async () => {
    const old = deferred<Response>();
    fetchMock.mockResolvedValueOnce(session("A")).mockReturnValueOnce(old.promise).mockResolvedValueOnce(session("B"));
    await client.startAuthSession("/api/v1/auth/login", { email: "A" });
    const pending = client.apiRequest("/api/v1/catalog/releases", { method: "POST", body: '{"title":"A draft"}' });
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    await client.startAuthSession("/api/v1/auth/login", { email: "B" });
    old.resolve(response(null, 401));
    await rejected;
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/releases"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/refresh"))).toHaveLength(0);
  });

  it("retains the normal same-session 401 refresh and retry", async () => {
    fetchMock.mockResolvedValueOnce(session("A"))
      .mockResolvedValueOnce(response(null, 401))
      .mockResolvedValueOnce(session("A-new"))
      .mockResolvedValueOnce(response({ tenant: "A" }));
    await client.startAuthSession("/api/v1/auth/login", {});
    await expect(client.apiRequest("/api/v1/catalog/releases")).resolves.toEqual({ tenant: "A" });
    expect(fetchMock.mock.calls[1]![1].headers.get("Authorization")).toBe("Bearer A");
    expect(fetchMock.mock.calls[3]![1].headers.get("Authorization")).toBe("Bearer A-new");
  });

  it("discards data when login changes while the 401 retry is in flight", async () => {
    const retry = deferred<Response>();
    const retrySeen = deferred<void>();
    let catalogCalls = 0;
    fetchMock.mockImplementation((url: string, init: RequestInit) => {
      if (url.endsWith("/login")) return Promise.resolve(session(JSON.parse(init.body as string).email));
      if (url.endsWith("/refresh")) return Promise.resolve(session("A-new"));
      if (++catalogCalls === 1) return Promise.resolve(response(null, 401));
      retrySeen.resolve(undefined);
      return retry.promise;
    });
    await client.startAuthSession("/api/v1/auth/login", { email: "A" });
    const pending = client.apiRequest("/api/v1/catalog/releases");
    const rejected = expect(pending).rejects.toMatchObject({ code: "AUTH_SESSION_CHANGED" });
    await retrySeen.promise;
    await client.startAuthSession("/api/v1/auth/login", { email: "B" });
    retry.resolve(response({ secretTenant: "A" }));
    await rejected;
  });

  it("preserves the 2FA challenge error and subsequent verification flow", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      data: null, error: { code: "TWO_FACTOR_REQUIRED", message: "Verify", details: { challengeId: "challenge", methods: ["app"] } }, requestId: "2fa",
    }), { status: 401 })).mockResolvedValueOnce(session("B"));
    await expect(client.startAuthSession("/api/v1/auth/login", {})).rejects.toMatchObject({ status: 401, code: "TWO_FACTOR_REQUIRED", details: { challengeId: "challenge", methods: ["app"] } });
    await expect(client.startAuthSession("/api/v1/auth/2fa/verify", { challengeId: "challenge", code: "000000" })).resolves.toMatchObject({ accessToken: "B" });
  });

  it("requests during login await that session instead of refreshing an old cookie", async () => {
    const login = deferred<Response>();
    fetchMock.mockImplementation((url: string) => url.endsWith("/login") ? login.promise : Promise.resolve(response({ tenant: "B" })));
    const pendingLogin = client.startAuthSession("/api/v1/auth/login", {});
    const pendingData = client.apiRequest("/api/v1/catalog/releases");
    login.resolve(session("B"));
    await pendingLogin;
    await expect(pendingData).resolves.toEqual({ tenant: "B" });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/refresh"))).toHaveLength(0);
    expect(fetchMock.mock.calls[1]![1].headers.get("Authorization")).toBe("Bearer B");
  });
});
