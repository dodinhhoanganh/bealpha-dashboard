/**
 * Audit Log API
 *
 * GET /api/audit-log — Paginated, filterable audit log entries
 *   Query params: page, limit, action, entityType, userId, search, from, to
 */

import { NextRequest, NextResponse } from "next/server";
import { getSession, isSystemAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_UNAUTHORIZED" }, { status: 401 });
    }

    // Only admins and managers can view audit logs
    const allowedRoles = ["admin", "distributor", "manager"];
    const hasAccess = session.roles?.some((r: string) =>
      allowedRoles.includes(r),
    );
    if (!hasAccess) {
      return NextResponse.json({ error: "ERROR_FORBIDDEN" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    let limit = parseInt(searchParams.get("limit") || "25");
    if (isNaN(limit) || limit < 1) limit = 25;
    limit = Math.min(limit, 100);
    const action = searchParams.get("action"); // CREATE, UPDATE, DELETE, LOGIN, LOGOUT
    const entityType = searchParams.get("entityType"); // Release, Track, User, etc.
    const userId = searchParams.get("userId");
    const search = searchParams.get("search");
    const from = searchParams.get("from");
    const to = searchParams.get("to");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    // B2B2B scoping: non-system-admins only see logs from users within their entity hierarchy
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      // Find user IDs that belong to accessible entities
      const accessibleUsers = await prisma.userEntityRole.findMany({
        where: { entityId: { in: accessibleIds } },
        select: { userId: true },
        distinct: ["userId"],
      });
      where.userId = { in: accessibleUsers.map((u) => u.userId) };
    }

    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (userId) where.userId = userId;

    // Date range
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from);
      if (to) where.createdAt.lte = new Date(to);
    }

    // Search in entityType, action (wrapped in AND to preserve scoping)
    if (search) {
      where.AND = [
        {
          OR: [
            { entityType: { contains: search, mode: "insensitive" } },
            { action: { contains: search, mode: "insensitive" } },
          ],
        },
      ];
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    // Resolve user names for logs that have userId
    const userIds = [
      ...new Set(logs.map((l) => l.userId).filter(Boolean)),
    ] as string[];
    const users =
      userIds.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));

    const logsWithUsers = logs.map((log) => ({
      ...log,
      user: log.userId ? userMap.get(log.userId) || null : null,
    }));

    // Get distinct entity types and actions for filter dropdowns
    const [entityTypes, actions] = await Promise.all([
      prisma.auditLog.findMany({
        select: { entityType: true },
        distinct: ["entityType"],
        orderBy: { entityType: "asc" },
      }),
      prisma.auditLog.findMany({
        select: { action: true },
        distinct: ["action"],
        orderBy: { action: "asc" },
      }),
    ]);

    return NextResponse.json({
      data: logsWithUsers,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: {
        entityTypes: entityTypes.map((e) => e.entityType),
        actions: actions.map((a) => a.action),
      },
    });
  } catch (error) {
    console.error("Audit log API error:", error);
    return NextResponse.json(
      { error: "ERROR_INTERNAL_SERVER_ERROR" },
      { status: 500 },
    );
  }
}
