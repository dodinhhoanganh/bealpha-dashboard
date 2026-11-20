CREATE TABLE "archive_entries" (
  "id" UUID NOT NULL,
  "archive_asset_id" UUID NOT NULL,
  "asset_id" UUID NOT NULL,
  "entry_name" VARCHAR(1024) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archive_entries_asset_id_key" ON "archive_entries"("asset_id");
CREATE UNIQUE INDEX "archive_entries_archive_asset_id_entry_name_key" ON "archive_entries"("archive_asset_id", "entry_name");
CREATE INDEX "archive_entries_archive_asset_id_idx" ON "archive_entries"("archive_asset_id");
ALTER TABLE "archive_entries" ADD CONSTRAINT "archive_entries_archive_asset_id_fkey" FOREIGN KEY ("archive_asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_entries" ADD CONSTRAINT "archive_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
