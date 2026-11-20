import {
  childEntityOptions,
  entityTypeLabel,
  relationshipLabel,
  roleLabel,
} from "@/lib/entity-management";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("entity management language and hierarchy", () => {
  const t = (key: string, fallback?: string) => fallback ?? key;
  it("offers every lower business tier without confusing shared entity types", () => {
    const options = childEntityOptions("SYSTEM_ADMIN", t, 1);
    expect(options.map(option => option.businessTier)).toEqual(["DISTRIBUTOR", "LABEL", "ARTIST"]);
    expect(options.map(option => option.type)).toEqual(["ORGANIZATION", "ORGANIZATION", "SUB_ACCOUNT"]);
    expect(childEntityOptions("ORGANIZATION", t, 2).map(option => option.businessTier)).toEqual(["LABEL", "ARTIST"]);
    expect(childEntityOptions("ORGANIZATION", t, 3).map(option => option.businessTier)).toEqual(["ARTIST"]);
    expect(childEntityOptions("SUB_ACCOUNT", t, 4)).toEqual([]);
  });

  it("keeps business structure separate from user access roles", () => {
    expect(entityTypeLabel("SUPER_ADMIN", t)).toBe("BeAlpha Platform Owner");
    expect(entityTypeLabel("SYSTEM_ADMIN", t)).toBe("BeAlpha Operations Team");
    expect(entityTypeLabel("ORGANIZATION", t)).toBe("Customer Organization");
    expect(entityTypeLabel("SUB_ACCOUNT", t)).toBe("Client Account");
    expect(roleLabel("OWNER", t)).toBe("Owner");
    expect(roleLabel("REVIEWER", t)).toBe("Release Reviewer");
  });

  it("permits only lower business levels inside the four-level limit", () => {
    expect(childEntityOptions("ORGANIZATION", t, 2).map((item) => item.type)).toEqual([
      "ORGANIZATION",
      "SUB_ACCOUNT",
    ]);
    expect(childEntityOptions("SUB_ACCOUNT", t, 4)).toEqual([]);
    expect(childEntityOptions("ORGANIZATION", t, 3).map((item) => item.type)).toEqual(["SUB_ACCOUNT"]);
    expect(childEntityOptions("ORGANIZATION", t, 4)).toEqual([]);
    expect(childEntityOptions("ORGANIZATION", t)).toEqual([]);
    expect(childEntityOptions("ORGANIZATION", t, null)).toEqual([]);
    expect(relationshipLabel("ORGANIZATION", "ORGANIZATION", t)).toBe("Nested organization");
  });

  it("shows hierarchy levels relative to the visible organization tree", () => {
    const source = readFileSync(resolve(process.cwd(), "components/entities/EntityTreeView.tsx"), "utf8");
    expect(source).toContain("renderNode(child, depth + 1)");
    expect(source).toContain("renderNode(node, 1)");
    expect(source).toContain("aria-level={depth}");
    expect(source).not.toContain("hierarchyDepth");
  });
});
