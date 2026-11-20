import {
  catalogReleaseApprovedPayloadSchema,
  catalogReleaseRejectedPayloadSchema,
  catalogReleaseSubmittedPayloadSchema,
  notificationRequestPayloadSchema
} from "@bealpha/contracts";
import { Redis } from "ioredis";
import { z } from "zod";
import type { NotificationDatabase } from "./database.js";
import { PayloadCipher } from "./payload-crypto.js";

const baseEvent = { version: z.literal(1), eventId: z.string().uuid(), requestId: z.string().uuid(), actorId: z.string().optional(), tenantId: z.string().optional(), entityPath: z.string().optional() };
const eventSchema = z.discriminatedUnion("type", [
  z.object({ ...baseEvent, type: z.literal("notification.requested"), payload: notificationRequestPayloadSchema }).passthrough(),
  z.object({ ...baseEvent, type: z.literal("catalog.release.rejected"), payload: catalogReleaseRejectedPayloadSchema }).passthrough(),
  z.object({ ...baseEvent, type: z.literal("catalog.release.submitted"), payload: catalogReleaseSubmittedPayloadSchema }).passthrough(),
  z.object({ ...baseEvent, type: z.literal("catalog.release.approved"), payload: catalogReleaseApprovedPayloadSchema }).passthrough()
]);

export async function consumeNotificationEvent(database: NotificationDatabase, cipher: PayloadCipher, raw: unknown): Promise<boolean> {
  const event = eventSchema.parse(raw);
  if (event.type === "catalog.release.rejected") {
    const result = await database.prisma.notification.createMany({
      data: [{ eventId: event.eventId, entityPath: event.payload.recipientEntityPath, type: "release_rejected", title: `Release rejected by ${event.payload.rejectedByTier.toLowerCase().replace("_", " ")}`, message: event.payload.reason, link: `/?panel=releases&releaseId=${encodeURIComponent(event.payload.releaseId)}`, metadata: { releaseId: event.payload.releaseId, status: event.payload.status, rejectedByTier: event.payload.rejectedByTier } }],
      skipDuplicates: true
    });
    return result.count === 1;
  }
  if (event.type === "catalog.release.submitted" || event.type === "catalog.release.approved") {
    const finalApproval = event.payload.status === "APPROVED";
    const result = await database.prisma.notification.createMany({
      data: [{
        eventId: event.eventId,
        entityPath: event.payload.recipientEntityPath,
        type: finalApproval ? "release_approved" : "release_review_requested",
        title: finalApproval ? "Release approved by BeAlpha" : "Release awaiting your review",
        message: finalApproval ? "The release passed final approval and its manual delivery package is being prepared." : "A release has advanced to your approval tier.",
        link: `/?panel=releases&releaseId=${encodeURIComponent(event.payload.releaseId)}`,
        metadata: { releaseId: event.payload.releaseId, status: event.payload.status }
      }],
      skipDuplicates: true
    });
    return result.count === 1;
  }
  const encrypted = cipher.encrypt(event.payload.variables);
  const result = await database.prisma.emailDelivery.createMany({ data: [{ eventId: event.eventId, requestId: event.requestId, actorId: event.actorId, tenantId: event.tenantId, entityPath: event.entityPath, recipient: event.payload.recipient, template: event.payload.template, locale: event.payload.locale, variablesCiphertext: encrypted.ciphertext, variablesIv: encrypted.iv, variablesAuthTag: encrypted.authTag }], skipDuplicates: true });
  return result.count === 1;
}

type StreamMessage = [string, string[]];
export class NotificationEventConsumer {
  private readonly redis: Redis;
  private ready = false;
  constructor(private readonly database: NotificationDatabase, private readonly cipher: PayloadCipher, redisUrl: string, private readonly consumer: string) { this.redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000, retryStrategy: attempt => Math.min(attempt * 100, 2000) }); }
  private async ensureGroup() { if (this.ready) return; await this.redis.xgroup("CREATE", "bealpha:events", "notifications", "0", "MKSTREAM").catch(error => { if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error; }); this.ready = true; }
  private async process(messages: StreamMessage[]) { for (const [id, fields] of messages) { const index = fields.indexOf("event"); if (index < 0 || !fields[index + 1]) { await this.redis.xack("bealpha:events", "notifications", id); continue; } try { const raw = JSON.parse(fields[index + 1]); if (["notification.requested", "catalog.release.rejected", "catalog.release.submitted", "catalog.release.approved"].includes(raw?.type)) await consumeNotificationEvent(this.database, this.cipher, raw); await this.redis.xack("bealpha:events", "notifications", id); } catch { /* Pending event is reclaimed after idle timeout. */ } } }
  async poll() { await this.ensureGroup(); const claimed = await this.redis.call("XAUTOCLAIM", "bealpha:events", "notifications", this.consumer, "60000", "0-0", "COUNT", "50") as [string, StreamMessage[]]; if (claimed?.[1]?.length) await this.process(claimed[1]); const result = await this.redis.xreadgroup("GROUP", "notifications", this.consumer, "COUNT", 50, "BLOCK", 100, "STREAMS", "bealpha:events", ">") as unknown as [string, StreamMessage[]][] | null; const messages = result?.[0]?.[1] ?? []; if (messages.length) await this.process(messages); }
  close() { this.redis.disconnect(); }
}
