-- Additive rollout: unclassified historical chains remain NULL for review.
-- No reparenting, membership changes, or tenant reassignment.
ALTER TABLE "business_entities"
  ADD COLUMN "business_tier" VARCHAR(16),
  ADD CONSTRAINT "business_entities_business_tier_check"
    CHECK (
      "business_tier" IS NULL OR
      ("entity_type" = 'SYSTEM_ADMIN' AND "business_tier" = 'BEALPHA') OR
      ("entity_type" = 'ORGANIZATION' AND "business_tier" IN ('DISTRIBUTOR', 'LABEL')) OR
      ("entity_type" = 'SUB_ACCOUNT' AND "business_tier" = 'ARTIST')
    );

WITH RECURSIVE valid_tree AS (
  SELECT id, 0 AS tier_rank
  FROM "business_entities"
  WHERE "parent_id" IS NULL AND "entity_type" = 'SUPER_ADMIN'
  UNION ALL
  SELECT child.id,
    CASE WHEN child."entity_type" = 'SUB_ACCOUNT' THEN 4 ELSE parent.tier_rank + 1 END
  FROM "business_entities" child
  JOIN valid_tree parent ON child."parent_id" = parent.id
  WHERE (parent.tier_rank = 0 AND child."entity_type" = 'SYSTEM_ADMIN')
     OR (parent.tier_rank IN (1, 2) AND child."entity_type" = 'ORGANIZATION')
     OR (parent.tier_rank IN (2, 3) AND child."entity_type" = 'SUB_ACCOUNT')
)
UPDATE "business_entities" entity
SET "business_tier" = CASE tree.tier_rank
  WHEN 1 THEN 'BEALPHA'
  WHEN 2 THEN 'DISTRIBUTOR'
  WHEN 3 THEN 'LABEL'
  WHEN 4 THEN 'ARTIST'
END
FROM valid_tree tree
WHERE entity.id = tree.id AND tree.tier_rank > 0;
