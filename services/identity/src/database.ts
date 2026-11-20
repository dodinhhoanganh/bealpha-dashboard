import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

import type { IdentityConfig } from "./config.js";
import { PrismaClient } from "./generated/prisma-v2/client.js";

export interface IdentityDatabase {
  prisma: PrismaClient;
  pool: Pool;
  close(): Promise<void>;
}

export function createIdentityDatabase(config: IdentityConfig): IdentityDatabase {
  const pool = new Pool({
    connectionString: config.databaseUrl,
    max: config.dbPoolMax,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
  });
  const prisma = new PrismaClient({
    adapter: new PrismaPg(pool),
    log: config.nodeEnv === "development" ? ["warn", "error"] : ["error"]
  });

  return {
    prisma,
    pool,
    async close() {
      await prisma.$disconnect();
      await pool.end();
    }
  };
}
