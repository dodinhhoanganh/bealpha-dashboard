DROP INDEX "deliveries_idempotency_key_key";

CREATE UNIQUE INDEX "deliveries_tenant_id_idempotency_key_key"
ON "deliveries"("tenant_id", "idempotency_key");
