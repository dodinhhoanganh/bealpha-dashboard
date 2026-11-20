import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";

import { copyQuery, insertRows, runMigration, stableUuid } from "./lib/migration.js";

function root(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return path.resolve(value);
}

function legacyPath(mediaRoot: string, fileUrl: string): string {
  let pathname = fileUrl;
  try { pathname = new URL(fileUrl).pathname; } catch { /* relative path */ }
  pathname = pathname.replace(/\\/g, "/").replace(/^\/+/, "").replace(/^uploads\//, "");
  const resolved = path.resolve(mediaRoot, pathname);
  const relative = path.relative(mediaRoot, resolved);
  if (!pathname || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`Unsafe legacy media path: ${fileUrl}`);
  return resolved;
}

async function copyAndHash(source: string, destination: string): Promise<{ size: bigint; sha256: string }> {
  const existing = await stat(destination).catch(() => null);
  const digest = createHash("sha256");
  let size = 0n;
  if (existing?.isFile()) {
    for await (const chunk of createReadStream(destination)) { digest.update(chunk); size += BigInt(chunk.length); }
    const destinationFile = { size, sha256: digest.digest("hex") };
    const sourceFile = await inspectHash(source);
    if (sourceFile.size !== destinationFile.size || sourceFile.sha256 !== destinationFile.sha256) {
      throw new Error(`Existing migrated media differs from source: ${destination}`);
    }
    return destinationFile;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.migration.tmp`;
  await rm(temporary, { force: true });
  const meter = async function* () {
    for await (const chunk of createReadStream(source)) { digest.update(chunk); size += BigInt(chunk.length); yield chunk; }
  };
  await pipeline(meter(), createWriteStream(temporary, { flags: "wx" }));
  await rename(temporary, destination);
  return { size, sha256: digest.digest("hex") };
}

async function inspectHash(source: string): Promise<{ size: bigint; sha256: string }> {
  const digest = createHash("sha256");
  let size = 0n;
  for await (const chunk of createReadStream(source)) { digest.update(chunk); size += BigInt(chunk.length); }
  return { size, sha256: digest.digest("hex") };
}

const legacyRoot = root("LEGACY_MEDIA_ROOT");
const mediaRoot = root("MEDIA_STORAGE_ROOT");
const fallbackActor = process.env.MIGRATION_SYSTEM_ACTOR_ID;
if (!fallbackActor) throw new Error("MIGRATION_SYSTEM_ACTOR_ID is required");

await runMigration("media-v1", "MEDIA_DATABASE_URL", async context => {
  await copyQuery(context, "assets", async (offset, limit) => {
    const source = await context.source.query(`SELECT a.*, COALESCE(member.id,a.tenant_id) AS owner_entity_id, COALESCE(member.path,e.path) AS owner_entity_path
      FROM core.assets a LEFT JOIN core.business_entities e ON e.id=a.tenant_id
      LEFT JOIN LATERAL (SELECT entity.id,entity.path FROM auth.user_entity_roles uer JOIN core.business_entities entity ON entity.id=uer.entity_id WHERE uer.user_id=a.uploader_id ORDER BY array_length(string_to_array(entity.path,'.'),1) DESC LIMIT 1) member ON true
      ORDER BY a.id LIMIT $1 OFFSET $2`, [limit, offset]);
    const migrated = [];
    for (const row of source.rows) {
      if (!row.tenant_id || !row.file_url) throw new Error(`Asset ${row.id} lacks tenant or file URL`);
      const uploadId = stableUuid("legacy-media-upload", row.id);
      const storageKey = `${row.tenant_id}/${uploadId}/original`;
      const sourcePath = legacyPath(legacyRoot, row.file_url);
      const file = context.dryRun ? await inspectHash(sourcePath) : await copyAndHash(sourcePath, path.resolve(mediaRoot, storageKey));
      migrated.push({ ...row, upload_id: uploadId, storage_key: storageKey, actual_size: file.size, sha256: file.sha256, actor_id: row.uploader_id ?? fallbackActor, owner_entity_path: row.owner_entity_path ?? `legacy.${row.tenant_id}` });
    }
    return migrated;
  }, async (client, rows) => {
    await insertRows(client, "upload_intents", rows.map(row => ({ id: row.upload_id, tenant_id: row.tenant_id, owner_entity_id: row.owner_entity_id, owner_entity_path: row.owner_entity_path, actor_id: row.actor_id, asset_type: row.type, file_name: row.file_name, content_type: row.mime_type ?? "application/octet-stream", size_bytes: row.actual_size, sha256: row.sha256, token_hash: createHash("sha256").update(`legacy:${row.id}`).digest("hex"), storage_key: row.storage_key, release_id: row.release_id, track_id: row.track_id, status: "COMPLETE", expires_at: row.created_at, consumed_at: row.created_at, created_at: row.created_at, updated_at: row.updated_at })));
    await insertRows(client, "assets", rows.map(row => ({ id: row.id, upload_intent_id: row.upload_id, tenant_id: row.tenant_id, owner_entity_id: row.owner_entity_id, owner_entity_path: row.owner_entity_path, uploader_id: row.actor_id, type: row.type, file_name: row.file_name, storage_key: row.storage_key, file_size: row.actual_size, mime_type: row.mime_type ?? "application/octet-stream", sha256: row.sha256, release_id: row.release_id, track_id: row.track_id, status: row.status, processing_error: row.processing_error, duration_seconds: row.duration, sample_rate: row.sample_rate, bit_rate: row.bit_rate, channels: row.channels, bit_depth: row.bit_depth, codec: row.codec, width: row.width, height: row.height, frame_rate: row.frame_rate, video_codec: row.video_codec, audio_codec: row.audio_codec, created_at: row.created_at, updated_at: row.updated_at, processed_at: row.processed_at })));
    await insertRows(client, "processing_jobs", rows.filter(row => row.type === "AUDIO" && row.status !== "ARCHIVED").map(row => ({ id: stableUuid("legacy-media-preview-job", row.id), asset_id: row.id, request_id: stableUuid("legacy-media-preview-request", row.id), type: "INSPECT_MEDIA" })));
  });
});
