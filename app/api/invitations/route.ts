import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { randomBytes } from "crypto";
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

const INVITE_EXPIRY_DAYS = 7;

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

/**
 * GET /api/invitations — List invitations for entities user has access to
 *
 * Query params:
 *   - entityId: filter by entity
 *   - status: PENDING | ACCEPTED | EXPIRED | REVOKED
 *   - page, limit
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_READ)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const entityId = searchParams.get("entityId");
    const status = searchParams.get("status");
    let page = parseInt(searchParams.get("page") || "1");
    if (isNaN(page) || page < 1) page = 1;
    let limit = parseInt(searchParams.get("limit") || "20");
    if (isNaN(limit) || limit < 1) limit = 20;
    limit = Math.min(limit, 100);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const whereClause: any = {};

    // Scope invitations to accessible entities
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      whereClause.entityId = { in: accessibleIds };

      // If user requests a specific entityId, validate it's within their scope
      if (entityId) {
        if (!accessibleIds.includes(entityId)) {
          return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
        }
        whereClause.entityId = entityId;
      }
    } else if (entityId) {
      whereClause.entityId = entityId;
    }

    if (status) whereClause.status = status;

    const [invitations, total] = await Promise.all([
      prisma.invitation.findMany({
        where: whereClause,
        include: {
          entity: { select: { id: true, officialName: true, entityType: true } },
          inviter: { select: { id: true, email: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.invitation.count({ where: whereClause }),
    ]);

    return NextResponse.json({
      data: invitations,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    console.error("Error fetching invitations:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_INVITATIONS" }, { status: 500 });
  }
}

/**
 * POST /api/invitations — Send an email invitation to join an entity
 *
 * Body: { email, entityId, role?: "OWNER" | "ADMIN" | "MEMBER" }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_INVITE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const body = await request.json();
    const { email, entityId, role = "MEMBER" } = body;

    // Validate email
    if (!email || typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "ERROR_VALID_EMAIL_IS_REQUIRED" }, { status: 400 });
    }

    // Validate entity
    if (!entityId || typeof entityId !== "string") {
      return NextResponse.json({ error: "ERROR_ENTITY_ID_IS_REQUIRED" }, { status: 400 });
    }

    const validRoles: EntityRoleName[] = ["OWNER", "ADMIN", "MEMBER"];
    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: `Invalid role. Must be one of: ${validRoles.join(", ")}` },
        { status: 400 },
      );
    }

    // Verify entity exists and user has access
    const entity = await prisma.businessEntity.findUnique({
      where: { id: entityId },
      select: { id: true, officialName: true, isActive: true, entityType: true },
    });
    if (!entity || !entity.isActive) {
      return NextResponse.json({ error: "ERROR_ENTITY_NOT_FOUND" }, { status: 404 });
    }

    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(entityId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    // H-1: Sub-Account is limited to exactly 1 user (Plan_phan_cap.md §3.2)
    if (entity.entityType === "SUB_ACCOUNT") {
      const existingMembers = await prisma.userEntityRole.count({
        where: { entityId },
      });
      const pendingInvites = await prisma.invitation.count({
        where: { entityId, status: "PENDING", expiresAt: { gt: new Date() } },
      });
      if (existingMembers + pendingInvites >= 1) {
        return NextResponse.json(
          { error: "ERROR_SUB_ACCOUNT_LIMITED_TO_ONE_USER" },
          { status: 403 },
        );
      }
    }

    // Check if user with this email already exists and is a member
    const existingUser = await prisma.user.findUnique({
      where: { email: email.toLowerCase().trim() },
      select: { id: true },
    });

    if (existingUser) {
      // 1-User to 1-Entity isolation: Check if they belong to ANY entity
      const anyMembership = await prisma.userEntityRole.findFirst({
        where: { userId: existingUser.id },
      });
      if (anyMembership) {
        return NextResponse.json(
          { error: "ERROR_USER_ALREADY_BELONGS_TO_AN_ORGANIZATION" },
          { status: 409 },
        );
      }
    }

    // Check for existing pending invite
    const existingInvite = await prisma.invitation.findFirst({
      where: {
        email: email.toLowerCase().trim(),
        entityId,
        status: "PENDING",
        expiresAt: { gt: new Date() },
      },
    });

    if (existingInvite) {
      return NextResponse.json(
        { error: "ERROR_PENDING_INVITATION_ALREADY_EXISTS" },
        { status: 409 },
      );
    }

    // Create invitation
    const token = generateInviteToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + INVITE_EXPIRY_DAYS);

    const invitation = await prisma.invitation.create({
      data: {
        email: email.toLowerCase().trim(),
        entityId,
        role,
        token,
        invitedBy: session.id,
        expiresAt,
      },
      include: {
        entity: { select: { id: true, officialName: true, entityType: true } },
      },
    });

    // Send invitation email via notification service
    try {
      const { NotificationService } = await import("@/lib/services/notification.service");
      await NotificationService.sendInvitationEmail({
        email: invitation.email,
        entityName: entity.officialName,
        inviterName: session.entityName || session.email,
        token: invitation.token,
        role: invitation.role,
        expiresAt: invitation.expiresAt,
      });
    } catch (emailError) {
      console.error("Failed to send invitation email:", emailError);
      // Don't fail the invite — the token is still valid
    }

    await createAuditLog({
      userId: session.id,
      action: "invitation.create",
      entityType: "invitation",
      entityId: invitation.id,
      newValue: { email: invitation.email, entityId, role, expiresAt: expiresAt.toISOString() },
    });

    return NextResponse.json(
      {
        id: invitation.id,
        email: invitation.email,
        role: invitation.role,
        entity: invitation.entity,
        status: invitation.status,
        expiresAt: invitation.expiresAt,
        createdAt: invitation.createdAt,
      },
      { status: 201 },
    );
  } catch (error) {
    console.error("Error creating invitation:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_CREATE_INVITATION" }, { status: 500 });
  }
}
