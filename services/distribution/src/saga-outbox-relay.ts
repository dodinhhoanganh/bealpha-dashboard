import { internalAuthContextSchema } from "@bealpha/contracts";
import type { Queue } from "bullmq";
import { z } from "zod";

import type { DistributionDatabase } from "./database.js";

const snapshotRequestSchema = z
  .object({
    deliveryId: z.string().uuid(),
    releaseId: z.string().uuid(),
    actor: internalAuthContextSchema
  })
  .strict();

export class DistributionSagaOutboxRelay {
  private timer?: NodeJS.Timeout;
  private flushing = false;

  constructor(
    private readonly database: DistributionDatabase,
    private readonly queue: Queue,
    private readonly pollMs: number,
    private readonly batchSize: number
  ) {}

  start(): void {
    this.timer = setInterval(() => void this.flush(), this.pollMs);
    this.timer.unref();
    void this.flush();
  }

  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const events = await this.database.prisma.outboxEvent.findMany({
        where: { type: "distribution.snapshot.requested", publishedAt: null },
        orderBy: { occurredAt: "asc" },
        take: this.batchSize
      });
      for (const event of events) {
        try {
          const payload = snapshotRequestSchema.parse(event.payload);
          await this.queue.add(
            "GenerateSnapshotJob",
            { ...payload, requestId: event.requestId },
            { jobId: event.eventId, removeOnComplete: 1000, removeOnFail: 1000 }
          );
          await this.database.prisma.outboxEvent.update({
            where: { id: event.id },
            data: { publishedAt: new Date(), lastError: null }
          });
        } catch (error) {
          await this.database.prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              attempts: { increment: 1 },
              lastError: (error instanceof Error ? error.message : "SAGA_ENQUEUE_FAILED").slice(0, 500)
            }
          }).catch(() => undefined);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.flush();
  }
}
