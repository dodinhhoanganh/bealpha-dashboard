CREATE SCHEMA IF NOT EXISTS "public";
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'UPLOADING', 'QUEUED', 'PROCESSING', 'COMPLETE', 'FAILED', 'EXPIRED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');

CREATE TABLE "finance_imports" (
  "id" UUID NOT NULL,
  "platform" VARCHAR(100) NOT NULL,
  "period" VARCHAR(64) NOT NULL,
  "currency" CHAR(3) NOT NULL,
  "file_name" VARCHAR(255) NOT NULL,
  "content_type" VARCHAR(64) NOT NULL,
  "size_bytes" BIGINT NOT NULL,
  "sha256" CHAR(64) NOT NULL,
  "token_hash" CHAR(64) NOT NULL,
  "storage_key" VARCHAR(1024) NOT NULL,
  "actor_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
  "expires_at" TIMESTAMP(3) NOT NULL,
  "consumed_at" TIMESTAMP(3),
  "failure_code" VARCHAR(100),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "royalty_reports" (
  "id" UUID NOT NULL,
  "import_id" UUID NOT NULL,
  "period" VARCHAR(64) NOT NULL,
  "platform" VARCHAR(100) NOT NULL,
  "total_revenue" DECIMAL(38,18) NOT NULL DEFAULT 0,
  "total_plays" BIGINT NOT NULL DEFAULT 0,
  "currency" CHAR(3) NOT NULL,
  "status" VARCHAR(20) NOT NULL DEFAULT 'processed',
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processed_at" TIMESTAMP(3),
  CONSTRAINT "royalty_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "royalty_line_items" (
  "id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "source_row" BIGINT NOT NULL,
  "isrc" CHAR(12),
  "track_name" VARCHAR(500),
  "plays" BIGINT NOT NULL DEFAULT 0,
  "revenue" DECIMAL(38,18) NOT NULL,
  "country" CHAR(2),
  "tenant_id" UUID,
  "entity_path" VARCHAR(2048),
  CONSTRAINT "royalty_line_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "track_scopes" (
  "isrc" CHAR(12) NOT NULL,
  "tenant_id" UUID NOT NULL,
  "entity_path" VARCHAR(2048) NOT NULL,
  "track_id" UUID NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "track_scopes_pkey" PRIMARY KEY ("isrc")
);

CREATE TABLE "finance_jobs" (
  "id" UUID NOT NULL,
  "import_id" UUID NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "finance_jobs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "consumed_events" ("event_id" UUID NOT NULL, "event_type" VARCHAR(100) NOT NULL, "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "consumed_events_pkey" PRIMARY KEY ("event_id"));
CREATE TABLE "outbox_events" ("id" UUID NOT NULL, "event_id" UUID NOT NULL, "version" INTEGER NOT NULL DEFAULT 1, "type" VARCHAR(100) NOT NULL, "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "request_id" UUID NOT NULL, "actor_id" UUID, "tenant_id" UUID, "entity_path" VARCHAR(2048), "payload" JSONB NOT NULL, "published_at" TIMESTAMP(3), "attempts" INTEGER NOT NULL DEFAULT 0, "last_error" VARCHAR(500), CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id"));

CREATE UNIQUE INDEX "finance_imports_token_hash_key" ON "finance_imports"("token_hash");
CREATE UNIQUE INDEX "finance_imports_storage_key_key" ON "finance_imports"("storage_key");
CREATE INDEX "finance_imports_status_expires_at_idx" ON "finance_imports"("status", "expires_at");
CREATE UNIQUE INDEX "finance_imports_platform_period_sha256_key" ON "finance_imports"("platform", "period", "sha256");
CREATE UNIQUE INDEX "royalty_reports_import_id_key" ON "royalty_reports"("import_id");
CREATE INDEX "royalty_reports_received_at_idx" ON "royalty_reports"("received_at");
CREATE UNIQUE INDEX "royalty_reports_period_platform_currency_key" ON "royalty_reports"("period", "platform", "currency");
CREATE INDEX "royalty_line_items_isrc_idx" ON "royalty_line_items"("isrc");
CREATE INDEX "royalty_line_items_entity_path_report_id_idx" ON "royalty_line_items"("entity_path", "report_id");
CREATE INDEX "royalty_line_items_tenant_id_report_id_idx" ON "royalty_line_items"("tenant_id", "report_id");
CREATE UNIQUE INDEX "royalty_line_items_report_id_source_row_key" ON "royalty_line_items"("report_id", "source_row");
CREATE INDEX "track_scopes_entity_path_idx" ON "track_scopes"("entity_path");
CREATE UNIQUE INDEX "finance_jobs_import_id_key" ON "finance_jobs"("import_id");
CREATE INDEX "finance_jobs_status_available_at_idx" ON "finance_jobs"("status", "available_at");
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "outbox_events"("published_at", "occurred_at");
ALTER TABLE "royalty_line_items" ADD CONSTRAINT "royalty_line_items_report_id_fkey" FOREIGN KEY ("report_id") REFERENCES "royalty_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "finance_jobs" ADD CONSTRAINT "finance_jobs_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "finance_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
