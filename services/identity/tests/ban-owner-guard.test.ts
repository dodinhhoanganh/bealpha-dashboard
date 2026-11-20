import { describe, expect, it, vi } from "vitest";
import { PrismaIdentityStore as CurrentStore } from "../src/store.js";

const { PrismaIdentityStore } = process.env.BAN_STORE_TEST_SOURCE
  ? await import(process.env.BAN_STORE_TEST_SOURCE) as { PrismaIdentityStore: typeof CurrentStore }
  : { PrismaIdentityStore: CurrentStore };

const expected = { entityId: "label", entityRole: "OWNER" as const };
const owner = { id: "target", isActive: true, isBanned: false, membership: expected };

function fixture(current: { id: string; isActive: boolean; isBanned: boolean; membership: { entityId: string; entityRole: string } } = owner, otherOwners = 0) {
  const calls: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => { calls.push("lock"); return 0; }),
    user: {
      findUnique: vi.fn().mockResolvedValue(current),
      update: vi.fn(async () => ({ authzVersion: 2 })),
    },
    membership: { count: vi.fn(async () => { calls.push("count"); return otherOwners; }) },
    session: { findMany: vi.fn(async () => [{ id: "session" }]), updateMany: vi.fn() },
  };
  const store = new PrismaIdentityStore({
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as never);
  return { store, tx, calls };
}

describe("Ban owner and authorized membership protection", () => {
  it("keeps the last usable owner active without revoking sessions", async () => {
    const { store, tx, calls } = fixture();
    await expect(store.setBanState("target", true, "reason", expected)).resolves.toEqual({ kind: "last_owner" });
    expect(calls).toEqual(["lock", "count"]);
    expect(tx.membership.count).toHaveBeenCalledWith({ where: {
      entityId: "label", entityRole: "OWNER", userId: { not: "target" },
      user: { isActive: true, isBanned: false },
    } });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { entityId: "other-tenant", entityRole: "OWNER" as const },
    { entityId: "label", entityRole: "ADMIN" as const },
  ])("rejects target scope/role drift: $entityId/$entityRole", async membership => {
    const { store, tx } = fixture({ ...owner, membership }, 1);
    await expect(store.setBanState("target", true, "reason", expected)).resolves.toEqual({ kind: "membership_conflict" });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });

  it("rereads membership after waiting for the scope lock", async () => {
    const { store, tx } = fixture(owner, 1);
    tx.user.findUnique.mockResolvedValueOnce(owner).mockResolvedValueOnce({ ...owner, membership: { ...expected, entityId: "moved" } });
    await expect(store.setBanState("target", true, "reason", expected)).resolves.toEqual({ kind: "membership_conflict" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("rejects a disabled target at mutation time", async () => {
    const { store, tx } = fixture({ ...owner, isActive: false }, 1);
    await expect(store.setBanState("target", true, "reason", expected)).resolves.toEqual({ kind: "account_disabled" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("returns not_found for a deleted target", async () => {
    const { store, tx } = fixture();
    tx.user.findUnique.mockResolvedValue(null);
    await expect(store.setBanState("target", true, "reason", expected)).resolves.toEqual({ kind: "not_found" });
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it("bans with a replacement owner and invalidates authorization", async () => {
    const { store, tx } = fixture(owner, 1);
    await expect(store.setBanState("target", true, "reason", expected)).resolves.toEqual({ kind: "changed", authzVersion: 2, revokedSessionIds: ["session"] });
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      isBanned: true, banReason: "reason", authzVersion: { increment: 1 },
    } }));
    expect(tx.session.updateMany).toHaveBeenCalled();
  });

  it("unbans an owner without requiring another owner or revoking sessions", async () => {
    const { store, tx } = fixture({ ...owner, isBanned: true });
    await expect(store.setBanState("target", false, "ignored", expected)).resolves.toEqual({ kind: "changed", authzVersion: 2, revokedSessionIds: [] });
    expect(tx.membership.count).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
    expect(tx.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: {
      isBanned: false, banReason: null, authzVersion: { increment: 1 },
    } }));
  });

  it("does not block an already-banned owner's reason update", async () => {
    const { store, tx } = fixture({ ...owner, isBanned: true });
    await expect(store.setBanState("target", true, "new reason", expected)).resolves.toMatchObject({ kind: "changed" });
    expect(tx.membership.count).not.toHaveBeenCalled();
  });

  it.each(["ban", "demote"])("serializes a ban against another owner's %s", async operation => {
    const users = new Map(["first", "second"].map(id => [id, { ...owner, id, membership: { ...expected } }]));
    let queue = Promise.resolve();
    const store = new PrismaIdentityStore({ $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      let unlock: (() => void) | undefined;
      const tx = {
        $executeRaw: async () => {
          const previous = queue;
          queue = new Promise<void>(resolve => { unlock = resolve; });
          await previous;
          return 0;
        },
        user: {
          findUnique: async ({ where }: { where: { id: string } }) => structuredClone(users.get(where.id)),
          update: async ({ where, data }: { where: { id: string }; data: { isBanned?: boolean } }) => {
            if (data.isBanned !== undefined) users.get(where.id)!.isBanned = data.isBanned;
            return { authzVersion: 2 };
          },
        },
        membership: {
          findUnique: async ({ where }: { where: { userId: string } }) => ({ ...users.get(where.userId)!.membership }),
          count: async ({ where }: { where: { userId?: { not: string } } }) => {
            const count = [...users.values()].filter(user => user.membership.entityRole === "OWNER" && user.isActive && !user.isBanned && user.id !== where.userId?.not).length;
            await new Promise(resolve => setImmediate(resolve));
            return count;
          },
          update: async ({ where }: { where: { userId: string } }) => {
            Object.assign(users.get(where.userId)!.membership, { entityRole: "MEMBER" });
          },
        },
        session: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
      };
      try { return await callback(tx); } finally { unlock?.(); }
    } } as never);
    const results = await Promise.all([
      store.setBanState("first", true, "reason", expected),
      operation === "ban" ? store.setBanState("second", true, "reason", expected) : store.changeMembershipRole("second", "MEMBER", expected),
    ]);
    expect(results.map(result => result?.kind).sort()).toEqual(["changed", "last_owner"]);
    expect([...users.values()].filter(user => user.membership.entityRole === "OWNER" && !user.isBanned)).toHaveLength(1);
  });
});
