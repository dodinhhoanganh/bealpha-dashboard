import { randomUUID } from "node:crypto";

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import Fastify, {
  type FastifyError,
  type FastifyInstance,
  type FastifyRequest
} from "fastify";

import {
  createInternalContextSigner,
  registerAuthentication
} from "./auth.js";
import type { GatewayConfig } from "./config.js";
import { registerHealthRoutes } from "./health.js";
import { registerProxyRoutes, type FetchLike } from "./proxy.js";
import { registerRateLimit } from "./rate-limit.js";
import { createGatewayRedis } from "./redis.js";
import { sendFailure } from "./response.js";
import { normalizeRequestHostname, registerTenantDomainBinding, TenantDomainResolver } from "./tenant-domain.js";

export interface BuildGatewayOptions {
  config: GatewayConfig;
  fetcher?: FetchLike;
  logger?: boolean;
}

export async function buildGateway(
  options: BuildGatewayOptions
): Promise<FastifyInstance> {
  const { config } = options;
  const logger = options.logger ?? config.nodeEnv !== "test";
  const redis = createGatewayRedis(config);
  const signInternalContext = await createInternalContextSigner(config);
  const tenantDomainResolver = new TenantDomainResolver(config, signInternalContext, options.fetcher ?? fetch, redis);
  const app = Fastify({
    logger: logger
      ? {
          level: config.logLevel,
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "req.headers.x-bealpha-context"
          ]
        }
      : false,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    trustProxy: config.trustProxyHops === 0 ? false : ["loopback", "linklocal", "uniquelocal"],
    bodyLimit: config.bodyLimitBytes,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 1_000,
    routerOptions: { maxParamLength: 256 },
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error"
  });
  app.server.maxHeadersCount = 100;
  if (redis) {
    app.addHook("onClose", async () => {
      redis.disconnect();
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error.statusCode === 429) {
      return sendFailure(
        reply,
        429,
        request.id,
        "RATE_LIMITED",
        "Request rate limit exceeded"
      );
    }
    if (error.statusCode === 413 || error.code === "FST_ERR_CTP_BODY_TOO_LARGE") {
      return sendFailure(
        reply,
        413,
        request.id,
        "PAYLOAD_TOO_LARGE",
        "Request body exceeds Gateway limit"
      );
    }
    if (
      error.statusCode === 400 ||
      error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE"
    ) {
      return sendFailure(
        reply,
        error.code === "FST_ERR_CTP_INVALID_MEDIA_TYPE" ? 415 : 400,
        request.id,
        "VALIDATION_ERROR",
        "Request payload is invalid"
      );
    }

    request.log.error({ err: error }, "Unhandled Gateway error");
    return sendFailure(
      reply,
      500,
      request.id,
      "INTERNAL_ERROR",
      "Internal Gateway error"
    );
  });

  app.setNotFoundHandler((request, reply) =>
    sendFailure(reply, 404, request.id, "NOT_FOUND", "Route not found")
  );

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" }
  });
  const corsBase = {
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-requested-with"],
    exposedHeaders: ["x-request-id"]
  } as const;
  await app.register(cors, {
    delegator: async (request: FastifyRequest) => {
      const origin = request.headers.origin;
      if (!origin) return { ...corsBase, origin: false };
      try {
        const parsed = new URL(origin);
        const requestHostname = normalizeRequestHostname(request.hostname);
        if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.origin !== origin || normalizeRequestHostname(parsed.host) !== requestHostname) {
          if (config.corsOrigins.includes(origin) && parsed.protocol === "http:" && normalizeRequestHostname(parsed.host) === requestHostname) {
            return { ...corsBase, origin };
          }
          return { ...corsBase, origin: false };
        }
        if (config.corsOrigins.includes(origin)) return { ...corsBase, origin };
        await tenantDomainResolver.resolve(requestHostname, request.id);
        return { ...corsBase, origin };
      } catch {
        return { ...corsBase, origin: false };
      }
    }
  });

  await registerAuthentication(app, config, redis);
  registerTenantDomainBinding(app, config, signInternalContext, options.fetcher, redis, tenantDomainResolver);
  await registerRateLimit(app, config, redis);
  registerHealthRoutes(app, redis);
  registerProxyRoutes(app, config, signInternalContext, options.fetcher);
  return app;
}
