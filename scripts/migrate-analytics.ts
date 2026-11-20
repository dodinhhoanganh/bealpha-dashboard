import { copyQuery, insertRows, runMigration } from "./lib/migration.js";

await runMigration("analytics-v1", "ANALYTICS_DATABASE_URL", async context => {
  await copyQuery(context, "streaming-metrics", async (offset, limit) => (await context.source.query(`SELECT m.id,m.track_id,t.title AS track_title,r.tenant_id,owner.path AS entity_path,m.date,m.platform,
      COALESCE(NULLIF(upper(m.country),''),'XX') AS country,m.plays,m.skips,m.saves,m.shares,m.avg_play_duration,m.created_at,m.created_at AS updated_at
    FROM analytics.streaming_metrics m JOIN core.tracks t ON t.id=m.track_id JOIN core.releases r ON r.id=t.release_id JOIN core.business_entities owner ON owner.id=r.owner_id
    ORDER BY m.id LIMIT $1 OFFSET $2`, [limit, offset])).rows, (client, rows) => insertRows(client, "streaming_metrics", rows));
});
