import { randomUUID } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadDistributionConfig } from "./config.js";
import { createDistributionDatabase, type DistributionDatabase } from "./database.js";
import type { PackageDelivery } from "./package-builder.js";
import { SftpDeliveryTransport } from "./sftp-transport.js";
import { SftpAcknowledgementTransport, type DownloadedAcknowledgement, type SftpAcknowledgementDelivery } from "./sftp-transport.js";
import { processNextExportJob } from "./export-worker.js";
import { DistributionService } from "./distribution-service.js";
import { processNextVevoSubmission } from "./vevo-worker.js";

export interface DeliveryTransport { send(delivery: PackageDelivery & { dsp: string }): Promise<{ remoteFolder?: string }>; cleanup?(delivery: { id: string }): Promise<void>; }
export class UnconfiguredTransport implements DeliveryTransport { async send(): Promise<{ remoteFolder?: string }> { throw new Error("DISTRIBUTION_TRANSPORT_NOT_CONFIGURED"); } }

export async function processNextDeliveryJob(database: DistributionDatabase, transport: DeliveryTransport, maxAttempts: number): Promise<boolean> {
  const job = await database.prisma.deliveryJob.findFirst({ where: { status: "PENDING", availableAt: { lte: new Date() } }, include: { delivery: { include: { snapshot: true, assetGrants: true } } }, orderBy: { createdAt: "asc" } });
  if (!job) return false;
  if (!job.delivery.snapshot) {
    // DeliveryJobs are only created after snapshot generation is complete via Saga
    throw new Error("Delivery job found without a snapshot. This indicates corrupted orchestration state.");
  }
  const claimed = await database.prisma.deliveryJob.updateMany({ where: { id: job.id, status: "PENDING" }, data: { status: "RUNNING", lockedAt: new Date(), attempts: { increment: 1 } } });
  if (claimed.count !== 1) return true;
  try {
    await database.prisma.delivery.update({ where: { id: job.deliveryId }, data: { status: "PROCESSING", attempts: { increment: 1 } } });
    
    // Explicitly cast to assure TypeScript that snapshot is not null
    const deliveryForTransport = { ...job.delivery, snapshot: job.delivery.snapshot };
    const transportReceipt = await transport.send(deliveryForTransport);
    
    await database.prisma.$transaction(async transaction => {
      const sentAt = new Date();
      await transaction.delivery.update({ where: { id: job.deliveryId }, data: { status: "SENT", sentAt, lastError: null, ackPollAfter: sentAt, ackPollLockedAt: null, ackPollAttempts: 0, ackPollLastError: null, ...(transportReceipt.remoteFolder ? { remoteFolder: transportReceipt.remoteFolder } : {}) } });
      await transaction.deliveryAssetGrant.updateMany({ where: { deliveryId: job.deliveryId }, data: { consumedAt: sentAt } });
      await transaction.deliveryJob.update({ where: { id: job.id }, data: { status: "COMPLETE", lockedAt: null, lastError: null } });
      // Non-null assertion is safe because we check !job.delivery.snapshot at the top of the function
      await transaction.outboxEvent.create({ data: { eventId: randomUUID(), version: 1, type: "distribution.delivery.sent", requestId: job.delivery.snapshot!.requestId, actorId: job.delivery.snapshot!.createdById, tenantId: job.delivery.tenantId, entityPath: job.delivery.entityPath, payload: { deliveryId: job.deliveryId, dsp: job.delivery.dsp, sentAt: sentAt.toISOString() } } });
    });
    await transport.cleanup?.(job.delivery).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "DELIVERY_FAILED";
    const terminal = job.attempts + 1 >= maxAttempts;
    await database.prisma.$transaction(async transaction => {
      await transaction.deliveryJob.update({ where: { id: job.id }, data: { status: terminal ? "FAILED" : "PENDING", lockedAt: null, lastError: message, availableAt: new Date(Date.now() + Math.min(300000, 5000 * 2 ** job.attempts)) } });
      await transaction.delivery.update({ where: { id: job.deliveryId }, data: { status: terminal ? "FAILED" : "PENDING", lastError: message } });
    });
  }
  return true;
}

export async function processNextDeliveryJobWhenEnabled(enabled: boolean, database: DistributionDatabase, transport: DeliveryTransport, maxAttempts: number): Promise<boolean> {
  return enabled ? processNextDeliveryJob(database, transport, maxAttempts) : false;
}

export interface AcknowledgementTransport { poll(delivery: SftpAcknowledgementDelivery): Promise<DownloadedAcknowledgement[]>; }
export interface AcknowledgementRecorder { recordTransportAcknowledgement(deliveryId: string, input: DownloadedAcknowledgement): Promise<unknown>; }

export async function processNextAcknowledgementPoll(database: DistributionDatabase, transport: AcknowledgementTransport, recorder: AcknowledgementRecorder, pollIntervalMs: number): Promise<boolean> {
  const now = new Date();
  const stale = new Date(now.getTime() - 15 * 60 * 1000);
  const delivery = await database.prisma.delivery.findFirst({
    where: { status: "SENT", remoteFolder: { not: null }, ackPollAfter: { lte: now }, OR: [{ ackPollLockedAt: null }, { ackPollLockedAt: { lt: stale } }] },
    orderBy: { ackPollAfter: "asc" }
  });
  if (!delivery?.remoteFolder) return false;
  const claimed = await database.prisma.delivery.updateMany({ where: { id: delivery.id, status: "SENT", OR: [{ ackPollLockedAt: null }, { ackPollLockedAt: { lt: stale } }] }, data: { ackPollLockedAt: now } });
  if (claimed.count !== 1) return true;
  try {
    const acknowledgements = await transport.poll({ id: delivery.id, dsp: delivery.dsp, messageId: delivery.messageId, remoteFolder: delivery.remoteFolder });
    for (const acknowledgement of acknowledgements) await recorder.recordTransportAcknowledgement(delivery.id, acknowledgement);
    await database.prisma.delivery.updateMany({ where: { id: delivery.id, status: "SENT" }, data: { ackPollAfter: new Date(now.getTime() + pollIntervalMs), ackPollLockedAt: null, ackPollAttempts: { increment: 1 }, ackPollLastError: null } });
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 1000) : "ACK_POLL_FAILED";
    const delay = Math.min(60 * 60 * 1000, pollIntervalMs * 2 ** Math.min(delivery.ackPollAttempts, 6));
    await database.prisma.delivery.updateMany({ where: { id: delivery.id, status: "SENT" }, data: { ackPollAfter: new Date(now.getTime() + delay), ackPollLockedAt: null, ackPollAttempts: { increment: 1 }, ackPollLastError: message } });
  }
  return true;
}

export async function processNextAcknowledgementPollWhenEnabled(enabled: boolean, database: DistributionDatabase, transport: AcknowledgementTransport, recorder: AcknowledgementRecorder, pollIntervalMs: number): Promise<boolean> {
  return enabled ? processNextAcknowledgementPoll(database, transport, recorder, pollIntervalMs) : false;
}

export async function runDistributionWorker() { const config = loadDistributionConfig(); const database = createDistributionDatabase(config); const stale = new Date(Date.now() - 15 * 60 * 1000); await database.prisma.deliveryJob.updateMany({ where: { status: "RUNNING", lockedAt: { lt: stale } }, data: { status: "PENDING", lockedAt: null } }); await database.prisma.exportJob.updateMany({ where: { status: "RUNNING", lockedAt: { lt: stale } }, data: { status: "PENDING", lockedAt: null } }); await database.prisma.delivery.updateMany({ where: { status: "SENT", ackPollLockedAt: { lt: stale } }, data: { ackPollLockedAt: null } }); await database.prisma.vevoSubmission.updateMany({ where: { status: "PROCESSING", lockedAt: { lt: stale } }, data: { status: "PENDING", lockedAt: null } }); let stopping = false; process.on("SIGTERM", () => { stopping = true; }); process.on("SIGINT", () => { stopping = true; }); const transport = new SftpDeliveryTransport(config); const acknowledgementTransport = new SftpAcknowledgementTransport(config); const service = new DistributionService(database, config); while (!stopping) { const deliveryProcessed = await processNextDeliveryJobWhenEnabled(config.sftpDeliveryEnabled === true, database, transport, config.workerMaxAttempts); const acknowledgementProcessed = await processNextAcknowledgementPollWhenEnabled(config.sftpDeliveryEnabled === true, database, acknowledgementTransport, service, config.acknowledgementPollMs); const exportProcessed = await processNextExportJob(database, config); const vevoProcessed = await processNextVevoSubmission(database, config); if (!deliveryProcessed && !acknowledgementProcessed && !exportProcessed && !vevoProcessed) await new Promise(resolve => setTimeout(resolve, config.workerPollMs)); } await database.close(); }
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await runDistributionWorker();
