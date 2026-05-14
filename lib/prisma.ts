import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;

// ── Connection Pool Configuration ─────────────────────────
// Production-optimized pool settings
const pool = new Pool({
  connectionString,
  max: parseInt(process.env.DB_POOL_MAX || "20"), // Max connections
  idleTimeoutMillis: 30_000, // Close idle after 30s
  connectionTimeoutMillis: 10_000, // Connection timeout 10s
});

// Log pool errors (don't crash the process)
(
  pool as unknown as { on: (event: string, cb: (err: Error) => void) => void }
).on("error", (err) => {
  console.error("[PG Pool] Unexpected error on idle client:", err.message);
});

const adapter = new PrismaPg(pool);

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}

// ── Raw Pool Access (for materialized views, custom queries) ──
export { pool };

// ── Health Check ──────────────────────────────────────────
export async function checkDatabaseHealth(): Promise<{
  connected: boolean;
  poolSize: number;
  idleCount: number;
  waitingCount: number;
  latencyMs: number;
}> {
  const start = Date.now();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = pool as any;
  try {
    await pool.query("SELECT 1");
    return {
      connected: true,
      poolSize: p.totalCount ?? 0,
      idleCount: p.idleCount ?? 0,
      waitingCount: p.waitingCount ?? 0,
      latencyMs: Date.now() - start,
    };
  } catch {
    return {
      connected: false,
      poolSize: p.totalCount ?? 0,
      idleCount: p.idleCount ?? 0,
      waitingCount: p.waitingCount ?? 0,
      latencyMs: Date.now() - start,
    };
  }
}
