ALTER TABLE "deliveries"
  ADD COLUMN "message_id" VARCHAR(200),
  ADD COLUMN "message_thread_id" VARCHAR(200),
  ADD COLUMN "release_profile_version_id" VARCHAR(64) NOT NULL DEFAULT 'SimpleAudioSingle',
  ADD COLUMN "remote_folder" VARCHAR(500);

UPDATE "deliveries"
SET
  "message_id" = 'BA-' || "id"::text,
  "message_thread_id" = 'BA-' || "release_id"::text || '-' || "dsp"
WHERE "message_id" IS NULL OR "message_thread_id" IS NULL;

ALTER TABLE "deliveries"
  ALTER COLUMN "message_id" SET NOT NULL,
  ALTER COLUMN "message_thread_id" SET NOT NULL;

CREATE UNIQUE INDEX "deliveries_message_id_key" ON "deliveries"("message_id");

CREATE TABLE "delivery_acknowledgements" (
  "id" UUID NOT NULL,
  "delivery_id" UUID NOT NULL,
  "acknowledgement_message_id" VARCHAR(500) NOT NULL,
  "referenced_message_id" VARCHAR(200) NOT NULL,
  "sender_party_id" VARCHAR(128) NOT NULL,
  "supply_chain_status" VARCHAR(100) NOT NULL,
  "file_statuses" JSONB NOT NULL,
  "information" VARCHAR(1000),
  "file_name" VARCHAR(500) NOT NULL,
  "raw_sha256" CHAR(64) NOT NULL,
  "message_created_at" TIMESTAMP(3) NOT NULL,
  "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_acknowledgements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_acknowledgements_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "delivery_acknowledgements_sender_party_id_acknowledgement_message_id_key" ON "delivery_acknowledgements"("sender_party_id", "acknowledgement_message_id");
CREATE UNIQUE INDEX "delivery_acknowledgements_raw_sha256_key" ON "delivery_acknowledgements"("raw_sha256");
CREATE INDEX "delivery_acknowledgements_delivery_id_received_at_idx" ON "delivery_acknowledgements"("delivery_id", "received_at");
