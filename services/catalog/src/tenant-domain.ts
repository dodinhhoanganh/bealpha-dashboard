import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { resolveTxt } from "node:dns/promises";
import { tenantDomainCacheKey } from "@bealpha/contracts";
import { Redis } from "ioredis";

const RECORD_LABEL = "_bealpha-verification";
const RECORD_PREFIX = "bealpha-verification=";

export interface TenantDomainDependencies {
  resolveTxt: (hostname: string) => Promise<string[][]>;
  invalidate: (hostname: string) => Promise<void>;
}

export const defaultTenantDomainDependencies: TenantDomainDependencies = {
  resolveTxt,
  invalidate: async () => undefined
};

function tokenHash(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export function createTenantDomainChallenge(hostname: string) {
  const token = randomBytes(32).toString("base64url");
  return {
    tokenHash: tokenHash(token).toString("hex"),
    verification: {
      type: "TXT" as const,
      name: `${RECORD_LABEL}.${hostname}`,
      value: `${RECORD_PREFIX}${token}`
    }
  };
}

export function dnsRecordsContainChallenge(records: string[][], expectedHash: string): boolean {
  const expected = Buffer.from(expectedHash, "hex");
  if (expected.length !== 32) return false;
  return records.some(parts => {
    const value = parts.join("");
    if (!value.startsWith(RECORD_PREFIX)) return false;
    const actual = tokenHash(value.slice(RECORD_PREFIX.length));
    return timingSafeEqual(actual, expected);
  });
}

export class TenantDomainCacheInvalidator {
  private readonly redis: Redis;

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: attempt => Math.min(attempt * 100, 2_000)
    });
  }

  async invalidate(hostname: string): Promise<void> {
    await this.redis.del(tenantDomainCacheKey(hostname));
  }

  close(): void {
    this.redis.disconnect();
  }
}
