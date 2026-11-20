import type { InternalAuthContext, NotificationBulkAction, NotificationListQuery } from "@bealpha/contracts";
import type { NotificationDatabase } from "./database.js";
import { NotificationError } from "./errors.js";

function actor(context: InternalAuthContext) {
  if (context.authType !== "user" || !context.actorId) {
    throw new NotificationError(403, "FORBIDDEN", "Notification access requires a user");
  }
  return { userId: context.actorId, entityPath: context.entityPath };
}

function entityVisibility(userId: string, entityPath: string, unread = false) {
  return {
    entityPath,
    receipts: {
      none: {
        userId,
        OR: unread
          ? [{ readAt: { not: null } }, { dismissedAt: { not: null } }]
          : [{ dismissedAt: { not: null } }]
      }
    }
  };
}

function visibleWhere(userId: string, entityPath: string | undefined, unread = false) {
  return {
    OR: [
      { userId, ...(unread ? { read: false } : {}) },
      ...(entityPath ? [entityVisibility(userId, entityPath, unread)] : [])
    ]
  };
}

export class NotificationService {
  constructor(private readonly database: NotificationDatabase) {}

  async list(context: InternalAuthContext, query: NotificationListQuery) {
    const { userId, entityPath } = actor(context);
    const [records, unreadCount] = await Promise.all([
      this.database.prisma.notification.findMany({
        where: visibleWhere(userId, entityPath, query.unread),
        include: { receipts: { where: { userId }, select: { readAt: true } } },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: query.limit,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {})
      }),
      this.database.prisma.notification.count({ where: visibleWhere(userId, entityPath, true) })
    ]);
    const items = records.map(({ receipts, ...item }) => ({
      ...item,
      read: item.userId === userId ? item.read : Boolean(receipts[0]?.readAt)
    }));
    return {
      items,
      unreadCount,
      nextCursor: items.length === query.limit ? items.at(-1)?.id ?? null : null
    };
  }

  async markRead(context: InternalAuthContext, input: NotificationBulkAction) {
    const { userId, entityPath } = actor(context);
    const idFilter = input.all ? {} : { id: { in: input.ids! } };
    await this.database.prisma.notification.updateMany({
      where: { userId, read: false, ...idFilter },
      data: { read: true }
    });
    if (entityPath) {
      const shared = await this.database.prisma.notification.findMany({
        where: { ...entityVisibility(userId, entityPath), ...idFilter },
        select: { id: true }
      });
      if (shared.length) {
        const notificationIds = shared.map(item => item.id);
        const readAt = new Date();
        await this.database.prisma.$transaction([
          this.database.prisma.notificationReceipt.updateMany({
            where: { userId, notificationId: { in: notificationIds }, dismissedAt: null },
            data: { readAt }
          }),
          this.database.prisma.notificationReceipt.createMany({
            data: notificationIds.map(notificationId => ({ notificationId, userId, readAt })),
            skipDuplicates: true
          })
        ]);
      }
    }
    return {
      unreadCount: await this.database.prisma.notification.count({
        where: visibleWhere(userId, entityPath, true)
      })
    };
  }

  async remove(context: InternalAuthContext, input: NotificationBulkAction) {
    const { userId, entityPath } = actor(context);
    const idFilter = input.all ? {} : { id: { in: input.ids! } };
    const direct = await this.database.prisma.notification.deleteMany({ where: { userId, ...idFilter } });
    let sharedCount = 0;
    if (entityPath) {
      const shared = await this.database.prisma.notification.findMany({
        where: { ...entityVisibility(userId, entityPath), ...idFilter },
        select: { id: true }
      });
      sharedCount = shared.length;
      if (sharedCount) {
        const notificationIds = shared.map(item => item.id);
        const dismissedAt = new Date();
        await this.database.prisma.$transaction([
          this.database.prisma.notificationReceipt.updateMany({
            where: { userId, notificationId: { in: notificationIds } },
            data: { dismissedAt }
          }),
          this.database.prisma.notificationReceipt.createMany({
            data: notificationIds.map(notificationId => ({ notificationId, userId, dismissedAt })),
            skipDuplicates: true
          })
        ]);
      }
    }
    return { deleted: direct.count + sharedCount };
  }
}
