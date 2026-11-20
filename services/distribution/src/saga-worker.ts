import { Worker, type Job } from "bullmq";
import { randomUUID } from "node:crypto";
import { loadDistributionConfig, resolveDspRecipient } from "./config.js";
import { createDistributionDatabase } from "./database.js";
import { catalogSagaQueue, mediaSagaQueue, initQueues, closeQueues, redisConnection } from "./queues.js";
import { DistributionSagaOutboxRelay } from "./saga-outbox-relay.js";
import { catalogSnapshotSchema, coverAssetId, generateErn, snapshotHash, validateAgainstXsd } from "./ern.js";
import { encryptGrantToken } from "./grant-crypto.js";
import type { Prisma } from "./generated/distribution-prisma2/client.js";
import { ApprovedAudioConsumer } from "./approved-audio-consumer.js";
import { finalizeApprovedVideoPackage } from "./vevo-service.js";
import { failApprovedAudioPreparation, resumeApprovedAudioPreparation } from "./approved-audio-preparation.js";

const QUEUE_NAME = "distribution-saga-queue";

export async function runDistributionSagaWorker() {
  const config = loadDistributionConfig();
  const database = createDistributionDatabase(config);
  initQueues(config);
  const relay = new DistributionSagaOutboxRelay(database, catalogSagaQueue, config.workerPollMs, 100);
  const approvedReleaseConsumer = new ApprovedAudioConsumer(config.redisUrl, catalogSagaQueue, config.workerPollMs, config.autoPrepareDdexPackages, database);
  
  const connection = redisConnection(config.redisUrl);

  const worker = new Worker(QUEUE_NAME, async (job: Job) => {
    if (job.name === "SnapshotGeneratedJob") {
      const { deliveryId, snapshotPayload, requestId, actor } = job.data;
      
      const delivery = await database.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery) throw new Error("Delivery not found");

      // Extract required asset IDs from snapshot
      const assetIds = [...new Set(snapshotPayload.tracks.map((track: any) => track.audioAssetId).filter((id: any): id is string => Boolean(id)))];
      
      if (assetIds.length === 0 || delivery.messageType === "TakedownMessage") {
        // No grants needed, proceed directly to finalization
        await finalizeDelivery(database, config, delivery, snapshotPayload, [], requestId, actor);
      } else {
        // Request grants from Media
        await mediaSagaQueue.add("GenerateGrantsJob", {
          deliveryId,
          assetIds,
          snapshotPayload, // Pass along so it can be finalized later
          requestId,
          actor
        });
      }
    } else if (job.name === "ApprovedAudioSnapshotJob") {
      const { packageId, snapshotPayload, createdAt, requestId, actor } = job.data;
      try {
        await resumeApprovedAudioPreparation(database, packageId);
        const snapshot = catalogSnapshotSchema.parse(snapshotPayload);
        const assetIds = approvedAudioAssetIds(snapshot);
        await mediaSagaQueue.add("GenerateGrantsJob", { packageId, purpose: "approved-audio-ddex", createdAt, assetIds, snapshotPayload, requestId, actor }, { jobId: packageId, removeOnComplete: 1000, removeOnFail: 1000 });
      } catch (error) {
        await failApprovedAudioPreparation(database, packageId, error);
        throw error;
      }
    } else if (job.name === "ApprovedVideoSnapshotJob") {
      const { packageId, snapshotPayload, createdAt, requestId, actor } = job.data;
      const snapshot = snapshotPayload as { tracks?: Array<{ videoAssetId?: string; thumbnailAssetId?: string | null; captionAssetId?: string | null }> };
      const assetIds = [...new Set((snapshot.tracks ?? []).flatMap(track => [track.videoAssetId, track.thumbnailAssetId, track.captionAssetId]).filter((id): id is string => Boolean(id)))];
      if (assetIds.length === 0) throw new Error("Automatic VEVO package requires a ready video master");
      await mediaSagaQueue.add("GenerateGrantsJob", { packageId, purpose: "approved-video-vevo", createdAt, assetIds, snapshotPayload, requestId, actor }, { jobId: packageId, removeOnComplete: 1000, removeOnFail: 1000 });
    }
    else if (job.name === "GrantsGeneratedJob") {
      const { deliveryId, packageId, purpose, createdAt, snapshotPayload, rawGrants, requestId, actor } = job.data;

      if (purpose === "approved-audio-ddex") {
        await finalizeApprovedAudioPackage(database, config, packageId, snapshotPayload, rawGrants, createdAt, requestId, actor);
        return;
      }
      if (purpose === "approved-video-vevo") {
        await finalizeApprovedVideoPackage(database, config, packageId, snapshotPayload, rawGrants, requestId, actor);
        return;
      }
      
      const delivery = await database.prisma.delivery.findUnique({ where: { id: deliveryId } });
      if (!delivery) throw new Error("Delivery not found");

      const assetGrants = rawGrants.map((grant: any) => ({
        assetId: grant.assetId,
        tokenCiphertext: encryptGrantToken(grant.token, config.deliveryGrantEncryptionKey),
        expiresAt: new Date(grant.expiresAt),
        fileName: grant.fileName,
        contentType: grant.contentType,
        sizeBytes: BigInt(grant.sizeBytes)
      }));

      await finalizeDelivery(database, config, delivery, snapshotPayload, assetGrants, requestId, actor);
    } else if (job.name === "ApprovedAudioPreparationFailedJob") {
      await failApprovedAudioPreparation(database, job.data.packageId, job.data.reason);
    }
  }, { connection, concurrency: 5 });

  console.log("Distribution Saga Worker started...");
  relay.start();
  approvedReleaseConsumer.start();

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await approvedReleaseConsumer.close();
    await relay.close();
    await worker.close();
    await closeQueues();
    await database.close();
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

export function approvedAudioAssetIds(snapshotPayload: unknown): string[] {
  const snapshot = catalogSnapshotSchema.parse(snapshotPayload);
  const assetIds = [...new Set([...snapshot.tracks.map(track => track.audioAssetId), coverAssetId(snapshot.coverUrl)])];
  if (assetIds.length !== snapshot.tracks.length + 1) throw new Error("Every automatic DDEX package resource requires a distinct media asset");
  return assetIds;
}

export async function finalizeApprovedAudioPackage(database: ReturnType<typeof createDistributionDatabase>, config: ReturnType<typeof loadDistributionConfig>, packageId: string, snapshotPayload: unknown, rawGrants: any[], createdAt: string, requestId: string, actor: any, validator: typeof validateAgainstXsd = validateAgainstXsd) {
  if (!config.autoPrepareDdexPackages) throw new Error("Automatic DDEX package preparation is disabled");
  let existing = await database.prisma.exportJob.findUnique({ where: { id: packageId } });
  if (!existing) throw new Error("Automatic DDEX preparation record is missing");
  if (existing.status === "PENDING" || existing.status === "COMPLETE") return existing;
  const existingPayload = existing.payload && typeof existing.payload === "object" ? existing.payload as { phase?: unknown } : undefined;
  if (existing.status === "RUNNING" && existingPayload?.phase !== "PREPARING") return existing;
  if (existing.status === "FAILED") existing = await resumeApprovedAudioPreparation(database, packageId);
  try {
    const snapshot = catalogSnapshotSchema.parse(snapshotPayload);
    if (snapshot.status !== "LOCKED_FOR_DELIVERY") throw new Error("Automatic DDEX package requires a delivery-locked release");
    const requiredAssetIds = approvedAudioAssetIds(snapshot);
    const targetDsps = [...new Set(snapshot.metadata?.targetDsps ?? [])].sort();
    if (targetDsps.length === 0) throw new Error("Automatic DDEX package requires release target DSPs");
    const recipients = targetDsps.map(recipientId => {
      const recipient = resolveDspRecipient(config, recipientId);
      if (!recipient) throw new Error(`Automatic DDEX package recipient is not configured: ${recipientId}`);
      return { recipientId, recipient };
    });
    const grants = rawGrants.map(grant => {
      const expiresAt = new Date(grant.expiresAt);
      if (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date()) throw new Error("Automatic DDEX package grant is expired");
      if (!/^[a-f0-9]{64}$/.test(String(grant.sha256 ?? ""))) throw new Error("Automatic DDEX package grant checksum is missing");
      const sizeBytes = BigInt(grant.sizeBytes);
      if (sizeBytes <= 0n || sizeBytes > BigInt(config.packageMaxBytes)) throw new Error("Automatic DDEX package grant size is invalid");
      return { assetId: grant.assetId, token: encryptGrantToken(grant.token, config.deliveryGrantEncryptionKey), expiresAt: expiresAt.toISOString(), fileName: grant.fileName, contentType: grant.contentType, sizeBytes: sizeBytes.toString(), sha256: String(grant.sha256) };
    });
    const grantedAssetIds = new Set(grants.map(grant => grant.assetId));
    if (grantedAssetIds.size !== grants.length || grants.length !== requiredAssetIds.length || requiredAssetIds.some(assetId => !grantedAssetIds.has(assetId))) throw new Error("Automatic DDEX package grants do not match required resources");
    const assets = new Map(grants.map(grant => [grant.assetId, { fileName: grant.fileName, contentType: grant.contentType, sizeBytes: BigInt(grant.sizeBytes), sha256: grant.sha256 }]));
    const destinations = [] as Array<{ recipientId: string; ernXml: string }>;
    for (const { recipientId, recipient } of recipients) {
      const messageId = `BA-MANUAL-${packageId}-${recipientId}`;
      const ernXml = generateErn({ snapshot, sender: config.ddexSender, recipient, messageType: "NewReleaseMessage", ernVersion: "4.3", avsVersionId: config.ddexAvsVersionId, messageId, messageThreadId: messageId, createdAt: new Date(createdAt), assets });
      await validator(ernXml, config.xsdPath);
      destinations.push({ recipientId, ernXml });
    }
    const payload = JSON.parse(JSON.stringify({ kind: "DDEX_PACKAGE", approvalEventId: packageId, approvalOccurredAt: createdAt, approverEntityId: actor.entityId, snapshot, destinations, grants, createdAt })) as Prisma.InputJsonValue;
    const transitioned = await database.prisma.exportJob.updateMany({ where: { id: packageId, status: "RUNNING" }, data: { status: "PENDING", payload, availableAt: new Date(), lockedAt: null, lastError: null, expiresAt: new Date(Date.now() + config.exportRetentionSeconds * 1000) } });
    if (transitioned.count !== 1) return database.prisma.exportJob.findUniqueOrThrow({ where: { id: packageId } });
    return database.prisma.exportJob.findUniqueOrThrow({ where: { id: packageId } });
  } catch (error) {
    await failApprovedAudioPreparation(database, packageId, error);
    throw error;
  }
}

async function finalizeDelivery(database: ReturnType<typeof createDistributionDatabase>, config: ReturnType<typeof loadDistributionConfig>, delivery: any, snapshotPayload: any, assetGrants: any[], requestId: string, actor: any) {
  const recipient = resolveDspRecipient(config, delivery.dsp);
  if (!recipient) throw new Error("DSP recipient missing during finalization");

  const snapshotData = catalogSnapshotSchema.parse(snapshotPayload);
  const ernXml = generateErn({ snapshot: snapshotData, sender: config.ddexSender, recipient, messageType: delivery.messageType, ernVersion: delivery.ernVersion, avsVersionId: config.ddexAvsVersionId, messageId: delivery.messageId, messageThreadId: delivery.messageThreadId, createdAt: delivery.createdAt, assets: new Map(assetGrants.map(grant => [grant.assetId, grant])) });
  
  await validateAgainstXsd(ernXml, config.xsdPath);
  const sha256 = snapshotHash(snapshotPayload, ernXml);
  const snapshotJson = JSON.parse(JSON.stringify(snapshotPayload)) as Prisma.InputJsonValue;

  let snapshot = await database.prisma.deliverySnapshot.findUnique({ where: { releaseId_sha256: { releaseId: delivery.releaseId, sha256 } } });
  
  if (!snapshot) {
    const aggregate = await database.prisma.deliverySnapshot.aggregate({ where: { releaseId: delivery.releaseId }, _max: { version: true } });
    snapshot = await database.prisma.deliverySnapshot.create({ 
      data: { 
        releaseId: delivery.releaseId, 
        tenantId: delivery.tenantId, 
        entityPath: delivery.entityPath, 
        version: (aggregate._max.version ?? 0) + 1, 
        payload: snapshotJson, 
        ernXml, 
        sha256, 
        createdById: actor.actorId, 
        requestId: requestId 
      } 
    });
  }

  await database.prisma.$transaction(async transaction => {
    await transaction.delivery.update({
      where: { id: delivery.id },
      data: { 
        status: "PENDING",
        snapshotId: snapshot!.id 
      }
    });

    if (assetGrants.length) {
      await transaction.deliveryAssetGrant.createMany({ 
        data: assetGrants.map(grant => ({ deliveryId: delivery.id, ...grant })) 
      });
    }

    await transaction.deliveryJob.create({ data: { deliveryId: delivery.id } });
    await transaction.outboxEvent.create({ 
      data: { 
        eventId: randomUUID(), 
        version: 1, 
        type: "distribution.delivery.requested", 
        requestId, 
        actorId: actor.actorId, 
        tenantId: delivery.tenantId, 
        entityPath: delivery.entityPath, 
        payload: { 
          deliveryId: delivery.id, 
          snapshotId: snapshot!.id, 
          dsp: delivery.dsp, 
          idempotencyKey: delivery.idempotencyKey 
        } 
      } 
    });
  });
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runDistributionSagaWorker().catch(console.error);
}
