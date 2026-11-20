import { randomUUID } from "node:crypto";
import { REQUEST_ID_HEADER } from "@bealpha/contracts";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyError } from "fastify";
import { ZodError } from "zod";
import type { MediaConfig } from "./config.js";
import { MediaError } from "./errors.js";
import { registerInternalAuthentication } from "./internal-auth.js";
import { MediaService } from "./media-service.js";
import { sendFailure, successEnvelope } from "./response.js";
import { registerMediaRoutes } from "./routes.js";

function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError || (error instanceof Error && error.name === "ZodError" && Array.isArray((error as { issues?: unknown }).issues));
}

export async function buildMediaApp(options: { config: MediaConfig; service: MediaService; databaseHealth?: () => Promise<boolean>; logger?: boolean }) {
  const { config } = options;
  const app = Fastify({ logger: (options.logger ?? config.nodeEnv !== "test") ? { level: config.logLevel, redact: ["req.headers.x-bealpha-context", "req.query.token"], serializers: { req(request: { method?: string; url?: string; hostname?: string; ip?: string }) { return { method: request.method, url: request.url?.split("?", 1)[0], hostname: request.hostname, remoteAddress: request.ip }; } } } : false, genReqId: () => randomUUID(), requestIdHeader: REQUEST_ID_HEADER, trustProxy: config.trustProxyHops === 0 ? false : ["loopback", "linklocal", "uniquelocal"], bodyLimit: config.controlBodyLimitBytes, connectionTimeout: 10000, requestTimeout: 0, keepAliveTimeout: 5000, maxRequestsPerSocket: 1000, routerOptions: { maxParamLength: 128 }, onProtoPoisoning: "error", onConstructorPoisoning: "error" });
  app.server.maxHeadersCount = 100;
  app.addContentTypeParser(/^(?:audio|video|image|text)\/|^application\/(?:octet-stream|zip)/i, (_request, payload, done) => done(null, payload));
  app.addHook("onRequest", async (request, reply) => {
    reply.header(REQUEST_ID_HEADER, request.id);
    const directMedia = /^\/media-(?:upload|stream)\//.test(new URL(request.raw.url ?? "/", "http://media.invalid").pathname);
    if (typeof request.raw.socket.setTimeout === "function") {
      request.raw.socket.setTimeout(directMedia ? 3_600_000 : 30_000);
    }
  });
  app.setErrorHandler((error: FastifyError | ZodError, request, reply) => {
    if (error instanceof MediaError) return sendFailure(reply, error.statusCode, request.id, error.code, error.message);
    if (isZodError(error) || error.statusCode === 400) return sendFailure(reply, 400, request.id, "VALIDATION_ERROR", "Request payload is invalid");
    if (error.statusCode === 413) return sendFailure(reply, 413, request.id, "PAYLOAD_TOO_LARGE", "Request exceeds media-service limit");
    request.log.error({ err: error }, "Unhandled media-service error");
    return sendFailure(reply, 500, request.id, "INTERNAL_ERROR", "Internal media-service error");
  });
  app.setNotFoundHandler((request, reply) => sendFailure(reply, 404, request.id, "NOT_FOUND", "Route not found"));
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await registerInternalAuthentication(app, config);
  app.get("/health/live", async request => successEnvelope(request.id, { status: "ok", service: "media" }));
  app.get("/health/ready", async (request, reply) => {
    if (!(await (options.databaseHealth?.().catch(() => false) ?? Promise.resolve(true)))) return sendFailure(reply, 503, request.id, "UPSTREAM_UNAVAILABLE", "Media dependencies unavailable");
    return successEnvelope(request.id, { status: "ready", service: "media" });
  });
  registerMediaRoutes(app, options.service);
  return app;
}
