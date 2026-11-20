import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import type { CatalogConfig } from "./config.js";
import { PrismaClient } from "./generated/prisma-v2/client.js";

export function createCatalogDatabase(config: CatalogConfig) {
  const pool = new Pool({ connectionString: config.databaseUrl, max: config.dbPoolMax, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000 });
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool), log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"] });
  return { prisma, pool, async close() { await prisma.$disconnect(); await pool.end(); } };
}
export type CatalogDatabase = ReturnType<typeof createCatalogDatabase>;
