-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'CONFIRMED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETE', 'FAILED');

-- CreateTable
CREATE TABLE "delivery_snapshots" (
    "id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_path" VARCHAR(2048) NOT NULL,
    "version" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "ern_xml" TEXT NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliveries" (
    "id" UUID NOT NULL,
    "snapshot_id" UUID NOT NULL,
    "release_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entity_path" VARCHAR(2048) NOT NULL,
    "dsp" VARCHAR(64) NOT NULL,
    "ern_version" VARCHAR(10) NOT NULL,
    "message_type" VARCHAR(64) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "confirmed_at" TIMESTAMP(3),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_jobs" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "last_error" VARCHAR(1000),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "type" VARCHAR(100) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" UUID NOT NULL,
    "actor_id" UUID,
    "tenant_id" UUID,
    "entity_path" VARCHAR(2048),
    "payload" JSONB NOT NULL,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "delivery_snapshots_tenant_id_created_at_idx" ON "delivery_snapshots"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "delivery_snapshots_entity_path_idx" ON "delivery_snapshots"("entity_path");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_snapshots_release_id_version_key" ON "delivery_snapshots"("release_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_snapshots_release_id_sha256_key" ON "delivery_snapshots"("release_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_idempotency_key_key" ON "deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "deliveries_tenant_id_created_at_idx" ON "deliveries"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "deliveries_entity_path_idx" ON "deliveries"("entity_path");

-- CreateIndex
CREATE INDEX "deliveries_release_id_dsp_idx" ON "deliveries"("release_id", "dsp");

-- CreateIndex
CREATE INDEX "deliveries_status_created_at_idx" ON "deliveries"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_jobs_delivery_id_key" ON "delivery_jobs"("delivery_id");

-- CreateIndex
CREATE INDEX "delivery_jobs_status_available_at_idx" ON "delivery_jobs"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");

-- CreateIndex
CREATE INDEX "outbox_events_published_at_occurred_at_idx" ON "outbox_events"("published_at", "occurred_at");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_snapshot_id_fkey" FOREIGN KEY ("snapshot_id") REFERENCES "delivery_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_jobs" ADD CONSTRAINT "delivery_jobs_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

