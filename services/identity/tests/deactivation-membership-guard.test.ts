import { describe, expect, it, vi } from "vitest";
import { PrismaIdentityStore as CurrentStore } from "../src/store.js";

const { PrismaIdentityStore } = process.env.DEACTIVATION_STORE_TEST_SOURCE
  ? await import(process.env.DEACTIVATION_STORE_TEST_SOURCE) as { PrismaIdentityStore: typeof CurrentStore }
  : { PrismaIdentityStore: CurrentStore };

const expected = { entityId: "label", entityRole: "MEMBER" as const };
type Membership = { entityId: string; entityRole: string };

function fixture(initial: Membership = expected, afterLock = initial, ownerCount = 1) {
  const calls: string[] = [];
  const user = { id: "target", email: "member@example.com", membership: initial, isActive: true, isBanned: false, staffRoles: [], authzVersion: 2 };
  let current = user;
  const tx = {
    $executeRaw: vi.fn(async (..._query: unknown[]) => { calls.push("lock"); current = { ...user, membership: afterLock }; return 0; }),
    user: {
      findUnique: vi.fn(async () => { calls.push("read"); return { ...current }; }),
      findUniqueOrThrow: vi.fn(async () => current),
      update: vi.fn(async () => { calls.push("update"); return { authzVersion: 2 }; }),
    },
    membership: { count: vi.fn(async () => { calls.push("count"); return ownerCount; }) },
    session: { findMany: vi.fn(async () => [{ id: "session" }]), updateMany: vi.fn() },
  };
  const store = new PrismaIdentityStore({
    $transaction: async (callback: (transaction: typeof tx) => Promise<unknown>) => callback(tx),
  } as never);
  return { store, tx, calls };
}

describe("Deactivation membership snapshot and owner serialization", () => {
  it.each([
    { entityId: "sibling-tenant", entityRole: "MEMBER" },
    { entityId: "label", entityRole: "OWNER" },
  ])("rejects a deactivation authorized before target changed to $entityId/$entityRole", async current => {
    const { store, tx } = fixture(current);
    await expect(store.deactivateUser("target", expected)).resolves.toEqual({ kind: "membership_conflict" });
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(tx.session.updateMany).not.toHaveBeenCalled();
  });

  describe.each(["deactivate", "disable"] as const)("%s", operation => {
    function mutate(store: InstanceType<typeof PrismaIdentityStore>) {
      return operation === "deactivate"
        ? store.deactivateUser("target", expected)
        : store.updateManagedUser("target", { isActive: false });
    }

    it.each([
      { entityId: "sibling-tenant", entityRole: "MEMBER" },
      { entityId: "label", entityRole: "OWNER" },
    ])("rejects movement/promotion while waiting for lock: $entityId/$entityRole", async afterLock => {
      const { store, tx, calls } = fixture(expected, afterLock);
      await expect(mutate(store)).resolves.toEqual({ kind: "membership_conflict" });
      expect(calls).toEqual(["read", "lock", "read"]);
      expect(tx.user.update).not.toHaveBeenCalled();
      expect(tx.session.updateMany).not.toHaveBeenCalled();
    });

    it("locks even a non-owner and rereads before changing active state", async () => {
      const { store, tx, calls } = fixture();
      await expect(mutate(store)).resolves.toMatchObject({ kind: "changed", authzVersion: 2, revokedSessionIds: ["session"] });
      expect(calls).toEqual(["read", "lock", "read", "update"]);
      expect(tx.membership.count).not.toHaveBeenCalled();
      expect(tx.session.updateMany).toHaveBeenCalled();
      expect(tx.$executeRaw.mock.calls[0]?.[1]).toBe("label");
    });

    it("rejects deletion during lock wait", async () => {
      const { store, tx } = fixture();
      tx.user.findUnique.mockResolvedValueOnce({ id: "target", email: "member@example.com", membership: expected, isActive: true, isBanned: false, staffRoles: [], authzVersion: 2 }).mockResolvedValueOnce(null as never);
      await expect(mutate(store)).resolves.toEqual({ kind: "not_found" });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it("keeps last-owner protection after refreshing the snapshot", async () => {
      const membership = { entityId: "label", entityRole: "OWNER" as const };
      const { store, tx, calls } = fixture(membership);
      const result = operation === "deactivate"
        ? await store.deactivateUser("target", membership)
        : await store.updateManagedUser("target", { isActive: false });
      expect(result).toEqual({ kind: "last_owner" });
      expect(calls).toEqual(["read", "lock", "read", "count"]);
      expect(tx.membership.count).toHaveBeenCalledWith({ where: { entityId: "label", entityRole: "OWNER", user: { isActive: true, isBanned: false } } });
      expect(tx.user.update).not.toHaveBeenCalled();
    });
  });

  it("preserves ordinary global profile updates without membership locking", async () => {
    const { store, tx, calls } = fixture();
    await expect(store.updateManagedUser("target", { name: "Updated" })).resolves.toMatchObject({ kind: "changed" });
    expect(calls).toEqual(["read", "update"]);
    expect(tx.$executeRaw).not.toHaveBeenCalled();
  });
});
