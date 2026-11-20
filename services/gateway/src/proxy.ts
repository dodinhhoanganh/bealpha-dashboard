import { Readable } from "node:stream";

import {
  INTERNAL_CONTEXT_HEADER,
  REQUEST_ID_HEADER
} from "@bealpha/contracts";
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest
} from "fastify";

import type { InternalContextSigner } from "./auth.js";
import type { GatewayConfig, ServiceName } from "./config.js";
import { sendFailure } from "./response.js";

export type FetchLike = (
  input: string | URL,
  init?: RequestInit
) => Promise<Response>;

const ROUTE_SERVICE: Readonly<Record<string, ServiceName>> = {
  auth: "identity",
  identity: "identity",
  catalog: "catalog",
  media: "media",
  distribution: "distribution",
  finance: "finance",
  notifications: "notifications",
  analytics: "analytics",
  audit: "audit"
};

const INTERNAL_ONLY_PATHS = new Set([
  "/api/v1/identity/internal/entity-snapshots",
  "/api/v1/catalog/internal/tenant-domains/resolve",
]);

const INTERNAL_ONLY_PATTERNS = [
  /^\/api\/v1\/catalog\/releases\/[^/]+\/distribution-snapshot$/,
  /^\/api\/v1\/catalog\/tracks\/[^/]+\/analytics-scope$/,
] as const;

function isInternalOnlyPath(pathname: string): boolean {
  return INTERNAL_ONLY_PATHS.has(pathname) ||
    INTERNAL_ONLY_PATTERNS.some(pattern => pattern.test(pathname));
}

const REQUEST_HEADER_BLOCKLIST = new Set([
  "authorization",
  "connection",
  "content-length",
  "expect",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-entity-path",
  "x-role",
  "x-tenant-id",
  "x-user-id"
]);

const RESPONSE_HEADER_BLOCKLIST = new Set([
  "connection",
  "content-encoding",
  "content-length",
  "keep-alive",
  "server",
  "transfer-encoding",
  "upgrade",
  "x-powered-by",
  REQUEST_ID_HEADER
]);

function requestPath(request: FastifyRequest): URL {
  return new URL(request.raw.url ?? "/", "http://gateway.invalid");
}

function resolveService(request: FastifyRequest): ServiceName | undefined {
  const segment = requestPath(request).pathname.split("/")[3];
  return segment === undefined ? undefined : ROUTE_SERVICE[segment];
}

function isBlockedRequestHeader(name: string): boolean {
  return (
    REQUEST_HEADER_BLOCKLIST.has(name) ||
    name.startsWith("x-bealpha-") ||
    name.startsWith("x-internal-") ||
    name.startsWith("x-forwarded-")
  );
}

async function upstreamHeaders(
  request: FastifyRequest,
  signInternalContext: InternalContextSigner
): Promise<Headers> {
  const headers = new Headers();
  for (const [rawName, value] of Object.entries(request.headers)) {
    const name = rawName.toLowerCase();
    if (value === undefined || isBlockedRequestHeader(name)) {
      continue;
    }
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }

  const context = request.authContext ?? {
    v: 1 as const,
    requestId: request.id,
    authType: "anonymous" as const,
    roles: [],
    staffRoles: []
  };
  headers.set(INTERNAL_CONTEXT_HEADER, await signInternalContext(context));
  headers.set(REQUEST_ID_HEADER, request.id);
  headers.set("x-forwarded-for", request.ip);
  headers.set("x-forwarded-host", request.hostname);
  headers.set("x-forwarded-proto", request.protocol);
  headers.delete("accept-encoding");
  return headers;
}

function requestBody(
  request: FastifyRequest,
  headers: Headers
): BodyInit | undefined {
  if (["GET", "HEAD"].includes(request.method) || request.body === undefined) {
    return undefined;
  }
  if (typeof request.body === "string" || request.body instanceof Uint8Array) {
    return request.body as unknown as BodyInit;
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(request.body);
}

function forwardResponseHeaders(reply: FastifyReply, response: Response): void {
  response.headers.forEach((value, rawName) => {
    const name = rawName.toLowerCase();
    if (name !== "set-cookie" && !RESPONSE_HEADER_BLOCKLIST.has(name)) {
      reply.header(name, value);
    }
  });

  const getSetCookie = (
    response.headers as Headers & { getSetCookie?: () => string[] }
  ).getSetCookie;
  const cookies = getSetCookie?.call(response.headers) ?? [];
  if (cookies.length > 0) {
    reply.header("set-cookie", cookies);
  }
}

function rawMediaContentType(request: FastifyRequest): boolean {
  const contentType = request.headers["content-type"]?.toLowerCase() ?? "";
  return (
    contentType.startsWith("multipart/form-data") ||
    contentType.startsWith("application/octet-stream") ||
    contentType.startsWith("audio/") ||
    contentType.startsWith("video/")
  );
}

export function registerProxyRoutes(
  app: FastifyInstance,
  config: GatewayConfig,
  signInternalContext: InternalContextSigner,
  fetcher: FetchLike = fetch
): void {
  app.route({
    method: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"],
    url: "/api/v1/*",
    handler: async (request, reply) => {
      if (isInternalOnlyPath(requestPath(request).pathname)) {
        return sendFailure(
          reply,
          404,
          request.id,
          "NOT_FOUND",
          "API route not found"
        );
      }
      const service = resolveService(request);
      if (!service) {
        return sendFailure(
          reply,
          404,
          request.id,
          "NOT_FOUND",
          "API route not found"
        );
      }

      if (rawMediaContentType(request)) {
        return sendFailure(
          reply,
          415,
          request.id,
          "VALIDATION_ERROR",
          "Raw media must use a signed media data-plane URL"
        );
      }

      const path = requestPath(request);
      const target = new URL(
        `${path.pathname}${path.search}`,
        config.serviceUrls[service]
      );
      const headers = await upstreamHeaders(request, signInternalContext);
      const body = requestBody(request, headers);
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        config.upstreamTimeoutMs
      );
      timeout.unref();

      try {
        const response = await fetcher(target, {
          method: request.method,
          headers,
          ...(body === undefined ? {} : { body }),
          redirect: "manual",
          signal: controller.signal
        });

        reply.code(response.status);
        forwardResponseHeaders(reply, response);
        reply.header(REQUEST_ID_HEADER, request.id);

        if (
          !response.body ||
          request.method === "HEAD" ||
          [204, 304].includes(response.status)
        ) {
          clearTimeout(timeout);
          return reply.send();
        }

        const stream = Readable.fromWeb(response.body as never);
        const clear = () => clearTimeout(timeout);
        stream.once("end", clear);
        stream.once("close", clear);
        stream.once("error", clear);
        return reply.send(stream);
      } catch (error) {
        clearTimeout(timeout);
        request.log.warn({ err: error, service }, "Upstream request failed");
        return sendFailure(
          reply,
          503,
          request.id,
          "UPSTREAM_UNAVAILABLE",
          "Upstream service unavailable"
        );
      }
    }
  });
}
