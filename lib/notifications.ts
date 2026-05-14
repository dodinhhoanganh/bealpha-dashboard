/**
 * Notification Helper — server-side utility to create notifications
 * Import this in API routes to trigger notifications on events.
 */

import { prisma } from "@/lib/prisma";

export type NotificationType =
  | "release_approved"
  | "release_denied"
  | "release_scheduled"
  | "release_released"
  | "new_royalty"
  | "delivery_confirmed"
  | "delivery_failed"
  | "system"
  | "welcome";

interface CreateNotificationParams {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a notification for a single user
 */
export async function createNotification(params: CreateNotificationParams) {
  return prisma.notification.create({
    data: {
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link || null,
      metadata: params.metadata ? (params.metadata as any) : undefined,
    },
  });
}

/**
 * Create notifications for multiple users (broadcast)
 */
export async function broadcastNotification(
  userIds: string[],
  params: Omit<CreateNotificationParams, "userId">,
) {
  return prisma.notification.createMany({
    data: userIds.map((userId) => ({
      userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link || null,
      metadata: params.metadata ? (params.metadata as any) : undefined,
    })),
  });
}

/**
 * Notify all admins about an event
 */
export async function notifyAdmins(
  params: Omit<CreateNotificationParams, "userId">,
) {
  const adminUsers = await prisma.userRole.findMany({
    where: { role: { name: "admin" } },
    select: { userId: true },
  });
  const adminIds = adminUsers.map((u) => u.userId);
  if (adminIds.length === 0) return;
  return broadcastNotification(adminIds, params);
}

// =============================================
// Pre-built notification templates
// =============================================

export async function notifyReleaseApproved(
  userId: string,
  releaseTitle: string,
  releaseId: string,
) {
  return createNotification({
    userId,
    type: "release_approved",
    title: "Release Approved",
    message: `Your release "${releaseTitle}" has been approved and is ready for distribution.`,
    link: "products",
    metadata: { releaseId },
  });
}

export async function notifyReleaseDenied(
  userId: string,
  releaseTitle: string,
  releaseId: string,
  reason?: string,
) {
  return createNotification({
    userId,
    type: "release_denied",
    title: "Release Denied",
    message: `Your release "${releaseTitle}" was denied.${reason ? ` Reason: ${reason}` : ""} Please review and resubmit.`,
    link: "products",
    metadata: { releaseId, reason },
  });
}

export async function notifyReleaseScheduled(
  userId: string,
  releaseTitle: string,
  releaseDate: string,
) {
  return createNotification({
    userId,
    type: "release_scheduled",
    title: "Release Scheduled",
    message: `"${releaseTitle}" is scheduled for release on ${releaseDate}.`,
    link: "products",
  });
}

export async function notifyReleaseReleased(
  userId: string,
  releaseTitle: string,
) {
  return createNotification({
    userId,
    type: "release_released",
    title: "Release is Live!",
    message: `"${releaseTitle}" is now live on all platforms.`,
    link: "products",
  });
}

export async function notifyNewRoyalty(
  userId: string,
  platform: string,
  amount: number,
  period: string,
) {
  return createNotification({
    userId,
    type: "new_royalty",
    title: "New Royalty Report",
    message: `${platform} report for ${period}: $${amount.toFixed(2)} revenue.`,
    link: "earnings",
    metadata: { platform, amount, period },
  });
}

export async function notifyDeliveryConfirmed(
  userId: string,
  releaseTitle: string,
  dspName: string,
) {
  return createNotification({
    userId,
    type: "delivery_confirmed",
    title: "Delivery Confirmed",
    message: `"${releaseTitle}" has been confirmed by ${dspName}.`,
    link: "distribution",
    metadata: { dspName },
  });
}

export async function notifyDeliveryFailed(
  userId: string,
  releaseTitle: string,
  dspName: string,
  error?: string,
) {
  return createNotification({
    userId,
    type: "delivery_failed",
    title: "Delivery Failed",
    message: `Delivery of "${releaseTitle}" to ${dspName} failed.${error ? ` Error: ${error}` : ""}`,
    link: "distribution",
    metadata: { dspName, error },
  });
}

export async function notifyWelcome(userId: string, userName: string) {
  return createNotification({
    userId,
    type: "welcome",
    title: "Welcome to BeAlpha!",
    message: `Hi ${userName}, welcome to BeAlpha Music. Start by creating your first release.`,
    link: "dashboard",
  });
}
