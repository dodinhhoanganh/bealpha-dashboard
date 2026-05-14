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
import { NotificationService } from "@/lib/services/notification.service";

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
    const trackId = searchParams.get("trackId");
    const platform = searchParams.get("platform");
    const country = searchParams.get("country");
    let days = parseInt(searchParams.get("days") || "30");
    if (isNaN(days) || days < 1) days = Number("30");
    days = Math.min(days, 365);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // Build role-scoped track filter (B2B2B entity hierarchy)
    let trackScope: Record<string, unknown> | undefined;
    if (
      !isSystemAdmin(session) &&
      !session.roles?.includes("moderator") &&
      !session.roles?.includes("finance")
    ) {
      if (session.tenantId) {
        if (session.entityType === "SUB_ACCOUNT") {
          // Sub-account: only their own releases or where they are tagged as an artist
          if (session.roles?.includes("artist")) {
            trackScope = {
              AND: [
                { release: { tenantId: session.tenantId } }, // Strict tenant lock
                {
                  OR: [
                    { release: { ownerId: session.entityId } },
                    { release: { artist: { name: session.entityName } } },
                    { artist: { name: session.entityName } },
                    { contributors: { some: { name: session.entityName } } }
                  ]
                }
              ]
            };
          } else {
            trackScope = { release: { tenantId: session.tenantId, ownerId: session.entityId } };
          }
        } else {
          // Organization: all releases within entity hierarchy
          const accessibleIds = await getAccessibleEntityIds(session.entityId);
          trackScope = { release: { tenantId: { in: accessibleIds } } };
        }
      } else {
        return NextResponse.json({ daily: [], summary: { plays: 0, skips: 0, saves: 0, shares: 0, skipRate: 0 } });
      }
    }

    const metrics = await prisma.streamingMetrics.findMany({
      where: {
        ...(trackId && { trackId }),
        ...(platform && { platform }),
        ...(country && { country }),
        ...(trackScope && { track: trackScope }),
        date: { gte: startDate },
      },
      include: {
        track: {
          select: {
            id: true,
            title: true,
            artist: {
              select: {
                name: true,
              },
            },
          },
        },
      },
      orderBy: { date: "desc" },
    });

    // Aggregate by date
    const aggregated: Record<
      string,
      {
        date: string;
        plays: number;
        skips: number;
        saves: number;
        shares: number;
      }
    > = {};

    metrics.forEach((m) => {
      const dateStr = m.date.toISOString().split("T")[0];
      if (!aggregated[dateStr]) {
        aggregated[dateStr] = {
          date: dateStr,
          plays: 0,
          skips: 0,
          saves: 0,
          shares: 0,
        };
      }
      aggregated[dateStr].plays += m.plays;
      aggregated[dateStr].skips += m.skips;
      aggregated[dateStr].saves += m.saves;
      aggregated[dateStr].shares += m.shares;
    });

    const dailyData = Object.values(aggregated).sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );

    // Summary statistics
    const totals = metrics.reduce(
      (acc, m) => ({
        plays: acc.plays + m.plays,
        skips: acc.skips + m.skips,
        saves: acc.saves + m.saves,
        shares: acc.shares + m.shares,
      }),
      { plays: 0, skips: 0, saves: 0, shares: 0 },
    );

    return NextResponse.json({
      daily: dailyData,
      summary: {
        ...totals,
        skipRate:
          totals.plays > 0
            ? Math.round((totals.skips / totals.plays) * 100)
            : 0,
      },
      totalRecords: metrics.length,
    });
  } catch (error) {
    console.error("Error fetching streaming metrics:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_STREAMING_METRICS" },
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
        { error: "ERROR_ONLY_ADMIN_CAN_CREATE_STREAMING_METRICS" },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.trackId) {
      return NextResponse.json(
        { error: "ERROR_TRACKID_IS_REQUIRED" },
        { status: 400 },
      );
    }
    if (!body.platform) {
      return NextResponse.json(
        { error: "ERROR_PLATFORM_IS_REQUIRED" },
        { status: 400 },
      );
    }
    if (!body.date) {
      return NextResponse.json({ error: "ERROR_DATE_IS_REQUIRED" }, { status: 400 });
    }
    const parsedDate = new Date(body.date);
    if (isNaN(parsedDate.getTime())) {
      return NextResponse.json(
        { error: "ERROR_INVALID_DATE_FORMAT" },
        { status: 400 },
      );
    }

    // Verify trackId exists
    const trackExists = await prisma.track.findUnique({
      where: { id: body.trackId },
      select: { id: true },
    });
    if (!trackExists) {
      return NextResponse.json({ error: "ERROR_TRACK_NOT_FOUND" }, { status: 404 });
    }

    // A6 fix: Clamp numeric fields to non-negative integers
    const safeInt = (v: unknown): number => {
      const n = typeof v === "number" ? v : parseInt(String(v || "0"));
      return isNaN(n) || n < 0 ? 0 : Math.floor(n);
    };

    const metrics = await prisma.streamingMetrics.create({
      data: {
        trackId: body.trackId,
        date: parsedDate,
        platform: body.platform,
        country: body.country,
        plays: safeInt(body.plays),
        skips: safeInt(body.skips),
        saves: safeInt(body.saves),
        shares: safeInt(body.shares),
        avgPlayDuration: body.avgPlayDuration,
      },
    });

    // Check if new metrics crossed a milestone
    await NotificationService.notifyStreamingMilestones(body.trackId).catch(
      console.error,
    );

    return NextResponse.json(metrics, { status: 201 });
  } catch (error) {
    console.error("Error creating streaming metrics:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_CREATE_STREAMING_METRICS" },
      { status: 500 },
    );
  }
}
