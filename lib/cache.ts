/**
 * Server-side In-Memory Cache
 *
 * Lightweight TTL cache for API responses — no Redis dependency needed.
 * Suitable for single-instance deployments. For multi-instance,
 * swap to Redis (ioredis) or Upstash.
 *
 * Usage:
 *   const stats = await cache.getOrSet("dashboard:stats", fetchStats, 300);
 *   cache.del("dashboard:stats");
 *   cache.flush();
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class MemoryCache {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private store = new Map<string, CacheEntry<any>>();
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(maxSize = 500) {
    this.maxSize = maxSize;
  }

  /**
   * Get a cached value, or return undefined if expired/missing.
   */
  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    return entry.value as T;
  }

  /**
   * Set a value with TTL in seconds.
   */
  set<T>(key: string, value: T, ttlSeconds: number = 300): void {
    // Evict oldest entries if at capacity
    if (this.store.size >= this.maxSize) {
      const firstKey = this.store.keys().next().value;
      if (firstKey) this.store.delete(firstKey);
    }
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  /**
   * Get from cache or compute + cache the value.
   */
  async getOrSet<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlSeconds: number = 300,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;

    const value = await fetcher();
    this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Delete a specific key or pattern.
   */
  del(keyOrPattern: string): number {
    if (keyOrPattern.includes("*")) {
      // Escape regex special chars, then convert * wildcards to .*
      const escaped = keyOrPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp("^" + escaped.replace(/\*/g, ".*") + "$");
      let count = 0;
      for (const key of this.store.keys()) {
        if (regex.test(key)) {
          this.store.delete(key);
          count++;
        }
      }
      return count;
    }
    return this.store.delete(keyOrPattern) ? 1 : 0;
  }

  /**
   * Flush all cache entries.
   */
  flush(): void {
    this.store.clear();
    this.hits = 0;
    this.misses = 0;
  }

  /**
   * Get cache statistics.
   */
  stats() {
    // Clean expired entries
    const now = Date.now();
    for (const [key, entry] of this.store.entries()) {
      if (now > entry.expiresAt) this.store.delete(key);
    }
    return {
      size: this.store.size,
      maxSize: this.maxSize,
      hits: this.hits,
      misses: this.misses,
      hitRate:
        this.hits + this.misses > 0
          ? Math.round((this.hits / (this.hits + this.misses)) * 100)
          : 0,
    };
  }
}

// ── Singleton ────────────────────────────────────────────
const globalForCache = globalThis as unknown as {
  __cache: MemoryCache | undefined;
};

export const cache = globalForCache.__cache ?? new MemoryCache(500);

if (process.env.NODE_ENV !== "production") {
  globalForCache.__cache = cache;
}

// ── Pre-defined TTL constants ────────────────────────────
export const TTL = {
  SHORT: 60, // 1 minute — volatile data
  MEDIUM: 300, // 5 minutes — dashboard stats
  LONG: 3600, // 1 hour — external API responses
  DAY: 86400, // 24 hours — static reference data
} as const;
