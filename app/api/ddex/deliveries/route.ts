import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, hasPermission, PERMISSIONS, isSystemAdmin } from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

/**
 * GET /api/ddex/deliveries
 * List delivery history with pagination, filtering, and search
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.RELEASE_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = Number("20");
    limit = Math.min(limit, 100);
    const status = searchParams.get("status"); // pending, sent, confirmed, failed
    const dspName = searchParams.get("dsp");
    const releaseId = searchParams.get("releaseId");
    const batchId = searchParams.get("batchId");
    const search = searchParams.get("search");
    const sortBy = searchParams.get("sortBy") || "createdAt";
    const sortOrder = (searchParams.get("sortOrder") || "desc") as
      | "asc"
      | "desc";

    // Build where clause
    const whereClause: Record<string, unknown> = {};

    if (status) whereClause.status = status;
    if (dspName) whereClause.dspName = dspName;
    if (releaseId) whereClause.releaseId = releaseId;
    if (batchId) whereClause.batchId = batchId;

    // Role-based visibility scoping (B2B2B entity hierarchy)
    if (
      isSystemAdmin(session) ||
      session.roles.includes("moderator") ||
      session.roles.includes("supporter")
    ) {
      // Can see all deliveries
    } else if (session.tenantId) {
      if (session.entityType === "SUB_ACCOUNT") {
        whereClause.release = { tenantId: session.tenantId };
      } else {
        // Organization: see deliveries across entity hierarchy
        const accessibleIds = await getAccessibleEntityIds(session.entityId);
        whereClause.release = { tenantId: { in: accessibleIds } };
      }
    } else {
      return NextResponse.json({ data: [], total: 0, page, limit, totalPages: 0 });
    }

    // BUG-9 fix: Wrap search OR inside AND to prevent bypassing tenant scope
    if (search) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const searchConditions: any[] = [
        { dspName: { contains: search, mode: "insensitive" } },
        { batchId: { contains: search, mode: "insensitive" } },
      ];
      // Only add release.title search if no release-level scoping already set
      if (!whereClause.release) {
        searchConditions.push({ release: { title: { contains: search, mode: "insensitive" } } });
      } else {
        // Merge release title search with existing release tenant scope
        searchConditions.push({
          release: {
            ...((whereClause.release as Record<string, unknown>) || {}),
            title: { contains: search, mode: "insensitive" },
          },
        });
      }
      whereClause.AND = [{ OR: searchConditions }];
    }

    // Determine orderBy
    const validSortFields = [
      "createdAt",
      "sentAt",
      "confirmedAt",
      "status",
      "dspName",
    ];
    const orderField = validSortFields.includes(sortBy) ? sortBy : "createdAt";
    const orderBy = { [orderField]: sortOrder };

    const [deliveries, total] = await Promise.all([
      prisma.ddexDelivery.findMany({
        where: whereClause,
        include: {
          release: {
            select: {
              id: true,
              title: true,
              ean: true,
              status: true,
              coverUrl: true,
              artist: { select: { id: true, name: true } },
              label: { select: { id: true, name: true } },
            },
          },
        },
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.ddexDelivery.count({ where: whereClause }),
    ]);

    // Strip xmlContent from list response (too large)
    const data = deliveries.map(({ xmlContent, ...d }) => d);

    return NextResponse.json({
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Deliveries list error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_DELIVERIES" },
      { status: 500 },
    );
  }
}
