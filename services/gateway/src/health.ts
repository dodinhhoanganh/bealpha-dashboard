import { API_VERSION } from "@bealpha/contracts";
import type { FastifyInstance } from "fastify";
import type { Redis } from "ioredis";

export function registerHealthRoutes(app: FastifyInstance, redis?: Redis): void {
  app.get(
    "/health/live",
    { config: { rateLimit: false } },
    async (request) => ({
      data: { status: "ok", service: "gateway", apiVersion: API_VERSION },
      error: null,
      requestId: request.id
    })
  );

  app.get(
    "/health/ready",
    { config: { rateLimit: false } },
    async (request, reply) => {
      if (redis && (await redis.ping().catch(() => "DOWN")) !== "PONG") {
        return reply.code(503).send({
          data: null,
          error: {
            code: "UPSTREAM_UNAVAILABLE",
            message: "Gateway dependencies unavailable"
          },
          requestId: request.id
        });
      }
      return {
        data: { status: "ready", service: "gateway" },
        error: null,
        requestId: request.id
      };
    }
  );
}
