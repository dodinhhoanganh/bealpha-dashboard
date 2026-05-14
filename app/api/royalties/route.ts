import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isAdmin,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

/**
 * B2B2B Tenant-Scoped Royalties
 *
 * Revenue is tracked globally via RoyaltyReport (per platform per period),
 * but tenant-scoped via RoyaltyLineItem.isrc → Track.isrc → Release.tenantId.
 *
 * - Finance/SysAdmin: sees all reports with global totals
 * - Org user: sees only revenue from line items matching tracks in their tenant
 *
 * Query params:
 *   period, platform, status, search (existing)
 *   breakdown: "track" — per-track revenue detail (uses ISRC join)
 */

// Get tenant-scoped ISRCs for revenue filtering
async function getTenantISRCs(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
): Promise<string[] | null> {
  // Finance/SysAdmin sees all — no ISRC filter
  if (isSystemAdmin(session) || session.roles.includes("finance")) return null;

  if (!session.tenantId) return [];

  // Build release scope
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let releaseWhere: any = {};

  if (session.entityType === "SUB_ACCOUNT") {
    if (session.roles.includes("artist")) {
      releaseWhere = {
        OR: [
          { ownerId: session.entityId },
          { artist: { name: session.entityName } }
        ]
      };
    } else {
      releaseWhere = { ownerId: session.entityId };
    }
  } else {
    const accessibleIds = await getAccessibleEntityIds(session.entityId);
    releaseWhere = { tenantId: { in: accessibleIds } };
  }

  const tracks = await prisma.track.findMany({
    where: { release: releaseWhere, isrc: { not: null } },
    select: { isrc: true },
  });

  return tracks.map((t) => t.isrc).filter(Boolean) as string[];
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.ANALYTICS_VIEW) && !isAdmin(session) && !session.roles.includes("finance")) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period");
    const platform = searchParams.get("platform");
    const status = searchParams.get("status");
    const search = searchParams.get("search");
    const breakdown = searchParams.get("breakdown"); // "track" for per-track detail
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    const sortBy = searchParams.get("sortBy") || "receivedAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as "asc" | "desc";

    // Get tenant ISRCs for scoping
    const tenantISRCs = await getTenantISRCs(session);

    // If org user has no tracks with ISRCs, return empty
    if (tenantISRCs && tenantISRCs.length === 0) {
      return NextResponse.json({
        data: [],
        total: 0,
        page,
        limit,
        totalPages: 0,
        tenantRevenue: 0,
        tenantPlays: 0,
      });
    }

    // ──────────────────────────────────────────────
    // BREAKDOWN: per-track revenue detail
    // ──────────────────────────────────────────────
    if (breakdown === "track") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lineItemWhere: any = {};

      // Scope by tenant ISRCs
      if (tenantISRCs) {
        lineItemWhere.isrc = { in: tenantISRCs };
      }

      // Filters
      if (platform) {
        lineItemWhere.report = { platform: { contains: platform, mode: "insensitive" } };
      }
      if (period) {
        lineItemWhere.report = { ...lineItemWhere.report, period };
      }

      const lineItems = await prisma.royaltyLineItem.findMany({
        where: lineItemWhere,
        include: {
          report: { select: { platform: true, period: true, currency: true } },
        },
        orderBy: { revenue: "desc" },
        take: 100,
      });

      // Group by ISRC for aggregation
      const isrcMap: Record<string, {
        isrc: string;
        trackName: string;
        totalRevenue: number;
        totalPlays: number;
        platforms: Set<string>;
        periods: Set<string>;
        currency: string;
      }> = {};

      for (const item of lineItems) {
        const key = item.isrc || item.trackName || "unknown";
        if (!isrcMap[key]) {
          isrcMap[key] = {
            isrc: item.isrc || "",
            trackName: item.trackName || "",
            totalRevenue: 0,
            totalPlays: 0,
            platforms: new Set(),
            periods: new Set(),
            currency: item.report.currency || "USD",
          };
        }
        isrcMap[key].totalRevenue += parseFloat(item.revenue.toString());
        isrcMap[key].totalPlays += item.plays;
        isrcMap[key].platforms.add(item.report.platform);
        isrcMap[key].periods.add(item.report.period);
      }

      // Enrich with track metadata from our DB
      const isrcs = Object.keys(isrcMap).filter((k) => k.length > 3);
      // Scope track lookup to the tenant to prevent ISRC collisions across tenants
      const tracksFromDb = isrcs.length > 0
        ? await prisma.track.findMany({
          where: { 
            isrc: { in: isrcs },
            ...(tenantISRCs ? { release: { tenantId: { in: await getAccessibleEntityIds(session.entityId) } } } : {})
          },
          select: {
            isrc: true,
            title: true,
            artist: { select: { name: true } },
            release: { select: { title: true, coverUrl: true } },
          },
        })
        : [];

      const trackLookup = new Map(tracksFromDb.map((t) => [t.isrc, t]));

      const trackBreakdown = Object.values(isrcMap)
        .sort((a, b) => b.totalRevenue - a.totalRevenue)
        .map((item) => {
          const dbTrack = trackLookup.get(item.isrc);
          return {
            isrc: item.isrc,
            trackName: dbTrack?.title || item.trackName,
            artist: dbTrack?.artist?.name || null,
            release: dbTrack?.release?.title || null,
            coverUrl: dbTrack?.release?.coverUrl || null,
            totalRevenue: Math.round(item.totalRevenue * 10000) / 10000,
            totalPlays: item.totalPlays,
            platforms: [...item.platforms],
            periods: [...item.periods],
            currency: item.currency,
          };
        });

      const grandTotal = trackBreakdown.reduce((s, t) => s + t.totalRevenue, 0);
      const grandPlays = trackBreakdown.reduce((s, t) => s + t.totalPlays, 0);

      return NextResponse.json({
        data: trackBreakdown,
        summary: {
          totalRevenue: Math.round(grandTotal * 10000) / 10000,
          totalPlays: grandPlays,
          trackCount: trackBreakdown.length,
        },
      });
    }

    // ──────────────────────────────────────────────
    // DEFAULT: Report-level listing with tenant revenue
    // ──────────────────────────────────────────────

    const whereClause = {
      ...(period && { period }),
      ...(platform && {
        platform: { contains: platform, mode: "insensitive" as const },
      }),
      ...(status && { status }),
      ...(search && {
        platform: { contains: search, mode: "insensitive" as const },
      }),
    };

    const total = await prisma.royaltyReport.count({ where: whereClause });
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;

    const validSortFields: Record<string, string> = {
      receivedAt: "receivedAt",
      period: "period",
      platform: "platform",
      totalRevenue: "totalRevenue",
    };
    const orderField = validSortFields[sortBy] || "receivedAt";

    const reports = await prisma.royaltyReport.findMany({
      where: whereClause,
      include: {
        _count: { select: { lineItems: true } },
        // For tenant scoping — load line items to compute tenant-specific revenue
        ...(tenantISRCs
          ? {
            lineItems: {
              where: { isrc: { in: tenantISRCs } },
              select: { revenue: true, plays: true },
            },
          }
          : {}),
      },
      orderBy: { [orderField]: sortOrder },
      skip,
      take: limit,
    });

    const formattedReports = reports.map((report) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = report as any;

      // For org users: compute revenue from ONLY their tracks
      let displayRevenue: number;
      let displayPlays: number;

      if (tenantISRCs && r.lineItems) {
        // Tenant-scoped: sum only matching line items
        displayRevenue = r.lineItems.reduce(
          (sum: number, li: { revenue: unknown }) => sum + parseFloat(String(li.revenue)),
          0,
        );
        displayPlays = r.lineItems.reduce(
          (sum: number, li: { plays: number }) => sum + li.plays,
          0,
        );
      } else {
        // Global view (Finance/SysAdmin)
        displayRevenue = parseFloat(report.totalRevenue.toString());
        displayPlays = report.totalPlays;
      }

      return {
        id: report.id,
        period: report.period,
        platform: report.platform,
        totalRevenue: Math.round(displayRevenue * 10000) / 10000,
        totalPlays: displayPlays,
        currency: report.currency,
        status: report.status,
        lineItemCount: report._count.lineItems,
        receivedAt: report.receivedAt,
        processedAt: report.processedAt,
        // Flag for UI — is this scoped or global?
        isTenantScoped: !!tenantISRCs,
      };
    });

    // Grand totals for the current page (for summary bar)
    const tenantTotalRevenue = formattedReports.reduce((s, r) => s + r.totalRevenue, 0);
    const tenantTotalPlays = formattedReports.reduce((s, r) => s + r.totalPlays, 0);

    return NextResponse.json({
      data: formattedReports,
      total,
      page,
      limit,
      totalPages,
      tenantRevenue: Math.round(tenantTotalRevenue * 10000) / 10000,
      tenantPlays: tenantTotalPlays,
    });
  } catch (error) {
    console.error("Error fetching royalty reports:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_ROYALTY_REPORTS" },
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

    if (!isAdmin(session)) {
      return NextResponse.json(
        { error: "ERROR_ONLY_ADMIN_CAN_CREATE_ROYALTY_REPORTS" },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.period || !String(body.period).trim()) {
      return NextResponse.json(
        { error: "ERROR_REPORTING_PERIOD_IS_REQUIRED" },
        { status: 400 },
      );
    }
    if (!body.platform || !String(body.platform).trim()) {
      return NextResponse.json(
        { error: "ERROR_PLATFORM_IS_REQUIRED" },
        { status: 400 },
      );
    }
    if (body.totalRevenue === undefined || body.totalRevenue === null) {
      return NextResponse.json(
        { error: "ERROR_TOTAL_REVENUE_IS_REQUIRED" },
        { status: 400 },
      );
    }

    // Validate reportUrl if provided (prevent javascript: URI XSS)
    const reportUrl = body.reportUrl && typeof body.reportUrl === "string"
      ? (/^(https?:\/\/|\/uploads\/)/i.test(body.reportUrl) ? body.reportUrl : null)
      : null;

    const report = await prisma.royaltyReport.create({
      data: {
        period: body.period,
        platform: body.platform,
        totalRevenue: body.totalRevenue,
        totalPlays: body.totalPlays || 0,
        currency: body.currency || "USD",
        status: body.status || "pending",
        reportUrl,
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error("Error creating royalty report:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_CREATE_ROYALTY_REPORT" },
      { status: 500 },
    );
  }
}
