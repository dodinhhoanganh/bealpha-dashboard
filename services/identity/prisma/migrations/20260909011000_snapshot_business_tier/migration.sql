-- Consumer-first additive rollout. Legacy events may omit the semantic tier.
ALTER TABLE "entity_snapshots"
  ADD COLUMN "business_tier" VARCHAR(16),
  ADD CONSTRAINT "entity_snapshots_business_tier_check" CHECK (
    "business_tier" IS NULL OR
    ("entity_type" = 'SYSTEM_ADMIN' AND "business_tier" = 'BEALPHA') OR
    ("entity_type" = 'ORGANIZATION' AND "business_tier" IN ('DISTRIBUTOR', 'LABEL')) OR
    ("entity_type" = 'SUB_ACCOUNT' AND "business_tier" = 'ARTIST')
  );
