import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSecureSession, hasPermission, PERMISSIONS, isSystemAdmin } from "@/lib/auth";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";
import { createAuditLog } from "@/lib/audit";
import { NotificationService } from "@/lib/services/notification.service";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/releases/[id]/deny — Multi-level denial workflow
 *
 * B2B2B tier-aware rejection:
 *   - Organization denies PENDING_ORG_APPROVAL → ORG_REJECTED
 *   - System Admin denies PENDING_SYS_APPROVAL → SYS_REJECTED
 *   - System Admin can deny at any stage → SYS_REJECTED
 *
 * Organizations can only deny releases within their own tenant.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_DENY)) {
      return NextResponse.json(
        { error: "ERROR_ACCESS_DENIED_ONLY_ADMIN_OR_MODERATOR_CAN_DE" },
        { status: 403 },
      );
    }

    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = body.reason || "No reason provided";

    const release = await prisma.release.findUnique({
      where: { id },
      select: { id: true, status: true, title: true, tenantId: true },
    });

    if (!release) {
      return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
    }

    // Tenant scope: non-system-admins can only deny releases in their entity hierarchy
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(release.tenantId)) {
        return NextResponse.json(
          { error: "ERROR_CANNOT_DENY_RELEASE_OUTSIDE_YOUR_ORGANIZATION" },
          { status: 403 },
        );
      }
    }

    if (release.status === "ORG_REJECTED" || release.status === "SYS_REJECTED") {
      return NextResponse.json(
        { error: "ERROR_RELEASE_IS_ALREADY_DENIED" },
        { status: 400 },
      );
    }

    const deniableStatuses = ["PENDING_ORG_APPROVAL", "PENDING_SYS_APPROVAL", "SCHEDULED"];
    if (!deniableStatuses.includes(release.status)) {
      return NextResponse.json(
        {
          error: `Cannot deny a release with status "${release.status}". Only pending or scheduled releases can be denied.`,
        },
        { status: 400 },
      );
    }

    // Determine rejection status based on approver tier and release status
    let rejectionStatus: "ORG_REJECTED" | "SYS_REJECTED";

    if (isSystemAdmin(session)) {
      // System Admin rejection is always SYS_REJECTED
      rejectionStatus = "SYS_REJECTED";
    } else if (release.status === "PENDING_ORG_APPROVAL") {
      // Organization can reject at org level
      rejectionStatus = "ORG_REJECTED";
    } else {
      // Non-system-admin trying to deny PENDING_SYS_APPROVAL — not allowed
      return NextResponse.json(
        { error: "ERROR_ONLY_SYSTEM_ADMIN_CAN_DENY_AT_THIS_STAGE" },
        { status: 403 },
      );
    }

    const updatedRelease = await prisma.release.update({
      where: { id },
      data: {
        status: rejectionStatus,
      },
    });

    // Audit log
    await createAuditLog({
      userId: session.id,
      action: "release.deny",
      entityType: "release",
      entityId: id,
      oldValue: { status: release.status },
      newValue: { status: rejectionStatus, reason },
    });

    // Send notification to artist/label
    await NotificationService.notifyReleaseStatusChange(
      updatedRelease.id,
      rejectionStatus,
      session.id,
    ).catch(console.error);

    return NextResponse.json({
      success: true,
      message: `Release "${updatedRelease.title}" has been denied`,
      reason,
      release: {
        id: updatedRelease.id,
        title: updatedRelease.title,
        status: updatedRelease.status,
      },
    });
  } catch (error) {
    console.error("Error denying release:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_DENY_RELEASE" },
      { status: 500 },
    );
  }
}

