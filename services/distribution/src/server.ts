import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { buildDistributionApp } from "./app.js";
import { loadDistributionConfig } from "./config.js";
import { createDistributionDatabase } from "./database.js";
import { DistributionService } from "./distribution-service.js";
import { ExportService } from "./export-service.js";
import { VevoService } from "./vevo-service.js";
const config = loadDistributionConfig(); const database = createDistributionDatabase(config); const app = await buildDistributionApp({ config, service: new DistributionService(database, config), exportService: new ExportService(database, config), vevoService: new VevoService(database, config), databaseHealth: async () => { await database.pool.query("SELECT 1"); if (config.nodeEnv === "production") { await access(config.xsdPath!, constants.R_OK); await access(config.acknowledgementXsdPath!, constants.R_OK); } return true; } }); const close = async () => { await app.close(); await database.close(); process.exit(0); }; process.on("SIGTERM", close); process.on("SIGINT", close); await app.listen({ host: config.host, port: config.port });
