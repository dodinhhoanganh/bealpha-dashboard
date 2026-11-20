CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "type" VARCHAR(100) NOT NULL,
    "request_id" UUID NOT NULL,
    "actor_id" UUID,
    "tenant_id" UUID,
    "entity_path" VARCHAR(2048),
    "payload_ciphertext" TEXT NOT NULL,
    "payload_iv" VARCHAR(32) NOT NULL,
    "payload_auth_tag" VARCHAR(32) NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "outbox_events_event_id_key" ON "outbox_events"("event_id");
CREATE INDEX "outbox_events_published_at_next_attempt_at_occurred_at_idx"
ON "outbox_events"("published_at", "next_attempt_at", "occurred_at");
