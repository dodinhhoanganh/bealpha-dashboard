import { Worker, type Job, Queue } from "bullmq";
import { loadMediaConfig } from "./config.js";
import { createMediaDatabase } from "./database.js";
import { MediaService } from "./media-service.js";

const QUEUE_NAME = "media-saga-queue";
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

export async function runMediaSagaWorker() {
  const config = loadMediaConfig();
  const database = createMediaDatabase(config);
  const service = new MediaService(database, config);
  
  const connection = redisConnection(config.redisUrl);

  const distributionSagaQueue = new Queue(DISTRIBUTION_QUEUE, { connection });

  const worker = new Worker(QUEUE_NAME, async (job: Job) => {
    if (job.name === "GenerateGrantsJob") {
      const { deliveryId, packageId, purpose, createdAt, assetIds, snapshotPayload, requestId, actor } = job.data;
      
      try {
        const rawGrants = await service.createDeliveryGrants(actor, assetIds);
        
        await distributionSagaQueue.add("GrantsGeneratedJob", {
          deliveryId,
          packageId,
          purpose,
          createdAt,
          snapshotPayload,
          rawGrants,
          requestId,
          actor
        });
      } catch (error) {
        console.error(`Failed to generate grants for delivery ${deliveryId}`, error);
        if (purpose === "approved-audio-ddex" && packageId) {
          await distributionSagaQueue.add("ApprovedAudioPreparationFailedJob", { packageId, reason: "MEDIA_GRANT_PREPARATION_FAILED" }, { jobId: `${packageId}-media-failure-${job.attemptsMade}`, removeOnComplete: 1000 });
        }
        throw error;
      }
    }
  }, { connection, concurrency: 5 });

  console.log("Media Saga Worker started...");

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
  runMediaSagaWorker().catch(console.error);
}
