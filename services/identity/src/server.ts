import "dotenv/config";

import { buildIdentityApp } from "./app.js";
import { loadIdentityConfig } from "./config.js";
import { createIdentityDatabase } from "./database.js";
import { IdentityService } from "./identity-service.js";
import {
  createIdentityOutboxRelay,
  SensitivePayloadCipher
} from "./outbox.js";
import {
  createRedisSessionRegistry,
  MemorySessionRegistry
} from "./session-registry.js";
import { PrismaIdentityStore } from "./store.js";
import { EntityProjectionConsumer } from "./entity-projection-consumer.js";

const config = loadIdentityConfig();
const database = createIdentityDatabase(config);
const registry = config.redisUrl
  ? createRedisSessionRegistry(config.redisUrl)
  : new MemorySessionRegistry();
const store = new PrismaIdentityStore(database.prisma);
const service = await IdentityService.create(config, store, registry);
const outboxRelay = config.redisUrl
  ? createIdentityOutboxRelay(
      store,
      config.redisUrl,
      new SensitivePayloadCipher(config.outboxEncryptionKey),
      config.outboxPollIntervalMs,
      config.outboxBatchSize
    )
  : undefined;
const projectionConsumer = config.redisUrl
  ? new EntityProjectionConsumer(
      store,
      config.redisUrl,
      process.env.HOSTNAME ?? `identity-${process.pid}`,
      registry
    )
  : undefined;
const projectionTimer = projectionConsumer
  ? setInterval(() => void projectionConsumer.poll(), 1_000)
  : undefined;
projectionTimer?.unref();
const app = await buildIdentityApp({
  config,
  service,
  registry,
  databaseHealth: async () => {
    await database.pool.query("SELECT 1");
    return true;
  }
});

app.addHook("onClose", async () => {
  if (projectionTimer) clearInterval(projectionTimer);
  projectionConsumer?.close();
  await outboxRelay?.close();
  await Promise.all([registry.close(), database.close()]);
});

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Identity shutdown requested");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
  outboxRelay?.start();
  void projectionConsumer?.poll();
} catch (error) {
  app.log.error(error, "Identity startup failed");
  await app.close();
  process.exit(1);
}
