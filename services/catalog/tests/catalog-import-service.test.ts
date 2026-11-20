import { randomUUID } from "node:crypto";

import type { InternalAuthContext } from "@bealpha/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CatalogImportService } from "../src/catalog-import-service.js";
import type { CatalogConfig } from "../src/config.js";
import type { CatalogDatabase } from "../src/database.js";

const context: InternalAuthContext = { v: 1, requestId: randomUUID(), authType: "user", actorId: randomUUID(), entityId: randomUUID(), entityType: "ORGANIZATION", entityRole: "OWNER", tenantId: randomUUID(), entityPath: "root.system.org", roles: ["ORGANIZATION"], staffRoles: [], authzVersion: 1 };
const config = { mediaServiceUrl: "http://media.test", importMaxBytes: 50 * 1024 * 1024 * 1024, importGrantEncryptionKey: Buffer.alloc(32, 7) } as CatalogConfig;

function database() {
  const prisma = { catalogImport: { create: vi.fn(), findFirst: vi.fn() }, catalogImportJob: { create: vi.fn() }, outboxEvent: { create: vi.fn() }, $transaction: vi.fn() };
  prisma.$transaction.mockImplementation(async callback => callback(prisma));
  return { prisma } as unknown as CatalogDatabase;
}

afterEach(() => vi.unstubAllGlobals());

describe("Catalog import service", () => {
  it("obtains a scoped Media grant and enqueues an async import", async () => {
    const db = database();
    const assetId = randomUUID();
    const importId = randomUUID();
    vi.mocked(db.prisma.catalogImport.create).mockResolvedValue({ id: importId } as never);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { assetId, token: "t".repeat(48), expiresAt: new Date(Date.now() + 60000).toISOString(), fileName: "ern.xml", contentType: "application/xml", sizeBytes: "1024" } }), { status: 200, headers: { "content-type": "application/json" } })));
    const service = new CatalogImportService(db, config);
    await expect(service.create(context, { assetId, format: "XML" }, "signed-context")).resolves.toMatchObject({ id: importId });
    expect(db.prisma.catalogImport.create).toHaveBeenCalledWith({ data: expect.objectContaining({ assetId, tenantId: context.tenantId, ownerEntityId: context.entityId, entityPath: context.entityPath, format: "XML", sourceSizeBytes: 1024n }) });
    expect(db.prisma.catalogImportJob.create).toHaveBeenCalledWith({ data: { importId } });
  });

  it("rejects sub-account imports before contacting Media", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const service = new CatalogImportService(database(), config);
    await expect(service.create({ ...context, entityType: "SUB_ACCOUNT", roles: ["SUB_ACCOUNT"] }, { assetId: randomUUID(), format: "ZIP" }, "signed-context")).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
