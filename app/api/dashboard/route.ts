import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

// Dashboard summary endpoint
export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    const now = new Date();
    const startOfWeek = new Date(now);
    startOfWeek.setDate(now.getDate() - 7);

    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(now.getDate() - 30);

    // B2B2B scoping by entity/tenant
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const releaseScope: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const artistScope: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const labelScope: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const trackScope: any = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const assetScope: any = {};

    const isSysAdmin = isSystemAdmin(session);
    const isFinance = session.roles.includes("finance");
    const isModerator = session.roles.includes("moderator");
    const isStaff = isSysAdmin || isFinance || isModerator || session.roles.includes("supporter");

    // Track IDs for tenant-scoped analytics
    let tenantTrackIds: string[] | null = null;
    // ISRCs for tenant-scoped royalties
    let tenantISRCs: string[] | null = null;

    if (!isSysAdmin) {
      if (session.tenantId) {
        if (session.entityType === "SUB_ACCOUNT") {
          // Artists and labels share the tenant's artists and labels lists
          artistScope.tenantId = session.tenantId;
          labelScope.tenantId = session.tenantId;
          
          if (session.roles.includes("artist")) {
            const releaseCondition = {
              OR: [
                { ownerId: session.entityId },
                { artist: { name: session.entityName } }
              ]
            };
            releaseScope.OR = releaseCondition.OR;
            trackScope.release = releaseCondition;
            assetScope.release = releaseCondition;
          } else {
            releaseScope.ownerId = session.entityId;
            trackScope.release = { ownerId: session.entityId };
            assetScope.release = { ownerId: session.entityId };
          }
        } else {
          const accessibleIds = await getAccessibleEntityIds(session.entityId);
          releaseScope.tenantId = { in: accessibleIds };
          artistScope.tenantId = { in: accessibleIds };
          labelScope.tenantId = { in: accessibleIds };
          trackScope.release = { tenantId: { in: accessibleIds } };
          assetScope.release = { tenantId: { in: accessibleIds } };
        }

        // Get tenant track IDs and ISRCs for scoped analytics + royalties
        const tenantTracks = await prisma.track.findMany({
          where: trackScope,
          select: { id: true, isrc: true },
        });
        tenantTrackIds = tenantTracks.map((t) => t.id);
        tenantISRCs = tenantTracks.map((t) => t.isrc).filter(Boolean) as string[];
      } else if (isStaff) {
        // Staff roles see all — no scope restriction
      } else {
        releaseScope.id = { in: [] };
        artistScope.id = { in: [] };
        labelScope.id = { in: [] };
        trackScope.id = { in: [] };
        assetScope.id = { in: [] };
        tenantTrackIds = [];
        tenantISRCs = [];
      }
    }

    // Determine the relevant pending status based on entity tier
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pendingStatusScope: any = {};
    if (isSysAdmin) {
      pendingStatusScope.status = "PENDING_SYS_APPROVAL";
    } else if (session.entityType === "ORGANIZATION") {
      pendingStatusScope.status = "PENDING_ORG_APPROVAL";
    } else {
      // SUB_ACCOUNT sees any of their own releases that are still pending
      pendingStatusScope.status = { in: ["PENDING_ORG_APPROVAL", "PENDING_SYS_APPROVAL"] };
    }

    // Build streaming metrics query for tenant-scoped analytics
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const metricsWhere: any = { date: { gte: thirtyDaysAgo } };
    if (tenantTrackIds !== null) {
      metricsWhere.trackId = { in: tenantTrackIds };
    }

    // Build royalty scope — filter line items by tenant ISRCs
    const royaltyQuery = (isSysAdmin || isFinance)
      ? prisma.royaltyReport.findMany({ orderBy: { receivedAt: "desc" }, take: 5 })
      : Promise.resolve([]);

    // Tenant-scoped royalty: compute from line items matching ISRCs
    const tenantRoyaltyQuery = (tenantISRCs !== null && tenantISRCs.length > 0)
      ? prisma.royaltyLineItem.aggregate({
          where: { isrc: { in: tenantISRCs } },
          _sum: { revenue: true, plays: true },
        })
      : Promise.resolve({ _sum: { revenue: null, plays: null } });

    const [
      totalReleases,
      upcomingReleases,
      pendingReleases,
      totalArtists,
      totalTracks,
      totalLabels,
      totalAssets,
      streamingMetrics,
      topPlaylists,
      recentRoyalties,
      tenantRoyaltyAgg,
      recentReleasesList,
      pendingApprovals,
      recentActivity,
      deliveryStats,
    ] = await Promise.all([
      prisma.release.count({ where: releaseScope }),
      prisma.release.count({ where: { ...releaseScope, releaseDate: { gte: now } } }),
      prisma.release.count({ where: { ...releaseScope, ...pendingStatusScope } }),
      prisma.artist.count({ where: artistScope }),
      prisma.track.count({ where: trackScope }),
      prisma.label.count({ where: labelScope }),
      prisma.asset.count({ where: assetScope }),
      // Analytics — always from StreamingMetrics (tenant-scoped)
      prisma.streamingMetrics.findMany({
        where: metricsWhere,
        orderBy: { date: "asc" },
      }),
      // Playlists
      isSysAdmin
        ? prisma.playlist.findMany({ orderBy: { plays: "desc" }, take: 5 })
        : Promise.resolve([]),
      // Royalties (global for finance/sysadmin)
      royaltyQuery,
      // Tenant royalty aggregate
      tenantRoyaltyQuery,
      // Recent releases
      prisma.release.findMany({
        where: releaseScope,
        orderBy: { createdAt: "desc" },
        take: 5,
        include: {
          artist: { select: { id: true, name: true } },
          label: { select: { id: true, name: true } },
        },
      }),
      // Pending approvals (context-aware: SysAdmin sees SYS, OrgAdmin sees ORG)
      isSysAdmin || isModerator
        ? prisma.release.findMany({
            where: { status: "PENDING_SYS_APPROVAL" },
            orderBy: { createdAt: "desc" },
            take: 5,
            include: {
              artist: { select: { id: true, name: true } },
              label: { select: { id: true, name: true } },
            },
          })
        : session.entityType === "ORGANIZATION"
        ? prisma.release.findMany({
            where: { ...releaseScope, status: "PENDING_ORG_APPROVAL" },
            orderBy: { createdAt: "desc" },
            take: 5,
            include: {
              artist: { select: { id: true, name: true } },
              label: { select: { id: true, name: true } },
            },
          })
        : Promise.resolve([]),
      // Recent audit log
      isSysAdmin
        ? prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 })
        : Promise.resolve([]),
      // Delivery stats
      isSysAdmin || isFinance
        ? prisma.ddexDelivery.groupBy({ by: ["status"], _count: true })
        : Promise.resolve([]),
    ]);

    // Aggregate streaming metrics by date for daily trend
    const dailyMap: Record<string, { plays: number; skips: number; saves: number; shares: number }> = {};
    for (const m of streamingMetrics) {
      const dateStr = m.date.toISOString().split("T")[0];
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { plays: 0, skips: 0, saves: 0, shares: 0 };
      }
      dailyMap[dateStr].plays += m.plays;
      dailyMap[dateStr].skips += m.skips;
      dailyMap[dateStr].saves += m.saves;
      dailyMap[dateStr].shares += m.shares;
    }

    const dailyTrend = Object.entries(dailyMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, d]) => ({ date, plays: d.plays, skips: d.skips, saves: d.saves, shares: d.shares }));

    // Weekly stats from streaming metrics
    const weekMetrics = streamingMetrics.filter((m) => m.date >= startOfWeek);
    const weeklyStats = weekMetrics.reduce(
      (acc, m) => ({
        plays: acc.plays + m.plays,
        skips: acc.skips + m.skips,
        saves: acc.saves + m.saves,
        shares: acc.shares + m.shares,
      }),
      { plays: 0, skips: 0, saves: 0, shares: 0 },
    );

    // Finance section — tenant-scoped or global
    let totalRoyalties: number;
    if (tenantISRCs !== null) {
      // Org user: compute revenue from their tracks only
      totalRoyalties = tenantRoyaltyAgg._sum?.revenue
        ? parseFloat(tenantRoyaltyAgg._sum.revenue.toString())
        : 0;
    } else {
      // Finance/SysAdmin: global totals
      totalRoyalties = recentRoyalties.reduce(
        (sum, r) => sum + parseFloat(r.totalRevenue.toString()),
        0,
      );
    }

    const deliverySummary = {
      total: deliveryStats.reduce((s, d) => s + d._count, 0),
      pending: deliveryStats.find((d) => d.status === "pending")?._count || 0,
      sent: deliveryStats.find((d) => d.status === "sent")?._count || 0,
      confirmed: deliveryStats.find((d) => d.status === "confirmed")?._count || 0,
      failed: deliveryStats.find((d) => d.status === "failed")?._count || 0,
    };

    return NextResponse.json({
      catalog: { totalReleases, upcomingReleases, pendingReleases, totalArtists, totalTracks, totalLabels, totalAssets },
      weeklyStats: {
        ...weeklyStats,
        skipRate: weeklyStats.plays > 0 ? Math.round((weeklyStats.skips / weeklyStats.plays) * 100) : 0,
      },
      topPlaylists: topPlaylists.map((p) => ({
        id: p.id, name: p.name, platform: p.platform, plays: p.plays, followers: p.followers,
      })),
      finance: {
        totalRoyalties: Math.round(totalRoyalties * 10000) / 10000,
        pendingReports: recentRoyalties.filter((r) => r.status === "pending").length,
        recentReports: recentRoyalties.map((r) => ({
          id: r.id, platform: r.platform, period: r.period,
          totalRevenue: parseFloat(r.totalRevenue.toString()), status: r.status, receivedAt: r.receivedAt,
        })),
        isTenantScoped: tenantISRCs !== null,
      },
      dailyTrend,
      recentReleases: recentReleasesList.map((r) => ({
        id: r.id, title: r.title, status: r.status, format: r.format,
        coverUrl: r.coverUrl, releaseDate: r.releaseDate, artist: r.artist, label: r.label,
      })),
      pendingApprovals: pendingApprovals.map((r) => ({
        id: r.id, title: r.title, status: r.status, format: r.format,
        coverUrl: r.coverUrl, createdAt: r.createdAt, artist: r.artist, label: r.label,
      })),
      recentActivity: recentActivity.map((a) => ({
        id: a.id, action: a.action, entityType: a.entityType,
        entityId: a.entityId, createdAt: a.createdAt, userId: a.userId,
      })),
      deliverySummary,
    });
  } catch (error) {
    console.error("Error fetching dashboard summary:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_DASHBOARD_SUMMARY" }, { status: 500 });
  }
}
