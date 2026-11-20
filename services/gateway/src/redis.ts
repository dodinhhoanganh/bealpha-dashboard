import { Redis } from "ioredis";

import type { GatewayConfig } from "./config.js";

export function createGatewayRedis(config: GatewayConfig): Redis | undefined {
  if (!config.redisUrl) {
    return undefined;
  }
  return new Redis(config.redisUrl, {
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
    connectTimeout: 1_000,
    retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000)
  });
}
