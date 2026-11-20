CREATE TABLE "audit_events" ("id" UUID NOT NULL,"event_id" UUID NOT NULL,"request_id" UUID NOT NULL,"event_type" VARCHAR(100) NOT NULL,"action" VARCHAR(32) NOT NULL,"entity_type" VARCHAR(64) NOT NULL,"entity_id" VARCHAR(128),"actor_id" UUID,"tenant_id" UUID,"entity_path" VARCHAR(2048),"details" JSONB,"occurred_at" TIMESTAMP(3) NOT NULL,"created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "audit_events_event_id_key" ON "audit_events"("event_id");
CREATE INDEX "audit_events_entity_path_occurred_at_idx" ON "audit_events"("entity_path","occurred_at");
CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit_events"("action","occurred_at");
CREATE INDEX "audit_events_entity_type_occurred_at_idx" ON "audit_events"("entity_type","occurred_at");
