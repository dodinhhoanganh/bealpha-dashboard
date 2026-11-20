import { canonicalSnapshotHash, copyQuery, insertRows, runMigration, stableUuid } from "./lib/migration.js";

const actorId = process.env.MIGRATION_SYSTEM_ACTOR_ID;
if (!actorId) throw new Error("MIGRATION_SYSTEM_ACTOR_ID is required");

function status(value: string): string {
  const normalized = value.toUpperCase();
  if (["SENT", "CONFIRMED", "FAILED", "CANCELLED"].includes(normalized)) return normalized;
  return "CANCELLED";
}

await runMigration("distribution-v1", "DISTRIBUTION_DATABASE_URL", async context => {
  await copyQuery(context, "deliveries", async (offset, limit) => (await context.source.query(`SELECT d.*, r.tenant_id, owner.path AS entity_path,
      row_number() OVER (PARTITION BY d.release_id ORDER BY d.created_at, d.id) AS snapshot_version
    FROM ddex.deliveries d JOIN core.releases r ON r.id=d.release_id JOIN core.business_entities owner ON owner.id=r.owner_id
    ORDER BY d.created_at, d.id LIMIT $1 OFFSET $2`, [limit, offset])).rows, async (client, rows) => {
    const snapshots = rows.map(row => {
      const xml = row.xml_content ?? "";
      const payload = { migratedFrom: "legacy", legacyDeliveryId: row.id, releaseId: row.release_id };
      const sha256 = canonicalSnapshotHash(payload, xml);
      return { id: stableUuid("legacy-delivery-snapshot", row.id), release_id: row.release_id, tenant_id: row.tenant_id, entity_path: row.entity_path, version: Number(row.snapshot_version), payload, ern_xml: xml, sha256, created_by_id: actorId, request_id: stableUuid("legacy-delivery-request", row.id), created_at: row.created_at };
    });
    await insertRows(client, "delivery_snapshots", snapshots);
    await insertRows(client, "deliveries", rows.map((row, index) => ({ id: row.id, snapshot_id: snapshots[index].id, release_id: row.release_id, tenant_id: row.tenant_id, entity_path: row.entity_path, dsp: row.dsp_name.toLowerCase().replace(/[^a-z0-9_]/g, "_").slice(0, 64), ern_version: row.ern_version, message_type: row.message_type, idempotency_key: `legacy:${row.id}`, status: status(row.status), attempts: 0, sent_at: row.sent_at, confirmed_at: row.confirmed_at, last_error: ["PENDING", "PROCESSING"].includes(String(row.status).toUpperCase()) ? "MIGRATED_REQUIRES_MANUAL_REQUEUE" : row.error_log?.slice(0, 1000) ?? null, created_at: row.created_at, updated_at: row.updated_at })));
  });
});
