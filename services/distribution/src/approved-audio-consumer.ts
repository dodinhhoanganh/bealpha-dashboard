import { Redis } from "ioredis";
import type { Queue } from "bullmq";
import { z } from "zod";
import type { DistributionDatabase } from "./database.js";
import { ensureApprovedAudioPreparation } from "./approved-audio-preparation.js";

type StreamMessage = [string, string[]];

const approvedAudioEvent = z.object({
  version: z.literal(1),
  eventId: z.string().uuid(),
  type: z.literal("catalog.release.approved"),
  occurredAt: z.string().datetime({ offset: true }),
  requestId: z.string().uuid(),
  actorId: z.string().uuid(),
  entityPath: z.string().min(1).max(2048),
  payload: z.object({
    releaseId: z.string().uuid(),
    releaseType: z.enum(["AUDIO", "VIDEO"]),
    tenantId: z.string().uuid(),
    approverEntityId: z.string().uuid(),
    recipientEntityPath: z.string().min(1).max(2048),
    status: z.string()
  }).passthrough()
}).passthrough();

export async function enqueueApprovedAudioPackage(raw: unknown, queue: Pick<Queue, "add">, database: DistributionDatabase): Promise<boolean> {
  const parsed = approvedAudioEvent.safeParse(raw);
  if (!parsed.success || parsed.data.payload.status !== "APPROVED" || parsed.data.payload.releaseType !== "AUDIO") return false;
  const event = parsed.data;
  const preparation = await ensureApprovedAudioPreparation(database, {
    packageId: event.eventId,
    releaseId: event.payload.releaseId,
    tenantId: event.payload.tenantId,
    entityPath: event.payload.recipientEntityPath,
    createdAt: event.occurredAt,
    requestId: event.requestId,
    actorId: event.actorId,
    approverEntityId: event.payload.approverEntityId
  });
  const preparationPayload = preparation.payload && typeof preparation.payload === "object" ? preparation.payload as { phase?: unknown } : undefined;
  if (preparation.status !== "RUNNING" || preparationPayload?.phase !== "PREPARING") return true;
  try {
    await queue.add("PrepareApprovedAudioPackageJob", {
    packageId: event.eventId,
    releaseId: event.payload.releaseId,
    createdAt: event.occurredAt,
    requestId: event.requestId,
    actor: {
      v: 1,
      requestId: event.requestId,
      authType: "user",
      actorId: event.actorId,
      entityId: event.payload.approverEntityId,
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityPath: event.entityPath,
      roles: ["SUPER_ADMIN"],
      staffRoles: [],
      authzVersion: 1
    }
    }, { jobId: event.eventId, removeOnComplete: 1000, removeOnFail: 1000 });
  } catch (error) {
    await database.prisma.exportJob.updateMany({ where: { id: event.eventId, status: "RUNNING" }, data: { status: "FAILED", lastError: "DDEX_PREPARATION_FAILED: CATALOG_QUEUE_UNAVAILABLE" } });
    throw error;
  }
  return true;
}

export async function enqueueApprovedVideoPackage(raw: unknown, queue: Pick<Queue, "add">): Promise<boolean> {
  const parsed = approvedAudioEvent.safeParse(raw);
  if (!parsed.success || parsed.data.payload.status !== "APPROVED" || parsed.data.payload.releaseType !== "VIDEO") return false;
  const event = parsed.data;
  await queue.add("PrepareApprovedVideoPackageJob", {
    packageId: event.eventId,
    releaseId: event.payload.releaseId,
    createdAt: event.occurredAt,
    requestId: event.requestId,
    actor: {
      v: 1,
      requestId: event.requestId,
      authType: "user",
      actorId: event.actorId,
      entityId: event.payload.approverEntityId,
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      entityPath: event.entityPath,
      roles: ["SUPER_ADMIN"],
      staffRoles: [],
      authzVersion: 1
    }
  }, { jobId: event.eventId, removeOnComplete: 1000, removeOnFail: 1000 });
  return true;
}

export class ApprovedAudioConsumer {
  private readonly redis: Redis;
  private readonly consumer = `distribution-ddex-${process.pid}`;
  private timer?: NodeJS.Timeout;
  private ready = false;
  private polling = false;

  constructor(redisUrl: string, private readonly queue: Queue, private readonly pollMs: number, private readonly autoPrepareAudio = true, private readonly database?: DistributionDatabase) {
    this.redis = new Redis(redisUrl, { enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 1000, retryStrategy: attempts => Math.min(attempts * 100, 2000) });
  }

  start() { this.timer = setInterval(() => void this.poll().catch(() => undefined), this.pollMs); this.timer.unref(); void this.poll().catch(() => undefined); }

  private async ensureGroup() {
    if (this.ready) return;
    await this.redis.xgroup("CREATE", "bealpha:events", "distribution-ddex", "0", "MKSTREAM").catch(error => { if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) throw error; });
    this.ready = true;
  }

  async poll() {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.ensureGroup();
      const claimed = await this.redis.call("XAUTOCLAIM", "bealpha:events", "distribution-ddex", this.consumer, "60000", "0-0", "COUNT", "50") as [string, StreamMessage[]];
      await this.process(claimed?.[1] ?? []);
      const result = await this.redis.xreadgroup("GROUP", "distribution-ddex", this.consumer, "COUNT", 50, "BLOCK", 100, "STREAMS", "bealpha:events", ">") as unknown as [string, StreamMessage[]][] | null;
      await this.process(result?.[0]?.[1] ?? []);
    } finally {
      this.polling = false;
    }
  }

  private async process(messages: StreamMessage[]) {
    for (const [id, fields] of messages) {
      const index = fields.indexOf("event");
      if (index < 0 || !fields[index + 1]) { await this.redis.xack("bealpha:events", "distribution-ddex", id); continue; }
      try {
        const raw = JSON.parse(fields[index + 1]);
        if (raw?.type === "catalog.release.approved") {
          if (this.autoPrepareAudio) {
            if (!this.database) throw new Error("Distribution database is required for automatic DDEX preparation");
            await enqueueApprovedAudioPackage(raw, this.queue, this.database);
          }
          await enqueueApprovedVideoPackage(raw, this.queue);
        }
        await this.redis.xack("bealpha:events", "distribution-ddex", id);
      } catch { /* Failed events remain pending and are not acknowledged. */ }
    }
  }

  async close() { if (this.timer) clearInterval(this.timer); this.redis.disconnect(); }
}
