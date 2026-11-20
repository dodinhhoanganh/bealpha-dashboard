import type { PoolClient, QueryResultRow } from "pg";

import { copyQuery, insertRows, quote, type MigrationContext } from "./migration.js";

async function columns(client: PoolClient, schema: string, table: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND is_generated='NEVER' ORDER BY ordinal_position", [schema, table]);
  return result.rows.map(row => row.column_name).filter(column => column !== "path_ltree");
}

export async function copyIntersection(context: MigrationContext, step: string, sourceSchema: string, sourceTable: string, targetTable = sourceTable, orderBy = "id"): Promise<number> {
  const sourceClient = await context.source.connect();
  const targetClient = await context.target.connect();
  let shared: string[];
  try {
    const sourceColumns = await columns(sourceClient, sourceSchema, sourceTable);
    const targetColumns = new Set(await columns(targetClient, "public", targetTable));
    shared = sourceColumns.filter(column => targetColumns.has(column));
  } finally { sourceClient.release(); targetClient.release(); }
  if (shared.length === 0) throw new Error(`${step} has no shared columns`);
  const selected = shared.map(quote).join(",");
  return copyQuery<QueryResultRow>(context, step, async (offset, limit) => (await context.source.query(`SELECT ${selected} FROM ${quote(sourceSchema)}.${quote(sourceTable)} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`, [limit, offset])).rows, (client, rows) => insertRows(client, targetTable, rows));
}
