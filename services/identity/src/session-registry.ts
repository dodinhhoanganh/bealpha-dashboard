import {
  identityAuthzVersionKey,
  identitySessionKey
} from "@bealpha/contracts";
import { Redis } from "ioredis";

export interface SessionRegistry {
  activate(
    sessionId: string,
    userId: string,
    authzVersion: number,
    expiresAt: Date
  ): Promise<void>;
  deactivate(sessionId: string): Promise<void>;
  deactivateMany(sessionIds: readonly string[]): Promise<void>;
  syncAuthorization(userId: string, authzVersion: number): Promise<void>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
}

export class RedisSessionRegistry implements SessionRegistry {
  constructor(private readonly redis: Redis) {}

  async activate(
    sessionId: string,
    userId: string,
    authzVersion: number,
    expiresAt: Date
  ): Promise<void> {
    const ttl = Math.max(1, Math.ceil((expiresAt.getTime() - Date.now()) / 1000));
    await this.redis
      .multi()
      .set(identitySessionKey(sessionId), userId, "EX", ttl)
      .set(identityAuthzVersionKey(userId), String(authzVersion))
      .exec();
  }

  async deactivate(sessionId: string): Promise<void> {
    await this.redis.del(identitySessionKey(sessionId));
  }

  async deactivateMany(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) {
      return;
    }
    await this.redis.del(...sessionIds.map(identitySessionKey));
  }

  async syncAuthorization(userId: string, authzVersion: number): Promise<void> {
    await this.redis.set(identityAuthzVersionKey(userId), String(authzVersion));
  }

  async ping(): Promise<boolean> {
    return (await this.redis.ping()) === "PONG";
  }

  async close(): Promise<void> {
    this.redis.disconnect();
  }
}

export class MemorySessionRegistry implements SessionRegistry {
  readonly sessions = new Map<string, string>();
  readonly versions = new Map<string, number>();

  async activate(
    sessionId: string,
    userId: string,
    authzVersion: number,
    _expiresAt: Date
  ): Promise<void> {
    this.sessions.set(sessionId, userId);
    this.versions.set(userId, authzVersion);
  }

  async deactivate(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async deactivateMany(sessionIds: readonly string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      this.sessions.delete(sessionId);
    }
  }

  async syncAuthorization(userId: string, authzVersion: number): Promise<void> {
    this.versions.set(userId, authzVersion);
  }

  async ping(): Promise<boolean> {
    return true;
  }

  async close(): Promise<void> {}
}

export function createRedisSessionRegistry(redisUrl: string): SessionRegistry {
  return new RedisSessionRegistry(
    new Redis(redisUrl, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1_000,
      retryStrategy: (attempt: number) => Math.min(attempt * 100, 2_000)
    })
  );
}
