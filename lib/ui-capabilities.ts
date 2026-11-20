import type { UserSession } from "@/lib/types";

type CapabilityIdentity = Pick<UserSession, "entityType" | "entityRole" | "permissions">;

type CatalogRecord = "artist" | "label" | "composition";
type CatalogAction = "create" | "update" | "delete";
type ReleaseAction = CatalogAction | "submit";

const PANEL_PERMISSION: Readonly<Record<string, string | undefined>> = {
  releases: "release.read",
  catalog: "release.read",
  assets: "release.read",
  artists: "artist.read",
  labels: "label.read",
  vevo: "release.read",
  compositions: "release.read",
  analytics: "analytics.view",
  earnings: "finance.view",
};

function isManager(user: CapabilityIdentity): boolean {
  return user.entityRole === "OWNER" || user.entityRole === "ADMIN";
}

function isReviewer(user: CapabilityIdentity): boolean {
  return isManager(user) || user.entityRole === "REVIEWER";
}

function isPlatformManager(user: CapabilityIdentity): boolean {
  return user.entityType === "SUPER_ADMIN"
    || (user.entityType === "SYSTEM_ADMIN" && isManager(user));
}

function isBeAlphaOwner(user: CapabilityIdentity): boolean {
  return user.entityType === "SUPER_ADMIN" && user.entityRole === "OWNER";
}

function isSystemReviewer(user: CapabilityIdentity): boolean {
  return user.entityType === "SYSTEM_ADMIN" && isReviewer(user);
}

function isOrganizationManager(user: CapabilityIdentity): boolean {
  return user.entityType === "ORGANIZATION" && isManager(user);
}

function isOrganizationReviewer(user: CapabilityIdentity): boolean {
  return user.entityType === "ORGANIZATION" && isReviewer(user);
}

/**
 * Mirrors the catalog service's manager checks for mutable catalog records.
 * Read permissions are intentionally not enough for these actions: members
 * can inspect a tenant catalog, while only entity managers can mutate it.
 */
export function canManageCatalogRecord(
  user: CapabilityIdentity,
  record: CatalogRecord,
  action: CatalogAction,
): boolean {
  if (!user.permissions.includes(`${record}.${action}`)) return false;
  if (!isManager(user) || user.entityType === "SUB_ACCOUNT") return false;
  // Catalog records created from the tenant panels need an organization
  // context. Platform users can still review or edit scoped records, but the
  // create forms do not expose a tenant selector and must not offer a submit
  // action that the API would reject for lack of tenant scope.
  if (action === "create") {
    return user.entityType === "ORGANIZATION";
  }
  return true;
}

export function canAccessPanel(user: CapabilityIdentity, panel: string): boolean {
  if (panel === "dashboard" || panel === "settings") return true;
  if ((panel === "entities" || panel === "users") && user.entityType === "SUB_ACCOUNT") {
    return isManager(user) && user.permissions.includes("entity.invite");
  }
  // Playlists are the platform-wide DSP curation surface. The catalog API
  // intentionally limits it to BeAlpha's super administrator, so do not
  // expose a navigation entry that will always return 403 for tenant users.
  if (panel === "playlists") return isBeAlphaOwner(user);
  if (panel === "distribution") return isBeAlphaOwner(user);
  if (panel === "channels") return isPlatformManager(user) || isOrganizationManager(user);
  if (panel === "entities" || panel === "users" || panel === "audit-log") {
    return isPlatformManager(user) || isOrganizationManager(user);
  }
  const permission = PANEL_PERMISSION[panel];
  return permission ? user.permissions.includes(permission) : false;
}

export function canUseBulkDdex(user: CapabilityIdentity): boolean {
  return isSystemReviewer(user) || isOrganizationManager(user);
}

export function canApproveRelease(user: CapabilityIdentity, status: string): boolean {
  if (!user.permissions.includes("release.approve")) return false;
  if (status === "PENDING_ORG_APPROVAL") return isOrganizationReviewer(user);
  if (status === "PENDING_SYS_APPROVAL") return isSystemReviewer(user);
  if (status === "PENDING_SUPER_APPROVAL") return user.entityType === "SUPER_ADMIN" && isReviewer(user);
  return false;
}

/** Mirrors the catalog API role checks; stale permission strings cannot widen them. */
export function canManageRelease(user: CapabilityIdentity, action: ReleaseAction): boolean {
  if (!user.permissions.includes(`release.${action}`)) return false;
  if (user.entityType === "SUB_ACCOUNT") return user.entityRole === "OWNER";
  return isManager(user) || (action !== "delete" && user.entityRole === "MEMBER");
}

export function canSubmitRelease(user: CapabilityIdentity, status: string): boolean {
  return canManageRelease(user, "submit")
    && ["DRAFT", "ORG_REJECTED", "SYS_REJECTED", "SUPER_REJECTED"].includes(status);
}
