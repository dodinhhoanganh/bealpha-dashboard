-- Allow SUB_ACCOUNTs below nested ORGANIZATION nodes while preserving the
-- root-tenant boundary for label grants.
CREATE OR REPLACE FUNCTION enforce_sub_account_label_access_scope() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM "business_entities" child
    JOIN "business_entities" parent ON parent."id" = child."parent_id"
    JOIN "business_entities" root ON root."id" = NEW."tenant_id"
    WHERE child."id" = NEW."sub_account_id"
      AND child."entity_type" = 'SUB_ACCOUNT'
      AND root."entity_type" = 'ORGANIZATION'
      AND parent."entity_type" = 'ORGANIZATION'
      AND (parent."id" = root."id" OR parent."path" LIKE root."path" || '.%')
  ) OR NOT EXISTS (
    SELECT 1
    FROM "labels" label
    WHERE label."id" = NEW."label_id"
      AND label."tenant_id" = NEW."tenant_id"
  ) THEN
    RAISE EXCEPTION 'sub-account label grant must stay within its organization tenant';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
