import { buildMediaApp } from "./app.js";
import { loadMediaConfig } from "./config.js";
import { createMediaDatabase } from "./database.js";
import { MediaService } from "./media-service.js";

const config = loadMediaConfig();
const database = createMediaDatabase(config);
const app = await buildMediaApp({ config, service: new MediaService(database, config), databaseHealth: async () => { await database.pool.query("SELECT 1"); return true; } });
const close = async () => { await app.close(); await database.close(); process.exit(0); };
process.on("SIGTERM", close); process.on("SIGINT", close);
await app.listen({ host: config.host, port: config.port });
