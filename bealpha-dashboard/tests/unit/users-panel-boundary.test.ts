import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("UsersPanel domain boundary", () => {
  const source = readFileSync(resolve(process.cwd(), "components/entities/UsersPanel.tsx"), "utf8");

  it("assigns users to existing entities without creating catalog structure", () => {
    expect(source).toContain('apiRequest<BusinessEntity[]>("/api/v1/catalog/entities")');
    expect(source).not.toMatch(/apiRequest[^;]*\/api\/v1\/catalog\/entities[^;]*method:\s*["']POST["']/s);
    expect(source).not.toContain("entityMode");
  });

  it("keeps catalog concepts out of the access-role catalog", () => {
    expect(source).toContain('const ENTITY_ROLES: readonly EntityRole[] = ["OWNER", "ADMIN", "REVIEWER", "ACCOUNTANT", "MEMBER"]');
    expect(source).not.toMatch(/id:\s*["'](?:distributor|label|artist)["']/i);
    expect(source).not.toContain("requiresOwnerMembership");
    expect(source).toContain("entityRole: current.entityRole");
    expect(source).not.toContain("includeSubAccounts");
  });
});
