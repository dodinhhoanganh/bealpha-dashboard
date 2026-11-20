CREATE TABLE "stream_grants" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stream_grants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stream_grants_token_hash_key" ON "stream_grants"("token_hash");
CREATE INDEX "stream_grants_asset_id_expires_at_idx" ON "stream_grants"("asset_id", "expires_at");
CREATE INDEX "stream_grants_expires_at_consumed_at_idx" ON "stream_grants"("expires_at", "consumed_at");
ALTER TABLE "stream_grants" ADD CONSTRAINT "stream_grants_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
