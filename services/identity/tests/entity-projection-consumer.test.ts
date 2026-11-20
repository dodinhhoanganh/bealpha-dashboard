import type { EntitySnapshotSync } from "@bealpha/contracts";
import { describe, expect, it, vi } from "vitest";

import { consumeEntityProjectionEvent } from "../src/entity-projection-consumer.js";
import { PrismaIdentityStore } from "../src/store.js";

const organizationId = "33333333-3333-4333-8333-333333333333";
const subAccountId = "22222222-2222-4222-8222-222222222222";

function snapshot(overrides: Partial<EntitySnapshotSync> = {}): EntitySnapshotSync {
  return {
    id: subAccountId,
    entityType: "SUB_ACCOUNT",
    name: "Artist Account",
    path: "root.system.organization.artist",
    tenantId: organizationId,
    isActive: true,
    version: 1,
    ...overrides
  };
}

function projectionDatabase(
  initial: EntitySnapshotSync | null,
  synchronizeTransactionReads = false
) {
  let current = initial ? { ...initial } : null;
  let reads = 0;
  let releaseReads: (() => void) | undefined;
  const readGate = new Promise<void>((resolve) => {
    releaseReads = resolve;
  });

  const transactionEntitySnapshot = {
    findUnique: vi.fn(async () => {
      const result = current ? { version: current.version } : null;
      if (synchronizeTransactionReads) {
        reads += 1;
        if (reads === 2) releaseReads?.();
        await readGate;
      }
      return result;
    }),
    upsert: vi.fn(async (args: { create: EntitySnapshotSync; update: EntitySnapshotSync }) => {
      if (synchronizeTransactionReads && args.update.version === 2) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      current = { ...(current ?? args.create), ...args.update };
      return current;
    })
  };

  const entitySnapshot = {
    updateMany: vi.fn(async (args: {
      where: { id: string; version: { lt: number } };
      data: EntitySnapshotSync;
    }) => {
      if (
        current?.id === args.where.id &&
        current.version < args.where.version.lt
      ) {
        current = { ...current, ...args.data };
        return { count: 1 };
      }
      return { count: 0 };
    }),
    findUnique: vi.fn(async () => current ? { version: current.version } : null),
    create: vi.fn(async (args: { data: EntitySnapshotSync }) => {
      if (current) throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
      current = { ...args.data };
      return current;
    })
  };

  const prisma = {
    entitySnapshot,
    $transaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
      entitySnapshot: transactionEntitySnapshot
    }))
  };

  return {
    prisma,
    current: () => current
  };
}

describe("identity entity projection", () => {
  it("persists semantic tier without legacy or stale events erasing it", async () => {
    const database = projectionDatabase(null);
    const store = new PrismaIdentityStore(database.prisma as never);
    await store.upsertEntitySnapshot(snapshot({ businessTier: "ARTIST" }));
    expect(database.current()).toMatchObject({ businessTier: "ARTIST", version: 1 });
    await store.upsertEntitySnapshot(snapshot({ version: 2 }));
    expect(database.current()).toMatchObject({ businessTier: "ARTIST", version: 2 });
    await store.upsertEntitySnapshot(snapshot({ businessTier: null, version: 1 }));
    expect(database.current()).toMatchObject({ businessTier: "ARTIST", version: 2 });
  });

  it("invalidates registry state when an entity subtree becomes inactive", async () => {
    const upsertEntitySnapshot = vi.fn().mockResolvedValue(true);
    const invalidateEntityAuthorization = vi.fn().mockResolvedValue([
      {
        userId: "11111111-1111-4111-8111-111111111111",
        authzVersion: 9,
        sessionIds: ["session-a", "session-b"]
      }
    ]);
    const registry = {
      deactivateMany: vi.fn().mockResolvedValue(undefined),
      syncAuthorization: vi.fn().mockResolvedValue(undefined)
    };
    const payload = snapshot({ isActive: false, version: 7 });

    await expect(
      consumeEntityProjectionEvent(
        { upsertEntitySnapshot, invalidateEntityAuthorization },
        {
          version: 1,
          eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          type: "catalog.entity.updated",
          payload
        },
        registry
      )
    ).resolves.toBe(true);

    expect(invalidateEntityAuthorization).toHaveBeenCalledWith(payload, true);
    expect(registry.deactivateMany).toHaveBeenCalledWith(["session-a", "session-b"]);
    expect(registry.syncAuthorization).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      9
    );
  });

  it("consumes the complete inactive snapshot from the catalog event", async () => {
    const upsertEntitySnapshot = vi.fn().mockResolvedValue(true);
    const payload = snapshot({ isActive: false, version: 7 });

    await expect(consumeEntityProjectionEvent({ upsertEntitySnapshot }, {
      version: 1,
      eventId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      type: "catalog.entity.updated",
      payload
    })).resolves.toBe(true);

    expect(upsertEntitySnapshot).toHaveBeenCalledWith(payload);
  });

  it("ignores stale and duplicate versions but applies a newer inactive version", async () => {
    const database = projectionDatabase(snapshot({ version: 5 }));
    const store = new PrismaIdentityStore(database.prisma as never);

    await expect(store.upsertEntitySnapshot(snapshot({ version: 4 }))).resolves.toBe(false);
    await expect(store.upsertEntitySnapshot(snapshot({ version: 5 }))).resolves.toBe(false);
    await expect(store.upsertEntitySnapshot(snapshot({ version: 6, isActive: false }))).resolves.toBe(true);

    expect(database.current()).toMatchObject({ version: 6, isActive: false });
  });

  it("keeps the newest snapshot when versions are processed concurrently", async () => {
    const database = projectionDatabase(snapshot({ version: 1 }), true);
    const store = new PrismaIdentityStore(database.prisma as never);

    await Promise.all([
      store.upsertEntitySnapshot(snapshot({ version: 2, name: "Older" })),
      store.upsertEntitySnapshot(snapshot({ version: 3, name: "Newest" }))
    ]);

    expect(database.current()).toMatchObject({ version: 3, name: "Newest" });
  });

  it("revokes active sessions for an inactive subtree and returns current versions", async () => {
    const database = projectionDatabase(snapshot({ version: 7, isActive: false }));
    const activeSessions = [
      { id: "session-a", userId: "11111111-1111-4111-8111-111111111111" },
      { id: "session-b", userId: "22222222-2222-4222-8222-222222222222" }
    ];
    const userVersions = new Map([
      ["11111111-1111-4111-8111-111111111111", 4],
      ["22222222-2222-4222-8222-222222222222", 8]
    ]);
    const sessionFindMany = vi.fn(async () => activeSessions.splice(0));
    const sessionUpdateMany = vi.fn(async () => ({ count: 2 }));
    const userUpdateMany = vi.fn(async () => {
      for (const userId of userVersions.keys()) {
        userVersions.set(userId, userVersions.get(userId)! + 1);
      }
      return { count: userVersions.size };
    });
    const userFindMany = vi.fn(async () => [...userVersions].map(([id, authzVersion]) => ({ id, authzVersion })));
    const entitySnapshot = database.prisma.entitySnapshot;
    database.prisma.$transaction = vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation({
      entitySnapshot: {
        findUnique: vi.fn(async () => ({ path: "root.system.organization.artist", isActive: false }))
      },
      membership: {
        findMany: vi.fn(async (args: { where: unknown }) => {
          expect(args.where).toMatchObject({
            OR: [
              { entityId: subAccountId },
              { entityPath: "root.system.organization.artist" },
              { entityPath: { startsWith: "root.system.organization.artist." } }
            ]
          });
          return [...userVersions.keys()].map(userId => ({ userId }));
        })
      },
      session: { findMany: sessionFindMany, updateMany: sessionUpdateMany },
      user: { updateMany: userUpdateMany, findMany: userFindMany }
    })) as never;
    // Keep the snapshot method available for the concrete store while using a
    // small in-memory Prisma surface for the authorization transition.
    void entitySnapshot;
    const store = new PrismaIdentityStore(database.prisma as never);

    await expect(
      store.invalidateEntityAuthorization(snapshot({ isActive: false, version: 7 }), true)
    ).resolves.toEqual([
      {
        userId: "11111111-1111-4111-8111-111111111111",
        authzVersion: 5,
        sessionIds: ["session-a"]
      },
      {
        userId: "22222222-2222-4222-8222-222222222222",
        authzVersion: 9,
        sessionIds: ["session-b"]
      }
    ]);
    expect(userUpdateMany).toHaveBeenCalledOnce();
    expect(sessionUpdateMany).toHaveBeenCalledOnce();
  });

  it("requires every projected ancestor to remain active for a child session", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      path: "root.organization.parent.child",
      isActive: true
    });
    const findMany = vi.fn().mockResolvedValue([
      { isActive: true },
      { isActive: false },
      { isActive: true }
    ]);
    const store = new PrismaIdentityStore({
      entitySnapshot: { findUnique, findMany }
    } as never);

    await expect(store.isEntityActive(subAccountId)).resolves.toBe(false);
    expect(findMany).toHaveBeenCalledWith({
      where: {
        path: {
          in: [
            "root",
            "root.organization",
            "root.organization.parent",
            "root.organization.parent.child"
          ]
        }
      },
      select: { isActive: true }
    });
  });
});
