import { createHash } from "node:crypto";

import { copyQuery, insertRows, runMigration } from "./lib/migration.js";
import { copyIntersection } from "./lib/intersection.js";

await runMigration("identity-v1", "IDENTITY_DATABASE_URL", async context => {
  await copyIntersection(context, "users", "auth", "users");
  await copyQuery(context, "user-2fa-methods", async (offset, limit) => (await context.source.query("SELECT id, two_factor_method FROM auth.users WHERE two_factor_enabled=true AND two_factor_method IS NOT NULL ORDER BY id LIMIT $1 OFFSET $2", [limit, offset])).rows, async (client, rows) => {
    for (const row of rows) await client.query("UPDATE users SET two_factor_methods=ARRAY[$2]::text[] WHERE id=$1", [row.id, row.two_factor_method]);
  });
  await copyQuery(context, "entity-snapshots", async (offset, limit) => (await context.source.query(`SELECT id, entity_type, official_name AS name, path,
      CASE WHEN entity_type IN ('ORGANIZATION','SYSTEM_ADMIN') THEN id ELSE parent_id END AS tenant_id,
      is_active, 1 AS version, updated_at
    FROM core.business_entities ORDER BY path, id LIMIT $1 OFFSET $2`, [limit, offset])).rows, (client, rows) => insertRows(client, "entity_snapshots", rows));
  await copyQuery(context, "memberships", async (offset, limit) => (await context.source.query(`WITH ranked AS (
      SELECT uer.id, uer.user_id, e.id AS entity_id, e.entity_type, uer.role AS entity_role, e.official_name AS entity_name, e.path AS entity_path,
        COALESCE((SELECT org.id FROM core.business_entities org WHERE org.entity_type='ORGANIZATION' AND (e.path=org.path OR e.path LIKE org.path || '.%') ORDER BY length(org.path) DESC LIMIT 1), CASE WHEN e.entity_type='SUPER_ADMIN' THEN NULL ELSE e.id END) AS tenant_id,
        uer.created_at, row_number() OVER (PARTITION BY uer.user_id ORDER BY array_length(string_to_array(e.path,'.'),1) DESC, uer.created_at) AS rank
      FROM auth.user_entity_roles uer JOIN core.business_entities e ON e.id=uer.entity_id)
    SELECT id,user_id,entity_id,entity_type,entity_role,entity_name,entity_path,tenant_id,created_at,created_at AS updated_at FROM ranked WHERE rank=1 ORDER BY user_id LIMIT $1 OFFSET $2`, [limit, offset])).rows, (client, rows) => insertRows(client, "memberships", rows));
  await copyQuery(context, "staff-roles", async (offset, limit) => (await context.source.query(`SELECT ur.user_id, lower(r.name) AS role, now() AS created_at
    FROM auth.user_roles ur JOIN auth.roles r ON r.id=ur.role_id WHERE lower(r.name) IN ('admin','moderator','supporter','finance') ORDER BY ur.user_id, r.name LIMIT $1 OFFSET $2`, [limit, offset])).rows, (client, rows) => insertRows(client, "user_staff_roles", rows, ["user_id", "role"]));
  await copyQuery(context, "invitations", async (offset, limit) => (await context.source.query(`SELECT i.*, e.entity_type, e.official_name AS entity_name, e.path AS entity_path,
      COALESCE((SELECT org.id FROM core.business_entities org WHERE org.entity_type='ORGANIZATION' AND (e.path=org.path OR e.path LIKE org.path || '.%') ORDER BY length(org.path) DESC LIMIT 1), e.id) AS tenant_id
    FROM auth.invitations i JOIN core.business_entities e ON e.id=i.entity_id ORDER BY i.id LIMIT $1 OFFSET $2`, [limit, offset])).rows.map(row => ({ id: row.id, entity_id: row.entity_id, entity_type: row.entity_type, entity_name: row.entity_name, entity_path: row.entity_path, tenant_id: row.tenant_id, email: row.email, role: row.role, token_hash: createHash("sha256").update(String(row.token)).digest("hex"), status: row.status, invited_by: row.invited_by, expires_at: row.expires_at, accepted_at: row.accepted_at, last_sent_at: row.created_at, created_at: row.created_at })), (client, rows) => insertRows(client, "invitations", rows));
  console.log("[migration] active legacy sessions intentionally invalidated; users must sign in again after cutover");
});
