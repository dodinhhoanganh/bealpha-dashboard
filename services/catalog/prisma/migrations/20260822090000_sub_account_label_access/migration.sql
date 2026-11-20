-- SUB_ACCOUNT catalog access is an explicit allow-list. An account with no rows
-- has no label, artist, or release access.
CREATE TABLE "sub_account_label_access" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sub_account_id" UUID NOT NULL,
    "label_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sub_account_label_access_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sub_account_label_access_sub_account_id_label_id_key"
    ON "sub_account_label_access"("sub_account_id", "label_id");
CREATE INDEX "sub_account_label_access_tenant_id_sub_account_id_idx"
    ON "sub_account_label_access"("tenant_id", "sub_account_id");
CREATE INDEX "sub_account_label_access_tenant_id_label_id_idx"
    ON "sub_account_label_access"("tenant_id", "label_id");

ALTER TABLE "sub_account_label_access"
    ADD CONSTRAINT "sub_account_label_access_sub_account_id_fkey"
    FOREIGN KEY ("sub_account_id") REFERENCES "business_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sub_account_label_access"
    ADD CONSTRAINT "sub_account_label_access_label_id_fkey"
    FOREIGN KEY ("label_id") REFERENCES "labels"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Defense in depth: a grant must connect a direct SUB_ACCOUNT child to a label
-- owned by the same ORGANIZATION tenant.
CREATE FUNCTION enforce_sub_account_label_access_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "business_entities" e
    WHERE e."id" = NEW."sub_account_id"
      AND e."entity_type" = 'SUB_ACCOUNT'
      AND e."parent_id" = NEW."tenant_id"
  ) OR NOT EXISTS (
    SELECT 1 FROM "labels" l
    WHERE l."id" = NEW."label_id" AND l."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'sub-account label grant must stay within its organization tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sub_account_label_access_scope_guard"
BEFORE INSERT OR UPDATE ON "sub_account_label_access"
FOR EACH ROW EXECUTE FUNCTION enforce_sub_account_label_access_scope();
