ALTER TABLE "business_entities"
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "business_entities"
  ADD CONSTRAINT "business_entities_version_positive_check"
  CHECK ("version" > 0);
