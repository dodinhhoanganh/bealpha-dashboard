import {
  canAccessPanel,
  canApproveRelease,
  canManageCatalogRecord,
  canManageRelease,
  canSubmitRelease,
  canUseBulkDdex,
} from "@/lib/ui-capabilities";
import type { UserSession } from "@/lib/types";

function user(overrides: Partial<UserSession> = {}): UserSession {
  return {
    id: "user-1",
    email: "user@example.com",
    roles: [],
    permissions: [
      "release.create",
      "release.read",
      "release.update",
      "release.submit",
      "artist.read",
      "label.read",
      "analytics.view",
    ],
    entityId: "entity-1",
    entityType: "SUB_ACCOUNT",
    entityRole: "OWNER",
    entityName: "Customer",
    entityPath: "root.system.org.sub",
    tenantId: "tenant-1",
    ...overrides,
  };
}

describe("dashboard capability matrix", () => {
  it("allows Artist managers team access without child creation or dispatch", () => {
    const manager = user({ permissions: ["entity.read", "entity.invite", "user.read", "user.update"] });
    expect(canAccessPanel(manager, "entities")).toBe(true);
    expect(canAccessPanel(manager, "users")).toBe(true);
    expect(canAccessPanel(manager, "distribution")).toBe(false);
    expect(canAccessPanel(manager, "channels")).toBe(false);
    expect(canAccessPanel({ ...manager, entityRole: "MEMBER" }, "users")).toBe(false);
  });
  it("keeps sub-accounts in self-service catalog surfaces", () => {
    const sub = user();
    expect(canAccessPanel(sub, "releases")).toBe(true);
    expect(canAccessPanel(sub, "assets")).toBe(true);
    expect(canAccessPanel(sub, "vevo")).toBe(true);
    for (const panel of ["channels", "distribution", "entities", "users", "audit-log"]) {
      expect(canAccessPanel(sub, panel)).toBe(false);
    }
    expect(canAccessPanel(sub, "playlists")).toBe(false);
    expect(canUseBulkDdex(sub)).toBe(false);
  });

  it("lets organization managers administer their tenant but not dispatch", () => {
    const org = user({
      entityType: "ORGANIZATION",
      entityRole: "ADMIN",
      permissions: ["release.read", "label.read", "entity.read", "user.read"],
    });
    expect(canAccessPanel(org, "channels")).toBe(true);
    expect(canAccessPanel(org, "entities")).toBe(true);
    expect(canAccessPanel(org, "users")).toBe(true);
    expect(canAccessPanel(org, "distribution")).toBe(false);
    expect(canUseBulkDdex(org)).toBe(true);
  });

  it("prevents organization members from tenant administration", () => {
    const member = user({
      entityType: "ORGANIZATION",
      entityRole: "MEMBER",
      permissions: ["release.read", "label.read", "entity.read", "user.read"],
    });
    expect(canAccessPanel(member, "entities")).toBe(false);
    expect(canAccessPanel(member, "users")).toBe(false);
    expect(canAccessPanel(member, "channels")).toBe(false);
    expect(canUseBulkDdex(member)).toBe(false);
  });

  it("shows accountants linked read and finance surfaces without management actions", () => {
    const accountant = user({
      entityType: "ORGANIZATION",
      entityRole: "ACCOUNTANT",
      permissions: [
        "release.read",
        "artist.read",
        "label.read",
        "analytics.view",
        "finance.view",
        "finance.export",
      ],
    });

    for (const panel of ["catalog", "artists", "labels", "analytics", "earnings"]) {
      expect(canAccessPanel(accountant, panel)).toBe(true);
    }
    for (const panel of ["channels", "distribution", "entities", "users", "audit-log"]) {
      expect(canAccessPanel(accountant, panel)).toBe(false);
    }
    expect(canUseBulkDdex(accountant)).toBe(false);
    expect(canApproveRelease(accountant, "PENDING_ORG_APPROVAL")).toBe(false);
  });

  it("reserves dispatch for the BeAlpha owner", () => {
    const reviewer = user({
      entityType: "SYSTEM_ADMIN",
      entityRole: "ADMIN",
      permissions: ["release.read", "entity.read", "user.read"],
    });
    const superAdmin = user({
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      permissions: ["release.read", "release.approve"],
    });
    expect(canAccessPanel(reviewer, "distribution")).toBe(false);
    expect(canAccessPanel(reviewer, "playlists")).toBe(false);
    expect(canAccessPanel(superAdmin, "distribution")).toBe(true);
    expect(canAccessPanel(superAdmin, "playlists")).toBe(true);
    expect(canAccessPanel(reviewer, "audit-log")).toBe(true);
    expect(canUseBulkDdex(reviewer)).toBe(true);
  });

  it("enforces both release approval gates", () => {
    const org = user({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      permissions: ["release.approve", "release.submit"],
    });
    const reviewer = user({
      entityType: "SYSTEM_ADMIN",
      entityRole: "ADMIN",
      permissions: ["release.approve"],
    });
    const superAdmin = user({
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      permissions: ["release.approve"],
    });
    expect(canApproveRelease(org, "PENDING_ORG_APPROVAL")).toBe(true);
    expect(canApproveRelease(org, "PENDING_SYS_APPROVAL")).toBe(false);
    expect(canApproveRelease(reviewer, "PENDING_ORG_APPROVAL")).toBe(false);
    expect(canApproveRelease(reviewer, "PENDING_SYS_APPROVAL")).toBe(true);
    expect(canApproveRelease(superAdmin, "PENDING_SUPER_APPROVAL")).toBe(true);
    expect(canApproveRelease(reviewer, "PENDING_SUPER_APPROVAL")).toBe(false);
    expect(canApproveRelease(user(), "PENDING_ORG_APPROVAL")).toBe(false);
  });

  it("keeps reviewer under admin and limited to its approval tier", () => {
    const orgReviewer = user({ entityType: "ORGANIZATION", entityRole: "REVIEWER", permissions: ["release.read", "release.approve", "release.deny"] });
    const rootReviewer = user({ entityType: "SUPER_ADMIN", entityRole: "REVIEWER", permissions: ["release.read", "release.approve", "release.deny"] });
    expect(canApproveRelease(orgReviewer, "PENDING_ORG_APPROVAL")).toBe(true);
    expect(canApproveRelease(orgReviewer, "PENDING_SYS_APPROVAL")).toBe(false);
    expect(canApproveRelease(rootReviewer, "PENDING_SUPER_APPROVAL")).toBe(true);
    expect(canAccessPanel(rootReviewer, "distribution")).toBe(false);
    expect(canAccessPanel(orgReviewer, "users")).toBe(false);
  });

  it("allows creators to submit only editable workflow states", () => {
    expect(canSubmitRelease(user(), "DRAFT")).toBe(true);
    expect(canSubmitRelease(user(), "ORG_REJECTED")).toBe(true);
    expect(canSubmitRelease(user(), "PENDING_ORG_APPROVAL")).toBe(false);
    expect(canSubmitRelease(user({ permissions: ["release.read"] }), "DRAFT")).toBe(false);
  });

  it("keeps catalog mutations with entity managers", () => {
    const member = user({
      entityType: "ORGANIZATION",
      entityRole: "MEMBER",
      permissions: ["artist.create", "artist.update", "artist.delete", "label.create", "label.update", "label.delete", "composition.create", "composition.update"],
    });
    const organizationOwner = user({
      entityType: "ORGANIZATION",
      entityRole: "OWNER",
      permissions: ["artist.create", "artist.update", "artist.delete", "label.create", "label.update", "label.delete", "composition.create", "composition.update"],
    });
    const superAdmin = user({
      entityType: "SUPER_ADMIN",
      entityRole: "OWNER",
      permissions: ["artist.create", "artist.update", "artist.delete", "label.create", "label.update", "label.delete", "composition.create"],
    });

    expect(canManageCatalogRecord(member, "artist", "create")).toBe(false);
    expect(canManageCatalogRecord(member, "label", "update")).toBe(false);
    expect(canManageCatalogRecord(member, "composition", "create")).toBe(false);
    expect(canManageCatalogRecord(organizationOwner, "artist", "create")).toBe(true);
    expect(canManageCatalogRecord(organizationOwner, "label", "delete")).toBe(true);
    expect(canManageCatalogRecord(organizationOwner, "composition", "update")).toBe(true);
    expect(canManageCatalogRecord(superAdmin, "artist", "create")).toBe(false);
    expect(canManageCatalogRecord(superAdmin, "label", "create")).toBe(false);
  });

  it.each([
    ["OWNER", true, true], ["ADMIN", true, true], ["MEMBER", true, false],
    ["REVIEWER", false, false], ["ACCOUNTANT", false, false], ["UNKNOWN", false, false],
  ])("matches catalog release actions for organization %s", (entityRole, edit, remove) => {
    const actor = user({ entityType: "ORGANIZATION", entityRole: entityRole as string, permissions: ["release.create", "release.update", "release.delete", "release.submit"] });
    expect(canManageRelease(actor, "create")).toBe(edit);
    expect(canManageRelease(actor, "update")).toBe(edit);
    expect(canManageRelease(actor, "submit")).toBe(edit);
    expect(canManageRelease(actor, "delete")).toBe(remove);
  });

  it.each(["OWNER", "ADMIN", "MEMBER", "REVIEWER", "ACCOUNTANT"])("matches current Artist release API for %s", entityRole => {
    const actor = user({ entityRole, permissions: ["release.create", "release.update", "release.delete", "release.submit"] });
    for (const action of ["create", "update", "submit", "delete"] as const) {
      expect(canManageRelease(actor, action)).toBe(entityRole === "OWNER");
    }
  });

  it("requires the specific release action permission even for managers", () => {
    const actor = user({ entityType: "ORGANIZATION", permissions: ["release.submit"] });
    expect(canManageRelease(actor, "submit")).toBe(true);
    for (const action of ["create", "update", "delete"] as const) expect(canManageRelease(actor, action)).toBe(false);
  });
});
