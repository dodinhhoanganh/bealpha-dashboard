import { Queue } from "bullmq";
import type { DistributionConfig } from "./config.js";

export let catalogSagaQueue: Queue;
export let mediaSagaQueue: Queue;
export let distributionSagaQueue: Queue;

export function redisConnection(redisUrl: string) {
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

export function initQueues(config: DistributionConfig) {
  const connection = redisConnection(config.redisUrl);
  
  catalogSagaQueue = new Queue("catalog-saga-queue", { connection });
  mediaSagaQueue = new Queue("media-saga-queue", { connection });
  distributionSagaQueue = new Queue("distribution-saga-queue", { connection });
}

export async function closeQueues() {
  await catalogSagaQueue?.close();
  await mediaSagaQueue?.close();
  await distributionSagaQueue?.close();
}
