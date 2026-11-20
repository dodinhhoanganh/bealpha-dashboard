-- Catalog owns the business-entity projection used by entity creation.  The
-- platform root is stable and must exist before the first child is created.
INSERT INTO "business_entities" (
  "id",
  "entity_type",
  "parent_id",
  "official_name",
  "description",
  "metadata",
  "path",
  "is_active",
  "version",
  "created_at",
  "updated_at"
)
VALUES (
  'e0000000-0000-0000-0000-000000000001',
  'SUPER_ADMIN',
  NULL,
  'BeAlpha Music',
  'BeAlpha platform root',
  NULL,
  'e0000000-0000-0000-0000-000000000001',
  TRUE,
  1,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO UPDATE SET
  "entity_type" = EXCLUDED."entity_type",
  "official_name" = EXCLUDED."official_name",
  "path" = EXCLUDED."path",
  "is_active" = TRUE;
