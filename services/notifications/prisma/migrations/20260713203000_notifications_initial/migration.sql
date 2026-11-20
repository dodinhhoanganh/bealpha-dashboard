CREATE SCHEMA IF NOT EXISTS "public";
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'DLQ');
CREATE TABLE "email_deliveries" (
  "id" UUID NOT NULL,
  "event_id" UUID NOT NULL,
  "request_id" UUID NOT NULL,
  "actor_id" UUID,
  "tenant_id" UUID,
  "entity_path" VARCHAR(2048),
  "recipient" VARCHAR(254) NOT NULL,
  "template" VARCHAR(64) NOT NULL,
  "locale" VARCHAR(10) NOT NULL,
  "variables_ciphertext" TEXT NOT NULL,
  "variables_iv" VARCHAR(64) NOT NULL,
  "variables_auth_tag" VARCHAR(64) NOT NULL,
  "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "locked_at" TIMESTAMP(3),
  "sent_at" TIMESTAMP(3),
  "provider_message_id" VARCHAR(500),
  "last_error" VARCHAR(1000),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "email_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "dead_letters" ("id" UUID NOT NULL, "delivery_id" UUID NOT NULL, "reason" VARCHAR(1000) NOT NULL, "failed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "dead_letters_pkey" PRIMARY KEY ("id"));
CREATE TABLE "notifications" ("id" UUID NOT NULL, "user_id" UUID NOT NULL, "type" VARCHAR(64) NOT NULL, "title" VARCHAR(255) NOT NULL, "message" VARCHAR(2000) NOT NULL, "read" BOOLEAN NOT NULL DEFAULT false, "link" VARCHAR(255), "metadata" JSONB, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "email_deliveries_event_id_key" ON "email_deliveries"("event_id");
CREATE INDEX "email_deliveries_status_available_at_idx" ON "email_deliveries"("status", "available_at");
CREATE UNIQUE INDEX "dead_letters_delivery_id_key" ON "dead_letters"("delivery_id");
CREATE INDEX "dead_letters_failed_at_idx" ON "dead_letters"("failed_at");
CREATE INDEX "notifications_user_id_read_created_at_idx" ON "notifications"("user_id", "read", "created_at");
ALTER TABLE "dead_letters" ADD CONSTRAINT "dead_letters_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "email_deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
