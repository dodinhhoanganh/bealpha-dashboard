ALTER TABLE "tracks"
  ADD COLUMN "video_asset_id" UUID,
  ADD COLUMN "thumbnail_asset_id" UUID,
  ADD COLUMN "caption_asset_id" UUID,
  ADD COLUMN "caption_language" VARCHAR(35);

-- Older dashboard builds stored VIDEO masters in audio_asset_id. Preserve those
-- references while making the media purpose explicit for fail-closed delivery.
UPDATE "tracks" AS track
SET "video_asset_id" = track."audio_asset_id",
    "audio_asset_id" = NULL
FROM "releases" AS release
WHERE track."release_id" = release."id"
  AND release."type" = 'VIDEO'
  AND track."video_asset_id" IS NULL
  AND track."audio_asset_id" IS NOT NULL;

CREATE INDEX "tracks_video_asset_id_idx" ON "tracks"("video_asset_id");

ALTER TABLE "tracks"
  ADD CONSTRAINT "tracks_caption_language_check"
  CHECK (
    ("caption_asset_id" IS NULL AND "caption_language" IS NULL)
    OR
    ("caption_asset_id" IS NOT NULL AND "caption_language" IS NOT NULL AND "caption_language" ~ '^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$')
  );

CREATE OR REPLACE FUNCTION "touch_release_after_track_change"()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE "releases"
  SET "updated_at" = CURRENT_TIMESTAMP
  WHERE "id" = COALESCE(NEW."release_id", OLD."release_id");
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tracks_touch_release"
AFTER INSERT OR UPDATE OR DELETE ON "tracks"
FOR EACH ROW EXECUTE FUNCTION "touch_release_after_track_change"();
