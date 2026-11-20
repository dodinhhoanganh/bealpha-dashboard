import "dotenv/config";

import { buildGateway } from "./app.js";
import { loadGatewayConfig } from "./config.js";

const config = loadGatewayConfig();
const app = await buildGateway({ config });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "Gateway shutdown requested");
  await app.close();
  process.exit(0);
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error, "Gateway startup failed");
  process.exit(1);
}
