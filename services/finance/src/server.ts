import { buildFinanceApp } from "./app.js";
import { loadFinanceConfig } from "./config.js";
import { createFinanceDatabase } from "./database.js";
import { FinanceService } from "./finance-service.js";
const config = loadFinanceConfig(); const database = createFinanceDatabase(config); const app = await buildFinanceApp({ config, service: new FinanceService(database, config), databaseHealth: async () => { await database.pool.query("SELECT 1"); return true; } }); const close = async () => { await app.close(); await database.close(); process.exit(0); }; process.on("SIGTERM", close); process.on("SIGINT", close); await app.listen({ host: config.host, port: config.port });
