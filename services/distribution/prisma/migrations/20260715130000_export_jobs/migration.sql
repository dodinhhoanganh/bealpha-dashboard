CREATE TYPE "ExportFormat" AS ENUM ('XLSX', 'ZIP');

CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_path" VARCHAR(2048) NOT NULL,
    "actor_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "format" "ExportFormat" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "output_path" VARCHAR(1000),
    "file_name" VARCHAR(500),
    "content_type" VARCHAR(255),
    "size_bytes" BIGINT,
    "sha256" CHAR(64),
    "last_error" VARCHAR(1000),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "export_jobs_status_available_at_idx" ON "export_jobs"("status", "available_at");
CREATE INDEX "export_jobs_entity_path_created_at_idx" ON "export_jobs"("entity_path", "created_at");
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs"("expires_at");
