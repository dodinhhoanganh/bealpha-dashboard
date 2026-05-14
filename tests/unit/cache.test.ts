/**
 * Unit tests for Cache module
 */

import { cache, TTL, MemoryCache } from "@/lib/cache";

// Fresh cache for each test
let testCache: MemoryCache;

beforeEach(() => {
  testCache = new MemoryCache();
});

describe("Cache — basic get/set", () => {
  it("should return undefined for missing key", () => {
    expect(testCache.get("missing")).toBeUndefined();
  });

  it("should store and retrieve a value", () => {
    testCache.set("key", "value", 60);
    expect(testCache.get("key")).toBe("value");
  });

  it("should store objects", () => {
    const obj = { name: "test", count: 42 };
    testCache.set("obj", obj, 60);
    expect(testCache.get("obj")).toEqual(obj);
  });

  it("should expire values after TTL", async () => {
    testCache.set("expire", "data", 0.1); // 100ms TTL
    expect(testCache.get("expire")).toBe("data");

    await new Promise((r) => setTimeout(r, 200));
    expect(testCache.get("expire")).toBeUndefined();
  });
});

describe("Cache — getOrSet", () => {
  it("should call fetcher on cache miss", async () => {
    const fetcher = jest.fn().mockResolvedValue("fetched");
    const value = await testCache.getOrSet("new-key", fetcher, 60);
    expect(value).toBe("fetched");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("should NOT call fetcher on cache hit", async () => {
    testCache.set("existing", "cached", 60);
    const fetcher = jest.fn().mockResolvedValue("fetched");
    const value = await testCache.getOrSet("existing", fetcher, 60);
    expect(value).toBe("cached");
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("Cache — delete", () => {
  it("should delete a specific key", () => {
    testCache.set("a", 1, 60);
    testCache.set("b", 2, 60);
    testCache.del("a");
    expect(testCache.get("a")).toBeUndefined();
    expect(testCache.get("b")).toBe(2);
  });

  it("should delete by wildcard pattern", () => {
    testCache.set("users:1", "alice", 60);
    testCache.set("users:2", "bob", 60);
    testCache.set("posts:1", "post1", 60);
    testCache.del("users:*");
    expect(testCache.get("users:1")).toBeUndefined();
    expect(testCache.get("users:2")).toBeUndefined();
    expect(testCache.get("posts:1")).toBe("post1");
  });
});

describe("Cache — flush", () => {
  it("should clear all entries", () => {
    testCache.set("a", 1, 60);
    testCache.set("b", 2, 60);
    testCache.flush();
    expect(testCache.get("a")).toBeUndefined();
    expect(testCache.get("b")).toBeUndefined();
  });
});

describe("Cache — stats", () => {
  it("should track hits and misses", () => {
    testCache.set("hit", "value", 60);
    testCache.get("hit");  // hit
    testCache.get("miss"); // miss

    const stats = testCache.stats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.size).toBe(1);
    expect(stats.hitRate).toBeCloseTo(50); // percentage
  });

  it("should report 0 hit rate with no requests", () => {
    expect(testCache.stats().hitRate).toBe(0);
  });
});

describe("Cache — TTL constants", () => {
  it("should have expected TTL values", () => {
    expect(TTL.SHORT).toBe(60);
    expect(TTL.MEDIUM).toBe(300);
    expect(TTL.LONG).toBe(3600);
    expect(TTL.DAY).toBe(86400);
  });
});

describe("Cache — singleton export", () => {
  it("should export a cache instance", () => {
    expect(cache).toBeInstanceOf(MemoryCache);
  });
});
