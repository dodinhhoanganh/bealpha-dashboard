ALTER TYPE "VevoSubmissionStatus" ADD VALUE 'READY_FOR_MANUAL_DELIVERY';
ALTER TABLE "vevo_submissions"
  ADD COLUMN "package_path" VARCHAR(1000),
  ADD COLUMN "package_file_name" VARCHAR(500),
  ADD COLUMN "package_size_bytes" BIGINT,
  ADD COLUMN "package_sha256" CHAR(64),
  ADD COLUMN "package_expires_at" TIMESTAMP(3);
