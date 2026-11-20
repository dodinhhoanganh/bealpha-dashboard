ALTER TABLE "notifications"
  ADD COLUMN "event_id" UUID,
  ADD COLUMN "entity_path" VARCHAR(2048),
  ALTER COLUMN "user_id" DROP NOT NULL;

CREATE UNIQUE INDEX "notifications_event_id_key" ON "notifications"("event_id");
CREATE INDEX "notifications_entity_path_created_at_idx" ON "notifications"("entity_path", "created_at");

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_exactly_one_recipient_check"
CHECK (("user_id" IS NOT NULL)::int + ("entity_path" IS NOT NULL)::int = 1);

CREATE TABLE "notification_receipts" (
  "notification_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "read_at" TIMESTAMP(3),
  "dismissed_at" TIMESTAMP(3),
  CONSTRAINT "notification_receipts_pkey" PRIMARY KEY ("notification_id", "user_id"),
  CONSTRAINT "notification_receipts_notification_id_fkey"
    FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE
);

CREATE INDEX "notification_receipts_user_id_dismissed_at_idx"
ON "notification_receipts"("user_id", "dismissed_at");
