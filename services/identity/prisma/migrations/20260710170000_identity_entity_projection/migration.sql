CREATE TABLE "entity_snapshots" (
    "id" UUID NOT NULL,
    "entity_type" "EntityType" NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "path" VARCHAR(2048) NOT NULL,
    "tenant_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "entity_snapshots_path_idx" ON "entity_snapshots"("path");
