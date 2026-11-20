CREATE TABLE "playlists" (
  "id" UUID NOT NULL,
  "name" VARCHAR(200) NOT NULL,
  "platform" VARCHAR(100) NOT NULL,
  "cover_url" VARCHAR(2048),
  "followers" INTEGER NOT NULL DEFAULT 0,
  "plays" INTEGER NOT NULL DEFAULT 0,
  "color" VARCHAR(7),
  "external_id" VARCHAR(255),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "playlists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "playlist_tracks" (
  "id" UUID NOT NULL,
  "playlist_id" UUID NOT NULL,
  "track_id" UUID NOT NULL,
  "position" INTEGER NOT NULL DEFAULT 0,
  "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "playlist_tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "playlists_external_id_key" ON "playlists"("external_id");
CREATE INDEX "playlists_platform_idx" ON "playlists"("platform");
CREATE INDEX "playlists_plays_idx" ON "playlists"("plays");
CREATE UNIQUE INDEX "playlist_tracks_playlist_id_track_id_key" ON "playlist_tracks"("playlist_id", "track_id");
CREATE INDEX "playlist_tracks_playlist_id_idx" ON "playlist_tracks"("playlist_id");
CREATE INDEX "playlist_tracks_track_id_idx" ON "playlist_tracks"("track_id");
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_playlist_id_fkey" FOREIGN KEY ("playlist_id") REFERENCES "playlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "playlist_tracks" ADD CONSTRAINT "playlist_tracks_track_id_fkey" FOREIGN KEY ("track_id") REFERENCES "tracks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
