ALTER TYPE "AssetType" ADD VALUE 'ARCHIVE';
CREATE TYPE "JobType" AS ENUM ('VALIDATE_ARCHIVE', 'INSPECT_MEDIA');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');
CREATE TABLE "processing_jobs" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "request_id" UUID NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "processing_jobs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "processing_jobs_asset_id_key" ON "processing_jobs"("asset_id");
CREATE INDEX "processing_jobs_status_available_at_idx" ON "processing_jobs"("status", "available_at");
ALTER TABLE "processing_jobs" ADD CONSTRAINT "processing_jobs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
