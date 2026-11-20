import { describe, expect, it, vi } from "vitest";
import { PrismaIdentityStore } from "../src/store.js";

describe("Artist team owner protection", () => {
  it.each([
    { entityId: "different-tenant", entityRole: "MEMBER" },
    { entityId: "authorized-entity", entityRole: "OWNER" },
  ])("rejects stale authorization when target membership is $entityId/$entityRole", async current => {
    const tx = {
      $executeRaw: vi.fn(),
      membership: { findUnique: vi.fn().mockResolvedValue(current), count: vi.fn().mockResolvedValue(2), update: vi.fn() },
      session: { findMany: async () => [], updateMany: vi.fn() },
      user: { update: async () => ({ authzVersion: 2 }) },
    };
    const store = new PrismaIdentityStore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    await expect(store.changeMembershipRole("target", "ADMIN", { entityId: "authorized-entity", entityRole: "MEMBER" })).resolves.toEqual({ kind: "membership_conflict" });
    expect(tx.membership.update).not.toHaveBeenCalled();
  });

  it("rechecks the target after waiting for the entity lock", async () => {
    const tx = {
      $executeRaw: vi.fn(),
      membership: { findUnique: vi.fn().mockResolvedValueOnce({ entityId: "authorized-entity", entityRole: "MEMBER" }).mockResolvedValueOnce({ entityId: "moved", entityRole: "MEMBER" }), update: vi.fn() },
      session: { findMany: async () => [], updateMany: vi.fn() },
      user: { update: async () => ({ authzVersion: 2 }) },
    };
    const store = new PrismaIdentityStore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    await expect(store.changeMembershipRole("target", "ADMIN", { entityId: "authorized-entity", entityRole: "MEMBER" })).resolves.toEqual({ kind: "membership_conflict" });
    expect(tx.membership.update).not.toHaveBeenCalled();
  });

  it.each(["deactivate", "update"])("locks owner scope before the %s active-owner check", async operation => {
    const calls: string[] = [];
    const tx = {
      $executeRaw: vi.fn(async () => { calls.push("lock"); }),
      user: { findUnique: vi.fn().mockResolvedValue({ membership: { entityId: "artist", entityRole: "OWNER" } }), update: vi.fn() },
      membership: { count: vi.fn(async () => { calls.push("count"); return 1; }) },
    };
    const store = new PrismaIdentityStore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    const result = operation === "deactivate" ? await store.deactivateUser("owner") : await store.updateManagedUser("owner", { isActive: false });
    expect(result).toEqual({ kind: "last_owner" });
    expect(calls).toEqual(["lock", "count"]);
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it.each(["remove", "reassign"])("counts only usable owners before %s", async operation => {
    const target = { id: "other", entityType: "ORGANIZATION" as const, name: "Other", path: "root.other", tenantId: "other", isActive: true, version: 1 };
    const tx = {
      $executeRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValue({ membership: { entityId: "artist", entityRole: "OWNER" } }) },
      entitySnapshot: { findUnique: vi.fn().mockResolvedValue(target) },
      membership: { count: vi.fn().mockResolvedValue(1), delete: vi.fn(), upsert: vi.fn() },
    };
    const store = new PrismaIdentityStore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    const result = operation === "remove"
      ? await store.removeMembership("owner", "artist")
      : await store.reassignMembership("owner", target, "MEMBER");
    expect(result).toEqual({ kind: "last_owner" });
    expect(tx.membership.count).toHaveBeenCalledWith({ where: { entityId: "artist", entityRole: "OWNER", user: { isActive: true, isBanned: false } } });
    expect(tx.membership.delete).not.toHaveBeenCalled();
    expect(tx.membership.upsert).not.toHaveBeenCalled();
    if (operation === "reassign") expect(tx.$executeRaw.mock.calls.map(call => call[1])).toEqual(["artist", "other"]);
  });

  it("rejects reassignment if membership moved while waiting for scope locks", async () => {
    const target = { id: "other", entityType: "ORGANIZATION" as const, name: "Other", path: "root.other", tenantId: "other", isActive: true, version: 1 };
    const tx = {
      $executeRaw: vi.fn(),
      user: { findUnique: vi.fn().mockResolvedValueOnce({ membership: { entityId: "artist" } }).mockResolvedValueOnce({ membership: { entityId: "moved", entityRole: "OWNER" } }) },
      entitySnapshot: { findUnique: vi.fn().mockResolvedValue(target) },
      membership: { count: vi.fn(), upsert: vi.fn() },
    };
    const store = new PrismaIdentityStore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    await expect(store.reassignMembership("owner", target, "MEMBER")).resolves.toEqual({ kind: "membership_conflict" });
    expect(tx.membership.count).not.toHaveBeenCalled();
    expect(tx.membership.upsert).not.toHaveBeenCalled();
  });

  it("does not count inactive or banned owners as a usable replacement", async () => {
    const membership = {
      findUnique: vi.fn().mockResolvedValue({ entityId: "artist", entityRole: "OWNER" }),
      count: vi.fn(async ({ where }) => where.user?.isActive === true && where.user?.isBanned === false ? 1 : 2),
      update: vi.fn(),
    };
    const tx = { $executeRaw: vi.fn(), membership, session: { findMany: async () => [], updateMany: vi.fn() }, user: { update: async () => ({ authzVersion: 2 }) } };
    const store = new PrismaIdentityStore({ $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx) } as never);
    await expect(store.changeMembershipRole("last-active-owner", "MEMBER")).resolves.toEqual({ kind: "last_owner" });
    expect(membership.update).not.toHaveBeenCalled();
  });

  it("still refuses demotion of the last Artist owner", async () => {
    const transaction = {
      $executeRaw: vi.fn().mockResolvedValue(0),
      membership: {
        findUnique: vi.fn().mockResolvedValue({ entityType: "SUB_ACCOUNT", entityRole: "OWNER", entityId: "artist" }),
        count: vi.fn().mockResolvedValue(1),
        update: vi.fn(),
      },
    };
    const prisma = { $transaction: vi.fn(async callback => callback(transaction)) };
    const store = new PrismaIdentityStore(prisma as never);
    await expect(store.changeMembershipRole("owner", "MEMBER")).resolves.toEqual({ kind: "last_owner" });
    expect(transaction.membership.update).not.toHaveBeenCalled();
  });
  it("serializes competing owner demotions so one owner survives", async () => {
    const roles = new Map([["first", "OWNER"], ["second", "OWNER"]]);
    let queue = Promise.resolve();
    const prisma = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        let unlock: (() => void) | undefined;
        const tx = {
          $executeRaw: async () => {
            const previous = queue;
            queue = new Promise<void>(resolve => { unlock = resolve; });
            await previous;
            return 0;
          },
          membership: {
            findUnique: async ({ where }: { where: { userId: string } }) => ({ entityId: "artist", entityType: "SUB_ACCOUNT", entityRole: roles.get(where.userId) }),
            count: async () => {
              const count = [...roles.values()].filter(role => role === "OWNER").length;
              await new Promise(resolve => setImmediate(resolve));
              return count;
            },
            update: async ({ where, data }: { where: { userId: string }; data: { entityRole: string } }) => { roles.set(where.userId, data.entityRole); },
          },
          session: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
          user: { update: async () => ({ authzVersion: 2 }) },
        };
        try { return await callback(tx); } finally { unlock?.(); }
      },
    };
    const store = new PrismaIdentityStore(prisma as never);
    const results = await Promise.all([store.changeMembershipRole("first", "MEMBER"), store.changeMembershipRole("second", "MEMBER")]);
    expect(results.map(result => result.kind).sort()).toEqual(["changed", "last_owner"]);
    expect([...roles.values()].filter(role => role === "OWNER")).toHaveLength(1);
  });
});
