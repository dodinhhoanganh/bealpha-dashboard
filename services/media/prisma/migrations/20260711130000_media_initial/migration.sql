CREATE TYPE "AssetType" AS ENUM ('AUDIO', 'VIDEO', 'CANVAS', 'MOTION', 'SUBTITLE');
CREATE TYPE "UploadStatus" AS ENUM ('PENDING', 'UPLOADING', 'COMPLETE', 'FAILED', 'EXPIRED');
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'ERROR', 'ARCHIVED');

CREATE TABLE "upload_intents" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_entity_id" UUID NOT NULL,
    "owner_entity_path" VARCHAR(2048) NOT NULL,
    "actor_id" UUID NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "content_type" VARCHAR(255) NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "release_id" UUID,
    "track_id" UUID,
    "status" "UploadStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "failure_code" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "upload_intents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "upload_intent_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_entity_id" UUID NOT NULL,
    "owner_entity_path" VARCHAR(2048) NOT NULL,
    "uploader_id" UUID NOT NULL,
    "type" "AssetType" NOT NULL,
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(1024) NOT NULL,
    "file_size" BIGINT NOT NULL,
    "mime_type" VARCHAR(255) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "release_id" UUID,
    "track_id" UUID,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "processing_error" VARCHAR(1000),
    "duration_seconds" INTEGER,
    "sample_rate" INTEGER,
    "bit_rate" INTEGER,
    "channels" INTEGER,
    "bit_depth" INTEGER,
    "codec" VARCHAR(100),
    "width" INTEGER,
    "height" INTEGER,
    "frame_rate" DECIMAL(8,3),
    "video_codec" VARCHAR(100),
    "audio_codec" VARCHAR(100),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "processed_at" TIMESTAMP(3),
    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "type" VARCHAR(100) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" UUID NOT NULL,
    "actor_id" UUID,
    "tenant_id" UUID,
    "entity_path" VARCHAR(2048),
    "payload" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "upload_intents_token_hash_key" ON "upload_intents"("token_hash");
CREATE INDEX "upload_intents_tenant_id_created_at_idx" ON "upload_intents"("tenant_id", "created_at");
CREATE INDEX "upload_intents_status_expires_at_idx" ON "upload_intents"("status", "expires_at");
CREATE UNIQUE INDEX "assets_upload_intent_id_key" ON "assets"("upload_intent_id");
CREATE UNIQUE INDEX "assets_storage_key_key" ON "assets"("storage_key");
CREATE INDEX "assets_tenant_id_created_at_idx" ON "assets"("tenant_id", "created_at");
CREATE INDEX "assets_owner_entity_id_created_at_idx" ON "assets"("owner_entity_id", "created_at");
CREATE INDEX "assets_owner_entity_path_idx" ON "assets"("owner_entity_path");
CREATE INDEX "assets_release_id_idx" ON "assets"("release_id");
CREATE INDEX "assets_track_id_idx" ON "assets"("track_id");
CREATE INDEX "assets_status_idx" ON "assets"("status");
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "outbox_events"("published_at", "occurred_at");

ALTER TABLE "assets" ADD CONSTRAINT "assets_upload_intent_id_fkey" FOREIGN KEY ("upload_intent_id") REFERENCES "upload_intents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
