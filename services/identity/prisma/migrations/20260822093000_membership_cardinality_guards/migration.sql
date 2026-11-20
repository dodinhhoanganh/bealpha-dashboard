-- Canonical identity cardinality: one root account and one user per sub-account.
CREATE UNIQUE INDEX "memberships_single_super_admin_idx"
  ON "memberships" ("entity_type")
  WHERE "entity_type" = 'SUPER_ADMIN';

CREATE UNIQUE INDEX "memberships_single_sub_account_user_idx"
  ON "memberships" ("entity_id")
  WHERE "entity_type" = 'SUB_ACCOUNT';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "memberships" m
    JOIN "user_staff_roles" r ON r."user_id" = m."user_id"
    WHERE m."entity_type" = 'SUB_ACCOUNT'
  ) THEN
    RAISE EXCEPTION 'existing sub-account users must have platform staff roles removed';
  END IF;
END;
$$;

CREATE FUNCTION reject_sub_account_staff_roles() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "memberships" m
    WHERE m."user_id" = NEW."user_id" AND m."entity_type" = 'SUB_ACCOUNT'
  ) THEN
    RAISE EXCEPTION 'sub-account users cannot hold platform staff roles';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "user_staff_roles_reject_sub_account"
BEFORE INSERT OR UPDATE ON "user_staff_roles"
FOR EACH ROW EXECUTE FUNCTION reject_sub_account_staff_roles();

CREATE FUNCTION reject_staff_membership_on_sub_account() RETURNS trigger AS $$
BEGIN
  IF NEW."entity_type" = 'SUB_ACCOUNT' AND EXISTS (
    SELECT 1 FROM "user_staff_roles" r WHERE r."user_id" = NEW."user_id"
  ) THEN
    RAISE EXCEPTION 'platform staff cannot be assigned to a sub-account';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "memberships_reject_staff_sub_account"
BEFORE INSERT OR UPDATE ON "memberships"
FOR EACH ROW EXECUTE FUNCTION reject_staff_membership_on_sub_account();
