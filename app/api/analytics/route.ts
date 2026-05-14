import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

/**
 * B2B2B Tenant-Scoped Analytics
 *
 * ALL users query from StreamingMetrics (which chains: Track → Release → tenantId).
 * - Finance/SysAdmin: no tenant filter (sees all)
 * - Moderator: sees all within system
 * - Org user: sees only tracks in releases owned by their tenant
 * - Sub-account: sees only their entity's releases
 *
 * Query params:
 *   period: day (default) | week | month | quarter | year
 *   days: number of days to look back (default 30, max 365)
 *   type: daily (default) | performance | duration | track-detail
 *   platform: optional filter (Spotify, Apple Music, etc.)
 */

// Period grouping helper — truncate a date string to the given period
function getPeriodKey(date: Date, period: string): string {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");

  switch (period) {
    case "week": {
      // ISO week: get Monday of the week
      const dayOfWeek = d.getUTCDay();
      const diff = d.getUTCDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
      const monday = new Date(d);
      monday.setUTCDate(diff);
      return `${monday.getUTCFullYear()}-${String(monday.getUTCMonth() + 1).padStart(2, "0")}-${String(monday.getUTCDate()).padStart(2, "0")}`;
    }
    case "month":
      return `${year}-${month}`;
    case "quarter": {
      const q = Math.ceil((d.getUTCMonth() + 1) / 3);
      return `${year}-Q${q}`;
    }
    case "year":
      return `${year}`;
    default: // "day"
      return `${year}-${month}-${day}`;
  }
}

// Build tenant-scoped track filter based on session
async function buildTrackFilter(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<{ trackIds: string[] | null; empty: boolean }> {
  // Finance/SysAdmin/Moderator: see all
  if (isSystemAdmin(session) || session.roles.includes("finance") || session.roles.includes("moderator")) {
    return { trackIds: null, empty: false };
  }

  if (!session.tenantId) {
    return { trackIds: [], empty: true };
  }

  // Build release scope based on entity type
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let releaseWhere: any = {};

  if (session.entityType === "SUB_ACCOUNT") {
    if (session.roles.includes("artist")) {
      releaseWhere = {
        tenantId: session.tenantId, // Ensure they are locked to their tenant
        OR: [
          { ownerId: session.entityId },
          { artist: { name: session.entityName } },
          { tracks: { some: { artist: { name: session.entityName } } } },
          { tracks: { some: { contributors: { some: { name: session.entityName } } } } }
        ]
      };
    } else {
      releaseWhere = { tenantId: session.tenantId, ownerId: session.entityId };
    }
  } else {
    // Organization: see all releases within accessible entity hierarchy
    const accessibleIds = await getAccessibleEntityIds(session.entityId);
    releaseWhere = { tenantId: { in: accessibleIds } };
  }

  const tracks = await prisma.track.findMany({
    where: { release: releaseWhere },
    select: { id: true },
  });

  if (tracks.length === 0) {
    return { trackIds: [], empty: true };
  }

  return { trackIds: tracks.map((t) => t.id), empty: false };
}

const EMPTY_RESPONSE = {
  data: [],
  summary: { totalPlays: 0, totalSkips: 0, totalSaves: 0, totalShares: 0, skipRatePercent: 0 },
  period: "day",
};

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.ANALYTICS_VIEW)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    let days = parseInt(searchParams.get("days") || "30");
    if (isNaN(days) || days < 1) days = 30;
    days = Math.min(days, 365);
    const period = searchParams.get("period") || "day"; // day|week|month|quarter|year
    const type = searchParams.get("type") || "daily";
    const platformFilter = searchParams.get("platform") || null;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Build tenant-scoped track filter
    const { trackIds, empty } = await buildTrackFilter(session);
    if (empty) {
      return NextResponse.json(EMPTY_RESPONSE);
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metricsWhere: any = { date: { gte: startDate } };
    if (trackIds) metricsWhere.trackId = { in: trackIds };
    if (platformFilter) metricsWhere.platform = platformFilter;

    // ──────────────────────────────────────────────
    // TYPE: track-detail — per-track breakdown
    // ──────────────────────────────────────────────
    if (type === "track-detail") {
      const metrics = await prisma.streamingMetrics.findMany({
        where: metricsWhere,
        include: {
          track: {
            select: {
              id: true,
              title: true,
              isrc: true,
              artist: { select: { id: true, name: true } },
              release: { select: { id: true, title: true, coverUrl: true } },
            },
          },
        },
        orderBy: { date: "asc" },
      });

      // Group by track → period
      const trackMap: Record<string, {
        track: { id: string; title: string; isrc: string | null; artist: string; release: string; coverUrl: string | null };
        periods: Record<string, { plays: number; skips: number; saves: number; shares: number }>;
        totals: { plays: number; skips: number; saves: number; shares: number };
      }> = {};

      for (const m of metrics) {
        const tid = m.track.id;
        if (!trackMap[tid]) {
          trackMap[tid] = {
            track: {
              id: tid,
              title: m.track.title,
              isrc: m.track.isrc,
              artist: m.track.artist?.name || "Unknown",
              release: m.track.release?.title || "Unknown",
              coverUrl: m.track.release?.coverUrl || null,
            },
            periods: {},
            totals: { plays: 0, skips: 0, saves: 0, shares: 0 },
          };
        }
        const pk = getPeriodKey(m.date, period);
        if (!trackMap[tid].periods[pk]) {
          trackMap[tid].periods[pk] = { plays: 0, skips: 0, saves: 0, shares: 0 };
        }
        trackMap[tid].periods[pk].plays += m.plays;
        trackMap[tid].periods[pk].skips += m.skips;
        trackMap[tid].periods[pk].saves += m.saves;
        trackMap[tid].periods[pk].shares += m.shares;
        trackMap[tid].totals.plays += m.plays;
        trackMap[tid].totals.skips += m.skips;
        trackMap[tid].totals.saves += m.saves;
        trackMap[tid].totals.shares += m.shares;
      }

      // Sort by total plays desc
      const trackData = Object.values(trackMap)
        .sort((a, b) => b.totals.plays - a.totals.plays)
        .map((t) => ({
          ...t.track,
          totals: t.totals,
          periods: Object.entries(t.periods)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, val]) => ({ period: key, ...val })),
        }));

      return NextResponse.json({ data: trackData, period, days });
    }

    // ──────────────────────────────────────────────
    // TYPE: performance — per-track stacked chart
    // ──────────────────────────────────────────────
    if (type === "performance") {
      const metrics = await prisma.streamingMetrics.findMany({
        where: metricsWhere,
        include: {
          track: { select: { id: true, title: true } },
        },
        orderBy: { date: "asc" },
      });

      const grouped: Record<string, Record<string, number>> = {};
      for (const m of metrics) {
        const pk = getPeriodKey(m.date, period);
        if (!grouped[pk]) grouped[pk] = {};
        const trackKey = m.track.title.length > 15 ? m.track.title.slice(0, 15) + "…" : m.track.title;
        grouped[pk][trackKey] = (grouped[pk][trackKey] || 0) + m.plays;
      }

      const performanceData = Object.entries(grouped)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([periodKey, tracks]) => ({ period: periodKey, ...tracks }));

      return NextResponse.json({ data: performanceData, period, days });
    }

    // ──────────────────────────────────────────────
    // TYPE: duration — play duration buckets (SysAdmin/Finance only)
    // ──────────────────────────────────────────────
    if (type === "duration") {
      if (!isSystemAdmin(session) && !session.roles.includes("finance")) {
        return NextResponse.json({ data: [], period, days });
      }

      const buckets = await prisma.playDurationBucket.findMany({
        where: { date: { gte: startDate } },
        orderBy: { date: "desc" },
      });

      const aggregated: Record<string, number> = {};
      for (const b of buckets) {
        aggregated[b.range] = (aggregated[b.range] || 0) + b.count;
      }

      return NextResponse.json({
        data: Object.entries(aggregated).map(([range, count]) => ({ range, count })),
        period,
        days,
      });
    }

    // ──────────────────────────────────────────────
    // DEFAULT: daily/period aggregated analytics
    // All users get data from StreamingMetrics (tenant-scoped)
    // ──────────────────────────────────────────────
    const metrics = await prisma.streamingMetrics.findMany({
      where: metricsWhere,
      orderBy: { date: "asc" },
    });

    // Aggregate by period
    const aggregated: Record<string, { plays: number; skips: number; saves: number; shares: number }> = {};
    for (const m of metrics) {
      const pk = getPeriodKey(m.date, period);
      if (!aggregated[pk]) {
        aggregated[pk] = { plays: 0, skips: 0, saves: 0, shares: 0 };
      }
      aggregated[pk].plays += m.plays;
      aggregated[pk].skips += m.skips;
      aggregated[pk].saves += m.saves;
      aggregated[pk].shares += m.shares;
    }

    const data = Object.entries(aggregated)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodKey, d]) => ({
        period: periodKey,
        plays: d.plays,
        skips: d.skips,
        saves: d.saves,
        shares: d.shares,
      }));

    // Calculate totals
    const totals = metrics.reduce(
      (acc, m) => ({
        plays: acc.plays + m.plays,
        skips: acc.skips + m.skips,
        saves: acc.saves + m.saves,
        shares: acc.shares + m.shares,
      }),
      { plays: 0, skips: 0, saves: 0, shares: 0 },
    );

    const skipRatePercent = totals.plays > 0 ? Math.round((totals.skips / totals.plays) * 100) : 0;

    return NextResponse.json({
      data,
      summary: {
        totalPlays: totals.plays,
        totalSkips: totals.skips,
        totalSaves: totals.saves,
        totalShares: totals.shares,
        skipRatePercent,
      },
      period,
      days,
    });
  } catch (error) {
    console.error("Error fetching analytics:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_ANALYTICS" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!isSystemAdmin(session)) {
      return NextResponse.json(
        { error: "ERROR_ONLY_ADMIN_CAN_CREATE_ANALYTICS_RECORDS" },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Validate date
    if (!body.date) {
      return NextResponse.json({ error: "ERROR_DATE_IS_REQUIRED" }, { status: 400 });
    }
    const parsedDate = new Date(body.date);
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json({ error: "ERROR_INVALID_DATE_FORMAT" }, { status: 400 });
    }

    // Clamp numeric fields to non-negative integers
    const safeInt = (v: unknown): number => {
      const n = typeof v === "number" ? v : parseInt(String(v || "0"));
      return isNaN(n) || n < 0 ? 0 : Math.floor(n);
    };
    const safeFloat = (v: unknown): number => {
      const n = typeof v === "number" ? v : parseFloat(String(v || "0"));
      return isNaN(n) || n < 0 ? 0 : n;
    };

    const analytics = await prisma.dailyAnalytics.create({
      data: {
        date: parsedDate,
        totalPlays: safeInt(body.totalPlays),
        totalSkips: safeInt(body.totalSkips),
        skipRate: safeFloat(body.skipRate),
        avgPlayDuration: safeFloat(body.avgPlayDuration),
        newFollowers: safeInt(body.newFollowers),
        totalSaves: safeInt(body.totalSaves),
        totalShares: safeInt(body.totalShares),
      },
    });

    return NextResponse.json(analytics, { status: 201 });
  } catch (error) {
    console.error("Error creating analytics:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_CREATE_ANALYTICS" },
      { status: 500 },
    );
  }
}
