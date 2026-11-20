CREATE TABLE "streaming_metrics" (
  "id" UUID NOT NULL,
  "track_id" UUID NOT NULL,
  "track_title" VARCHAR(500) NOT NULL,
  "tenant_id" UUID NOT NULL,
  "entity_path" VARCHAR(2048) NOT NULL,
  "date" DATE NOT NULL,
  "platform" VARCHAR(100) NOT NULL,
  "country" VARCHAR(2) NOT NULL DEFAULT 'XX',
  "plays" INTEGER NOT NULL DEFAULT 0,
  "skips" INTEGER NOT NULL DEFAULT 0,
  "saves" INTEGER NOT NULL DEFAULT 0,
  "shares" INTEGER NOT NULL DEFAULT 0,
  "avg_play_duration" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "streaming_metrics_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "streaming_metrics_track_id_date_platform_country_key" ON "streaming_metrics"("track_id", "date", "platform", "country");
CREATE INDEX "streaming_metrics_entity_path_date_idx" ON "streaming_metrics"("entity_path", "date");
CREATE INDEX "streaming_metrics_tenant_id_date_idx" ON "streaming_metrics"("tenant_id", "date");
CREATE INDEX "streaming_metrics_platform_date_idx" ON "streaming_metrics"("platform", "date");
