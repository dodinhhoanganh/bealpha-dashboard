CREATE TABLE "compositions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "title" VARCHAR(500) NOT NULL,
    "subtitle" VARCHAR(500),
    "alternative_title" VARCHAR(500),
    "iswc" VARCHAR(15),
    "catalogue_number" VARCHAR(128),
    "genre" VARCHAR(100),
    "creation_date" TIMESTAMP(3),
    "lyrics_languages" VARCHAR(255),
    "territories" VARCHAR(2048) NOT NULL DEFAULT 'WORLDWIDE',
    "excluding_territories" VARCHAR(2048),
    "contract_period_begins" TIMESTAMP(3),
    "contract_period_ends" TIMESTAMP(3),
    "contract_number" VARCHAR(128),
    "authors" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "compositions_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "tracks" ADD COLUMN "composition_id" UUID;

CREATE UNIQUE INDEX "compositions_iswc_key" ON "compositions"("iswc");
CREATE INDEX "compositions_tenant_id_idx" ON "compositions"("tenant_id");
CREATE INDEX "compositions_owner_id_idx" ON "compositions"("owner_id");
CREATE UNIQUE INDEX "compositions_tenant_id_title_key" ON "compositions"("tenant_id", "title");
CREATE INDEX "tracks_composition_id_idx" ON "tracks"("composition_id");

ALTER TABLE "compositions" ADD CONSTRAINT "compositions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "business_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "compositions" ADD CONSTRAINT "compositions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tracks" ADD CONSTRAINT "tracks_composition_id_fkey" FOREIGN KEY ("composition_id") REFERENCES "compositions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
