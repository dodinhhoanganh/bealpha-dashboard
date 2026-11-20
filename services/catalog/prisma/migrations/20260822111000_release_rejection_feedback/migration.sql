ALTER TABLE "releases"
  ADD COLUMN "last_rejection_reason" VARCHAR(1000),
  ADD COLUMN "last_rejected_by_tier" "EntityType",
  ADD COLUMN "last_rejected_at" TIMESTAMP(3);
