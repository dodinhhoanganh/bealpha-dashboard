import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSession,
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
  type EntityRoleName,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import { createAuditLog } from "@/lib/audit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/entities/[id]/members — List all members of an entity
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    // Check access
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(id)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    const members = await prisma.userEntityRole.findMany({
      where: { entityId: id },
      include: {
        user: {
          select: {
            id: true, email: true, name: true, avatar: true,
            isActive: true, isBanned: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({
      data: members.map((m: typeof members[number]) => ({
        id: m.id,
        userId: m.userId,
        role: m.role,
        createdAt: m.createdAt,
        user: m.user,
      })),
      total: members.length,
    });
  } catch (error) {
    console.error("Error fetching entity members:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_MEMBERS" }, { status: 500 });
  }
}

/**
 * POST /api/entities/[id]/members — Add a user to an entity
 *
 * Body: { userId, role: "OWNER" | "ADMIN" | "MEMBER" }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    // Check access
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(id)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    const body = await request.json();
    const { userId, role } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json({ error: "ERROR_USERID_IS_REQUIRED" }, { status: 400 });
    }

    const validRoles: EntityRoleName[] = ["OWNER", "ADMIN", "MEMBER"];
    if (!role || !validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(", ")}` },
        { status: 400 },
      );
    }

    // Verify user exists
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, isActive: true },
    });
    if (!user) {
      return NextResponse.json({ error: "ERROR_USER_NOT_FOUND" }, { status: 404 });
    }
    if (!user.isActive) {
      return NextResponse.json({ error: "ERROR_USER_IS_DEACTIVATED" }, { status: 400 });
    }

    // Verify entity exists
    const entity = await prisma.businessEntity.findUnique({
      where: { id },
      select: { id: true, officialName: true, isActive: true, entityType: true, _count: { select: { userRoles: true } } },
    });
    if (!entity || !entity.isActive) {
      return NextResponse.json({ error: "ERROR_ENTITY_NOT_FOUND" }, { status: 404 });
    }

    // B2B2B Rule: Sub-accounts (Tier 3) can only have 1 user — no team members
    if (entity.entityType === "SUB_ACCOUNT" && entity._count.userRoles >= 1) {
      return NextResponse.json(
        { error: "ERROR_SUBACCOUNT_SINGLE_USER_LIMIT" },
        { status: 400 },
      );
    }

    // Check if user is already a member
    const existing = await prisma.userEntityRole.findUnique({
      where: { userId_entityId: { userId, entityId: id } },
    });
    if (existing) {
      // Update role instead
      const updated = await prisma.userEntityRole.update({
        where: { id: existing.id },
        data: { role },
        include: { user: { select: { id: true, email: true, name: true } } },
      });

      await createAuditLog({
        userId: session.id,
        action: "entity.member.update",
        entityType: "userEntityRole",
        entityId: updated.id,
        oldValue: { role: existing.role },
        newValue: { role },
      });

      return NextResponse.json(updated);
    }

    // Create new membership
    const membership = await prisma.userEntityRole.create({
      data: { userId, entityId: id, role },
      include: { user: { select: { id: true, email: true, name: true } } },
    });

    await createAuditLog({
      userId: session.id,
      action: "entity.member.add",
      entityType: "userEntityRole",
      entityId: membership.id,
      newValue: { userId, entityId: id, role },
    });

    return NextResponse.json(membership, { status: 201 });
  } catch (error) {
    console.error("Error adding entity member:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_ADD_MEMBER" }, { status: 500 });
  }
}

/**
 * DELETE /api/entities/[id]/members — Remove a user from an entity
 *
 * Query: ?userId=xxx
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_UPDATE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("userId");

    if (!userId) {
      return NextResponse.json({ error: "ERROR_USERID_IS_REQUIRED" }, { status: 400 });
    }

    // Check access
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(id)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    // Prevent removing yourself from your primary entity
    if (userId === session.id && id === session.entityId) {
      return NextResponse.json(
        { error: "ERROR_CANNOT_REMOVE_YOURSELF_FROM_PRIMARY_ENTITY" },
        { status: 400 },
      );
    }

    const membership = await prisma.userEntityRole.findUnique({
      where: { userId_entityId: { userId, entityId: id } },
    });

    if (!membership) {
      return NextResponse.json({ error: "ERROR_MEMBERSHIP_NOT_FOUND" }, { status: 404 });
    }

    await prisma.userEntityRole.delete({ where: { id: membership.id } });

    await createAuditLog({
      userId: session.id,
      action: "entity.member.remove",
      entityType: "userEntityRole",
      entityId: membership.id,
      oldValue: { userId, entityId: id, role: membership.role },
    });

    return NextResponse.json({ success: true, message: "Member removed from entity" });
  } catch (error) {
    console.error("Error removing entity member:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_REMOVE_MEMBER" }, { status: 500 });
  }
}
