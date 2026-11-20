ALTER TABLE "delivery_asset_grants"
ADD COLUMN "file_name" VARCHAR(500) NOT NULL,
ADD COLUMN "content_type" VARCHAR(255) NOT NULL,
ADD COLUMN "size_bytes" BIGINT NOT NULL;
