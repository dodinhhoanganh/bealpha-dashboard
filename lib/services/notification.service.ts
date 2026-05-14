import { prisma } from "@/lib/prisma";
import { getAccessibleEntityIds } from "@/lib/entity-hierarchy";

export class NotificationService {
  /**
   * Notify when a new release is created.
   * Routes to entity hierarchy: Org admins + system moderators
   */
  static async notifyReleaseCreated(releaseId: string, creatorId: string) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: {
        title: true,
        tenantId: true,
        ownerId: true,
        artist: { select: { name: true } },
      },
    });

    if (!release) return;

    // Notify Org entity owners/admins
    const orgAdmins = await prisma.userEntityRole.findMany({
      where: {
        entityId: release.tenantId,
        role: { in: ["OWNER", "ADMIN"] },
        userId: { not: creatorId }, // Don't notify the creator
      },
      select: { userId: true },
    });

    const notifyIds = new Set(orgAdmins.map((a) => a.userId));

    // Also notify Sub-Account owner/admin if the release was created in a Sub-Account
    if (release.ownerId && release.ownerId !== release.tenantId) {
      const subAccountAdmins = await prisma.userEntityRole.findMany({
        where: {
          entityId: release.ownerId,
          role: { in: ["OWNER", "ADMIN"] },
          userId: { not: creatorId },
        },
        select: { userId: true },
      });
      subAccountAdmins.forEach((a) => notifyIds.add(a.userId));
    }

    // Also notify moderator staff
    const moderators = await prisma.userRole.findMany({
      where: { role: { name: { in: ["moderator", "admin"] } } },
      select: { userId: true },
    });
    moderators.forEach((m) => notifyIds.add(m.userId));
    notifyIds.delete(creatorId);

    if (notifyIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(notifyIds).map((userId) => ({
          userId,
          type: "system",
          title: "New Release Requires Review",
          message: `Release "${release.title}" by ${release.artist?.name || "Unknown"} has been submitted for review.`,
          link: `/releases/${releaseId}`,
        })),
      });
    }
  }

  /**
   * Notify when a release status changes in the multi-level workflow.
   */
  static async notifyReleaseStatusChange(
    releaseId: string,
    status: string,
    actorId: string,
  ) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { title: true, ownerId: true, tenantId: true },
    });

    if (!release) return;

    // Notify entity members who own this release
    const ownerMembers = await prisma.userEntityRole.findMany({
      where: { entityId: release.ownerId },
      select: { userId: true },
    });

    const notifyIds = new Set(ownerMembers.map((m) => m.userId));
    notifyIds.delete(actorId);

    const statusMessages: Record<string, string> = {
      PENDING_ORG_APPROVAL: `submitted for organization review`,
      ORG_REJECTED: `rejected by your organization`,
      PENDING_SYS_APPROVAL: `submitted for system review`,
      SYS_REJECTED: `rejected by system admin`,
      APPROVED: `approved`,
      DELIVERED: `delivered to DSPs`,
    };

    const msg = statusMessages[status] || `updated to ${status}`;

    if (notifyIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(notifyIds).map((userId) => ({
          userId,
          type: status.includes("REJECTED") ? "release_denied" : status === "APPROVED" ? "release_approved" : "system",
          title: `Release ${status.includes("REJECTED") ? "Rejected" : status === "APPROVED" ? "Approved" : "Updated"}`,
          message: `Your release "${release.title}" has been ${msg}.`,
          link: `/releases/${releaseId}`,
        })),
      });
    }

    // If approved at org level, escalate to system admins
    if (status === "PENDING_SYS_APPROVAL") {
      const sysAdmins = await prisma.userRole.findMany({
        where: { role: { name: { in: ["admin", "moderator"] } } },
        select: { userId: true },
      });

      const sysIds = new Set(sysAdmins.map((a) => a.userId));
      sysIds.delete(actorId);

      if (sysIds.size > 0) {
        await prisma.notification.createMany({
          data: Array.from(sysIds).map((userId) => ({
            userId,
            type: "system",
            title: "Release Escalated for System Review",
            message: `Release "${release.title}" has passed org review and requires system-level approval.`,
            link: `/releases/${releaseId}`,
          })),
        });
      }
    }
  }

  /**
   * Notify stakeholders when a release is delivered to DSPs.
   */
  static async notifyReleaseDelivered(releaseId: string) {
    const release = await prisma.release.findUnique({
      where: { id: releaseId },
      select: { title: true, ownerId: true, tenantId: true },
    });

    if (!release) return;

    // Notify all members of the owning entity + tenant entity
    const stakeholders = await prisma.userEntityRole.findMany({
      where: { entityId: { in: [release.ownerId, release.tenantId] } },
      select: { userId: true },
    });

    const stakeholderIds = new Set(stakeholders.map((s) => s.userId));

    if (stakeholderIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(stakeholderIds).map((userId) => ({
          userId,
          type: "delivery_confirmed",
          title: "Release Delivered",
          message: `Your release "${release.title}" has been successfully delivered to DSPs.`,
          link: `/releases/${releaseId}`,
        })),
      });
    }
  }

  /**
   * Track milestones and notify stakeholders
   */
  static async notifyStreamingMilestones(trackId: string) {
    const track = await prisma.track.findUnique({
      where: { id: trackId },
      select: {
        id: true,
        title: true,
        release: {
          select: { id: true, ownerId: true, tenantId: true },
        },
      },
    });

    if (!track || !track.release) return;

    const totalMetrics = await prisma.streamingMetrics.aggregate({
      where: { trackId },
      _sum: { plays: true },
    });

    const totalPlays = totalMetrics._sum.plays || 0;

    const milestones = [100000, 1000000, 10000000, 100000000, 1000000000];
    let reachedMilestone = 0;
    for (const m of milestones) {
      if (totalPlays >= m) reachedMilestone = m;
      else break;
    }

    if (reachedMilestone === 0) return;

    const existingNotif = await prisma.notification.findFirst({
      where: {
        type: "welcome",
        message: { contains: `reached ${reachedMilestone.toLocaleString()} streams` },
        link: { contains: trackId },
      },
    });

    if (existingNotif) return;

    const stakeholders = await prisma.userEntityRole.findMany({
      where: {
        entityId: { in: [track.release.ownerId, track.release.tenantId] },
      },
      select: { userId: true },
    });

    const stakeholderIds = new Set(stakeholders.map((s) => s.userId));

    if (stakeholderIds.size > 0) {
      await prisma.notification.createMany({
        data: Array.from(stakeholderIds).map((userId) => ({
          userId,
          type: "welcome",
          title: "Streaming Milestone Reached!",
          message: `Congratulations! The track "${track.title}" has reached ${reachedMilestone.toLocaleString()} streams!`,
          link: `/analytics?trackId=${trackId}`,
          metadata: { trackId, milestone: reachedMilestone } as any,
        })),
      });
    }
  }

  /**
   * Quarterly Revenue Notification
   */
  static async notifyQuarterlyRevenue(quarterName: string) {
    const financialUsers = await prisma.userRole.findMany({
      where: {
        role: { name: { in: ["finance", "admin"] } },
      },
      select: { userId: true },
    });

    const userIds = [...new Set(financialUsers.map((u) => u.userId))];

    if (userIds.length > 0) {
      await prisma.notification.createMany({
        data: userIds.map((userId) => ({
          userId,
          type: "new_royalty",
          title: "Quarterly Revenue Report Available",
          message: `The revenue report for ${quarterName} has been processed and is now available in your dashboard.`,
          link: `/finance/reports`,
        })),
      });
    }
  }

  /**
   * Send an invitation email to join an entity.
   * Creates an in-app notification if the user already exists,
   * and queues an email for external delivery.
   */
  static async sendInvitationEmail(params: {
    email: string;
    entityName: string;
    inviterName: string;
    token: string;
    role: string;
    expiresAt: Date;
  }) {
    const { email, entityName, inviterName, token, role, expiresAt } = params;

    // Check if user already exists — create in-app notification
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (existingUser) {
      await prisma.notification.create({
        data: {
          userId: existingUser.id,
          type: "invitation",
          title: `You've been invited to join "${entityName}"`,
          message: `${inviterName} has invited you to join "${entityName}" as ${role}. The invitation expires on ${expiresAt.toLocaleDateString()}.`,
          link: `/invite/${token}`,
        },
      });
    }

    // Wire up transactional email provider
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const inviteLink = `${baseUrl}/invite/${token}`;
    
    const { EmailService } = await import("@/lib/services/email.service");
    
    await EmailService.sendMail({
      to: email,
      subject: `You have been invited to join ${entityName}`,
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; overflow: hidden;">
          <div style="background-color: #000; padding: 24px; text-align: center;">
            <h1 style="color: #fff; margin: 0; font-size: 24px;">BeAlpha</h1>
          </div>
          <div style="padding: 32px;">
            <h2 style="margin-top: 0; color: #111;">Invitation to Join ${entityName}</h2>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
              Hello,
            </p>
            <p style="color: #4b5563; font-size: 16px; line-height: 1.5;">
              <strong>${inviterName}</strong> has invited you to join <strong>${entityName}</strong> on BeAlpha with the role of <strong>${role}</strong>.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${inviteLink}" style="background-color: #000; color: #fff; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 16px; display: inline-block;">
                Accept Invitation
              </a>
            </div>
            <p style="color: #6b7280; font-size: 14px; line-height: 1.5;">
              This invitation will expire on ${expiresAt.toLocaleDateString()}. If you did not expect this invitation, you can safely ignore this email.
            </p>
          </div>
        </div>
      `
    });
    
    console.log(`[Invitation Email] Queued email to: ${email}, Entity: ${entityName}, Link: ${inviteLink}`);
  }
}
