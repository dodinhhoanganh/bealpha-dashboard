CREATE TABLE "split_rules" (
  "entity_path" VARCHAR(2048) NOT NULL,
  "retained_basis_points" INTEGER NOT NULL,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "split_rules_pkey" PRIMARY KEY ("entity_path"),
  CONSTRAINT "split_rules_basis_points" CHECK ("retained_basis_points" >= 0 AND "retained_basis_points" <= 10000)
);
CREATE TABLE "royalty_allocations" (
  "id" UUID NOT NULL,
  "report_id" UUID NOT NULL,
  "source_row" BIGINT NOT NULL,
  "beneficiary_path" VARCHAR(2048) NOT NULL,
  "amount" DECIMAL(38,18) NOT NULL,
  CONSTRAINT "royalty_allocations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "royalty_allocations_report_id_source_row_beneficiary_path_key" ON "royalty_allocations"("report_id", "source_row", "beneficiary_path");
CREATE INDEX "royalty_allocations_beneficiary_path_report_id_idx" ON "royalty_allocations"("beneficiary_path", "report_id");
ALTER TABLE "royalty_allocations" ADD CONSTRAINT "royalty_allocations_report_id_source_row_fkey" FOREIGN KEY ("report_id", "source_row") REFERENCES "royalty_line_items"("report_id", "source_row") ON DELETE CASCADE ON UPDATE CASCADE;
