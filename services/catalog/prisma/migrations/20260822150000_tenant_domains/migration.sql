CREATE TYPE "TenantDomainStatus" AS ENUM ('PENDING', 'VERIFIED');

CREATE TABLE "tenant_domains" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" UUID NOT NULL,
  "hostname" VARCHAR(253) NOT NULL UNIQUE,
  "status" "TenantDomainStatus" NOT NULL DEFAULT 'PENDING',
  "verification_token_hash" CHAR(64) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "verified_at" TIMESTAMP(3),
  "last_checked_at" TIMESTAMP(3),
  "updated_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tenant_domains_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "business_entities"("id") ON DELETE CASCADE,
  CONSTRAINT "tenant_domains_version_positive" CHECK ("version" > 0)
);

CREATE INDEX "tenant_domains_tenant_id_status_idx" ON "tenant_domains"("tenant_id", "status");

CREATE OR REPLACE FUNCTION enforce_organization_tenant_domain()
RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "business_entities"
    WHERE "id" = NEW."tenant_id" AND "entity_type" = 'ORGANIZATION' AND "is_active" = true
  ) THEN
    RAISE EXCEPTION 'tenant domain requires an active organization';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tenant_domain_organization_guard"
BEFORE INSERT OR UPDATE ON "tenant_domains"
FOR EACH ROW EXECUTE FUNCTION enforce_organization_tenant_domain();
