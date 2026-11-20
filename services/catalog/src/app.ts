import { randomUUID } from "node:crypto";
import { REQUEST_ID_HEADER } from "@bealpha/contracts";
import helmet from "@fastify/helmet";
import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { CatalogConfig } from "./config.js";
import { CatalogError } from "./errors.js";
import { registerInternalAuthentication } from "./internal-auth.js";
import { sendFailure, successEnvelope } from "./response.js";
import { registerCatalogRoutes } from "./routes.js";
import { CatalogService } from "./catalog-service.js";
import type { CatalogImportService } from "./catalog-import-service.js";

export async function buildCatalogApp(options: { config: CatalogConfig; service: CatalogService; importService?: CatalogImportService; databaseHealth?: () => Promise<boolean>; logger?: boolean }): Promise<FastifyInstance> {
  const { config } = options;
  const app = Fastify({ logger: options.logger ?? config.nodeEnv !== "test" ? { level: config.logLevel, redact: ["req.headers.x-bealpha-context"] } : false, genReqId: () => randomUUID(), requestIdHeader: REQUEST_ID_HEADER, trustProxy: config.trustProxyHops === 0 ? false : ["loopback", "linklocal", "uniquelocal"], bodyLimit: config.bodyLimitBytes, connectionTimeout: 10000, requestTimeout: 30000, keepAliveTimeout: 5000, maxRequestsPerSocket: 1000, routerOptions: { maxParamLength: 128 }, onProtoPoisoning: "error", onConstructorPoisoning: "error" });
  app.server.maxHeadersCount = 100;
  app.addHook("onRequest", async (request, reply) => { reply.header(REQUEST_ID_HEADER, request.id); });
  app.setErrorHandler((error: FastifyError | ZodError, request, reply) => {
    if (error instanceof CatalogError) return sendFailure(reply, error.statusCode, request.id, error.code, error.message);
    if (error instanceof ZodError || error.statusCode === 400) return sendFailure(reply, 400, request.id, "VALIDATION_ERROR", "Request payload is invalid");
    if (error.statusCode === 413) return sendFailure(reply, 413, request.id, "PAYLOAD_TOO_LARGE", "Request body exceeds catalog-service limit");
    request.log.error({ err: error }, "Unhandled catalog-service error");
    return sendFailure(reply, 500, request.id, "INTERNAL_ERROR", "Internal catalog-service error");
  });
  app.setNotFoundHandler((request, reply) => sendFailure(reply, 404, request.id, "NOT_FOUND", "Route not found"));
  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-site" } });
  await registerInternalAuthentication(app, config);
  app.get("/health/live", async request => successEnvelope(request.id, { status: "ok", service: "catalog" }));
  app.get("/health/ready", async (request, reply) => {
    if (!(await (options.databaseHealth?.().catch(() => false) ?? Promise.resolve(true)))) return sendFailure(reply, 503, request.id, "UPSTREAM_UNAVAILABLE", "Catalog dependencies unavailable");
    return successEnvelope(request.id, { status: "ready", service: "catalog" });
  });
  registerCatalogRoutes(app, options.service, config, options.importService);
  return app;
}
