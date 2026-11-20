describe("browser API client", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("refreshes once, adds bearer token, and unwraps envelope", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { accessToken: "token-1", expiresIn: 900, user: {} },
        error: null,
        requestId: "refresh-id",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: { ok: true }, error: null, requestId: "request-id",
      }), { status: 200 }));

    const { apiRequest } = await import("@/lib/api-client");
    await expect(apiRequest<{ ok: boolean }>("/api/v1/catalog/releases")).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/v1/catalog/releases", expect.objectContaining({
      credentials: "include",
      headers: expect.any(Headers),
    }));
    expect((fetchMock.mock.calls[1][1].headers as Headers).get("Authorization")).toBe("Bearer token-1");
  });

  it("shares one refresh across concurrent requests", async () => {
    const fetchMock = global.fetch as jest.Mock;
    fetchMock.mockImplementation((url: string) => {
      const data = url.endsWith("/refresh")
        ? { accessToken: "shared-token", expiresIn: 900, user: {} }
        : { ok: true };
      return Promise.resolve(new Response(JSON.stringify({ data, error: null, requestId: "id" }), { status: 200 }));
    });

    const { apiRequest } = await import("@/lib/api-client");
    await Promise.all([
      apiRequest("/api/v1/catalog/releases"),
      apiRequest("/api/v1/notifications"),
    ]);
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/refresh"))).toHaveLength(1);
  });

  it("derives member permissions without administrative mutations", async () => {
    const { permissionsForIdentity } = await import("@/lib/api-client");
    const permissions = permissionsForIdentity("ORGANIZATION", "MEMBER", []);
    expect(permissions).toContain("release.read");
    expect(permissions).not.toContain("release.approve");
    expect(permissions).not.toContain("entity.invite");
  });

  it("gives sub-accounts read-only access to isolated royalty statements", async () => {
    const { permissionsForIdentity } = await import("@/lib/api-client");
    const permissions = permissionsForIdentity("SUB_ACCOUNT", "OWNER", []);
    expect(permissions).toContain("finance.view");
    expect(permissions).not.toContain("finance.export");
    expect(permissions).not.toContain("finance.payout");
  });

  it("keeps entity accountants finance-focused and unable to mutate catalog or roles", async () => {
    const { permissionsForIdentity } = await import("@/lib/api-client");
    const permissions = permissionsForIdentity("ORGANIZATION", "ACCOUNTANT", []);

    expect(permissions).toEqual(expect.arrayContaining([
      "release.read",
      "artist.read",
      "label.read",
      "finance.view",
      "finance.export",
      "analytics.view",
      "analytics.export",
    ]));
    for (const permission of [
      "release.create",
      "release.update",
      "release.delete",
      "release.submit",
      "release.approve",
      "entity.create",
      "entity.update",
      "entity.invite",
      "user.create",
      "user.update",
      "finance.payout",
    ]) {
      expect(permissions).not.toContain(permission);
    }
  });

  it("does not expose payout controls through the platform finance staff role", async () => {
    const { permissionsForIdentity } = await import("@/lib/api-client");
    const permissions = permissionsForIdentity("SYSTEM_ADMIN", "MEMBER", ["finance"]);

    expect(permissions).toEqual(expect.arrayContaining(["finance.view", "finance.export"]));
    expect(permissions).not.toContain("finance.payout");
    expect(permissions).not.toContain("release.approve");
  });
});
