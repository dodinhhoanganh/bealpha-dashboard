ALTER TABLE "assets"
  ADD COLUMN "published_at" TIMESTAMP(3),
  ADD COLUMN "published_by_id" UUID;

CREATE INDEX "assets_published_at_idx" ON "assets"("published_at");

ALTER TABLE "assets"
  ADD CONSTRAINT "assets_image_publication_check"
  CHECK (
    ("published_at" IS NULL AND "published_by_id" IS NULL)
    OR
    ("type" = 'IMAGE' AND "published_at" IS NOT NULL AND "published_by_id" IS NOT NULL)
  );
