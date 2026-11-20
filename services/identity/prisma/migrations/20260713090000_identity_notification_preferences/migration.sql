ALTER TABLE "users"
  ADD COLUMN "notify_releases" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_royalties" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_news" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notify_marketing" BOOLEAN NOT NULL DEFAULT false;
