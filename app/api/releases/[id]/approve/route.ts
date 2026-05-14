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
 * POST /api/releases/[id]/approve — Multi-level approval workflow
 *
 * B2B2B 2-step approval:
 *   1. Organization approves PENDING_ORG_APPROVAL → PENDING_SYS_APPROVAL
 *   2. System Admin approves PENDING_SYS_APPROVAL → APPROVED
 *
 * System Admins can approve at any stage (bypass org step).
 * Organizations can only approve releases within their own tenant.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await getSecureSession();

    if (!session) {
      return NextResponse.json({ error: "ERROR_NOT_AUTHENTICATED" }, { status: 401 });
    }

    if (!hasPermission(session, PERMISSIONS.RELEASE_APPROVE)) {
      return NextResponse.json(
        {
          error: "ERROR_ACCESS_DENIED_ONLY_ADMIN_OR_MODERATOR_CAN_AP",
        },
        { status: 403 },
      );
    }

    const { id } = await params;

    const release = await prisma.release.findUnique({
      where: { id },
      select: { id: true, status: true, title: true, tenantId: true, ownerId: true },
    });

    if (!release) {
      return NextResponse.json({ error: "ERROR_RELEASE_NOT_FOUND" }, { status: 404 });
    }

    // Tenant scope: non-system-admins can only approve releases in their entity hierarchy
    if (!isSystemAdmin(session)) {
      const accessibleIds = await getAccessibleEntityIds(session.entityId);
      if (!accessibleIds.includes(release.tenantId)) {
        return NextResponse.json(
          { error: "ERROR_CANNOT_APPROVE_RELEASE_OUTSIDE_YOUR_ORGANIZATION" },
          { status: 403 },
        );
      }
    }

    if (release.status !== "PENDING_SYS_APPROVAL" && release.status !== "PENDING_ORG_APPROVAL") {
      return NextResponse.json(
        { error: `Release is already ${release.status.toLowerCase()}` },
        { status: 400 },
      );
    }

    // Determine the new status based on current status and approver's tier
    let newStatus: "PENDING_SYS_APPROVAL" | "APPROVED";

    if (release.status === "PENDING_ORG_APPROVAL") {
      if (isSystemAdmin(session)) {
        // System Admin can bypass org review and approve directly
        newStatus = "APPROVED";
      } else {
        // Organization approves → forward to System Admin for final review
        newStatus = "PENDING_SYS_APPROVAL";
      }
    } else {
      // release.status === "PENDING_SYS_APPROVAL"
      if (!isSystemAdmin(session)) {
        return NextResponse.json(
          { error: "ERROR_ONLY_SYSTEM_ADMIN_CAN_PERFORM_FINAL_APPROVAL" },
          { status: 403 },
        );
      }
      newStatus = "APPROVED";
    }

    const updatedRelease = await prisma.release.update({
      where: { id },
      data: {
        status: newStatus,
      },
      include: {
        artist: { select: { id: true, name: true } },
        label: { select: { id: true, name: true } },
      },
    });

    // Audit log
    await createAuditLog({
      userId: session.id,
      action: "release.approve",
      entityType: "release",
      entityId: id,
      oldValue: { status: release.status },
      newValue: { status: newStatus },
    });

    // Notify the creator and route up the hierarchy
    await NotificationService.notifyReleaseStatusChange(
      updatedRelease.id,
      newStatus,
      session.id,
    ).catch(console.error);

    const actionLabel = newStatus === "PENDING_SYS_APPROVAL"
      ? "approved by organization and forwarded for system review"
      : "approved";

    return NextResponse.json({
      success: true,
      message: `Release "${updatedRelease.title}" has been ${actionLabel}`,
      release: {
        id: updatedRelease.id,
        title: updatedRelease.title,
        status: updatedRelease.status,
        artist: updatedRelease.artist?.name,
        label: updatedRelease.label?.name,
      },
    });
  } catch (error) {
    console.error("Error approving release:", error);
    return NextResponse.json(
      { error: "ERROR_FAILED_TO_APPROVE_RELEASE" },
      { status: 500 },
    );
  }
}
