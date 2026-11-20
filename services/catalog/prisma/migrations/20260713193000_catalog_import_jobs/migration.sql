CREATE TYPE "CatalogImportFormat" AS ENUM ('XML', 'ZIP', 'CSV', 'XLSX');
CREATE TYPE "CatalogImportStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'FAILED');
CREATE TYPE "CatalogImportJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');

CREATE TABLE "catalog_imports" (
  "id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "tenant_id" UUID NOT NULL,
  "owner_entity_id" UUID NOT NULL,
  "entity_path" VARCHAR(2048) NOT NULL,
  "actor_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "format" "CatalogImportFormat" NOT NULL,
  "status" "CatalogImportStatus" NOT NULL DEFAULT 'PENDING',
  "token_ciphertext" TEXT NOT NULL,
  "grant_expires_at" TIMESTAMP(3) NOT NULL,
  "source_file_name" VARCHAR(500) NOT NULL,
  "source_content_type" VARCHAR(255) NOT NULL,
  "source_size_bytes" BIGINT NOT NULL,
  "archive_entries" JSONB,
  "release_count" INTEGER NOT NULL DEFAULT 0,
  "track_count" INTEGER NOT NULL DEFAULT 0,
  "last_error" VARCHAR(1000),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_imports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalog_import_jobs" (
  "id" UUID NOT NULL,
  "import_id" UUID NOT NULL,
  "status" "CatalogImportJobStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "catalog_import_jobs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "catalog_import_jobs_import_id_key" ON "catalog_import_jobs"("import_id");
CREATE INDEX "catalog_imports_tenant_id_created_at_idx" ON "catalog_imports"("tenant_id", "created_at");
CREATE INDEX "catalog_imports_owner_entity_id_idx" ON "catalog_imports"("owner_entity_id");
CREATE INDEX "catalog_imports_entity_path_idx" ON "catalog_imports"("entity_path");
CREATE INDEX "catalog_imports_asset_id_idx" ON "catalog_imports"("asset_id");
CREATE INDEX "catalog_imports_status_created_at_idx" ON "catalog_imports"("status", "created_at");
CREATE INDEX "catalog_import_jobs_status_available_at_idx" ON "catalog_import_jobs"("status", "available_at");
ALTER TABLE "catalog_import_jobs" ADD CONSTRAINT "catalog_import_jobs_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "catalog_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
