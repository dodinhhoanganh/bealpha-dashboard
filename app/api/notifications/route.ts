import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession, getSecureSession } from "@/lib/auth";

/**
 * GET /api/notifications
 * Get notifications for the current user
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = Number("20");
    limit = Math.min(limit, 100);
    const unreadOnly = searchParams.get("unread") === "true";

    const where: Record<string, unknown> = { userId: session.id };
    if (unreadOnly) where.read = false;

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: { userId: session.id, read: false },
      }),
    ]);

    return NextResponse.json({
      data: notifications,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      unreadCount,
    });
  } catch (error) {
    console.error("Notifications error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_FETCH_NOTIFICATIONS" },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/notifications
 * Mark notifications as read
 * Body: { ids?: string[], all?: boolean }
 */
export async function PATCH(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await request.json();
    const { ids, all } = body;

    if (all) {
      await prisma.notification.updateMany({
        where: { userId: session.id, read: false },
        data: { read: true },
      });
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.updateMany({
        where: { id: { in: ids }, userId: session.id },
        data: { read: true },
      });
    } else {
      return NextResponse.json(
        { error: "ERROR_PROVIDE_IDS_ARRAY_OR_ALL_TRUE" },
        { status: 400 },
      );
    }

    const unreadCount = await prisma.notification.count({
      where: { userId: session.id, read: false },
    });

    return NextResponse.json({ success: true, unreadCount });
  } catch (error) {
    console.error("Mark read error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_UPDATE_NOTIFICATIONS" },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/notifications
 * Delete notifications
 * Body: { ids?: string[], all?: boolean }
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const body = await request.json();
    const { ids, all } = body;

    if (all) {
      await prisma.notification.deleteMany({
        where: { userId: session.id },
      });
    } else if (ids && Array.isArray(ids) && ids.length > 0) {
      await prisma.notification.deleteMany({
        where: { id: { in: ids }, userId: session.id },
      });
    } else {
      return NextResponse.json(
        { error: "ERROR_PROVIDE_IDS_ARRAY_OR_ALL_TRUE" },
        { status: 400 },
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Delete notifications error:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_DELETE_NOTIFICATIONS" },
      { status: 500 },
    );
  }
}
