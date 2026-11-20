-- Artist is a terminal business unit, not a single-person login.
-- Preserve the Super Admin singleton and platform staff-role exclusion triggers.
DROP INDEX "memberships_single_sub_account_user_idx";
