import { prisma } from "@/lib/prisma";
import { Prisma } from "@prisma/client";

interface AuditLogParams {
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Create an audit log entry.
 *
 * Usage:
 *   await createAuditLog({
 *     userId: session.id,
 *     action: "release.approve",
 *     entityType: "release",
 *     entityId: releaseId,
 *     oldValue: { status: "PENDING" },
 *     newValue: { status: "APPROVED" },
 *   });
 *
 * Actions follow the pattern: entity.verb
 *   - release.create, release.update, release.delete, release.approve, release.deny
 *   - track.create, track.update, track.delete
 *   - artist.create, artist.update, artist.delete
 *   - label.create, label.update, label.delete
 *   - asset.create, asset.update, asset.delete
 *   - user.create, user.update, user.delete, user.ban, user.unban
 *   - auth.login, auth.logout, auth.2fa_enable, auth.2fa_disable
 */
export async function createAuditLog(params: AuditLogParams): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: params.userId,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        oldValue: params.oldValue
          ? (params.oldValue as Prisma.InputJsonValue)
          : undefined,
        newValue: params.newValue
          ? (params.newValue as Prisma.InputJsonValue)
          : undefined,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
      },
    });
  } catch (error) {
    // Never let audit log failures break the main operation
    console.error("Failed to create audit log:", error);
  }
}

/**
 * Create audit log with request context (extracts IP and User-Agent).
 */
export async function createAuditLogFromRequest(
  request: Request,
  params: Omit<AuditLogParams, "ipAddress" | "userAgent">,
): Promise<void> {
  const ipAddress =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown";
  const userAgent = request.headers.get("user-agent") || undefined;

  return createAuditLog({
    ...params,
    ipAddress,
    userAgent,
  });
}
