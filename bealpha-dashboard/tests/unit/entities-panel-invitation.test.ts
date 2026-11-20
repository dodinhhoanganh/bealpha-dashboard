import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("EntitiesPanel invitation boundary", () => {
  const source = readFileSync(resolve(process.cwd(), "components/entities/EntitiesPanel.tsx"), "utf8");

  it("invites the owner first and exposes team access only after onboarding", () => {
    expect(source).toContain('role: ownerOnboarding ? "OWNER" : inviteRole');
    expect(source).toContain('membership.role === "OWNER"');
    expect(source).toContain('value={inviteRole}');
    expect(source).toContain("businessTitle: inviteBusinessTitle.trim()");
    expect(source).toContain('t("users.jobTitle"');
    expect(source).toContain('email: inviteEmail.trim()');
    expect(source).toContain('detailEntity.entityType === "SUB_ACCOUNT"');
  });

  it("explains owner onboarding without a single-person restriction", () => {
    expect(source).toContain("entities.organizationOwnerInviteHelp");
    expect(source).not.toContain("entities.subAccountOwnerInviteHelp");
  });

  it("assigns labels before onboarding a client-account owner", () => {
    expect(source).toContain("/api/v1/catalog/entities/${encodeURIComponent(id)}/label-access");
    expect(source).toContain("body: JSON.stringify({ labelIds: assignedLabelIds })");
    expect(source).toContain("entities.assignLabelBeforeInvite");
    expect(source).toContain('type="checkbox" checked={checked}');
  });
});
