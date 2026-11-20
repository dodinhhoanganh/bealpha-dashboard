import { createHash, randomUUID } from "node:crypto";

import { Pool, type PoolClient, type QueryResultRow } from "pg";

export const BATCH_SIZE = 500;

export interface MigrationContext {
  source: Pool;
  target: Pool;
  dryRun: boolean;
  migration: string;
}

function databaseUrl(name: string): string {
  const value = process.env[name];
  if (!value || !["postgres:", "postgresql:"].includes(new URL(value).protocol)) throw new Error(`${name} must be a PostgreSQL URL`);
  return value;
}

export function targetUrl(name: string): string {
  return databaseUrl(name);
}

function lockKey(name: string): number {
  return createHash("sha256").update(name).digest().readInt32BE(0);
}

async function ensureControlTable(client: PoolClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS public._migration_checkpoints (
    migration VARCHAR(100) NOT NULL,
    step VARCHAR(100) NOT NULL,
    offset_rows BIGINT NOT NULL DEFAULT 0,
    copied_rows BIGINT NOT NULL DEFAULT 0,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (migration, step)
  )`);
}

export async function runMigration(name: string, targetEnvironment: string, operation: (context: MigrationContext) => Promise<void>): Promise<void> {
  const dryRun = process.env.MIGRATION_DRY_RUN === "1";
  if (!dryRun && process.env.MIGRATION_MAINTENANCE_CONFIRMED !== "YES") throw new Error("Set MIGRATION_MAINTENANCE_CONFIRMED=YES after enabling read-only maintenance mode");
  const source = new Pool({ connectionString: databaseUrl("LEGACY_DATABASE_URL"), max: 2, application_name: `bealpha-${name}-source` });
  const target = new Pool({ connectionString: databaseUrl(targetEnvironment), max: 2, application_name: `bealpha-${name}-target` });
  const lock = await target.connect();
  try {
    if (!dryRun) await ensureControlTable(lock);
    const result = await lock.query<{ locked: boolean }>("SELECT pg_try_advisory_lock($1) AS locked", [lockKey(name)]);
    if (!result.rows[0]?.locked) throw new Error(`Migration ${name} is already running`);
    await operation({ source, target, dryRun, migration: name });
  } finally {
    await lock.query("SELECT pg_advisory_unlock($1)", [lockKey(name)]).catch(() => undefined);
    lock.release();
    await Promise.all([source.end(), target.end()]);
  }
}

export async function copyQuery<T extends QueryResultRow>(context: MigrationContext, step: string, load: (offset: number, limit: number) => Promise<T[]>, insert: (client: PoolClient, rows: T[]) => Promise<void>): Promise<number> {
  const checkpoint = context.dryRun ? { rows: [] } : await context.target.query<{ offset_rows: string; copied_rows: string; completed_at: Date | null }>("SELECT offset_rows, copied_rows, completed_at FROM public._migration_checkpoints WHERE migration=$1 AND step=$2", [context.migration, step]);
  if (checkpoint.rows[0]?.completed_at) return Number(checkpoint.rows[0].copied_rows);
  let offset = Number(checkpoint.rows[0]?.offset_rows ?? 0);
  let copied = Number(checkpoint.rows[0]?.copied_rows ?? 0);
  while (true) {
    const rows = await load(offset, BATCH_SIZE);
    if (rows.length === 0) break;
    if (!context.dryRun) {
      const client = await context.target.connect();
      try {
        await client.query("BEGIN");
        await insert(client, rows);
        offset += rows.length;
        copied += rows.length;
        await client.query(`INSERT INTO public._migration_checkpoints (migration, step, offset_rows, copied_rows) VALUES ($1,$2,$3,$4)
          ON CONFLICT (migration, step) DO UPDATE SET offset_rows=EXCLUDED.offset_rows, copied_rows=EXCLUDED.copied_rows, updated_at=now()`, [context.migration, step, offset, copied]);
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    } else {
      offset += rows.length;
      copied += rows.length;
    }
  }
  if (!context.dryRun) await context.target.query(`INSERT INTO public._migration_checkpoints (migration, step, offset_rows, copied_rows, completed_at) VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (migration, step) DO UPDATE SET offset_rows=EXCLUDED.offset_rows, copied_rows=EXCLUDED.copied_rows, completed_at=now(), updated_at=now()`, [context.migration, step, offset, copied]);
  console.log(`[migration] ${step}: ${copied} row(s)${context.dryRun ? " dry-run" : ""}`);
  return copied;
}

export async function insertRows(client: PoolClient, table: string, rows: QueryResultRow[], conflictColumns: string[] = ["id"]): Promise<void> {
  if (rows.length === 0) return;
  const columns = Object.keys(rows[0]);
  const values: unknown[] = [];
  const tuples = rows.map((row, rowIndex) => `(${columns.map((column, columnIndex) => { values.push(row[column]); return `$${rowIndex * columns.length + columnIndex + 1}`; }).join(",")})`);
  const conflict = conflictColumns.length > 0 ? `ON CONFLICT (${conflictColumns.map(quote).join(",")}) DO NOTHING` : "ON CONFLICT DO NOTHING";
  await client.query(`INSERT INTO ${quote(table)} (${columns.map(quote).join(",")}) VALUES ${tuples.join(",")} ${conflict}`, values);
}

export function quote(value: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) throw new Error(`Unsafe SQL identifier: ${value}`);
  return `"${value}"`;
}

export function stableUuid(namespace: string, value: string): string {
  const bytes = createHash("sha256").update(`${namespace}:${value}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function canonicalSnapshotHash(payload: unknown, ernXml: string): string {
  return createHash("sha256").update(JSON.stringify(payload)).update("\0").update(ernXml).digest("hex");
}

export function requestId(value?: string): string {
  return value && /^[0-9a-f-]{36}$/i.test(value) ? value : randomUUID();
}
