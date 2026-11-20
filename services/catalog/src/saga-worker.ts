import { Worker, type Job, Queue } from "bullmq";
import { loadCatalogConfig } from "./config.js";
import { createCatalogDatabase } from "./database.js";
import { CatalogService } from "./catalog-service.js";

const QUEUE_NAME = "catalog-saga-queue";
const DISTRIBUTION_QUEUE = "distribution-saga-queue";

function redisConnection(redisUrl: string) {
  const url = new URL(redisUrl);
  const database = url.pathname.slice(1);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    ...(url.username ? { username: decodeURIComponent(url.username) } : {}),
    ...(url.password ? { password: decodeURIComponent(url.password) } : {}),
    ...(database ? { db: Number(database) } : {}),
    ...(url.protocol === "rediss:" ? { tls: { servername: url.hostname } } : {})
  };
}

function sagaFailureCode(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as { code: unknown }).code) : "CATALOG_SNAPSHOT_FAILED";
  return /^[A-Z0-9_]{3,100}$/.test(code) ? code : "CATALOG_SNAPSHOT_FAILED";
}

export async function runCatalogSagaWorker() {
  const config = loadCatalogConfig();
  if (!config.redisUrl) {
    throw new Error("REDIS_URL is required for the catalog saga worker");
  }
  const database = createCatalogDatabase(config);
  const service = new CatalogService(database);
  
  const connection = redisConnection(config.redisUrl);

  const distributionSagaQueue = new Queue(DISTRIBUTION_QUEUE, { connection });

  const worker = new Worker(QUEUE_NAME, async (job: Job) => {
    if (job.name === "GenerateSnapshotJob") {
      const { deliveryId, releaseId, requestId, actor } = job.data;
      
      try {
        await service.lockReleaseForDelivery(actor, releaseId);
        const rawSnapshot = await service.getDistributionSnapshot(actor, releaseId);
        
        // Using a basic stringify/parse to handle Dates, BigInts should be transformed if present
        const snapshotPayload = JSON.parse(JSON.stringify(rawSnapshot, (key, value) =>
          typeof value === "bigint" ? value.toString() : value
        ));
        
        await distributionSagaQueue.add("SnapshotGeneratedJob", {
          deliveryId,
          snapshotPayload,
          requestId,
          actor
        });
      } catch (error) {
        console.error(`Failed to generate snapshot for delivery ${deliveryId}`, error);
        throw error; // Let BullMQ retry
      }
    } else if (job.name === "PrepareApprovedAudioPackageJob") {
      const { packageId, releaseId, createdAt, requestId, actor } = job.data;
      try {
        await service.lockReleaseForDelivery(actor, releaseId);
        const rawSnapshot = await service.getDistributionSnapshot(actor, releaseId);
        if (rawSnapshot.type !== "AUDIO") throw new Error("Automatic DDEX package requires an AUDIO release");
        const snapshotPayload = JSON.parse(JSON.stringify(rawSnapshot, (_key, value) => typeof value === "bigint" ? value.toString() : value));
        await distributionSagaQueue.add("ApprovedAudioSnapshotJob", { packageId, snapshotPayload, createdAt, requestId, actor }, { jobId: packageId, removeOnComplete: 1000, removeOnFail: 1000 });
      } catch (error) {
        await distributionSagaQueue.add("ApprovedAudioPreparationFailedJob", { packageId, reason: sagaFailureCode(error) }, { jobId: `${packageId}-failure-${job.attemptsMade}`, removeOnComplete: 1000 });
        throw error;
      }
    } else if (job.name === "PrepareApprovedVideoPackageJob") {
      const { packageId, releaseId, createdAt, requestId, actor } = job.data;
      await service.lockReleaseForDelivery(actor, releaseId);
      const rawSnapshot = await service.getDistributionSnapshot(actor, releaseId);
      if (rawSnapshot.type !== "VIDEO") throw new Error("Automatic VEVO package requires a VIDEO release");
      const snapshotPayload = JSON.parse(JSON.stringify(rawSnapshot, (_key, value) => typeof value === "bigint" ? value.toString() : value));
      await distributionSagaQueue.add("ApprovedVideoSnapshotJob", { packageId, snapshotPayload, createdAt, requestId, actor }, { jobId: packageId, removeOnComplete: 1000, removeOnFail: 1000 });
    }
  }, { connection, concurrency: 5 });

  console.log("Catalog Saga Worker started...");

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await worker.close();
    await distributionSagaQueue.close();
    await database.close();
  };

  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runCatalogSagaWorker().catch(console.error);
}
