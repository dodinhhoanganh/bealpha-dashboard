import { notificationBulkActionSchema, notificationListQuerySchema } from "@bealpha/contracts";
import type { FastifyInstance } from "fastify";
import { NotificationService } from "./notification-service.js";
import { successEnvelope } from "./response.js";
export function registerNotificationRoutes(app: FastifyInstance, service: NotificationService) { app.get("/api/v1/notifications", async request => successEnvelope(request.id, await service.list(request.authContext!, notificationListQuerySchema.parse(request.query)))); app.patch("/api/v1/notifications", async request => successEnvelope(request.id, await service.markRead(request.authContext!, notificationBulkActionSchema.parse(request.body)))); app.delete("/api/v1/notifications", async request => successEnvelope(request.id, await service.remove(request.authContext!, notificationBulkActionSchema.parse(request.body)))); }
