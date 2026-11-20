import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("UsersPanel membership boundary", () => {
  const source = readFileSync(resolve(process.cwd(), "components/entities/UsersPanel.tsx"), "utf8");

  it("allows Artist team roles without forcing OWNER", () => {
    expect(source).not.toContain('requiresOwnerMembership');
    expect(source).toContain('const entityRole: EntityRole = createData.entityRole');

    expect(source).toContain('renderEntityOptions()');
    expect(source).toContain('businessTitle: createData.businessTitle.trim()');
    expect(source).toContain('/business-title`');
  });

  it("keeps editable role selection for existing users and platform staff controls", () => {
    expect(source).toContain('value={createData.entityRole}');
    expect(source).toContain('selectedCreateEntity?.entityType === "SYSTEM_ADMIN"');
    expect(source).toContain('selectedEditEntityType === "SYSTEM_ADMIN"');
    expect(source).toContain('renderStaffRoles("create", createData.staffRoles)');
    expect(source).toContain('renderStaffRoles("edit", editData.staffRoles)');
  });
});
