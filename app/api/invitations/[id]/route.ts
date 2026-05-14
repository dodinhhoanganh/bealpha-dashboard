import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getSecureSession,
  hasPermission,
  PERMISSIONS,
  isSystemAdmin,
} from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import { createAuditLog } from "@/lib/audit";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/invitations/[id] — Get invitation details
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    const { id } = await params;

    const invitation = await prisma.invitation.findUnique({
      where: { id },
      include: {
        entity: { select: { id: true, officialName: true, entityType: true } },
        inviter: { select: { id: true, email: true, name: true } },
      },
    });

    if (!invitation) {
      return NextResponse.json({ error: "ERROR_INVITATION_NOT_FOUND" }, { status: 404 });
    }

    // Check access
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(invitation.entityId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    return NextResponse.json(invitation);
  } catch (error) {
    console.error("Error fetching invitation:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_FETCH_INVITATION" }, { status: 500 });
  }
}

/**
 * DELETE /api/invitations/[id] — Revoke a pending invitation
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_INVITE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    const invitation = await prisma.invitation.findUnique({
      where: { id },
      select: { id: true, email: true, entityId: true, status: true },
    });

    if (!invitation) {
      return NextResponse.json({ error: "ERROR_INVITATION_NOT_FOUND" }, { status: 404 });
    }

    // Check access
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(invitation.entityId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot revoke invitation with status "${invitation.status}"` },
        { status: 400 },
      );
    }

    await prisma.invitation.update({
      where: { id },
      data: { status: "REVOKED" },
    });

    await createAuditLog({
      userId: session.id,
      action: "invitation.revoke",
      entityType: "invitation",
      entityId: id,
      oldValue: { status: "PENDING" },
      newValue: { status: "REVOKED" },
    });

    return NextResponse.json({ success: true, message: "Invitation revoked" });
  } catch (error) {
    console.error("Error revoking invitation:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_REVOKE_INVITATION" }, { status: 500 });
  }
}

/**
 * POST /api/invitations/[id] — Resend an invitation email
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();
    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }
    if (!hasPermission(session, PERMISSIONS.ENTITY_INVITE)) {
      return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
    }

    const { id } = await params;

    const invitation = await prisma.invitation.findUnique({
      where: { id },
      include: {
        entity: { select: { id: true, officialName: true } },
      },
    });

    if (!invitation) {
      return NextResponse.json({ error: "ERROR_INVITATION_NOT_FOUND" }, { status: 404 });
    }

    if (invitation.status !== "PENDING") {
      return NextResponse.json(
        { error: `Cannot resend invitation with status "${invitation.status}"` },
        { status: 400 },
      );
    }

    // Check access
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(invitation.entityId)) {
        return NextResponse.json({ error: "ERROR_ACCESS_DENIED" }, { status: 403 });
      }
    }

    // Extend expiry
    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 7);
    await prisma.invitation.update({
      where: { id },
      data: { expiresAt: newExpiry },
    });

    // Resend email
    try {
      const { NotificationService } = await import("@/lib/services/notification.service");
      await NotificationService.sendInvitationEmail({
        email: invitation.email,
        entityName: invitation.entity.officialName,
        inviterName: session.entityName || session.email,
        token: invitation.token,
        role: invitation.role,
        expiresAt: newExpiry,
      });
    } catch (emailError) {
      console.error("Failed to resend invitation email:", emailError);
    }

    await createAuditLog({
      userId: session.id,
      action: "invitation.resend",
      entityType: "invitation",
      entityId: id,
      newValue: { email: invitation.email, expiresAt: newExpiry.toISOString() },
    });

    return NextResponse.json({
      success: true,
      message: `Invitation resent to ${invitation.email}`,
      expiresAt: newExpiry,
    });
  } catch (error) {
    console.error("Error resending invitation:", error);
    return NextResponse.json({ error: "ERROR_FAILED_TO_RESEND_INVITATION" }, { status: 500 });
  }
}
