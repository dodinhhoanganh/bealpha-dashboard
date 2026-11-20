import { loadCatalogConfig } from "./config.js";
import { createCatalogDatabase } from "./database.js";
import { CatalogService } from "./catalog-service.js";
import { buildCatalogApp } from "./app.js";
import { createCatalogOutboxRelay } from "./outbox-relay.js";
import { CatalogImportService } from "./catalog-import-service.js";
import { defaultTenantDomainDependencies, TenantDomainCacheInvalidator } from "./tenant-domain.js";

const config = loadCatalogConfig();
const database = createCatalogDatabase(config);
const domainInvalidator = config.redisUrl ? new TenantDomainCacheInvalidator(config.redisUrl) : undefined;
const app = await buildCatalogApp({
  config,
  service: new CatalogService(database, {
    ...defaultTenantDomainDependencies,
    invalidate: hostname => domainInvalidator?.invalidate(hostname) ?? Promise.resolve()
  }),
  importService: new CatalogImportService(database, config),
  databaseHealth: async () => { await database.pool.query("SELECT 1"); return true; }
});
const relay = config.redisUrl ? createCatalogOutboxRelay(database, config.redisUrl, config.outboxPollMs ?? 1000, config.outboxBatchSize ?? 100) : undefined;
const close = async () => { await relay?.close(); domainInvalidator?.close(); await app.close(); await database.close(); process.exit(0); };
process.on("SIGTERM", close); process.on("SIGINT", close);
relay?.start();
await app.listen({ host: config.host, port: config.port });
