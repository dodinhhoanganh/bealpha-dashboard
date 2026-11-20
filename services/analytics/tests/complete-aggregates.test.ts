import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InternalAuthContext } from "@bealpha/contracts";
import { AnalyticsService as CurrentService } from "../src/analytics-service.js";
import type { AnalyticsConfig } from "../src/config.js";

const { AnalyticsService } = process.env.ANALYTICS_TEST_SOURCE
  ? await import(process.env.ANALYTICS_TEST_SOURCE) as { AnalyticsService: typeof CurrentService }
  : { AnalyticsService: CurrentService };
const context: InternalAuthContext = { v: 1, requestId: "request", authType: "user", actorId: "user", entityId: "label", entityType: "ORGANIZATION", entityRole: "OWNER", tenantId: "tenant", entityPath: "root.system.org", roles: ["ORGANIZATION"], staffRoles: [] };
type Metric = { date: Date; entityPath: string; plays: number; skips: number; saves: number; shares: number; avgPlayDuration: number | null };
type Query = { where: { OR?: { entityPath: string | { startsWith: string } }[]; date: { gte: Date; lt?: Date }; avgPlayDuration?: { not: null } }; take?: number; by?: string[] };

function metric(overrides: Partial<Metric> = {}): Metric {
  return { date: new Date("2026-10-07T00:00:00Z"), entityPath: context.entityPath!, plays: 3, skips: 1, saves: 1, shares: 1, avgPlayDuration: 45, ...overrides };
}
function fixture(rows: Metric[]) {
  const filter = ({ where }: Query) => rows.filter(row =>
    row.date >= where.date.gte && (!where.date.lt || row.date < where.date.lt) &&
    (!where.OR || where.OR.some(clause => typeof clause.entityPath === "string" ? row.entityPath === clause.entityPath : row.entityPath.startsWith(clause.entityPath.startsWith))) &&
    (!where.avgPlayDuration || row.avgPlayDuration !== null));
  const groupBy = vi.fn(async (query: Query) => {
    const groups = new Map<string, { date: Date; avgPlayDuration: number | null; _sum: { plays: number; skips: number; saves: number; shares: number } }>();
    for (const row of filter(query)) {
      const key = query.by?.[0] === "date" ? row.date.toISOString() : String(row.avgPlayDuration);
      const group = groups.get(key) ?? { date: row.date, avgPlayDuration: row.avgPlayDuration, _sum: { plays: 0, skips: 0, saves: 0, shares: 0 } };
      for (const field of ["plays", "skips", "saves", "shares"] as const) group._sum[field] += row[field];
      groups.set(key, group);
    }
    return [...groups.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
  });
  const findMany = vi.fn(async (query: Query) => filter(query).slice(0, query.take));
  const service = new AnalyticsService({ prisma: { streamingMetric: { groupBy, findMany } } } as never, {} as AnalyticsConfig);
  return { service, groupBy, findMany };
}

describe("complete, scoped analytics aggregation", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime("2026-10-08T12:00:00Z"); });
  afterEach(() => { vi.useRealTimers(); });

  it.each(["summary", "streaming"] as const)("%s includes every metric beyond 10000 without sibling totals", async endpoint => {
    const rows = Array.from({ length: 12005 }, (_, index) => metric({ entityPath: index % 2 ? context.entityPath! : `${context.entityPath}.artist` }));
    rows.push(metric({ entityPath: "root.system.org-other", plays: 1_000_000 }), metric({ entityPath: "root.system.other", plays: 1_000_000 }));
    const { service, groupBy, findMany } = fixture(rows);
    const result = await service[endpoint](context, 30);
    expect("totalPlays" in result.summary ? result.summary.totalPlays : result.summary.plays).toBe(36015);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["date"], where: expect.objectContaining({ OR: [{ entityPath: context.entityPath }, { entityPath: { startsWith: `${context.entityPath}.` } }] }), _sum: { plays: true, skips: true, saves: true, shares: true } }));
    expect(findMany).not.toHaveBeenCalled();
  });

  it("duration includes every scoped play beyond the old raw-row cap", async () => {
    const rows = Array.from({ length: 12005 }, () => metric());
    rows.push(metric({ entityPath: "root.system.other", plays: 1_000_000 }));
    const { service, groupBy, findMany } = fixture(rows);
    expect((await service.duration(context, 30)).data.find(row => row.range === "30-60s")?.count).toBe(36015);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ["avgPlayDuration"], _sum: { plays: true } }));
    expect(findMany).not.toHaveBeenCalled();
  });

  it("uses exactly the requested inclusive UTC dates and excludes future data", async () => {
    const { service, groupBy } = fixture([
      metric({ date: new Date("2026-10-07T00:00:00Z") }), metric({ date: new Date("2026-10-08T00:00:00Z") }),
      metric({ date: new Date("2026-10-06T00:00:00Z"), plays: 100 }), metric({ date: new Date("2026-10-09T00:00:00Z"), plays: 100 }),
    ]);
    const result = await service.summary(context, 2);
    expect(result.summary.totalPlays).toBe(6);
    expect(result.data.map(row => row.period)).toEqual(["2026-10-07", "2026-10-08"]);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ date: { gte: new Date("2026-10-07T00:00:00Z"), lt: new Date("2026-10-09T00:00:00Z") } }) }));
  });

  it("keeps duration bucket boundaries and excludes missing duration", async () => {
    const { service } = fixture([29, 30, 59, 60, 119, 120, 179, 180, null].map(avgPlayDuration => metric({ avgPlayDuration, plays: 1 })));
    expect((await service.duration(context, 30)).data).toEqual([
      { range: "0-30s", count: 1 }, { range: "30-60s", count: 2 }, { range: "1-2m", count: 2 }, { range: "2-3m", count: 2 }, { range: "3m+", count: 1 },
    ]);
  });

  it("retains authorized platform-wide aggregation and empty responses", async () => {
    const { service, groupBy } = fixture([metric(), metric({ entityPath: "root.system.other" })]);
    expect((await service.summary({ ...context, entityType: "SUPER_ADMIN" }, 30)).summary.totalPlays).toBe(6);
    expect(groupBy).toHaveBeenCalledWith(expect.objectContaining({ where: { date: expect.any(Object) } }));
    const empty = fixture([]).service;
    expect((await empty.summary(context, 30)).summary.totalPlays).toBe(0);
    expect((await empty.duration(context, 30)).data.every(row => row.count === 0)).toBe(true);
  });
});
