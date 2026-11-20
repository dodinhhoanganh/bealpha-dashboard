import { copyQuery, runMigration } from "./lib/migration.js";
import { copyIntersection } from "./lib/intersection.js";

await runMigration("catalog-v1", "CATALOG_DATABASE_URL", async context => {
  await copyIntersection(context, "business-entities", "core", "business_entities", "business_entities", "path, id");
  await copyIntersection(context, "labels", "core", "labels");
  await copyIntersection(context, "artists", "core", "artists");
  await copyIntersection(context, "compositions", "core", "compositions");
  await copyIntersection(context, "releases", "core", "releases");
  await copyIntersection(context, "tracks", "core", "tracks");
  await copyQuery(context, "release-metadata", async (offset, limit) => (await context.source.query(`SELECT id, to_jsonb(r) - ARRAY['id','title','ean','type','format','genre','release_date','display_artist','cover_url','upc_locked_at','artist_id','label_id','status','tenant_id','owner_id','total_size_bytes','created_at','updated_at'] AS metadata
    FROM core.releases r ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset])).rows, async (client, rows) => {
    for (const row of rows) await client.query("UPDATE releases SET metadata=$2 WHERE id=$1", [row.id, row.metadata]);
  });
  await copyQuery(context, "track-metadata", async (offset, limit) => (await context.source.query(`SELECT id, to_jsonb(t) - ARRAY['id','release_id','title','isrc','isrc_locked_at','track_number','disc_number','duration','artist_id','audio_asset_id','canvas_asset_id','motion_asset_id','adm_asset_id','composition_id','recording_label_share','created_at','updated_at'] AS metadata
    FROM core.tracks t ORDER BY id LIMIT $1 OFFSET $2`, [limit, offset])).rows, async (client, rows) => {
    for (const row of rows) await client.query("UPDATE tracks SET metadata=$2 WHERE id=$1", [row.id, row.metadata]);
  });
  await copyIntersection(context, "playlists", "analytics", "playlists");
  await copyIntersection(context, "playlist-tracks", "analytics", "playlist_tracks", "playlist_tracks", "playlist_id, position, id");
});
