import {
  INTERNAL_CONTEXT_HEADER,
  REQUEST_ID_HEADER,
  resolvedTenantDomainSchema,
  tenantDomainCacheKey,
  type ApiErrorCode,
  type ResolvedTenantDomain
} from "@bealpha/contracts";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";

import type { InternalContextSigner } from "./auth.js";
import type { GatewayConfig } from "./config.js";
import type { FetchLike } from "./proxy.js";
import { sendFailure } from "./response.js";

type DomainCache = Pick<Redis, "get" | "set" | "del">;

export function normalizeRequestHostname(input: string): string {
  const raw = input.trim();
  if (!raw || raw.length > 255 || /[\s/@?#]/.test(raw)) throw new Error("Invalid Host header");
  const hostname = new URL(`http://${raw}`).hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname.length > 253) throw new Error("Invalid Host header");
  return hostname;
}

export class TenantDomainResolutionError extends Error {
  constructor(readonly statusCode: number, readonly code: ApiErrorCode, message: string) {
    super(message);
  }
}

export class TenantDomainResolver {
  constructor(
    private readonly config: GatewayConfig,
    private readonly signInternalContext: InternalContextSigner,
    private readonly fetcher: FetchLike,
    private readonly cache?: DomainCache
  ) {}

  async resolve(hostnameInput: string, requestId: string): Promise<ResolvedTenantDomain> {
    const hostname = normalizeRequestHostname(hostnameInput);
    const key = tenantDomainCacheKey(hostname);
    if (this.cache) {
      try {
        const cached = await this.cache.get(key);
        if (cached) {
          const parsed = resolvedTenantDomainSchema.safeParse(JSON.parse(cached));
          if (parsed.success && parsed.data.hostname === hostname) return parsed.data;
          await this.cache.del(key);
        }
      } catch {
        // A cache failure must never become an authorization bypass. Resolve from Catalog.
      }
    }

    const context = {
      v: 1 as const,
      requestId,
      authType: "service" as const,
      serviceId: "gateway",
      roles: [],
      staffRoles: []
    };
    let response: Response;
    try {
      const target = new URL("/api/v1/catalog/internal/tenant-domains/resolve", this.config.serviceUrls.catalog);
      target.searchParams.set("hostname", hostname);
      response = await this.fetcher(target, {
        method: "GET",
        headers: {
          [INTERNAL_CONTEXT_HEADER]: await this.signInternalContext(context),
          [REQUEST_ID_HEADER]: requestId
        },
        signal: AbortSignal.timeout(this.config.upstreamTimeoutMs)
      });
    } catch {
      throw new TenantDomainResolutionError(503, "UPSTREAM_UNAVAILABLE", "Tenant domain registry unavailable");
    }
    if (response.status === 404) throw new TenantDomainResolutionError(421, "UNRECOGNIZED_TENANT_DOMAIN", "Tenant domain is not verified");
    if (!response.ok) throw new TenantDomainResolutionError(503, "UPSTREAM_UNAVAILABLE", "Tenant domain registry unavailable");
    let payload: unknown;
    try { payload = await response.json(); }
    catch { throw new TenantDomainResolutionError(503, "UPSTREAM_UNAVAILABLE", "Tenant domain registry returned an invalid response"); }
    const parsed = resolvedTenantDomainSchema.safeParse((payload as { data?: unknown }).data);
    if (!parsed.success || parsed.data.hostname !== hostname) {
      throw new TenantDomainResolutionError(503, "UPSTREAM_UNAVAILABLE", "Tenant domain registry returned an invalid response");
    }
    if (this.cache) {
      try { await this.cache.set(key, JSON.stringify(parsed.data), "EX", this.config.tenantDomainCacheTtlSeconds); }
      catch { /* Safe: the verified registry result remains authoritative. */ }
    }
    return parsed.data;
  }
}

function tokenTenant(request: FastifyRequest): string | undefined {
  const context = request.authContext;
  if (context?.authType !== "user") return undefined;
  // A nested organization is identified by its own entityId, but its custom
  // hostname belongs to the root organization tenant carried in tenantId.
  // Keep the entityId fallback for old root-organization tokens that predate
  // the explicit tenant claim.
  return context.entityType === "ORGANIZATION"
    ? context.tenantId ?? context.entityId
    : context.tenantId;
}

export function registerTenantDomainBinding(
  app: FastifyInstance,
  config: GatewayConfig,
  signInternalContext: InternalContextSigner,
  fetcher: FetchLike = fetch,
  cache?: DomainCache,
  resolverOverride?: TenantDomainResolver
): void {
  const platformHostnames = new Set(config.platformHostnames.map(normalizeRequestHostname));
  const resolver = resolverOverride ?? new TenantDomainResolver(config, signInternalContext, fetcher, cache);
  app.addHook("preValidation", async (request, reply) => {
    const pathname = new URL(request.raw.url ?? "/", "http://gateway.invalid").pathname;
    if (!pathname.startsWith("/api/v1/") || request.method === "OPTIONS") return;
    let hostname: string;
    try { hostname = normalizeRequestHostname(request.hostname); }
    catch { return sendFailure(reply, 421, request.id, "UNRECOGNIZED_TENANT_DOMAIN", "Host header is invalid"); }
    if (platformHostnames.has(hostname)) return;
    try {
      const domain = await resolver.resolve(hostname, request.id);
      const tenantId = tokenTenant(request);
      if (tenantId !== undefined && tenantId !== domain.tenantId) {
        return sendFailure(reply, 403, request.id, "TENANT_DOMAIN_MISMATCH", "Access token does not belong to this tenant domain");
      }
    } catch (error) {
      if (error instanceof TenantDomainResolutionError) {
        return sendFailure(reply, error.statusCode, request.id, error.code, error.message);
      }
      return sendFailure(reply, 503, request.id, "UPSTREAM_UNAVAILABLE", "Tenant domain registry unavailable");
    }
  });
}
