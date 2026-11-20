import { describe, expect, it, vi } from "vitest";
import type { InternalAuthContext } from "@bealpha/contracts";
import { AuditService } from "../src/audit-service.js";
import type { AuditDatabase } from "../src/database.js";
import { projectEvent, redact } from "../src/projection.js";

function context(overrides: Partial<InternalAuthContext> = {}): InternalAuthContext { return { v: 1, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authType: "user", actorId: "11111111-1111-4111-8111-111111111111", entityId: "22222222-2222-4222-8222-222222222222", entityType: "ORGANIZATION", entityRole: "OWNER", tenantId: "33333333-3333-4333-8333-333333333333", entityPath: "root.system.org", roles: ["ORGANIZATION"], staffRoles: [], authzVersion: 1, ...overrides }; }
function database() { return { prisma: { auditEvent: { createMany: vi.fn(), findMany: vi.fn(), count: vi.fn() } } }; }

describe("audit invariants", () => {
  it("redacts secrets recursively", () => { expect(redact({ token: "secret", nested: { email: "a@b.com", status: "ok" } })).toEqual({ token: "[REDACTED]", nested: { email: "[REDACTED]", status: "ok" } }); });
  it("projects events idempotently", async () => { const db = database(); db.prisma.auditEvent.createMany.mockResolvedValue({ count: 1 }); await expect(projectEvent(db as unknown as AuditDatabase, { version: 1, eventId: "44444444-4444-4444-8444-444444444444", requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", type: "catalog.release.created", occurredAt: new Date().toISOString(), actorId: "11111111-1111-4111-8111-111111111111", entityPath: "root.system.org", payload: { releaseId: "55555555-5555-4555-8555-555555555555" } })).resolves.toBe(true); expect(db.prisma.auditEvent.createMany).toHaveBeenCalledWith(expect.objectContaining({ skipDuplicates: true })); });
  it("scopes manager reads by path delimiter", async () => { const db = database(); db.prisma.auditEvent.findMany.mockResolvedValue([]); db.prisma.auditEvent.count.mockResolvedValue(0); const result = await new AuditService(db as unknown as AuditDatabase).list(context(), { page: 1, limit: 25 }); expect(result.total).toBe(0); expect(db.prisma.auditEvent.count).toHaveBeenCalledWith({ where: { OR: [{ entityPath: "root.system.org" }, { entityPath: { startsWith: "root.system.org." } }] } }); });
});
