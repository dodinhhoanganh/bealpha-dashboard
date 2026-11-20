import { Redis } from "ioredis";
import { z } from "zod";
import { loadAnalyticsConfig } from "./config.js";
import { createAnalyticsDatabase } from "./database.js";

const STREAM_KEY = "bealpha:events";
const GROUP_NAME = "analytics-workers";
const CONSUMER_NAME = `analytics-worker-${process.pid}`;

export async function runAnalyticsWorker() {
  const config = loadAnalyticsConfig();
  const database = createAnalyticsDatabase(config);
  
  const redis = new Redis(config.redisUrl, {
    maxRetriesPerRequest: null // Required for blocking XREADGROUP
  });

  try {
    await redis.xgroup("CREATE", STREAM_KEY, GROUP_NAME, "0", "MKSTREAM");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("BUSYGROUP")) {
      console.error("Failed to create consumer group", error);
      process.exit(1);
    }
  }

  let stopping = false;
  process.on("SIGTERM", () => { stopping = true; redis.disconnect(); });
  process.on("SIGINT", () => { stopping = true; redis.disconnect(); });

  console.log("Analytics worker started, listening for events...");

  while (!stopping) {
    try {
      // Cast redis to any to bypass ioredis overloaded type definition limitations
      const messages = await (redis as any).xreadgroup("GROUP", GROUP_NAME, CONSUMER_NAME, "BLOCK", 5000, "COUNT", 100, "STREAMS", STREAM_KEY, ">");
      
      if (!messages || messages.length === 0) continue;

      for (const [stream, entries] of messages) {
        for (const entry of entries) {
          const [messageId, fields] = entry;
          let eventPayload;
          
          for (let i = 0; i < fields.length; i += 2) {
            if (fields[i] === "event") {
              try {
                eventPayload = JSON.parse(fields[i + 1]);
              } catch (e) {
                console.error(`Invalid JSON in event ${messageId}`);
              }
            }
          }

          if (eventPayload) {
            try {
              if (eventPayload.type === "catalog.track.scope-upserted") {
                const payload = eventPayload.payload;
                await database.prisma.trackScope.upsert({
                  where: { trackId: payload.trackId },
                  create: {
                    trackId: payload.trackId,
                    trackTitle: payload.trackTitle || "Unknown Track",
                    tenantId: eventPayload.tenantId,
                    entityPath: eventPayload.entityPath,
                  },
                  update: {
                    trackTitle: payload.trackTitle || "Unknown Track",
                    tenantId: eventPayload.tenantId,
                    entityPath: eventPayload.entityPath,
                  }
                });
              } else if (eventPayload.type === "catalog.track.scope-deleted") {
                const payload = eventPayload.payload;
                await database.prisma.trackScope.delete({
                  where: { trackId: payload.trackId }
                }).catch(() => undefined); // Ignore if not found
              }
            } catch (e) {
              console.error(`Failed to process event ${messageId}:`, e);
            }
          }

          await redis.xack(STREAM_KEY, GROUP_NAME, messageId);
        }
      }
    } catch (error) {
      if (stopping) break;
      console.error("Worker error:", error);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  
  await database.close();
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  runAnalyticsWorker().catch(console.error);
}
