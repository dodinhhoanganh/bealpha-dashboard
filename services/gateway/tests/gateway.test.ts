import {
  exportPKCS8,
  exportSPKI,
  generateKeyPair,
  jwtVerify,
  SignJWT
} from "jose";
import Fastify from "fastify";
import type { Redis } from "ioredis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { buildGateway } from "../src/app.js";
import { registryValuesMatch } from "../src/auth.js";
import { loadGatewayConfig, type GatewayConfig } from "../src/config.js";
import type { FetchLike } from "../src/proxy.js";
import { buildRateLimitKey } from "../src/rate-limit.js";
import { registerHealthRoutes } from "../src/health.js";
import { TenantDomainResolver } from "../src/tenant-domain.js";

const accessKeys = await generateKeyPair("ES256", { extractable: true });
const internalKeys = await generateKeyPair("ES256", { extractable: true });
const accessPublicKeyPem = await exportSPKI(accessKeys.publicKey);
const internalPrivateKeyPem = await exportPKCS8(internalKeys.privateKey);

const config: GatewayConfig = {
  nodeEnv: "test",
  host: "127.0.0.1",
  port: 4000,
  logLevel: "silent",
  trustProxyHops: 0,
  bodyLimitBytes: 256,
  upstreamTimeoutMs: 100,
  rateLimitMax: 1_000,
  rateLimitWindowMs: 60_000,
  platformHostnames: ["localhost", "127.0.0.1"],
  tenantDomainCacheTtlSeconds: 30,
  corsOrigins: ["http://localhost:3000"],
  accessTokenPublicKeyPem: accessPublicKeyPem,
  accessTokenIssuer: "bealpha-identity",
  accessTokenAudience: "bealpha-api",
  internalContextPrivateKeyPem: internalPrivateKeyPem,
  internalContextIssuer: "bealpha-gateway",
  internalContextAudience: "bealpha-services",
  internalContextTtlSeconds: 30,
  serviceUrls: {
    identity: "http://identity.test",
    catalog: "http://catalog.test",
    media: "http://media.test",
    distribution: "http://distribution.test",
    finance: "http://finance.test",
    notifications: "http://notifications.test",
    analytics: "http://analytics.test",
    audit: "http://audit.test"
  }
};

const apps: Awaited<ReturnType<typeof buildGateway>>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function accessToken(overrides: Record<string, unknown> = {}) {
  return new SignJWT({
    tenantId: "tenant-1",
    sessionId: "session-1",
    entityId: "entity-1",
    entityType: "ORGANIZATION",
    entityRole: "OWNER",
    entityPath: "bealpha.group.label",
    roles: ["ORGANIZATION"],
    staffRoles: ["admin"],
    authzVersion: 3,
    ...overrides
  })
    .setProtectedHeader({ alg: "ES256" })
    .setSubject("user-1")
    .setIssuer(config.accessTokenIssuer)
    .setAudience(config.accessTokenAudience)
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(accessKeys.privateKey);
}

async function createApp(
  fetcher?: FetchLike,
  configOverride: Partial<GatewayConfig> = {}
) {
  const app = await buildGateway({
    config: { ...config, ...configOverride },
    logger: false,
    ...(fetcher === undefined ? {} : { fetcher })
  });
  apps.push(app);
  return app;
}

function successResponse(requestId = "00000000-0000-4000-8000-000000000000") {
  return new Response(
    JSON.stringify({ data: { ok: true }, error: null, requestId }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

function pemBody(pem: string): string {
  return pem.replace(/-----[^-]+-----|\s/g, "");
}

describe("Gateway configuration", () => {
  const productionEnv = {
    NODE_ENV: "production",
    CORS_ORIGINS: "https://dashboard.example.com",
    REDIS_URL: "redis://:password@redis:6379/0",
    GATEWAY_PLATFORM_HOSTNAMES: "dashboard.example.com",
    GATEWAY_ACCESS_TOKEN_PUBLIC_KEY_B64: pemBody(accessPublicKeyPem),
    GATEWAY_INTERNAL_CONTEXT_PRIVATE_KEY_B64: pemBody(internalPrivateKeyPem)
  };

  it("loads separate ES256 verification and signing keys", () => {
    const loaded = loadGatewayConfig(productionEnv);

    expect(loaded.accessTokenPublicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(loaded.internalContextPrivateKeyPem).toContain("BEGIN PRIVATE KEY");
  });

  it("rejects an upstream origin containing a path", () => {
    expect(() =>
      loadGatewayConfig({
        ...productionEnv,
        CATALOG_SERVICE_URL: "http://catalog:4102/attacker-controlled"
      })
    ).toThrow(/origin without credentials or path/);
  });
});

describe("Gateway identity registry", () => {
  it("requires both active session ownership and current authz version", () => {
    expect(registryValuesMatch("user-1", 3, ["user-1", "3"])).toBe(true);
    expect(registryValuesMatch("user-1", 3, [null, "3"])).toBe(false);
    expect(registryValuesMatch("user-1", 3, ["user-1", "4"])).toBe(false);
    expect(registryValuesMatch("user-1", 3, ["user-2", "3"])).toBe(false);
  });
});

describe("Gateway authentication and proxy security", () => {
  it("rejects a signed access token without expiration before proxying", async () => {
    const { payload } = await jwtVerify(await accessToken(), accessKeys.publicKey);
    delete payload.exp;
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: "ES256" })
      .sign(accessKeys.privateKey);
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/releases",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a signed profile token whose root entity path is a UUID", async () => {
    const rootEntityId = "e0000000-0000-0000-0000-000000000001";
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher);
    const token = await accessToken({
      tenantId: undefined,
      entityId: rootEntityId,
      entityType: "SUPER_ADMIN",
      entityPath: rootEntityId,
      roles: ["SUPER_ADMIN"]
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/auth/profile",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("binds an authenticated tenant token to the exact verified custom Host", async () => {
    const tenantId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn<FetchLike>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/internal/tenant-domains/resolve")) {
        return new Response(JSON.stringify({ data: { tenantId, hostname: "label.example.test", version: 2 }, error: null, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return successResponse();
    });
    const app = await createApp(fetcher);
    const token = await accessToken({ tenantId, entityId: tenantId });
    const response = await app.inject({ method: "GET", url: "/api/v1/catalog/releases", headers: { host: "label.example.test", authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("binds a nested organization token through its root tenant", async () => {
    const tenantId = "33333333-3333-4333-8333-333333333333";
    const nestedOrganizationId = "55555555-5555-4555-8555-555555555555";
    const fetcher = vi.fn<FetchLike>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/internal/tenant-domains/resolve")) {
        return new Response(JSON.stringify({
          data: { tenantId, hostname: "label.example.test", version: 1 },
          error: null,
          requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return successResponse();
    });
    const app = await createApp(fetcher);
    const token = await accessToken({
      tenantId,
      entityId: nestedOrganizationId,
      entityPath: "bealpha.group.label.department",
      entityType: "ORGANIZATION"
    });
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/releases",
      headers: { host: "label.example.test", authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a valid token presented on another tenant's verified Host", async () => {
    const domainTenantId = "33333333-3333-4333-8333-333333333333";
    const tokenTenantId = "44444444-4444-4444-8444-444444444444";
    const fetcher = vi.fn<FetchLike>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/internal/tenant-domains/resolve")) {
        return new Response(JSON.stringify({ data: { tenantId: domainTenantId, hostname: "label.example.test", version: 1 }, error: null, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return successResponse();
    });
    const app = await createApp(fetcher);
    const token = await accessToken({ tenantId: tokenTenantId, entityId: tokenTenantId });
    const response = await app.inject({ method: "GET", url: "/api/v1/catalog/releases", headers: { host: "label.example.test", authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(403);
    expect(response.json().error.code).toBe("TENANT_DOMAIN_MISMATCH");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("fails closed for an unverified or spoofed Host", async () => {
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({ data: null, error: { code: "NOT_FOUND", message: "Not found" } }), { status: 404, headers: { "content-type": "application/json" } }));
    const app = await createApp(fetcher);
    const token = await accessToken();
    const response = await app.inject({ method: "GET", url: "/api/v1/catalog/releases", headers: { host: "spoofed.example.test", authorization: `Bearer ${token}` } });

    expect(response.statusCode).toBe(421);
    expect(response.json().error.code).toBe("UNRECOGNIZED_TENANT_DOMAIN");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("allows CORS only for an exact HTTPS origin on the same verified custom Host", async () => {
    const tenantId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify({
      data: { tenantId, hostname: "label.example.test", version: 1 }, error: null, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    }), { status: 200, headers: { "content-type": "application/json" } }));
    const app = await createApp(fetcher);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        host: "label.example.test",
        origin: "https://label.example.test",
        "access-control-request-method": "POST"
      }
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe("https://label.example.test");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not reflect a verified-looking Origin that differs from the request Host", async () => {
    const fetcher = vi.fn<FetchLike>();
    const app = await createApp(fetcher);
    const response = await app.inject({
      method: "OPTIONS",
      url: "/api/v1/auth/login",
      headers: {
        host: "tenant-b.example.test",
        origin: "https://tenant-a.example.test",
        "access-control-request-method": "POST"
      }
    });

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("isolates cached domain mappings by normalized hostname", async () => {
    const values = new Map<string, string>();
    const cache = {
      get: vi.fn(async (key: string) => values.get(key) ?? null),
      set: vi.fn(async (key: string, value: string) => { values.set(key, value); return "OK"; }),
      del: vi.fn(async (key: string) => values.delete(key) ? 1 : 0)
    };
    const fetcher = vi.fn<FetchLike>(async input => {
      const url = new URL(String(input));
      const hostname = url.searchParams.get("hostname")!;
      const tenantId = hostname.startsWith("a.") ? "33333333-3333-4333-8333-333333333333" : "44444444-4444-4444-8444-444444444444";
      return new Response(JSON.stringify({ data: { tenantId, hostname, version: 1 }, error: null, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }), { status: 200, headers: { "content-type": "application/json" } });
    });
    const resolver = new TenantDomainResolver(config, async () => "signed-context", fetcher, cache as never);

    const first = await resolver.resolve("A.example.test.", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    const second = await resolver.resolve("a.example.test", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    const other = await resolver.resolve("b.example.test", "cccccccc-cccc-4ccc-8ccc-cccccccccccc");

    expect(first.tenantId).toBe(second.tenantId);
    expect(other.tenantId).not.toBe(first.tenantId);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(values.size).toBe(2);
  });

  it("rejects an invalid access token", async () => {
    const fetcher = vi.fn<FetchLike>();
    const app = await createApp(fetcher);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/releases",
      headers: { authorization: "Bearer invalid.token.value" }
    });

    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("UNAUTHENTICATED");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("strips forged scope headers and signs verified context", async () => {
    let forwardedHeaders: Headers | undefined;
    const fetcher: FetchLike = async (_input, init) => {
      forwardedHeaders = new Headers(init?.headers);
      return successResponse();
    };
    const app = await createApp(fetcher);
    const token = await accessToken();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/releases",
      headers: {
        authorization: `Bearer ${token}`,
        "x-bealpha-context": "forged",
        "x-tenant-id": "evil-tenant",
        "x-user-id": "evil-user"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(forwardedHeaders?.get("authorization")).toBeNull();
    expect(forwardedHeaders?.get("x-tenant-id")).toBeNull();
    expect(forwardedHeaders?.get("x-user-id")).toBeNull();

    const signedContext = forwardedHeaders?.get("x-bealpha-context");
    expect(signedContext).toBeTruthy();
    expect(signedContext).not.toBe("forged");
    const { payload, protectedHeader } = await jwtVerify(
      signedContext!,
      internalKeys.publicKey,
      {
        issuer: config.internalContextIssuer,
        audience: config.internalContextAudience
      }
    );
    expect(payload.actorId).toBe("user-1");
    expect(payload.sessionId).toBe("session-1");
    expect(payload.entityId).toBe("entity-1");
    expect(payload.tenantId).toBe("tenant-1");
    expect(payload.entityPath).toBe("bealpha.group.label");
    expect(payload.authzVersion).toBe(3);
    expect(protectedHeader.alg).toBe("ES256");
  });

  it("allows only explicit public auth routes without a token", async () => {
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email: "user@example.com", password: "password" }
    });

    expect(response.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("allows the public tenant-brand bootstrap without a token", async () => {
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher);

    const response = await app.inject({ method: "GET", url: "/api/v1/catalog/public-tenant-brand" });

    expect(response.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(new URL(fetcher.mock.calls[0]![0] as string).pathname).toBe("/api/v1/catalog/public-tenant-brand");
  });

  it("allows password-reset endpoints without an access token", async () => {
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher);

    const requestReset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-reset/request",
      payload: { email: "user@example.com" }
    });
    const confirmReset = await app.inject({
      method: "POST",
      url: "/api/v1/auth/password-reset/confirm",
      payload: { token: "a".repeat(43), newPassword: "Strong-password-123!" }
    });

    expect(requestReset.statusCode).toBe(200);
    expect(confirmReset.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("allows invitation validation and acceptance without a session", async () => {
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher);

    const validate = await app.inject({
      method: "POST",
      url: "/api/v1/auth/invitations/validate",
      payload: { token: "a".repeat(43) }
    });
    const accept = await app.inject({
      method: "POST",
      url: "/api/v1/auth/invitations/accept",
      payload: { token: "a".repeat(43), password: "Strong-password-123!" }
    });

    expect(validate.statusCode).toBe(200);
    expect(accept.statusCode).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("does not proxy an unknown service segment", async () => {
    const fetcher = vi.fn<FetchLike>();
    const app = await createApp(fetcher);
    const token = await accessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/http:%2F%2Fattacker.example/",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(404);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    "/api/v1/identity/internal/entity-snapshots",
    "/api/v1/catalog/releases/11111111-1111-4111-8111-111111111111/distribution-snapshot",
    "/api/v1/catalog/tracks/22222222-2222-4222-8222-222222222222/analytics-scope",
  ])("does not expose internal service route %s", async (url) => {
    const fetcher = vi.fn<FetchLike>();
    const app = await createApp(fetcher);
    const token = await accessToken();

    const response = await app.inject({
      method: url.includes("entity-snapshots") ? "PUT" : "GET",
      url,
      headers: { authorization: `Bearer ${token}` },
      ...(url.includes("entity-snapshots") ? { payload: {} } : {}),
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Gateway resource controls", () => {
  it("returns 503 readiness when Redis is unavailable", async () => {
    const app = Fastify({ logger: false });
    registerHealthRoutes(app, { ping: vi.fn().mockRejectedValue(new Error("Redis down")) } as unknown as Redis);
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("UPSTREAM_UNAVAILABLE");
    await app.close();
  });
  it("rejects oversized request bodies with a stable envelope", async () => {
    const fetcher = vi.fn<FetchLike>();
    const app = await createApp(fetcher);
    const token = await accessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/releases",
      headers: { authorization: `Bearer ${token}` },
      payload: { value: "x".repeat(512) }
    });

    expect(response.statusCode).toBe(413);
    expect(response.json().error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a stable 503 when an upstream is unavailable", async () => {
    const app = await createApp(async () => {
      throw new TypeError("fetch failed");
    });
    const token = await accessToken();

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/releases",
      headers: { authorization: `Bearer ${token}` }
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("UPSTREAM_UNAVAILABLE");
  });

  it("rejects raw media at the Gateway", async () => {
    const fetcher = vi.fn<FetchLike>();
    const app = await createApp(fetcher);
    const token = await accessToken();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/media/upload",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "audio/wav"
      },
      payload: Buffer.from("RIFF")
    });

    expect(response.statusCode).toBe(415);
    expect(response.json().error.code).toBe("VALIDATION_ERROR");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("combines IP, actor, and route bucket without storing raw identifiers", () => {
    const first = buildRateLimitKey("127.0.0.1", "user-1", "catalog");
    const otherUser = buildRateLimitKey("127.0.0.1", "user-2", "catalog");
    const otherIp = buildRateLimitKey("127.0.0.2", "user-1", "catalog");

    expect(first).not.toBe(otherUser);
    expect(first).not.toBe(otherIp);
    expect(first).not.toContain("user-1");
    expect(first).toMatch(/^gateway:catalog:[a-f0-9]{32}$/);
  });

  it("returns 429 after the distributed rate quota is exhausted", async () => {
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher, { rateLimitMax: 2 });
    const token = await accessToken();
    const request = {
      method: "GET" as const,
      url: "/api/v1/catalog/releases",
      headers: { authorization: `Bearer ${token}` }
    };

    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(200);
    const limited = await app.inject(request);

    expect(limited.statusCode).toBe(429);
    expect(limited.json().error.code).toBe("RATE_LIMITED");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("V15 handles 100 concurrent authenticated catalog reads", async () => {
    const fetcher = vi.fn<FetchLike>(async () => successResponse());
    const app = await createApp(fetcher, { rateLimitMax: 200 });
    const token = await accessToken();
    const responses = await Promise.all(Array.from({ length: 100 }, () => app.inject({
      method: "GET",
      url: "/api/v1/catalog/releases",
      headers: { authorization: `Bearer ${token}` }
    })));
    expect(responses.every(response => response.statusCode === 200)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(100);
    await app.close();
  });
});
