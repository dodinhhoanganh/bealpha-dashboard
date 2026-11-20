CREATE TABLE "delivery_asset_grants" (
    "id" UUID NOT NULL,
    "delivery_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "token_ciphertext" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "delivery_asset_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_asset_grants_delivery_id_asset_id_key" ON "delivery_asset_grants"("delivery_id", "asset_id");
CREATE INDEX "delivery_asset_grants_expires_at_idx" ON "delivery_asset_grants"("expires_at");
ALTER TABLE "delivery_asset_grants" ADD CONSTRAINT "delivery_asset_grants_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "deliveries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
