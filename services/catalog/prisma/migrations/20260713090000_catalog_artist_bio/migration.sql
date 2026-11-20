ALTER TABLE "artists"
  ADD COLUMN "bio" TEXT,
  ADD COLUMN "spotify_id" VARCHAR(128),
  ADD COLUMN "apple_music_id" VARCHAR(128),
  ADD COLUMN "vevo_channel" VARCHAR(20),
  ADD COLUMN "vevo_bio" VARCHAR(1000),
  ADD COLUMN "vevo_banner_url" VARCHAR(2048);

ALTER TABLE "business_entities"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "metadata" JSONB;

ALTER TABLE "releases"
  ADD COLUMN "cover_url" VARCHAR(2048),
  ADD COLUMN "upc_locked_at" TIMESTAMP(3);

ALTER TABLE "tracks"
  ADD COLUMN "isrc_locked_at" TIMESTAMP(3);
