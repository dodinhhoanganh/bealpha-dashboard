import { createHash } from "node:crypto";

import { copyQuery, insertRows, runMigration, stableUuid } from "./lib/migration.js";

const actorId = process.env.MIGRATION_SYSTEM_ACTOR_ID;
if (!actorId) throw new Error("MIGRATION_SYSTEM_ACTOR_ID is required");

await runMigration("finance-v1", "FINANCE_DATABASE_URL", async context => {
  await copyQuery(context, "reports", async (offset, limit) => (await context.source.query("SELECT * FROM finance.royalty_reports ORDER BY id LIMIT $1 OFFSET $2", [limit, offset])).rows, async (client, rows) => {
    const imports = rows.map(row => { const id = stableUuid("legacy-finance-import", row.id); return { id, platform: row.platform, period: row.period, currency: row.currency, file_name: `legacy-${row.id}.csv`, content_type: "text/csv", size_bytes: 0n, sha256: createHash("sha256").update(`legacy-report:${row.id}`).digest("hex"), token_hash: createHash("sha256").update(`legacy-token:${row.id}`).digest("hex"), storage_key: `migration/${row.id}`, actor_id: actorId, request_id: stableUuid("legacy-finance-request", row.id), status: "COMPLETE", expires_at: row.received_at, consumed_at: row.received_at, created_at: row.received_at, updated_at: row.processed_at ?? row.received_at }; });
    await insertRows(client, "finance_imports", imports);
    await insertRows(client, "royalty_reports", rows.map((row, index) => ({ id: row.id, import_id: imports[index].id, period: row.period, platform: row.platform, total_revenue: row.total_revenue, total_plays: BigInt(row.total_plays ?? 0), currency: row.currency, status: row.status, received_at: row.received_at, processed_at: row.processed_at })));
  });
  await copyQuery(context, "line-items", async (offset, limit) => (await context.source.query(`SELECT li.*, row_number() OVER (PARTITION BY report_id ORDER BY id) AS source_row FROM finance.royalty_line_items li ORDER BY report_id, id LIMIT $1 OFFSET $2`, [limit, offset])).rows, (client, rows) => insertRows(client, "royalty_line_items", rows.map(row => ({ id: row.id, report_id: row.report_id, source_row: BigInt(row.source_row), isrc: row.isrc?.replace(/-/g, "").toUpperCase() || null, track_name: row.track_name, plays: BigInt(row.plays ?? 0), revenue: row.revenue, country: row.country?.toUpperCase().slice(0, 2) || null }))));
});
