import { exportSPKI, generateKeyPair, SignJWT } from "jose";
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { InternalAuthContext } from "@bealpha/contracts";
import { INTERNAL_CONTEXT_HEADER, REQUEST_ID_HEADER } from "@bealpha/contracts";
import { buildCatalogApp } from "../src/app.js";
import { CatalogService } from "../src/catalog-service.js";
import type { CatalogConfig } from "../src/config.js";
import type { CatalogDatabase } from "../src/database.js";

const ids = {
  actor: "11111111-1111-4111-8111-111111111111",
  system: "10101010-1010-4010-8010-101010101010",
  entity: "22222222-2222-4222-8222-222222222222",
  tenant: "33333333-3333-4333-8333-333333333333",
  siblingTenant: "44444444-4444-4444-8444-444444444444",
  release: "55555555-5555-4555-8555-555555555555",
  track: "66666666-6666-4666-8666-666666666666",
  artist: "77777777-7777-4777-8777-777777777777",
  label: "88888888-8888-4888-8888-888888888888",
  otherLabel: "99999999-9999-4999-8999-999999999999"
};

function context(overrides: Partial<InternalAuthContext> = {}): InternalAuthContext {
  return {
    v: 1,
    requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    authType: "user",
    actorId: ids.actor,
    entityId: ids.entity,
    entityType: "SUB_ACCOUNT",
    entityRole: "OWNER",
    tenantId: ids.tenant,
    entityPath: "root.system.org.sub",
    roles: ["SUB_ACCOUNT"],
    staffRoles: [],
    authzVersion: 1,
    ...overrides
  };
}

function fakeDatabase() {
  const prisma = {
      businessEntity: {
        findUnique: vi.fn(),
        findFirst: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      },
      label: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      subAccountLabelAccess: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn().mockResolvedValue(1), deleteMany: vi.fn(), createMany: vi.fn() },
      tenantBrandProfile: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), updateMany: vi.fn(), create: vi.fn() },
      tenantDomain: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
      artist: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn() },
      release: {
        findUnique: vi.fn(),
        findUniqueOrThrow: vi.fn(),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        updateMany: vi.fn(),
        delete: vi.fn()
      },
      track: { findUnique: vi.fn(), findMany: vi.fn().mockResolvedValue([]), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn(), count: vi.fn() },
      composition: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
      playlist: { findMany: vi.fn(), create: vi.fn() },
      outboxEvent: { create: vi.fn() },
      $transaction: vi.fn()
  };
  prisma.$transaction.mockImplementation(async callback => callback(prisma));
  return {
    prisma
  };
}

function mockBusinessEntityChain(
  database: ReturnType<typeof fakeDatabase>,
  entities: Array<{ id: string; parentId: string | null; path: string; entityType: "SUPER_ADMIN" | "SYSTEM_ADMIN" | "ORGANIZATION" | "SUB_ACCOUNT"; isActive: boolean }>
) {
  const byId = new Map(entities.map(entity => [entity.id, entity]));
  database.prisma.businessEntity.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) => byId.get(where.id) ?? null);
}

describe("catalog tenant invariants", () => {
  it("rejects Artist access to an inactive tenant even with an existing label grant", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release, tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label,
      tenant: { path: "root.system.org", isActive: false },
      owner: { path: "root.system.org.sub", entityType: "SUB_ACCOUNT" },
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.getRelease(context(), ids.release)).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect(database.prisma.subAccountLabelAccess.count).not.toHaveBeenCalled();
  });

  it.each(["DRAFT", "SYS_REJECTED"])("routes direct Artist %s submissions to BeAlpha without phantom organization review", async status => {
    const database = fakeDatabase();
    const release = {
      id: ids.release, type: "AUDIO", format: "SINGLE", status, ownerId: ids.entity, tenantId: ids.entity,
      labelId: ids.label, coverUrl: "media-asset:cover", upcLockedAt: null,
      tenant: { path: "root.system.artist", isActive: true },
      owner: { path: "root.system.artist", entityType: "SUB_ACCOUNT" },
      metadata: { cLine: "2026 Label", pLine: "2026 Label" },
    };
    database.prisma.release.findUnique.mockResolvedValueOnce(release).mockResolvedValueOnce({
      ean: "123456789012", format: "SINGLE", genre: "Pop", displayArtist: "Artist", metadata: release.metadata,
      label: { name: "Label" }, tracks: [{ isrc: "USABC2600001", duration: 180, audioAssetId: ids.track, discNumber: 1, trackNumber: 1 }],
    });
    database.prisma.track.count.mockResolvedValue(1);
    database.prisma.release.update.mockImplementation(async ({ data }) => ({ ...release, ...data }));
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const result = await service.submitRelease(context({ tenantId: ids.entity, entityPath: release.owner.path }), ids.release, { targetDsps: ["spotify"] });
    expect(result.status).toBe("PENDING_SYS_APPROVAL");
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      type: "catalog.release.submitted", payload: expect.objectContaining({ status: "PENDING_SYS_APPROVAL", recipientEntityPath: "root.system" }),
    }) }));
    expect(database.prisma.track.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { releaseId: ids.release, isrcLockedAt: null } }));
  });

  it.each([
    ["ORGANIZATION", "DISTRIBUTOR"],
    ["ORGANIZATION", "LABEL"],
    ["SUB_ACCOUNT", "LABEL"],
    ["SYSTEM_ADMIN", "BEALPHA"],
  ] as const)("rejects %s/%s under a Label", async (entityType, businessTier) => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    mockBusinessEntityChain(database, [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: rootId, path: "root.ops", entityType: "SYSTEM_ADMIN", isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.ops.distributor", entityType: "ORGANIZATION", isActive: true },
      { id: ids.entity, parentId: ids.tenant, path: "root.ops.distributor.label", entityType: "ORGANIZATION", isActive: true },
    ]);
    await expect(new CatalogService(database as unknown as CatalogDatabase).createEntity(
      context({ entityId: ids.entity, entityType: "ORGANIZATION", entityRole: "OWNER", entityPath: "root.ops.distributor.label" }),
      { parentId: ids.entity, entityType, businessTier, officialName: "Invalid" },
    )).rejects.toMatchObject({ code: "INVALID_ENTITY_TREE" });
    expect(database.prisma.businessEntity.create).not.toHaveBeenCalled();
  });

  it.each([
    ["ORGANIZATION", "LABEL", 3],
    ["SUB_ACCOUNT", "ARTIST", 4],
  ] as const)("creates direct %s/%s without a fake intermediary", async (entityType, businessTier, level) => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    const entities = [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN" as const, isActive: true },
      { id: ids.system, parentId: rootId, path: "root.ops", entityType: "SYSTEM_ADMIN" as const, isActive: true },
    ];
    mockBusinessEntityChain(database, entities);
    database.prisma.businessEntity.create.mockImplementation(async ({ data }) => ({ ...data, isActive: true, version: 1 }));
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const result = await service.createEntity(context({ entityId: ids.system, entityType: "SYSTEM_ADMIN", entityRole: "OWNER", entityPath: "root.ops" }), {
      parentId: ids.system, entityType, businessTier, officialName: "Direct customer",
    });
    expect(result).toMatchObject({ parentId: ids.system, entityType, businessTier });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ tenantId: result.id, businessTier }) }) }));
    database.prisma.businessEntity.findMany.mockResolvedValue([...entities, result]);
    expect((await service.listEntities(context({ entityType: "SUPER_ADMIN", entityPath: "root" }))).at(-1)?.businessLevel).toBe(level);
  });

  it("persists the semantic tier when creating a distributor", async () => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    mockBusinessEntityChain(database, [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: rootId, path: "root.ops", entityType: "SYSTEM_ADMIN", isActive: true },
    ]);
    database.prisma.businessEntity.create.mockImplementation(async ({ data }) => ({ ...data, isActive: true, version: 1 }));
    const result = await new CatalogService(database as unknown as CatalogDatabase).createEntity(
      context({ entityId: ids.system, entityType: "SYSTEM_ADMIN", entityRole: "OWNER", entityPath: "root.ops" }),
      { parentId: ids.system, entityType: "ORGANIZATION", officialName: "Distributor" },
    );
    expect(result).toMatchObject({ businessTier: "DISTRIBUTOR" });
    expect(database.prisma.businessEntity.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ businessTier: "DISTRIBUTOR" }) }));
  });

  it("uses stored business tiers for direct Label and Artist units rather than depth", async () => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    const entities = [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN" as const, isActive: true, businessTier: null },
      { id: ids.system, parentId: rootId, path: "root.ops", entityType: "SYSTEM_ADMIN" as const, isActive: true, businessTier: "BEALPHA" },
      { id: ids.tenant, parentId: ids.system, path: "root.ops.label", entityType: "ORGANIZATION" as const, isActive: true, businessTier: "LABEL" },
      { id: ids.entity, parentId: ids.system, path: "root.ops.artist", entityType: "SUB_ACCOUNT" as const, isActive: true, businessTier: "ARTIST" },
    ];
    database.prisma.businessEntity.findMany.mockResolvedValue(entities);
    mockBusinessEntityChain(database, entities);
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const listed = await service.listEntities(context({ entityId: rootId, entityType: "SUPER_ADMIN", entityPath: "root" }));
    expect(listed.map(entity => entity.businessLevel)).toEqual([0, 1, 3, 4]);
  });

  it("rejects inconsistent or non-descending stored business tiers", async () => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    const entities = [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN" as const, isActive: true, businessTier: null },
      { id: ids.system, parentId: rootId, path: "root.ops", entityType: "SYSTEM_ADMIN" as const, isActive: true, businessTier: "BEALPHA" },
      { id: ids.tenant, parentId: ids.system, path: "root.ops.label", entityType: "ORGANIZATION" as const, isActive: true, businessTier: "LABEL" },
      { id: ids.entity, parentId: ids.tenant, path: "root.ops.label.wrong", entityType: "ORGANIZATION" as const, isActive: true, businessTier: "DISTRIBUTOR" },
    ];
    database.prisma.businessEntity.findMany.mockResolvedValue(entities);
    mockBusinessEntityChain(database, entities);
    const listed = await new CatalogService(database as unknown as CatalogDatabase).listEntities(context({ entityType: "SUPER_ADMIN", entityPath: "root" }));
    expect(listed.at(-1)?.businessLevel).toBeNull();
  });

  it("filters the organization work queue by direct reviewer before applying the result limit", async () => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await service.listReleases(context({ entityId: ids.tenant, entityType: "ORGANIZATION", entityRole: "REVIEWER", entityPath: "root.system.org" }), { workQueue: true, limit: 50 });
    expect(database.prisma.release.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { AND: [
        { tenantId: ids.tenant, owner: { OR: [{ path: "root.system.org" }, { path: { startsWith: "root.system.org." } }] } },
        { OR: [{ status: "PENDING_ORG_APPROVAL", OR: [{ ownerId: ids.tenant }, { owner: { entityType: "SUB_ACCOUNT", parentId: ids.tenant } }] }] }
      ] }, take: 50
    }));
  });

  it.each(["SYSTEM_ADMIN", "SUPER_ADMIN"] as const)("shows only the matching approval stage for %s reviewers", async (entityType) => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await service.listReleases(context({ entityType, entityRole: "REVIEWER", entityPath: "root.system" }), { workQueue: true });
    const where = database.prisma.release.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toEqual({ tenant: { OR: [{ path: "root.system" }, { path: { startsWith: "root.system." } }] } });
    expect(where.AND[1]).toEqual({ OR: [{ status: entityType === "SYSTEM_ADMIN" ? "PENDING_SYS_APPROVAL" : "PENDING_SUPER_APPROVAL" }] });
  });

  it("gives an accountant no actionable work rather than exposing approval tasks", async () => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await service.listReleases(context({ entityType: "ORGANIZATION", entityRole: "ACCOUNTANT" }), { workQueue: true });
    expect(database.prisma.release.findMany.mock.calls[0][0].where.AND[1]).toEqual({ OR: [] });
  });

  it("preserves client ownership and label grants in the actionable queue", async () => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await service.listReleases(context(), { workQueue: true, status: "DRAFT" });
    const where = database.prisma.release.findMany.mock.calls[0][0].where;
    expect(where.AND[0]).toMatchObject({ ownerId: ids.entity, tenantId: ids.tenant, status: "DRAFT" });
    expect(where.AND[0].label).toBeDefined();
    expect(where.AND[1]).toEqual({ OR: [{ status: { in: ["DRAFT", "ORG_REJECTED", "SYS_REJECTED", "SUPER_REJECTED"] } }] });
  });

  it("derives canonical business levels from the stored parent chain when listing entities", async () => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    const childOrganizationId = "bbbbbbbb-0000-4000-8000-000000000000";
    const directSubAccountId = "cccccccc-0000-4000-8000-000000000000";
    const nestedSubAccountId = "dddddddd-0000-4000-8000-000000000000";
    const entities = [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN" as const, isActive: true },
      { id: ids.system, parentId: rootId, path: "root.system", entityType: "SYSTEM_ADMIN" as const, isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.system.distributor", entityType: "ORGANIZATION" as const, isActive: true },
      { id: childOrganizationId, parentId: ids.tenant, path: "root.system.distributor.label", entityType: "ORGANIZATION" as const, isActive: true },
      { id: directSubAccountId, parentId: ids.tenant, path: "root.system.distributor.artist", entityType: "SUB_ACCOUNT" as const, isActive: true },
      { id: nestedSubAccountId, parentId: childOrganizationId, path: "root.system.distributor.label.artist", entityType: "SUB_ACCOUNT" as const, isActive: true }
    ];
    database.prisma.businessEntity.findMany.mockResolvedValue(entities);
    mockBusinessEntityChain(database, entities);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    const listed = await service.listEntities(context({
      entityId: rootId,
      entityType: "SUPER_ADMIN",
      entityPath: "root",
      roles: ["SUPER_ADMIN"]
    }));

    expect(listed.map(entity => [entity.entityType, entity.businessLevel])).toEqual([
      ["SUPER_ADMIN", 0],
      ["SYSTEM_ADMIN", 1],
      ["ORGANIZATION", 2],
      ["ORGANIZATION", 3],
      ["SUB_ACCOUNT", 4],
      ["SUB_ACCOUNT", 4]
    ]);
    expect(database.prisma.businessEntity.findUnique).not.toHaveBeenCalled();
  });

  it("marks a historical entity with an invalid parent chain as having no business level", async () => {
    const database = fakeDatabase();
    const invalid = {
      id: "eeeeeeee-0000-4000-8000-000000000000",
      parentId: "dddddddd-0000-4000-8000-000000000000",
      path: "root.system.distributor.label.extra",
      entityType: "ORGANIZATION" as const,
      isActive: true
    };
    const entities = [
      { id: "aaaaaaaa-0000-4000-8000-000000000000", parentId: null, path: "root", entityType: "SUPER_ADMIN" as const, isActive: true },
      { id: ids.system, parentId: "aaaaaaaa-0000-4000-8000-000000000000", path: "root.system", entityType: "SYSTEM_ADMIN" as const, isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.system.distributor", entityType: "ORGANIZATION" as const, isActive: true },
      { id: "dddddddd-0000-4000-8000-000000000000", parentId: ids.tenant, path: "root.system.distributor.label", entityType: "ORGANIZATION" as const, isActive: true },
      invalid
    ];
    database.prisma.businessEntity.findMany.mockResolvedValue(entities);
    mockBusinessEntityChain(database, entities);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    const listed = await service.listEntities(context({ entityType: "SUPER_ADMIN", entityPath: "root", roles: ["SUPER_ADMIN"] }));

    expect(listed.at(-1)).toMatchObject({ id: invalid.id, businessLevel: null });
  });

  it("rejects creating an organization below business level three using the stored parent chain", async () => {
    const database = fakeDatabase();
    const rootId = "aaaaaaaa-0000-4000-8000-000000000000";
    const labelId = "bbbbbbbb-0000-4000-8000-000000000000";
    mockBusinessEntityChain(database, [
      { id: rootId, parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: rootId, path: "root.system", entityType: "SYSTEM_ADMIN", isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.system.distributor", entityType: "ORGANIZATION", isActive: true },
      { id: labelId, parentId: ids.tenant, path: "root.system.distributor.label", entityType: "ORGANIZATION", isActive: true }
    ]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.createEntity(context({
      entityId: labelId,
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityPath: "root.system.distributor.label",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), {
      parentId: labelId,
      entityType: "ORGANIZATION",
      officialName: "Too Deep"
    })).rejects.toMatchObject({ code: "INVALID_ENTITY_TREE", statusCode: 409 });
    expect(database.prisma.businessEntity.create).not.toHaveBeenCalled();
  });

  it.each(["root", "root.system", "root.system.other"])("rejects creating under out-of-scope parent %s", async (parentPath) => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({ id: "parent", parentId: null, path: parentPath, entityType: "ORGANIZATION", isActive: true });
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.createEntity(context({ entityId: ids.tenant, entityType: "ORGANIZATION", entityPath: "root.system.org" }), {
      parentId: "parent", entityType: "SUB_ACCOUNT", officialName: "Rejected"
    })).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
    expect(database.prisma.businessEntity.create).not.toHaveBeenCalled();
  });

  it("rejects extending a malformed or cyclic stored hierarchy", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({ id: ids.tenant, parentId: ids.tenant, path: "root.system.org", entityType: "ORGANIZATION", isActive: true });
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.createEntity(context({ entityId: ids.tenant, entityType: "ORGANIZATION", entityPath: "root.system.org" }), {
      parentId: ids.tenant, entityType: "SUB_ACCOUNT", officialName: "Rejected"
    })).rejects.toMatchObject({ statusCode: 409, code: "INVALID_ENTITY_TREE" });
    expect(database.prisma.businessEntity.create).not.toHaveBeenCalled();
  });

  it("allows an organization to create a nested organization in the same root tenant", async () => {
    const database = fakeDatabase();
    const nestedParentId = ids.tenant;
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: nestedParentId,
      parentId: ids.system,
      path: "root.system.tenant",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.businessEntity.findMany.mockResolvedValue([
      { id: nestedParentId, path: "root.system.tenant" },
      { id: ids.tenant, path: "root.system.tenant" }
    ]);
    database.prisma.businessEntity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      isActive: true,
      version: 1
    }));
    database.prisma.outboxEvent.create.mockResolvedValue({});
    mockBusinessEntityChain(database, [
      { id: "root-id", parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: "root-id", path: "root.system", entityType: "SYSTEM_ADMIN", isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.system.tenant", entityType: "ORGANIZATION", isActive: true },
    ]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    const created = await service.createEntity(context({
      entityId: nestedParentId,
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityPath: "root.system.tenant",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), {
      parentId: nestedParentId,
      entityType: "ORGANIZATION",
      officialName: "Regional Office"
    });

    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          id: created.id,
          entityType: "ORGANIZATION",
          tenantId: ids.tenant
        })
      })
    });
  });

  it("uses the earliest organization ancestor when a super admin creates a nested organization", async () => {
    const database = fakeDatabase();
    const nestedParentId = ids.tenant;
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: nestedParentId,
      parentId: ids.system,
      path: "root.system.tenant",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.businessEntity.findMany.mockResolvedValue([
      { id: nestedParentId, path: "root.system.tenant" },
      { id: ids.tenant, path: "root.system.tenant" }
    ]);
    database.prisma.businessEntity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      isActive: true,
      version: 1
    }));
    database.prisma.outboxEvent.create.mockResolvedValue({});
    mockBusinessEntityChain(database, [
      { id: "root-id", parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: "root-id", path: "root.system", entityType: "SYSTEM_ADMIN", isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.system.tenant", entityType: "ORGANIZATION", isActive: true },
    ]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    const created = await service.createEntity(context({
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityPath: "root",
      tenantId: undefined,
      roles: ["SUPER_ADMIN"]
    }), {
      parentId: nestedParentId,
      entityType: "ORGANIZATION",
      officialName: "Regional Office"
    });

    expect(database.prisma.businessEntity.findMany).toHaveBeenCalledWith({
      where: {
        entityType: { in: ["ORGANIZATION", "SUB_ACCOUNT"] },
        path: { in: ["root", "root.system", "root.system.tenant"] }
      },
      select: { id: true, path: true }
    });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ id: created.id, tenantId: ids.tenant })
      })
    });
  });

  it("uses the earliest organization ancestor when a super admin creates a sub-account", async () => {
    const database = fakeDatabase();
    const nestedParentId = "12121212-1212-4212-8212-121212121212";
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: nestedParentId,
      parentId: ids.tenant,
      path: "root.system.tenant.department",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.businessEntity.findMany.mockResolvedValue([
      { id: nestedParentId, path: "root.system.tenant.department" },
      { id: ids.tenant, path: "root.system.tenant" }
    ]);
    database.prisma.businessEntity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      isActive: true,
      version: 1
    }));
    database.prisma.outboxEvent.create.mockResolvedValue({});
    mockBusinessEntityChain(database, [
      { id: "root-id", parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: "root-id", path: "root.system", entityType: "SYSTEM_ADMIN", isActive: true },
      { id: ids.tenant, parentId: ids.system, path: "root.system.tenant", entityType: "ORGANIZATION", isActive: true },
      { id: nestedParentId, parentId: ids.tenant, path: "root.system.tenant.department", entityType: "ORGANIZATION", isActive: true },
    ]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    const created = await service.createEntity(context({
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityPath: "root",
      tenantId: undefined,
      roles: ["SUPER_ADMIN"]
    }), {
      parentId: nestedParentId,
      entityType: "SUB_ACCOUNT",
      officialName: "Artist Account"
    });

    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ id: created.id, entityType: "SUB_ACCOUNT", tenantId: ids.tenant })
      })
    });
  });

  it("emits a complete organization snapshot when a system admin creates a tenant", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.system,
      parentId: null,
      path: "root.system",
      entityType: "SYSTEM_ADMIN",
      isActive: true
    });
    database.prisma.businessEntity.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
      ...data,
      isActive: true,
      version: 1
    }));
    database.prisma.outboxEvent.create.mockResolvedValue({});
    mockBusinessEntityChain(database, [
      { id: "root-id", parentId: null, path: "root", entityType: "SUPER_ADMIN", isActive: true },
      { id: ids.system, parentId: "root-id", path: "root.system", entityType: "SYSTEM_ADMIN", isActive: true }
    ]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    const created = await service.createEntity(context({
      entityId: ids.system,
      entityType: "SYSTEM_ADMIN",
      entityPath: "root.system",
      tenantId: undefined,
      roles: ["SYSTEM_ADMIN"]
    }), {
      parentId: ids.system,
      entityType: "ORGANIZATION",
      officialName: "Acme Records"
    });

    expect(created.entityId).toBe(created.id);

    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "catalog.entity.created",
        payload: {
          id: created.id,
          entityType: "ORGANIZATION",
          businessTier: "DISTRIBUTOR",
          name: "Acme Records",
          path: created.path,
          tenantId: created.id,
          isActive: true,
          version: 1
        }
      })
    });
  });

  it("emits an inactive versioned sub-account snapshot mapped to its organization", async () => {
    const database = fakeDatabase();
    const nestedParentId = "12121212-1212-4212-8212-121212121212";
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.entity,
      parentId: nestedParentId,
      path: "root.system.org.department.sub",
      entityType: "SUB_ACCOUNT",
      isActive: true
    });
    database.prisma.businessEntity.update.mockResolvedValue({
      id: ids.entity,
      entityType: "SUB_ACCOUNT",
      officialName: "Artist Account",
      path: "root.system.org.department.sub",
      isActive: false,
      version: 4
    });
    database.prisma.businessEntity.findMany.mockResolvedValue([
      { id: nestedParentId, path: "root.system.org.department" },
      { id: ids.tenant, path: "root.system.org" }
    ]);
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.updateEntity(context({
      entityType: "ORGANIZATION",
      entityRole: "ADMIN",
      entityId: nestedParentId,
      entityPath: "root.system.org.department",
      roles: ["ORGANIZATION"]
    }), ids.entity, { isActive: false });

    expect(database.prisma.businessEntity.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ids.entity },
      data: { isActive: false, version: { increment: 1 } }
    }));
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "catalog.entity.updated",
        payload: {
          id: ids.entity,
          entityType: "SUB_ACCOUNT",
          name: "Artist Account",
          path: "root.system.org.department.sub",
          tenantId: ids.tenant,
          isActive: false,
          version: 4
        }
      })
    });
  });

  it("emits the root tenant for an updated nested organization", async () => {
    const database = fakeDatabase();
    const nestedOrganizationId = "12121212-1212-4212-8212-121212121212";
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: nestedOrganizationId,
      parentId: ids.tenant,
      path: "root.system.tenant.department",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.businessEntity.findMany.mockResolvedValue([
      { id: nestedOrganizationId, path: "root.system.tenant.department" },
      { id: ids.tenant, path: "root.system.tenant" }
    ]);
    database.prisma.businessEntity.update.mockResolvedValue({
      id: nestedOrganizationId,
      entityType: "ORGANIZATION",
      officialName: "Regional Office Updated",
      path: "root.system.tenant.department",
      isActive: true,
      version: 2,
      parent: { id: ids.tenant }
    });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.updateEntity(context({
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityPath: "root",
      tenantId: undefined,
      roles: ["SUPER_ADMIN"]
    }), nestedOrganizationId, { officialName: "Regional Office Updated" });

    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "catalog.entity.updated",
        payload: expect.objectContaining({
          id: nestedOrganizationId,
          entityType: "ORGANIZATION",
          tenantId: ids.tenant
        })
      })
    });
  });

  it("does not let a sub-account owner update its organization tenant", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      parentId: ids.system,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.updateEntity(context(), ids.tenant, {
      officialName: "Hijacked tenant"
    })).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.businessEntity.update).not.toHaveBeenCalled();
  });

  it("inherits the organization brand for a sub-account", async () => {
    const database = fakeDatabase();
    database.prisma.tenantBrandProfile.findUnique.mockResolvedValue({
      tenantId: ids.tenant,
      displayName: "Acme Records",
      logoAssetId: ids.artist,
      accentColor: "#111111",
      accentTextColor: "#FFFFFF",
      supportEmail: "support@acme.test",
      supportUrl: null,
      defaultLocale: "en",
      version: 2
    });
    database.prisma.businessEntity.findUnique.mockResolvedValue({ officialName: "Acme", entityType: "ORGANIZATION", isActive: true });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.getTenantBrand(context())).resolves.toMatchObject({
      tenantId: ids.tenant,
      displayName: "Acme Records",
      logoUrl: `/media-public/${ids.artist}`,
      version: 2
    });
  });

  it("allows only the organization owner to update safe brand fields", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({ officialName: "Acme", entityType: "ORGANIZATION", isActive: true });
    database.prisma.tenantBrandProfile.updateMany.mockResolvedValue({ count: 1 });
    database.prisma.tenantBrandProfile.findUniqueOrThrow.mockResolvedValue({ tenantId: ids.tenant, version: 2 });
    database.prisma.tenantBrandProfile.findUnique.mockResolvedValue({ tenantId: ids.tenant, displayName: "Acme Records", logoAssetId: null, accentColor: "#111111", accentTextColor: "#FFFFFF", supportEmail: null, supportUrl: null, defaultLocale: "en", version: 2 });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const input = { displayName: "Acme Records", logoAssetId: null, accentColor: "#111111", accentTextColor: "#FFFFFF", supportEmail: null, supportUrl: null, defaultLocale: "en", expectedVersion: 1 };
    const owner = context({ entityType: "ORGANIZATION", entityRole: "OWNER", entityId: ids.tenant, entityPath: "root.system.org", roles: ["ORGANIZATION"] });

    await service.updateTenantBrand(owner, input);
    expect(database.prisma.tenantBrandProfile.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: ids.tenant, version: 1 } }));
    await expect(service.updateTenantBrand({ ...owner, entityRole: "ADMIN" }, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a stale tenant-brand update instead of overwriting a newer version", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({ entityType: "ORGANIZATION", isActive: true });
    database.prisma.tenantBrandProfile.updateMany.mockResolvedValue({ count: 0 });
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const owner = context({ entityType: "ORGANIZATION", entityRole: "OWNER", entityId: ids.tenant, entityPath: "root.system.org", roles: ["ORGANIZATION"] });

    await expect(service.updateTenantBrand(owner, {
      displayName: "Stale",
      accentColor: "#111111",
      accentTextColor: "#FFFFFF",
      defaultLocale: "en",
      expectedVersion: 2
    })).rejects.toMatchObject({ code: "VERSION_CONFLICT", statusCode: 409 });
    expect(database.prisma.tenantBrandProfile.create).not.toHaveBeenCalled();
    expect(database.prisma.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("verifies DNS only for an exact Organization-owned tenant domain", async () => {
    const database = fakeDatabase();
    const token = "tenant-domain-proof";
    const verificationTokenHash = createHash("sha256").update(token).digest("hex");
    const domain = {
      id: ids.label,
      tenantId: ids.tenant,
      hostname: "music.example.test",
      status: "PENDING",
      verificationTokenHash,
      version: 1,
      verifiedAt: null,
      lastCheckedAt: null
    };
    database.prisma.tenantDomain.findFirst.mockResolvedValue(domain);
    database.prisma.tenantDomain.updateMany.mockResolvedValue({ count: 1 });
    database.prisma.tenantDomain.findUniqueOrThrow.mockResolvedValue({ ...domain, status: "VERIFIED", version: 2, verifiedAt: new Date() });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const resolveTxt = vi.fn().mockResolvedValue([[`bealpha-verification=${token}`]]);
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const service = new CatalogService(database as unknown as CatalogDatabase, { resolveTxt, invalidate });
    const owner = context({ entityType: "ORGANIZATION", entityRole: "OWNER", entityId: ids.tenant, entityPath: "root.system.org", roles: ["ORGANIZATION"] });

    await expect(service.verifyTenantDomain(owner, ids.label, 1)).resolves.toMatchObject({ status: "VERIFIED", version: 2 });
    expect(resolveTxt).toHaveBeenCalledWith("_bealpha-verification.music.example.test");
    expect(database.prisma.tenantDomain.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ids.label, tenantId: ids.tenant, version: 1, status: "PENDING" }
    }));
    expect(invalidate).toHaveBeenCalledTimes(2);

    database.prisma.tenantDomain.findFirst.mockResolvedValueOnce(null);
    await expect(service.verifyTenantDomain({ ...owner, entityId: ids.siblingTenant, tenantId: ids.siblingTenant }, ids.label, 1)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("resolves only an exact verified hostname for an active Organization", async () => {
    const database = fakeDatabase();
    database.prisma.tenantDomain.findFirst.mockResolvedValue({ tenantId: ids.tenant, hostname: "music.example.test", version: 3 });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.resolveTenantDomain("MUSIC.example.test.")).resolves.toEqual({ tenantId: ids.tenant, hostname: "music.example.test", version: 3 });
    expect(database.prisma.tenantDomain.findFirst).toHaveBeenCalledWith({
      where: { hostname: "music.example.test", status: "VERIFIED", tenant: { entityType: "ORGANIZATION", isActive: true } },
      select: { tenantId: true, hostname: true, version: true }
    });
  });

  it("returns only public brand fields for an exact verified tenant hostname", async () => {
    const database = fakeDatabase();
    database.prisma.tenantDomain.findFirst.mockResolvedValue({
      tenantId: ids.tenant,
      tenant: {
        officialName: "Tenant Label",
        brandProfile: { displayName: "White Label", logoAssetId: ids.track, accentColor: "#112233", accentTextColor: "#FFFFFF", supportEmail: "help@example.test", supportUrl: null, defaultLocale: "vi", version: 2 }
      }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.resolvePublicTenantBrand("MUSIC.example.test.")).resolves.toEqual({
      tenantId: ids.tenant, displayName: "White Label", logoAssetId: ids.track,
      logoUrl: `/media-public/${ids.track}`, accentColor: "#112233", accentTextColor: "#FFFFFF",
      supportEmail: "help@example.test", supportUrl: null, defaultLocale: "vi", version: 2
    });
    expect(database.prisma.tenantDomain.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { hostname: "music.example.test", status: "VERIFIED", tenant: { entityType: "ORGANIZATION", isActive: true } }
    }));
  });

  it.each(["localhost", "192.168.1.7", "171.241.31.72"])(
    "returns the platform brand for platform host %s without a tenant-domain lookup",
    async hostname => {
      const database = fakeDatabase();
      const service = new CatalogService(database as unknown as CatalogDatabase);

      await expect(service.resolvePublicTenantBrand(hostname)).resolves.toMatchObject({
        displayName: "BeAlpha Music",
        logoAssetId: null,
        logoUrl: null,
        accentColor: "#111111",
        accentTextColor: "#FFFFFF",
        defaultLocale: "en",
        version: 1
      });
      expect(database.prisma.tenantDomain.findFirst).not.toHaveBeenCalled();
    }
  );

  it("fails closed when listing labels for a sub-account without grants", async () => {
    const database = fakeDatabase();
    database.prisma.label.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listLabels(context());

    expect(database.prisma.label.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: ids.tenant,
        subAccountAccess: { some: { subAccountId: ids.entity, tenantId: ids.tenant } }
      }
    }));
  });

  it("denies a same-tenant label that is not assigned to the sub-account", async () => {
    const database = fakeDatabase();
    database.prisma.label.findUnique.mockResolvedValue({
      id: ids.label,
      tenantId: ids.tenant,
      tenant: { path: "root.system.org" }
    });
    database.prisma.subAccountLabelAccess.count.mockResolvedValue(0);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.getLabel(context(), ids.label)).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("lets an organization admin replace grants only for its direct sub-account and labels", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.entity,
      parentId: ids.tenant,
      path: "root.system.org.sub",
      entityType: "SUB_ACCOUNT",
      isActive: true
    });
    database.prisma.label.findMany.mockResolvedValue([{ id: ids.label, tenantId: ids.tenant }]);
    database.prisma.subAccountLabelAccess.deleteMany.mockResolvedValue({ count: 0 });
    database.prisma.subAccountLabelAccess.createMany.mockResolvedValue({ count: 1 });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.replaceSubAccountLabelAccess(context({
      entityType: "ORGANIZATION",
      entityRole: "ADMIN",
      entityId: ids.tenant,
      tenantId: ids.tenant,
      entityPath: "root.system.org",
      roles: ["ORGANIZATION"]
    }), ids.entity, [ids.label]);

    expect(database.prisma.subAccountLabelAccess.createMany).toHaveBeenCalledWith({
      data: [{ tenantId: ids.tenant, subAccountId: ids.entity, labelId: ids.label }]
    });
  });

  it("rejects a cross-tenant label assignment", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.entity,
      parentId: ids.tenant,
      path: "root.system.org.sub",
      entityType: "SUB_ACCOUNT",
      isActive: true
    });
    database.prisma.label.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.replaceSubAccountLabelAccess(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.tenant,
      tenantId: ids.tenant,
      entityPath: "root.system.org",
      roles: ["ORGANIZATION"]
    }), ids.entity, [ids.otherLabel])).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.subAccountLabelAccess.deleteMany).not.toHaveBeenCalled();
  });

  it("does not let an organization member manage sub-account label grants", async () => {
    const database = fakeDatabase();
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.replaceSubAccountLabelAccess(context({
      entityType: "ORGANIZATION",
      entityRole: "MEMBER",
      entityId: ids.tenant,
      tenantId: ids.tenant,
      entityPath: "root.system.org",
      roles: ["ORGANIZATION"]
    }), ids.entity, [ids.label])).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(database.prisma.label.findMany).not.toHaveBeenCalled();
  });

  it("filters sub-account artists through assigned labels", async () => {
    const database = fakeDatabase();
    database.prisma.artist.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listArtists(context());

    expect(database.prisma.artist.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: ids.tenant,
        label: { subAccountAccess: { some: { subAccountId: ids.entity, tenantId: ids.tenant } } }
      }
    }));
  });

  it("denies release creation for an unassigned label", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({ id: ids.tenant, path: "root.system.org", entityType: "ORGANIZATION", isActive: true });
    database.prisma.label.findUnique.mockResolvedValue({ tenantId: ids.tenant });
    database.prisma.subAccountLabelAccess.count.mockResolvedValue(0);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.createRelease(context(), {
      title: "Denied album",
      releaseDate: new Date("2026-08-22"),
      labelId: ids.label
    })).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.release.create).not.toHaveBeenCalled();
  });
  it("allows only super admins to list global playlists", async () => {
    const database = fakeDatabase();
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.listPlaylists(context())).rejects.toMatchObject({ code: "FORBIDDEN" });
    database.prisma.playlist.findMany.mockResolvedValue([]);
    await expect(service.listPlaylists(context({ entityType: "SUPER_ADMIN", roles: ["SUPER_ADMIN"] }))).resolves.toEqual([]);
  });
  it("returns denormalized analytics scope without cross-entity access", async () => {
    const database = fakeDatabase();
    const release = { id: ids.release, tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label, owner: { path: "root.system.org.sub" }, tenant: { path: "root.system.org", isActive: true } };
    database.prisma.track.findUnique.mockResolvedValue({ id: ids.track, releaseId: ids.release, title: "Track", release });
    database.prisma.release.findUnique.mockResolvedValue(release);
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.getTrackAnalyticsScope(context(), ids.track)).resolves.toEqual({ trackId: ids.track, trackTitle: "Track", tenantId: ids.tenant, entityPath: "root.system.org.sub" });
  });
  it("V11 limits sub-account release listing to its owner id", async () => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listReleases(context());

    expect(database.prisma.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ ownerId: ids.entity }) })
    );
  });

  it("V11 scopes export snapshots and caps them at 10000 tracks", async () => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([{ tracks: Array.from({ length: 10001 }, () => ({})) }]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.getExportSnapshot(context())).rejects.toMatchObject({ code: "EXPORT_TOO_LARGE", statusCode: 413 });
    expect(database.prisma.release.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ ownerId: ids.entity }), take: 10000 }));
  });

  it("V11 uses a path delimiter so org1 cannot match org10", async () => {
    const database = fakeDatabase();
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listReleases(
      context({
        entityType: "ORGANIZATION",
        entityPath: "root.system.org1",
        tenantId: ids.tenant,
        roles: ["ORGANIZATION"]
      })
    );

    expect(database.prisma.release.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: ids.tenant,
          owner: {
            OR: [
              { path: "root.system.org1" },
              { path: { startsWith: "root.system.org1." } }
            ]
          }
        }
      })
    );
  });

  it("keeps nested organization catalog records in the root tenant", async () => {
    const database = fakeDatabase();
    database.prisma.label.findMany.mockResolvedValue([]);
    database.prisma.artist.findMany.mockResolvedValue([]);
    database.prisma.composition.findMany.mockResolvedValue([]);
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.label,
      entityType: "ORGANIZATION",
      isActive: true,
      path: "root.system.org.department"
    });
    database.prisma.label.findUnique.mockResolvedValue({ tenantId: ids.tenant });
    database.prisma.artist.create.mockResolvedValue({ id: ids.artist, tenantId: ids.tenant });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const nested = context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    });

    await service.listLabels(nested);
    await service.listArtists(nested);
    await service.listCompositions(nested);
    expect(database.prisma.label.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: ids.tenant } }));
    expect(database.prisma.artist.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: ids.tenant } }));
    expect(database.prisma.composition.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: ids.tenant, owner: expect.anything() } }));

    await service.createArtist(nested, { name: "Nested Artist", labelId: ids.label });
    expect(database.prisma.artist.create).toHaveBeenCalledWith({ data: expect.objectContaining({ tenantId: ids.tenant, name: "Nested Artist" }) });
  });

  it("rejects a nested organization from assigning a catalog record to a child tenant id", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.otherLabel,
      entityType: "ORGANIZATION",
      isActive: true,
      path: "root.system.org.department.child"
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.createLabel(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), { name: "Wrong Tenant Label", tenantId: ids.otherLabel })).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.label.create).not.toHaveBeenCalled();
  });

  it("uses the root tenant when a nested organization manages sub-account label grants", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.entity,
      parentId: ids.label,
      path: "root.system.org.department.sub",
      entityType: "SUB_ACCOUNT",
      isActive: true
    });
    database.prisma.label.findMany.mockResolvedValue([{ id: ids.label, tenantId: ids.tenant }]);
    database.prisma.subAccountLabelAccess.deleteMany.mockResolvedValue({ count: 0 });
    database.prisma.subAccountLabelAccess.createMany.mockResolvedValue({ count: 1 });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await service.replaceSubAccountLabelAccess(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.label,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), ids.entity, [ids.label]);

    expect(database.prisma.label.findMany).toHaveBeenCalledWith({ where: { id: { in: [ids.label] }, tenantId: ids.tenant }, select: { id: true, tenantId: true } });
    expect(database.prisma.subAccountLabelAccess.createMany).toHaveBeenCalledWith({ data: [{ tenantId: ids.tenant, subAccountId: ids.entity, labelId: ids.label }] });
  });

  it("does not let a nested organization owner change root tenant branding", async () => {
    const database = fakeDatabase();
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.updateTenantBrand(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), {
      displayName: "Nested",
      accentColor: "#111111",
      accentTextColor: "#FFFFFF",
      defaultLocale: "en",
      expectedVersion: 1
    })).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("keeps nested organization composition access inside its owner subtree", async () => {
    const database = fakeDatabase();
    database.prisma.composition.findUnique.mockResolvedValue({
      id: ids.track,
      tenantId: ids.tenant,
      ownerId: ids.otherLabel,
      tenant: { path: "root.system.org" },
      owner: { path: "root.system.org.other-department" }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.getComposition(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), ids.track)).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("V11 scopes a sub-account release filter by owner instead of organization tenant id", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org1.child",
      entityType: "SUB_ACCOUNT",
      isActive: true
    });
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listReleases(
      context({ entityType: "ORGANIZATION", entityPath: "root.system.org1", tenantId: undefined, roles: ["ORGANIZATION"] }),
      { entityId: ids.tenant, status: "PENDING_ORG_APPROVAL", limit: 20 }
    );

    expect(database.prisma.release.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: ids.tenant, status: "PENDING_ORG_APPROVAL" }),
      take: 20
    }));
  });

  it("does not broaden a nested organization filter to its root tenant", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listReleases(context({
      entityType: "ORGANIZATION",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), { entityId: ids.tenant });

    expect(database.prisma.release.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        tenantId: ids.tenant,
        owner: {
          OR: [
            { path: "root.system.org.department" },
            { path: { startsWith: "root.system.org.department." } }
          ]
        }
      }
    }));
  });

  it("keeps a sub-account root-tenant filter constrained to its own releases", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.release.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listReleases(context(), { entityId: ids.tenant });

    expect(database.prisma.release.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ ownerId: ids.entity, tenantId: ids.tenant })
    }));
  });

  it("allows a nested organization to create labels in its root tenant", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.label.create.mockResolvedValue({ id: ids.label, tenantId: ids.tenant, name: "Department Label" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.createLabel(context({
      entityType: "ORGANIZATION",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), { name: "Department Label" });

    expect(database.prisma.label.create).toHaveBeenCalledWith({
      data: { name: "Department Label", tenantId: ids.tenant }
    });
  });

  it("does not let a nested organization attach a sibling composition", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "DRAFT",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      tenant: { path: "root.system.org", isActive: true },
      owner: { path: "root.system.org.department" }
    });
    database.prisma.composition.findUnique.mockResolvedValue({
      id: ids.track,
      tenantId: ids.tenant,
      ownerId: ids.otherLabel,
      tenant: { path: "root.system.org", isActive: true },
      owner: { path: "root.system.org.other-department" }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.createTrack(context({
      entityType: "ORGANIZATION",
      entityId: ids.entity,
      entityPath: "root.system.org.department",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), ids.release, { title: "Track", compositionId: ids.track })).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    });
    expect(database.prisma.track.create).not.toHaveBeenCalled();
  });

  it("V2 rejects an artist from a sibling tenant", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.artist.findUnique.mockResolvedValue({
      tenantId: ids.siblingTenant
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(
      service.createRelease(context(), {
        title: "Album",
        releaseDate: new Date("2026-07-11"),
        artistId: ids.artist
      })
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(database.prisma.release.create).not.toHaveBeenCalled();
  });

  it("stores release and track draft metadata atomically", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.label.findUnique.mockResolvedValue({ tenantId: ids.tenant });
    database.prisma.release.create.mockResolvedValue({
      id: ids.release,
      tenantId: ids.tenant,
      ownerId: ids.entity,
      tracks: []
    });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.createReleaseDraft(context(), {
      title: "Album",
      releaseDate: new Date("2026-07-15T00:00:00.000Z"),
      labelId: ids.label,
      metadata: { parentalWarningType: "NotExplicit" },
      tracks: [{ title: "Track", metadata: { lyricsLanguage: "en" } }]
    });

    expect(database.prisma.release.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: { parentalWarningType: "NotExplicit" },
        tracks: { create: [{ title: "Track", metadata: { lyricsLanguage: "en" } }] }
      }),
      include: { tracks: { orderBy: [{ discNumber: "asc" }, { trackNumber: "asc" }] } }
    });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledOnce();
  });

  it("V10 keeps UPC locked after delivery", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      ean: "123456789012",
      status: "DELIVERED",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(
      service.updateRelease(context(), ids.release, { ean: "123456789013" })
    ).rejects.toMatchObject({ code: "IDENTIFIER_LOCKED", statusCode: 409 });
  });

  it("V10 keeps ISRC locked after delivery", async () => {
    const database = fakeDatabase();
    database.prisma.track.findUnique.mockResolvedValue({
      id: ids.track,
      releaseId: ids.release,
      isrc: "USABC2600001",
      release: { tenantId: ids.tenant, status: "RELEASED" }
    });
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      ownerId: ids.entity,
      tenantId: ids.tenant,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(
      service.updateTrack(context(), ids.track, { isrc: "USABC2600002" })
    ).rejects.toMatchObject({ code: "IDENTIFIER_LOCKED", statusCode: 409 });
  });

  it("V10 rejects adding tracks after delivery lock", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "LOCKED_FOR_DELIVERY",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(
      service.createTrack(context(), ids.release, { title: "Late track" })
    ).rejects.toMatchObject({ code: "WORKFLOW_LOCKED", statusCode: 409 });
    expect(database.prisma.track.create).not.toHaveBeenCalled();
  });

  it("V4 rejects release approval from a sub-account", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "PENDING_ORG_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.approveRelease(context(), ids.release)).rejects.toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403
    });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("enforces release edit, submit, and delete capabilities at the service boundary", async () => {
    const database = fakeDatabase();
    const release = {
      id: ids.release,
      type: "AUDIO",
      status: "DRAFT",
      tenantId: ids.tenant,
      ownerId: ids.tenant,
      labelId: ids.label,
      coverUrl: "https://cdn.example.test/cover.jpg",
      ean: "123456789012",
      genre: "Pop",
      displayArtist: "Artist",
      metadata: { cLine: "2026 Label", pLine: "2026 Label" },
      tenant: { path: "root.system.org", isActive: true },
      owner: { path: "root.system.org" }
    };
    const readonlyRoles = ["REVIEWER", "ACCOUNTANT"] as const;
    const service = new CatalogService(database as unknown as CatalogDatabase);

    for (const entityRole of readonlyRoles) {
      const readonlyContext = context({
        entityType: "ORGANIZATION",
        entityRole,
        entityId: ids.tenant,
        entityPath: "root.system.org",
        tenantId: ids.tenant,
        roles: ["ORGANIZATION"]
      });
      await expect(service.updateRelease(readonlyContext, ids.release, { title: "Unauthorized" }))
        .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
      await expect(service.submitRelease(readonlyContext, ids.release, { targetDsps: ["spotify"] }))
        .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    }

    const member = context({
      entityType: "ORGANIZATION",
      entityRole: "MEMBER",
      entityId: ids.tenant,
      entityPath: "root.system.org",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    });
    await expect(service.deleteRelease(member, ids.release))
      .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

    database.prisma.release.findUnique.mockResolvedValue(release);
    database.prisma.release.update.mockResolvedValue({ ...release, title: "Member edit" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    await expect(service.updateRelease(member, ids.release, { title: "Member edit" }))
      .resolves.toMatchObject({ title: "Member edit" });

    database.prisma.release.findUnique
      .mockResolvedValueOnce(release)
      .mockResolvedValueOnce({
        ean: release.ean,
        format: "SINGLE",
        genre: release.genre,
        displayArtist: release.displayArtist,
        metadata: release.metadata,
        label: { name: "Label" },
        tracks: [{ isrc: "USABC2600001", duration: 180, audioAssetId: ids.track, discNumber: 1, trackNumber: 1 }]
      });
    database.prisma.track.count.mockResolvedValue(1);
    database.prisma.release.update.mockResolvedValue({ ...release, status: "PENDING_ORG_APPROVAL" });
    database.prisma.track.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.submitRelease(member, ids.release, { targetDsps: ["spotify"] }))
      .resolves.toMatchObject({ status: "PENDING_ORG_APPROVAL" });

    expect(database.prisma.release.delete).not.toHaveBeenCalled();
  });

  it("V4 advances organization approval only to system review", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "PENDING_ORG_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.release.update.mockResolvedValue({
      id: ids.release,
      status: "PENDING_SYS_APPROVAL"
    });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.approveRelease(context({
      entityType: "ORGANIZATION",
      entityRole: "ADMIN",
      entityId: ids.tenant,
      entityPath: "root.system.org",
      roles: ["ORGANIZATION"]
    }), ids.release);

    expect(database.prisma.release.update).toHaveBeenCalledWith({
      where: { id: ids.release },
      data: { status: "PENDING_SYS_APPROVAL" }
    });
  });

  it("allows a scoped organization reviewer to approve without tenant administration rights", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release, status: "PENDING_ORG_APPROVAL", tenantId: ids.tenant,
      ownerId: ids.entity, labelId: ids.label, tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.release.update.mockResolvedValue({ id: ids.release, status: "PENDING_SYS_APPROVAL" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.approveRelease(context({ entityType: "ORGANIZATION", entityRole: "REVIEWER", entityId: ids.tenant, entityPath: "root.system.org", roles: ["ORGANIZATION"] }), ids.release);

    expect(database.prisma.release.update).toHaveBeenCalledWith({ where: { id: ids.release }, data: { status: "PENDING_SYS_APPROVAL" } });
  });

  it("keeps a nested sub-account in its direct organization review queue", async () => {
    const database = fakeDatabase();
    const release = {
      id: ids.release,
      type: "AUDIO",
      status: "PENDING_ORG_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.tenant", isActive: true },
      owner: { path: "root.system.tenant.parent.sub", entityType: "SUB_ACCOUNT" },
    };
    database.prisma.release.findUnique.mockResolvedValue(release);
    database.prisma.release.update.mockResolvedValue({ ...release, status: "PENDING_SYS_APPROVAL" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.approveRelease(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.tenant,
      entityPath: "root.system.tenant",
      roles: ["ORGANIZATION"],
    }), ids.release)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

    await expect(service.approveRelease(context({
      entityType: "ORGANIZATION",
      entityRole: "REVIEWER",
      entityId: ids.otherLabel,
      entityPath: "root.system.tenant.parent",
      roles: ["ORGANIZATION"],
    }), ids.release)).resolves.toMatchObject({ status: "PENDING_SYS_APPROVAL" });
  });

  it("does not let the platform review tier bypass organization approval", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "PENDING_ORG_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.approveRelease(context({
      entityType: "SYSTEM_ADMIN",
      entityRole: "ADMIN",
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      tenantId: undefined,
      entityPath: "root.system",
      roles: ["SYSTEM_ADMIN"]
    }), ids.release)).rejects.toMatchObject({ code: "INVALID_WORKFLOW_STATE", statusCode: 409 });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("advances distribution approval to BeAlpha final review", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "PENDING_SYS_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.release.update.mockResolvedValue({ id: ids.release, status: "PENDING_SUPER_APPROVAL" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.approveRelease(context({
      entityType: "SYSTEM_ADMIN",
      entityRole: "ADMIN",
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      entityPath: "root.system",
      roles: ["SYSTEM_ADMIN"]
    }), ids.release);

    expect(database.prisma.release.update).toHaveBeenCalledWith({
      where: { id: ids.release },
      data: { status: "PENDING_SUPER_APPROVAL" }
    });
  });

  it("allows only BeAlpha to complete final approval", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "PENDING_SUPER_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.release.update.mockResolvedValue({ id: ids.release, type: "AUDIO", status: "APPROVED" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.approveRelease(context({
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      tenantId: undefined,
      entityPath: "root",
      roles: ["SUPER_ADMIN"]
    }), ids.release);

    expect(database.prisma.release.update).toHaveBeenCalledWith({
      where: { id: ids.release },
      data: { status: "APPROVED" }
    });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "catalog.release.approved", payload: expect.objectContaining({ releaseId: ids.release, releaseType: "AUDIO", status: "APPROVED" }) }) });
  });

  it("locks a system-approved release before distribution snapshotting", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "APPROVED",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.release.update.mockResolvedValue({
      id: ids.release,
      status: "LOCKED_FOR_DELIVERY"
    });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.lockReleaseForDelivery(context({
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      tenantId: ids.tenant,
      entityPath: "root.system",
      roles: ["SUPER_ADMIN"]
    }), ids.release);

    expect(database.prisma.release.update).toHaveBeenCalledWith({
      where: { id: ids.release },
      data: { status: "LOCKED_FOR_DELIVERY" }
    });
  });

  it("returns the release owner path in the trusted distribution snapshot", async () => {
    const database = fakeDatabase();
    const accessRelease = { id: ids.release, tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label, tenant: { path: "root.system.org", isActive: true }, owner: { path: "root.system.org.sub" } };
    const snapshot = { ...accessRelease, tracks: [], totalSizeBytes: 0n };
    database.prisma.release.findUnique.mockResolvedValueOnce(accessRelease).mockResolvedValueOnce(snapshot);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.getDistributionSnapshot(context({ entityType: "SUPER_ADMIN", entityRole: "OWNER", entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa", tenantId: undefined, entityPath: "root", roles: ["SUPER_ADMIN"] }), ids.release)).resolves.toEqual(snapshot);
    expect(database.prisma.release.findUnique).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: ids.release },
      include: expect.objectContaining({ owner: { select: { path: true } } })
    }));
  });

  it("does not let an organization lock a release for distribution", async () => {
    const database = fakeDatabase();
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.lockReleaseForDelivery(context({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityId: ids.tenant,
      entityPath: "root.system.org",
      roles: ["ORGANIZATION"]
    }), ids.release)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("does not let a non-owner platform role lock a release for distribution", async () => {
    const database = fakeDatabase(); const service = new CatalogService(database as unknown as CatalogDatabase);
    await expect(service.lockReleaseForDelivery(context({ entityType: "SUPER_ADMIN", entityRole: "ADMIN", entityId: ids.entity, entityPath: "root", roles: ["SUPER_ADMIN"] }), ids.release)).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("requires and publishes the lower-tier rejection reason", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "PENDING_SYS_APPROVAL",
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      owner: { path: "root.system.org.artist" },
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.release.update.mockResolvedValue({ id: ids.release, status: "SYS_REJECTED" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const reviewer = context({
      entityType: "SYSTEM_ADMIN",
      entityRole: "ADMIN",
      entityId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
      entityPath: "root.system",
      roles: ["SYSTEM_ADMIN"]
    });

    await expect(service.denyRelease(reviewer, ids.release, "  ")).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    await service.denyRelease(reviewer, ids.release, "ISRC does not match the master");

    expect(database.prisma.release.update).toHaveBeenCalledWith({
      where: { id: ids.release },
      data: expect.objectContaining({
        status: "SYS_REJECTED",
        lastRejectionReason: "ISRC does not match the master",
        lastRejectedByTier: "SYSTEM_ADMIN",
        lastRejectedAt: expect.any(Date)
      })
    });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "catalog.release.rejected",
        payload: expect.objectContaining({
          recipientEntityPath: "root.system.org",
          reason: "ISRC does not match the master"
        })
      })
    });
  });

  it("V10 locks UPC and ISRC on first submission", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release,
      status: "DRAFT",
      coverUrl: "https://cdn.example/cover.jpg",
      upcLockedAt: null,
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.track.count.mockResolvedValue(1);
    database.prisma.release.update.mockResolvedValue({
      id: ids.release,
      status: "PENDING_ORG_APPROVAL"
    });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.submitRelease(context(), ids.release, { targetDsps: ["spotify", "apple_music"] });

    expect(database.prisma.release.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ids.release },
      data: expect.objectContaining({ status: "PENDING_ORG_APPROVAL", upcLockedAt: expect.any(Date), metadata: { targetDsps: ["spotify", "apple_music"] } })
    }));
    expect(database.prisma.track.updateMany).toHaveBeenCalledWith({
      where: { releaseId: ids.release, isrcLockedAt: null },
      data: { isrcLockedAt: expect.any(Date) }
    });
  });

  it("requires DSP destinations before a release enters review", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release, status: "DRAFT", coverUrl: "https://cdn.example/cover.jpg", upcLockedAt: null,
      tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.track.count.mockResolvedValue(1);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.submitRelease(context(), ids.release)).rejects.toMatchObject({ code: "DSP_SELECTION_REQUIRED", statusCode: 400 });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("notifies the direct parent organization when a nested sub-account submits", async () => {
    const database = fakeDatabase();
    const release = {
      id: ids.release,
      type: "AUDIO",
      format: "SINGLE",
      status: "DRAFT",
      coverUrl: "https://cdn.example/cover.jpg",
      ean: "123456789012",
      genre: "Pop",
      displayArtist: "Artist",
      metadata: { cLine: "2026 Label", pLine: "2026 Label" },
      upcLockedAt: null,
      tenantId: ids.tenant,
      ownerId: ids.entity,
      labelId: ids.label,
      tenant: { path: "root.system.tenant", isActive: true },
      owner: { path: "root.system.tenant.parent.sub", entityType: "SUB_ACCOUNT" },
    };
    database.prisma.release.findUnique
      .mockResolvedValueOnce(release)
      .mockResolvedValueOnce({
        ean: release.ean,
        format: release.format,
        genre: release.genre,
        displayArtist: release.displayArtist,
        metadata: release.metadata,
        label: { name: "Label" },
        tracks: [{ isrc: "USABC2600001", duration: 180, audioAssetId: ids.track, discNumber: 1, trackNumber: 1 }],
      });
    database.prisma.track.count.mockResolvedValue(1);
    database.prisma.release.update.mockResolvedValue({ ...release, status: "PENDING_ORG_APPROVAL" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.submitRelease(context({ entityPath: release.owner.path }), ids.release, { targetDsps: ["spotify"] });

    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "catalog.release.submitted",
        payload: expect.objectContaining({ recipientEntityPath: "root.system.tenant.parent" }),
      }),
    });
  });

  it("blocks AUDIO review before the complete DDEX snapshot contract is ready", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique
      .mockResolvedValueOnce({
        id: ids.release, type: "AUDIO", status: "DRAFT", coverUrl: "media-asset:99999999-9999-4999-8999-999999999999",
        ean: "123456789012", genre: "Pop", displayArtist: "Artist", metadata: { cLine: "2026 Label", pLine: "2026 Label" },
        upcLockedAt: null, tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label,
        tenant: { path: "root.system.org", isActive: true }
      })
      .mockResolvedValueOnce({
        ean: "123456789012", format: "SINGLE", genre: "Pop", displayArtist: "Artist",
        metadata: { cLine: "2026 Label", pLine: "2026 Label" }, label: { name: "Label" },
        tracks: [{ isrc: "USABC2600001", duration: null, audioAssetId: ids.track, discNumber: 1, trackNumber: 1 }]
      });
    database.prisma.track.count.mockResolvedValue(1);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.submitRelease(context(), ids.release, { targetDsps: ["spotify"] }))
      .rejects.toMatchObject({ code: "DDEX_RELEASE_INCOMPLETE", statusCode: 409 });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("submits AUDIO only when the complete DDEX snapshot contract is ready", async () => {
    const database = fakeDatabase();
    const release = {
      id: ids.release, type: "AUDIO", status: "DRAFT", coverUrl: "media-asset:99999999-9999-4999-8999-999999999999",
      ean: "123456789012", genre: "Pop", displayArtist: "Artist", metadata: { cLine: "2026 Label", pLine: "2026 Label" },
      upcLockedAt: null, tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label,
      tenant: { path: "root.system.org", isActive: true }
    };
    database.prisma.release.findUnique
      .mockResolvedValueOnce(release)
      .mockResolvedValueOnce({
        ean: release.ean, format: "SINGLE", genre: release.genre, displayArtist: release.displayArtist,
        metadata: release.metadata, label: { name: "Label" },
        tracks: [{ isrc: "USABC2600001", duration: 180, audioAssetId: ids.track, discNumber: 1, trackNumber: 1 }]
      });
    database.prisma.track.count.mockResolvedValue(1);
    database.prisma.release.update.mockResolvedValue({ ...release, status: "PENDING_ORG_APPROVAL" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.submitRelease(context(), ids.release, { targetDsps: ["spotify"] });

    expect(database.prisma.release.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ids.release },
      data: expect.objectContaining({ status: "PENDING_ORG_APPROVAL", metadata: { cLine: "2026 Label", pLine: "2026 Label", targetDsps: ["spotify"] } })
    }));
  });

  it.each(["SYS_REJECTED", "SUPER_REJECTED"] as const)("restarts bottom-up approval after %s", async rejectedStatus => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release, status: rejectedStatus, coverUrl: "https://cdn.example/cover.jpg",
      upcLockedAt: new Date(), updatedAt: new Date(), tenantId: ids.tenant, ownerId: ids.entity,
      labelId: ids.label, tenant: { path: "root.system.org", isActive: true }
    });
    database.prisma.track.count.mockResolvedValue(1);
    database.prisma.release.update.mockResolvedValue({ id: ids.release, status: "PENDING_ORG_APPROVAL" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.submitRelease(context(), ids.release, { targetDsps: ["spotify"] });

    expect(database.prisma.release.update).toHaveBeenCalledWith({
      where: { id: ids.release }, data: { status: "PENDING_ORG_APPROVAL", metadata: { targetDsps: ["spotify"] } }
    });
  });

  it("blocks material edits while a higher-tier review is pending", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({
      id: ids.release, status: "PENDING_SYS_APPROVAL", tenantId: ids.tenant, ownerId: ids.entity,
      labelId: ids.label, tenant: { path: "root.system.org", isActive: true }
    });
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.updateRelease(context(), ids.release, { title: "Changed after label approval" }))
      .rejects.toMatchObject({ code: "WORKFLOW_LOCKED", statusCode: 409 });
    expect(database.prisma.release.update).not.toHaveBeenCalled();
  });

  it("V8 emits tenant scope with ISRC for finance projection", async () => {
    const database = fakeDatabase();
    database.prisma.release.findUnique.mockResolvedValue({ id: ids.release, status: "DRAFT", tenantId: ids.tenant, ownerId: ids.entity, labelId: ids.label, tenant: { path: "root.system.org", isActive: true }, owner: { path: "root.system.org.sub" } });
    database.prisma.track.create.mockResolvedValue({ id: ids.track, releaseId: ids.release, isrc: "USABC2600001" });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);
    await service.createTrack(context(), ids.release, { title: "Track", isrc: "USABC2600001" });
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({ type: "catalog.track.scope-upserted", payload: { trackId: ids.track, releaseId: ids.release, isrc: "USABC2600001", tenantId: ids.tenant, entityPath: "root.system.org.sub" } }) });
  });

  it("V11 limits sub-account compositions to its owner id", async () => {
    const database = fakeDatabase();
    database.prisma.composition.findMany.mockResolvedValue([]);
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.listCompositions(context());

    expect(database.prisma.composition.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { ownerId: ids.entity } })
    );
  });

  it("keeps composition mutations with organization managers", async () => {
    const database = fakeDatabase();
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await expect(service.createComposition(context(), { title: "Work" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    await expect(service.updateComposition(context(), ids.track, { title: "Updated" }))
      .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    await expect(service.deleteComposition(context(), ids.track))
      .rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

    expect(database.prisma.composition.create).not.toHaveBeenCalled();
    expect(database.prisma.composition.findUnique).not.toHaveBeenCalled();
    expect(database.prisma.composition.update).not.toHaveBeenCalled();
    expect(database.prisma.composition.delete).not.toHaveBeenCalled();
  });

  it("I6 writes a versioned event in the mutation transaction", async () => {
    const database = fakeDatabase();
    database.prisma.businessEntity.findUnique.mockResolvedValue({
      id: ids.tenant,
      path: "root.system.org",
      entityType: "ORGANIZATION",
      isActive: true
    });
    database.prisma.composition.create.mockResolvedValue({
      id: ids.track,
      tenantId: ids.tenant,
      ownerId: ids.tenant
    });
    database.prisma.outboxEvent.create.mockResolvedValue({});
    const service = new CatalogService(database as unknown as CatalogDatabase);

    await service.createComposition(context({
      entityId: ids.tenant,
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      entityPath: "root.system.org",
      tenantId: ids.tenant,
      roles: ["ORGANIZATION"]
    }), { title: "Work" });

    expect(database.prisma.$transaction).toHaveBeenCalledOnce();
    expect(database.prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        version: 1,
        type: "catalog.composition.created",
        requestId: context().requestId,
        actorId: ids.actor,
        tenantId: ids.tenant,
        payload: {
          compositionId: ids.track,
          tenantId: ids.tenant,
          ownerId: ids.tenant
        }
      })
    });
  });
});

describe("catalog HTTP security", () => {
  it("accepts explicit business tiers but rejects client-assigned tenant IDs", async () => {
    const createEntity = vi.fn().mockResolvedValue({ id: ids.entity, businessTier: "ARTIST" });
    const app = await buildCatalogApp({ config, service: { createEntity } as unknown as CatalogService, logger: false });
    try {
      const headers = await signedHeaders("eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", { entityId: ids.system, entityType: "SYSTEM_ADMIN", entityRole: "OWNER", entityPath: "root.system" });
      const payload = { parentId: ids.system, entityType: "SUB_ACCOUNT", businessTier: "ARTIST", officialName: "Direct Artist" };
      const response = await app.inject({ method: "POST", url: "/api/v1/catalog/entities", headers, payload });
      expect(response.statusCode, response.body).toBe(201);
      expect(createEntity).toHaveBeenCalledWith(expect.anything(), payload);
      const forged = await app.inject({ method: "POST", url: "/api/v1/catalog/entities", headers, payload: { ...payload, tenantId: ids.siblingTenant } });
      expect(forged.statusCode).toBe(400);
      expect(createEntity).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });

  let privateKey: CryptoKey;
  let config: CatalogConfig;

  beforeAll(async () => {
    const keys = await generateKeyPair("ES256", { extractable: true });
    privateKey = keys.privateKey;
    config = {
      nodeEnv: "test",
      host: "127.0.0.1",
      port: 4102,
      logLevel: "silent",
      trustProxyHops: 0,
      bodyLimitBytes: 32768,
      databaseUrl: "postgresql://test:test@localhost:5432/test",
      dbPoolMax: 1,
      gatewayContextPublicKeyPem: await exportSPKI(keys.publicKey),
      gatewayContextIssuer: "bealpha-gateway",
      gatewayContextAudience: "bealpha-services",
      mediaServiceUrl: "http://media.test",
      distributionServiceUrl: "http://distribution.test",
      importGrantEncryptionKey: Buffer.alloc(32, 1),
      importRoot: "/imports",
      importMaxBytes: 50 * 1024 * 1024 * 1024,
      importMaxEntries: 10000,
      importMaxXmlBytes: 256 * 1024 * 1024,
      importWorkerPollMs: 1000,
      importWorkerMaxAttempts: 3
    };
  });

  async function signedHeaders(requestId: string, overrides: Partial<InternalAuthContext> = {}) {
    const token = await new SignJWT({ ...context(), ...overrides, requestId })
      .setProtectedHeader({ alg: "ES256" })
      .setIssuer(config.gatewayContextIssuer)
      .setAudience(config.gatewayContextAudience)
      .setIssuedAt()
      .setExpirationTime("30s")
      .sign(privateKey);
    return {
      [REQUEST_ID_HEADER]: requestId,
      [INTERNAL_CONTEXT_HEADER]: token
    };
  }

  it("parses workQueue explicitly and rejects invalid queue flags", async () => {
    const listReleases = vi.fn().mockResolvedValue([]);
    const app = await buildCatalogApp({ config, service: { listReleases } as unknown as CatalogService, logger: false });
    const headers = await signedHeaders("abababab-abab-4bab-8bab-abababababab");
    try {
      for (const value of ["true", "false"]) {
        const response = await app.inject({ method: "GET", url: `/api/v1/catalog/releases?workQueue=${value}&limit=50`, headers });
        expect(response.statusCode).toBe(200);
        expect(listReleases).toHaveBeenLastCalledWith(expect.any(Object), { workQueue: value === "true", limit: 50 });
      }
      listReleases.mockClear();
      const invalid = await app.inject({ method: "GET", url: "/api/v1/catalog/releases?workQueue=1", headers });
      expect(invalid.statusCode).toBe(400);
      expect(listReleases).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it("V4 rejects requests without signed Gateway context", async () => {
    const service = { listReleases: vi.fn() } as unknown as CatalogService;
    const app = await buildCatalogApp({ config, service, logger: false });
    const response = await app.inject({ method: "GET", url: "/api/v1/catalog/releases" });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it("returns 503 readiness when PostgreSQL is unavailable", async () => {
    const service = {} as CatalogService;
    const app = await buildCatalogApp({ config, service, databaseHealth: async () => false, logger: false });
    const response = await app.inject({ method: "GET", url: "/health/ready" });
    expect(response.statusCode).toBe(503);
    expect(response.json().error.code).toBe("UPSTREAM_UNAVAILABLE");
    await app.close();
  });

  it("returns the platform brand bootstrap on localhost instead of an internal error", async () => {
    const database = fakeDatabase();
    const service = new CatalogService(database as unknown as CatalogDatabase);
    const app = await buildCatalogApp({ config, service, logger: false });
    const requestId = "abababab-abab-4bab-8bab-abababababab";
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/catalog/public-tenant-brand",
      headers: { ...await signedHeaders(requestId), "x-forwarded-host": "localhost" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      data: { displayName: "BeAlpha Music", logoAssetId: null, logoUrl: null },
      error: null,
      requestId
    });
    expect(database.prisma.tenantDomain.findFirst).not.toHaveBeenCalled();
    await app.close();
  });

  it("V5 rejects client tenant injection and V9 rejects numeric decimals", async () => {
    const service = { createTrack: vi.fn(), createComposition: vi.fn() } as unknown as CatalogService;
    const app = await buildCatalogApp({ config, service, logger: false });
    const requestId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const headers = await signedHeaders(requestId);

    const tenantInjection = await app.inject({
      method: "POST",
      url: `/api/v1/catalog/releases/${ids.release}/tracks`,
      headers,
      payload: { title: "Track", tenantId: ids.siblingTenant }
    });
    const numericDecimal = await app.inject({
      method: "POST",
      url: `/api/v1/catalog/releases/${ids.release}/tracks`,
      headers,
      payload: { title: "Track", recordingLabelShare: 50.25 }
    });
    const invalidShares = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/compositions",
      headers,
      payload: {
        title: "Work",
        authors: [
          { name: "Writer A", role: "Composer", shareBasisPoints: 5000 },
          { name: "Writer B", role: "Lyricist", shareBasisPoints: 4000 }
        ]
      }
    });

    expect(tenantInjection.statusCode).toBe(400);
    expect(numericDecimal.statusCode).toBe(400);
    expect(invalidShares.statusCode).toBe(400);
    expect(service.createTrack).not.toHaveBeenCalled();
    expect(service.createComposition).not.toHaveBeenCalled();
    await app.close();
  });

  it("exposes strict label-access replacement at the catalog boundary", async () => {
    const replaceSubAccountLabelAccess = vi.fn().mockResolvedValue({ subAccountId: ids.entity, labelIds: [ids.label] });
    const service = { replaceSubAccountLabelAccess } as unknown as CatalogService;
    const app = await buildCatalogApp({ config, service, logger: false });
    const requestId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const response = await app.inject({
      method: "PUT",
      url: `/api/v1/catalog/entities/${ids.entity}/label-access`,
      headers: await signedHeaders(requestId),
      payload: { labelIds: [ids.label] }
    });

    expect(response.statusCode).toBe(200);
    expect(replaceSubAccountLabelAccess).toHaveBeenCalledWith(expect.objectContaining({ actorId: ids.actor }), ids.entity, [ids.label]);
    await app.close();
  });

  it("exposes the authorized delivery lock used by VEVO orchestration", async () => {
    const lockReleaseForDelivery = vi.fn().mockResolvedValue({ id: ids.release, status: "LOCKED_FOR_DELIVERY", totalSizeBytes: 0n });
    const service = { lockReleaseForDelivery } as unknown as CatalogService;
    const app = await buildCatalogApp({ config, service, logger: false });
    const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const response = await app.inject({
      method: "POST",
      url: `/api/v1/catalog/releases/${ids.release}/delivery-lock`,
      headers: await signedHeaders(requestId, {
        entityType: "SUPER_ADMIN",
        entityRole: "OWNER",
        entityPath: "root",
        roles: ["SUPER_ADMIN"]
      })
    });

    expect(response.statusCode).toBe(200);
    expect(lockReleaseForDelivery).toHaveBeenCalledWith(expect.objectContaining({ actorId: ids.actor }), ids.release);
    await app.close();
  });

  it("returns final video approval without a synchronous distribution call", async () => {
    const approveRelease = vi.fn().mockResolvedValue({ id: ids.release, type: "VIDEO", status: "APPROVED", updatedAt: new Date("2026-08-22T00:00:00Z") });
    const distributionFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { status: "PENDING" } }), { status: 202 })); vi.stubGlobal("fetch", distributionFetch);
    const app = await buildCatalogApp({ config, service: { approveRelease } as unknown as CatalogService, logger: false }); const requestId = "abababab-abab-4bab-8bab-abababababab";
    const response = await app.inject({ method: "POST", url: `/api/v1/catalog/releases/${ids.release}/approve`, headers: await signedHeaders(requestId, { entityType: "SUPER_ADMIN", entityRole: "OWNER", entityPath: "root", roles: ["SUPER_ADMIN"] }) });
    expect(response.statusCode).toBe(200);
    expect(distributionFetch).not.toHaveBeenCalled();
    await app.close();
  });

  it("accepts only DSP targets returned by the internal Distribution catalog", async () => {
    const getDistributionSnapshot = vi.fn().mockResolvedValue({ id: ids.release, type: "AUDIO", tracks: [], coverUrl: null });
    const submitRelease = vi.fn().mockResolvedValue({ id: ids.release, status: "PENDING_ORG_APPROVAL" });
    const targetFetch = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ data: [{ id: "spotify", name: "Spotify" }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", targetFetch);
    const app = await buildCatalogApp({ config, service: { getDistributionSnapshot, submitRelease } as unknown as CatalogService, logger: false });
    const requestId = "acacacac-acac-4cac-8cac-acacacacacac";
    const headers = await signedHeaders(requestId);

    const rejected = await app.inject({ method: "POST", url: `/api/v1/catalog/releases/${ids.release}/submit`, headers, payload: { dspIds: ["unknown_dsp"] } });
    const accepted = await app.inject({ method: "POST", url: `/api/v1/catalog/releases/${ids.release}/submit`, headers, payload: { dspIds: ["spotify"] } });

    expect(rejected.statusCode).toBe(400);
    expect(rejected.json().error.code).toBe("DSP_NOT_CONFIGURED");
    expect(accepted.statusCode).toBe(200);
    expect(submitRelease).toHaveBeenCalledOnce();
    expect(submitRelease).toHaveBeenCalledWith(expect.any(Object), ids.release, expect.objectContaining({ targetDsps: ["spotify"] }));
    expect(targetFetch).toHaveBeenCalledWith("http://distribution.test/api/v1/distribution/recipients?releaseType=AUDIO", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    await app.close();
    vi.unstubAllGlobals();
  });

  it("rejects a cross-tenant media asset before attaching it to a track", async () => {
    const createTrack = vi.fn();
    const mediaFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: ids.artist,
        tenantId: ids.siblingTenant,
        ownerEntityId: ids.otherLabel,
        ownerEntityPath: "root.system.sibling",
        type: "AUDIO",
        status: "READY"
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mediaFetch);
    const app = await buildCatalogApp({ config, service: { createTrack } as unknown as CatalogService, logger: false });
    const requestId = "bcbcbcbc-bcbc-4bcb-8bcb-bcbcbcbcbcbc";

    const response = await app.inject({
      method: "POST",
      url: `/api/v1/catalog/releases/${ids.release}/tracks`,
      headers: await signedHeaders(requestId),
      payload: { title: "Track", audioAssetId: ids.artist }
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("NOT_FOUND");
    expect(createTrack).not.toHaveBeenCalled();
    await app.close();
    vi.unstubAllGlobals();
  });

  it("rejects a descendant-owned image as the Organization brand logo", async () => {
    const updateTenantBrand = vi.fn();
    const service = { updateTenantBrand } as unknown as CatalogService;
    const mediaFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: { id: ids.artist, type: "IMAGE", status: "READY", ownerEntityId: ids.entity, tenantId: ids.tenant }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mediaFetch);
    const app = await buildCatalogApp({ config, service, logger: false });
    const requestId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/catalog/tenant-brand",
      headers: await signedHeaders(requestId, {
        entityId: ids.tenant,
        entityType: "ORGANIZATION",
        entityRole: "OWNER",
        entityPath: "root.system.org",
        tenantId: ids.tenant,
        roles: ["ORGANIZATION"]
      }),
      payload: {
        displayName: "Acme Records",
        logoAssetId: ids.artist,
        accentColor: "#111111",
        accentTextColor: "#FFFFFF",
        defaultLocale: "en",
        expectedVersion: 1
      }
    });

    expect(response.statusCode).toBe(422);
    expect(updateTenantBrand).not.toHaveBeenCalled();
    await app.close();
    vi.unstubAllGlobals();
  });

  it("publishes a tenant-owned logo only as part of the explicit brand save transition", async () => {
    const updatedBrand = {
      tenantId: ids.tenant,
      displayName: "Acme Records",
      logoAssetId: ids.artist,
      logoUrl: `/media-public/${ids.artist}`,
      accentColor: "#111111",
      accentTextColor: "#FFFFFF",
      supportEmail: null,
      supportUrl: null,
      defaultLocale: "en",
      version: 2,
    };
    const updateTenantBrand = vi.fn().mockResolvedValue(updatedBrand);
    const mediaFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { id: ids.artist, type: "IMAGE", status: "READY", ownerEntityId: ids.tenant, tenantId: ids.tenant } }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ data: { assetId: ids.artist, url: `http://media.test/media-public/${ids.artist}` } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mediaFetch);
    const app = await buildCatalogApp({ config, service: { updateTenantBrand } as unknown as CatalogService, logger: false });
    const requestId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const headers = await signedHeaders(requestId, { entityId: ids.tenant, entityType: "ORGANIZATION", entityRole: "OWNER", entityPath: "root.system.org", tenantId: ids.tenant, roles: ["ORGANIZATION"] });

    const response = await app.inject({ method: "PATCH", url: "/api/v1/catalog/tenant-brand", headers, payload: { displayName: "Acme Records", logoAssetId: ids.artist, accentColor: "#111111", accentTextColor: "#FFFFFF", defaultLocale: "en", expectedVersion: 1 } });

    expect(response.statusCode, response.body).toBe(200);
    expect(mediaFetch).toHaveBeenNthCalledWith(2, `http://media.test/api/v1/media/assets/${ids.artist}/publication`, expect.objectContaining({ method: "POST" }));
    expect(updateTenantBrand).toHaveBeenCalledOnce();
    await app.close();
    vi.unstubAllGlobals();
  });

  it("keeps an uploaded release cover private while the release is a draft", async () => {
    const createReleaseDraft = vi.fn().mockResolvedValue({
      id: ids.release,
      title: "Private draft",
      coverUrl: `media-asset:${ids.artist}`,
      status: "DRAFT",
      totalSizeBytes: 0n,
      tracks: [{ id: ids.track, title: "Track", metadata: null }],
      metadata: null,
    });
    const mediaFetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: {
        id: ids.artist,
        tenantId: ids.tenant,
        ownerEntityId: ids.entity,
        ownerEntityPath: "root.system.org",
        type: "IMAGE",
        status: "PROCESSING"
      }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", mediaFetch);
    const app = await buildCatalogApp({ config, service: { createReleaseDraft } as unknown as CatalogService, logger: false });
    const requestId = "ffffffff-ffff-4fff-8fff-ffffffffffff";

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/catalog/releases",
      headers: await signedHeaders(requestId, { entityType: "ORGANIZATION", entityRole: "OWNER", entityPath: "root.system.org", tenantId: ids.tenant, roles: ["ORGANIZATION"] }),
      payload: { title: "Private draft", releaseDate: "2026-09-01", coverUrl: `media-asset:${ids.artist}`, tracks: [{ title: "Track" }] },
    });

    expect(response.statusCode, response.body).toBe(201);
    expect(createReleaseDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ coverUrl: `media-asset:${ids.artist}` }));
    expect(mediaFetch).toHaveBeenCalledOnce();
    expect(mediaFetch).toHaveBeenCalledWith(
      `http://media.test/api/v1/media/assets/${ids.artist}`,
      expect.objectContaining({ headers: expect.objectContaining({ [INTERNAL_CONTEXT_HEADER]: expect.any(String) }) })
    );
    expect(mediaFetch.mock.calls[0]?.[1]).not.toMatchObject({ method: "POST" });
    await app.close();
    vi.unstubAllGlobals();
  });
});
