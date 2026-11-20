import { buildNotificationApp } from "./app.js";
import { loadNotificationConfig } from "./config.js";
import { createNotificationDatabase } from "./database.js";
import { NotificationService } from "./notification-service.js";
const config = loadNotificationConfig(); const database = createNotificationDatabase(config); const app = await buildNotificationApp({ config, service: new NotificationService(database), databaseHealth: async () => { await database.pool.query("SELECT 1"); return true; } }); const close = async () => { await app.close(); await database.close(); process.exit(0); }; process.on("SIGTERM", close); process.on("SIGINT", close); await app.listen({ host: config.host, port: config.port });
