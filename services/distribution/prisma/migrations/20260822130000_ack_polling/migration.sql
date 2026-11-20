ALTER TABLE "deliveries"
  ADD COLUMN "ack_poll_after" TIMESTAMP(3),
  ADD COLUMN "ack_poll_locked_at" TIMESTAMP(3),
  ADD COLUMN "ack_poll_attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "ack_poll_last_error" VARCHAR(1000);

CREATE INDEX "deliveries_status_ack_poll_after_idx" ON "deliveries"("status", "ack_poll_after");
