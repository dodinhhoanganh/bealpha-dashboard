import { describe, expect, it, vi } from "vitest";
import type { InternalAuthContext } from "@bealpha/contracts";
import { AnalyticsService } from "../src/analytics-service.js";
import type { AnalyticsConfig } from "../src/config.js";
import type { AnalyticsDatabase } from "../src/database.js";

function context(overrides: Partial<InternalAuthContext> = {}): InternalAuthContext {
  return { v: 1, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", authType: "user", actorId: "11111111-1111-4111-8111-111111111111", entityId: "22222222-2222-4222-8222-222222222222", entityType: "ORGANIZATION", entityRole: "OWNER", tenantId: "33333333-3333-4333-8333-333333333333", entityPath: "root.system.org", roles: ["ORGANIZATION"], staffRoles: [], authzVersion: 1, ...overrides };
}
function database() { return { prisma: { streamingMetric: { groupBy: vi.fn(), upsert: vi.fn() } } }; }
const config = { catalogServiceUrl: "http://catalog:4102" } as AnalyticsConfig;

describe("analytics invariants", () => {
  it("scopes reads with a path delimiter", async () => {
    const db = database(); db.prisma.streamingMetric.groupBy.mockResolvedValue([]);
    await new AnalyticsService(db as unknown as AnalyticsDatabase, config).summary(context(), 30);
    expect(db.prisma.streamingMetric.groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ OR: [{ entityPath: "root.system.org" }, { entityPath: { startsWith: "root.system.org." } }] }) }));
  });
  it("aggregates integer metrics by day", async () => {
    const db = database(); db.prisma.streamingMetric.groupBy.mockResolvedValue([{ date: new Date("2026-07-01"), _sum: { plays: 15, skips: 3, saves: 4, shares: 1 } }]);
    const result = await new AnalyticsService(db as unknown as AnalyticsDatabase, config).summary(context({ entityType: "SUPER_ADMIN" }), 30);
    expect(result.summary).toMatchObject({ totalPlays: 15, totalSkips: 3, totalSaves: 4, totalShares: 1, skipRatePercent: 20 });
  });
  it("blocks non-super-admin metric ingestion before upstream access", async () => {
    const service = new AnalyticsService(database() as unknown as AnalyticsDatabase, config);
    await expect(service.upsertMetric(context(), { trackId: "44444444-4444-4444-8444-444444444444", date: new Date(), platform: "spotify", plays: 1, skips: 0, saves: 0, shares: 0 }, "signed")).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
