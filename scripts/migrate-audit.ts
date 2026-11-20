import { copyQuery, insertRows, runMigration, stableUuid } from "./lib/migration.js";

await runMigration("audit-v1", "AUDIT_DATABASE_URL", async context => {
  await copyQuery(context, "audit-events", async (offset, limit) => (await context.source.query(`SELECT l.*, membership.entity_id AS tenant_id, membership.path AS entity_path
    FROM log.audit_logs l LEFT JOIN LATERAL (
      SELECT e.id AS entity_id,e.path FROM auth.user_entity_roles uer JOIN core.business_entities e ON e.id=uer.entity_id
      WHERE uer.user_id=l.user_id ORDER BY array_length(string_to_array(e.path,'.'),1) DESC LIMIT 1
    ) membership ON true ORDER BY l.id LIMIT $1 OFFSET $2`, [limit, offset])).rows.map(row => ({ id: row.id, event_id: stableUuid("legacy-audit-event", row.id), request_id: stableUuid("legacy-audit-request", row.id), event_type: "legacy.audit", action: String(row.action).slice(0, 32), entity_type: String(row.entity_type).slice(0, 64), entity_id: row.entity_id ? String(row.entity_id) : null, actor_id: row.user_id, tenant_id: row.tenant_id, entity_path: row.entity_path, details: { oldValue: row.old_value, newValue: row.new_value, ipAddress: row.ip_address, userAgent: row.user_agent }, occurred_at: row.created_at, created_at: row.created_at })), (client, rows) => insertRows(client, "audit_events", rows));
});
