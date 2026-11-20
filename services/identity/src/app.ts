import { randomUUID } from "node:crypto";

import { REQUEST_ID_HEADER } from "@bealpha/contracts";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { IdentityConfig } from "./config.js";
import { IdentityError } from "./errors.js";
import { IdentityService } from "./identity-service.js";
import { registerInternalAuthentication } from "./internal-auth.js";
import { registerIdentityRoutes } from "./routes.js";
import { sendFailure, successEnvelope } from "./response.js";
import type { SessionRegistry } from "./session-registry.js";

export interface BuildIdentityOptions {
  config: IdentityConfig;
  service: IdentityService;
  registry: SessionRegistry;
  databaseHealth?: () => Promise<boolean>;
  logger?: boolean;
}

export async function buildIdentityApp(
  options: BuildIdentityOptions
): Promise<FastifyInstance> {
  const { config } = options;
  const logger = options.logger ?? config.nodeEnv !== "test";
  const app = Fastify({
    logger: logger
      ? {
          level: config.logLevel,
          redact: [
            "req.headers.cookie",
            "req.headers.x-bealpha-context",
            "req.body.password",
            "req.body.currentPassword",
            "req.body.newPassword",
            "req.body.token",
            "req.body.code"
          ]
        }
      : false,
    genReqId: () => randomUUID(),
    requestIdHeader: REQUEST_ID_HEADER,
    trustProxy: config.trustProxyHops === 0 ? false : ["loopback", "linklocal", "uniquelocal"],
    bodyLimit: config.bodyLimitBytes,
    connectionTimeout: 10_000,
    requestTimeout: 30_000,
    keepAliveTimeout: 5_000,
    maxRequestsPerSocket: 1_000,
    routerOptions: { maxParamLength: 128 },
    onProtoPoisoning: "error",
    onConstructorPoisoning: "error"
  });
  app.server.maxHeadersCount = 100;

  app.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
  });

  app.setErrorHandler((error: FastifyError | ZodError, request, reply) => {
    if (error instanceof IdentityError) {
      return sendFailure(
        reply,
        error.statusCode,
        request.id,
        error.code,
        error.message,
        error.details
      );
    }
    if (error instanceof ZodError || error.statusCode === 400) {
      return sendFailure(
        reply,
        400,
        request.id,
        "VALIDATION_ERROR",
        "Request payload is invalid"
      );
    }
    if (error.statusCode === 413) {
      return sendFailure(
        reply,
        413,
        request.id,
        "PAYLOAD_TOO_LARGE",
        "Request body exceeds identity-service limit"
      );
    }
    request.log.error({ err: error }, "Unhandled identity-service error");
    return sendFailure(
      reply,
      500,
      request.id,
      "INTERNAL_ERROR",
      "Internal identity-service error"
    );
  });

  app.setNotFoundHandler((request, reply) =>
    sendFailure(reply, 404, request.id, "NOT_FOUND", "Route not found")
  );

  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: "same-site" }
  });
  await app.register(cookie);
  await registerInternalAuthentication(app, config);

  app.get("/health/live", async (request) =>
    successEnvelope(request.id, { status: "ok", service: "identity" })
  );
  app.get("/health/ready", async (request, reply) => {
    const [redisReady, databaseReady] = await Promise.all([
      options.registry.ping().catch(() => false),
      options.databaseHealth?.().catch(() => false) ?? Promise.resolve(true)
    ]);
    if (!redisReady || !databaseReady) {
      return sendFailure(
        reply,
        503,
        request.id,
        "UPSTREAM_UNAVAILABLE",
        "Identity dependencies unavailable"
      );
    }
    return successEnvelope(request.id, { status: "ready", service: "identity" });
  });

  registerIdentityRoutes(app, config, options.service);
  return app;
}
