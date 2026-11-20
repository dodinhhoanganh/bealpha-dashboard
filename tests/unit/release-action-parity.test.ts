import fs from "node:fs";
import path from "node:path";
import { canSubmitRelease as currentCanSubmitRelease } from "@/lib/ui-capabilities";
import type { UserSession } from "@/lib/types";

const identity = (entityType: string, entityRole: string): Pick<UserSession, "entityType" | "entityRole" | "permissions"> => ({
  entityType, entityRole, permissions: ["release.create", "release.update", "release.delete", "release.submit"],
});

const canSubmitRelease = process.env.RELEASE_CAPABILITIES_TEST_SOURCE
  ? jest.requireActual<{ canSubmitRelease: typeof currentCanSubmitRelease }>(process.env.RELEASE_CAPABILITIES_TEST_SOURCE).canSubmitRelease
  : currentCanSubmitRelease;

function panelSource(relative: string): string {
  const file = process.env.RELEASE_PANEL_TEST_ROOT
    ? path.join(process.env.RELEASE_PANEL_TEST_ROOT, path.basename(relative))
    : path.join(process.cwd(), relative);
  return fs.readFileSync(file, "utf8");
}

describe("release action API parity", () => {
  it.each(["REVIEWER", "ACCOUNTANT"])("hides submit for %s even with stale permissions", role => {
    expect(canSubmitRelease(identity("ORGANIZATION", role), "DRAFT")).toBe(false);
  });

  it.each(["ADMIN", "MEMBER"])("matches current SUB_ACCOUNT submit API for %s", role => {
    expect(canSubmitRelease(identity("SUB_ACCOUNT", role), "DRAFT")).toBe(false);
  });

  it("keeps permitted owners/operators and submit-only permission", () => {
    expect(canSubmitRelease(identity("SUB_ACCOUNT", "OWNER"), "DRAFT")).toBe(true);
    expect(canSubmitRelease({ ...identity("ORGANIZATION", "MEMBER"), permissions: ["release.submit"] }, "SYS_REJECTED")).toBe(true);
    expect(canSubmitRelease({ ...identity("ORGANIZATION", "OWNER"), permissions: ["release.update"] }, "DRAFT")).toBe(false);
  });

  it("uses the same submit gate for audio and VEVO, not update permission", () => {
    const source = panelSource("components/vevo/VevoCatalogPanel.tsx");
    expect(source).toContain("{canSubmitRelease(user, release.status) && (");
    expect(source).not.toContain("canUpdate && canSubmitVevoRelease");
  });

  it.each(["components/releases/ReleasesPanel.tsx", "components/vevo/VevoCatalogPanel.tsx"])("wires create/edit/delete to shared role gates: %s", file => {
    const source = panelSource(file);
    expect(source).toContain('const canCreate = canManageRelease(user, "create");');
    expect(source).toContain('const canUpdate = canManageRelease(user, "update");');
    expect(source).toContain('const canDelete = canManageRelease(user, "delete");');
  });
});
