CREATE TABLE "tenant_brand_profiles" (
  "tenant_id" UUID PRIMARY KEY,
  "display_name" VARCHAR(80) NOT NULL,
  "logo_asset_id" UUID,
  "accent_color" CHAR(7) NOT NULL DEFAULT '#111111',
  "accent_text_color" CHAR(7) NOT NULL DEFAULT '#FFFFFF',
  "support_email" VARCHAR(254),
  "support_url" VARCHAR(2048),
  "default_locale" VARCHAR(10) NOT NULL DEFAULT 'en',
  "version" INTEGER NOT NULL DEFAULT 1,
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_brand_profiles_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "business_entities"("id") ON DELETE CASCADE
);

CREATE OR REPLACE FUNCTION enforce_organization_brand_profile()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "business_entities"
    WHERE "id" = NEW."tenant_id" AND "entity_type" = 'ORGANIZATION' AND "is_active" = true
  ) THEN
    RAISE EXCEPTION 'tenant brand profile requires an active organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tenant_brand_profile_organization_guard"
BEFORE INSERT OR UPDATE ON "tenant_brand_profiles"
FOR EACH ROW EXECUTE FUNCTION enforce_organization_brand_profile();
