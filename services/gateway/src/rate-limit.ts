import { createHash } from "node:crypto";

import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Redis } from "ioredis";

import type { GatewayConfig } from "./config.js";

function routeBucket(request: FastifyRequest): string {
  const path = new URL(request.raw.url ?? "/", "http://gateway.invalid").pathname;
  return path.split("/")[3] || "unknown";
}

export function buildRateLimitKey(
  ip: string,
  actorId: string | undefined,
  bucket: string
): string {
  const digest = createHash("sha256")
    .update(ip)
    .update("\0")
    .update(actorId ?? "anonymous")
    .digest("hex")
    .slice(0, 32);
  return `gateway:${bucket}:${digest}`;
}

export async function registerRateLimit(
  app: FastifyInstance,
  config: GatewayConfig,
  redis?: Redis
): Promise<void> {
  await app.register(rateLimit, {
    global: true,
    hook: "preHandler",
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindowMs,
    ...(redis === undefined ? {} : { redis }),
    allowList: (request) =>
      new URL(request.raw.url ?? "/", "http://gateway.invalid").pathname.startsWith(
        "/health/"
      ),
    keyGenerator: (request) =>
      buildRateLimitKey(
        request.ip,
        request.authContext?.actorId,
        routeBucket(request)
      )
  });
}
