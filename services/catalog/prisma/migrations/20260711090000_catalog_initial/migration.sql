CREATE TYPE "EntityType" AS ENUM ('SUPER_ADMIN', 'SYSTEM_ADMIN', 'ORGANIZATION', 'SUB_ACCOUNT');
CREATE TYPE "ReleaseType" AS ENUM ('AUDIO', 'VIDEO');
CREATE TYPE "ReleaseFormat" AS ENUM ('SINGLE', 'EP', 'ALBUM', 'COMPILATION');
CREATE TYPE "ReleaseStatus" AS ENUM ('DRAFT', 'PENDING_ORG_APPROVAL', 'ORG_REJECTED', 'PENDING_SYS_APPROVAL', 'SYS_REJECTED', 'APPROVED', 'SCHEDULED', 'LOCKED_FOR_DELIVERY', 'DELIVERED', 'RELEASED', 'TAKEDOWN');

CREATE TABLE "business_entities" (
    "id" UUID NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "parent_id" UUID,
    "official_name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(2048) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "business_entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "labels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "dpid" VARCHAR(128),
    "ddex_party_name" VARCHAR(255),
    "logo_url" VARCHAR(2048),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "artists" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "label_id" UUID,
    "name" VARCHAR(255) NOT NULL,
    "isni" VARCHAR(32),
    "ipi" VARCHAR(32),
    "dpid" VARCHAR(128),
    "image_url" VARCHAR(2048),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "artists_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "releases" (
    "id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "ean" VARCHAR(14),
    "type" "ReleaseType" NOT NULL DEFAULT 'AUDIO',
    "format" "ReleaseFormat" NOT NULL DEFAULT 'SINGLE',
    "genre" VARCHAR(100),
    "release_date" TIMESTAMP(3) NOT NULL,
    "display_artist" VARCHAR(500),
    "artist_id" UUID,
    "label_id" UUID,
    "status" "ReleaseStatus" NOT NULL DEFAULT 'DRAFT',
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "total_size_bytes" BIGINT NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "releases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tracks" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "isrc" VARCHAR(12),
    "track_number" INTEGER NOT NULL DEFAULT 1,
    "disc_number" INTEGER NOT NULL DEFAULT 1,
    "duration" INTEGER,
    "artist_id" UUID,
    "audio_asset_id" UUID,
    "canvas_asset_id" UUID,
    "motion_asset_id" UUID,
    "adm_asset_id" UUID,
    "recording_label_share" DECIMAL(5,2),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "tracks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "business_entities_path_key" ON "business_entities"("path");
CREATE INDEX "business_entities_path_idx" ON "business_entities"("path");
CREATE UNIQUE INDEX "business_entities_parent_id_entity_type_official_name_key" ON "business_entities"("parent_id", "entity_type", "official_name");
CREATE INDEX "labels_tenant_id_idx" ON "labels"("tenant_id");
CREATE UNIQUE INDEX "labels_tenant_id_name_key" ON "labels"("tenant_id", "name");
CREATE UNIQUE INDEX "artists_isni_key" ON "artists"("isni");
CREATE UNIQUE INDEX "artists_ipi_key" ON "artists"("ipi");
CREATE INDEX "artists_tenant_id_idx" ON "artists"("tenant_id");
CREATE INDEX "artists_label_id_idx" ON "artists"("label_id");
CREATE UNIQUE INDEX "artists_tenant_id_name_key" ON "artists"("tenant_id", "name");
CREATE UNIQUE INDEX "releases_ean_key" ON "releases"("ean");
CREATE INDEX "releases_tenant_id_idx" ON "releases"("tenant_id");
CREATE INDEX "releases_owner_id_idx" ON "releases"("owner_id");
CREATE INDEX "releases_release_date_idx" ON "releases"("release_date");
CREATE UNIQUE INDEX "tracks_isrc_key" ON "tracks"("isrc");
CREATE INDEX "tracks_release_id_idx" ON "tracks"("release_id");
CREATE INDEX "tracks_artist_id_idx" ON "tracks"("artist_id");

ALTER TABLE "business_entities" ADD CONSTRAINT "business_entities_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "business_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "labels" ADD CONSTRAINT "labels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "business_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artists" ADD CONSTRAINT "artists_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "business_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "artists" ADD CONSTRAINT "artists_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "releases" ADD CONSTRAINT "releases_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "releases" ADD CONSTRAINT "releases_label_id_fkey" FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "releases" ADD CONSTRAINT "releases_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "releases" ADD CONSTRAINT "releases_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_release_id_fkey" FOREIGN KEY ("release_id") REFERENCES "releases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_artist_id_fkey" FOREIGN KEY ("artist_id") REFERENCES "artists"("id") ON DELETE SET NULL ON UPDATE CASCADE;
