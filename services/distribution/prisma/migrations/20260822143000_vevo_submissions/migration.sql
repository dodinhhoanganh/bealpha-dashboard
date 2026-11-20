CREATE TYPE "VevoSubmissionStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT_AWAITING_ACK', 'CONFIRMED', 'FAILED');
CREATE TYPE "VevoAssetRole" AS ENUM ('VIDEO', 'IMAGE', 'CAPTION');

CREATE TABLE "vevo_submissions" (
  "id" UUID NOT NULL,
  "release_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "entity_path" VARCHAR(2048) NOT NULL,
  "actor_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "idempotency_key" VARCHAR(128) NOT NULL,
  "isrc" CHAR(12) NOT NULL,
  "metadata" JSONB NOT NULL,
  "manifest_xml" TEXT NOT NULL,
  "manifest_file_name" VARCHAR(500) NOT NULL,
  "manifest_sha256" CHAR(64) NOT NULL,
  "status" "VevoSubmissionStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "submitted_at" TIMESTAMP(3),
  "confirmed_at" TIMESTAMP(3),
  "submission_prefix" VARCHAR(500),
  "manifest_key" VARCHAR(1024),
  "asset_keys" JSONB,
  "receipt_key" VARCHAR(1024),
  "receipt_sha256" CHAR(64),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "vevo_submissions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "vevo_submission_assets" (
  "id" UUID NOT NULL,
  "submission_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "role" "VevoAssetRole" NOT NULL,
  "token_ciphertext" TEXT NOT NULL,
  "file_name" VARCHAR(500) NOT NULL,
  "content_type" VARCHAR(255) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "vevo_submission_assets_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vevo_submissions_tenant_id_idempotency_key_key" ON "vevo_submissions"("tenant_id", "idempotency_key");
CREATE UNIQUE INDEX "vevo_submissions_receipt_sha256_key" ON "vevo_submissions"("receipt_sha256");
CREATE INDEX "vevo_submissions_entity_path_created_at_idx" ON "vevo_submissions"("entity_path", "created_at");
CREATE INDEX "vevo_submissions_status_available_at_idx" ON "vevo_submissions"("status", "available_at");
CREATE INDEX "vevo_submissions_release_id_created_at_idx" ON "vevo_submissions"("release_id", "created_at");
CREATE UNIQUE INDEX "vevo_submission_assets_submission_id_asset_id_key" ON "vevo_submission_assets"("submission_id", "asset_id");
CREATE INDEX "vevo_submission_assets_expires_at_idx" ON "vevo_submission_assets"("expires_at");
ALTER TABLE "vevo_submission_assets" ADD CONSTRAINT "vevo_submission_assets_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "vevo_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
