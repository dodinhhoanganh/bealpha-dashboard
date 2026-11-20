ALTER TABLE "assets"
  ADD COLUMN "qc_profile" VARCHAR(64),
  ADD COLUMN "qc_profile_version" VARCHAR(32),
  ADD COLUMN "qc_result" JSONB,
  ADD COLUMN "qc_validated_at" TIMESTAMP(3);

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_video_qc_consistency_check"
  CHECK (
    ("qc_profile" IS NULL AND "qc_profile_version" IS NULL AND "qc_result" IS NULL AND "qc_validated_at" IS NULL)
    OR
    ("type" = 'VIDEO' AND "qc_profile_version" IS NOT NULL AND "qc_result" IS NOT NULL AND "qc_validated_at" IS NOT NULL)
  );
