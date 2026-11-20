import { z } from "zod";

export const notificationListQuerySchema = z
  .object({
    unread: z.coerce.boolean().optional().default(false),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().uuid().optional()
  })
  .strict();

export const notificationBulkActionSchema = z
  .union([
    z.object({ all: z.literal(true), ids: z.never().optional() }).strict(),
    z.object({ all: z.literal(false).optional(), ids: z.array(z.string().uuid()).min(1).max(100) }).strict()
  ]);

export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;
export type NotificationBulkAction = z.infer<typeof notificationBulkActionSchema>;
