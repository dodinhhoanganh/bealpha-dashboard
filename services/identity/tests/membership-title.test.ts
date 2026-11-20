import { describe, expect, it, vi } from "vitest";
import { PrismaIdentityStore } from "../src/store.js";

describe("membership title authorization snapshot", () => {
  it.each([
    { entityId: "moved", entityRole: "MEMBER" },
    { entityId: "authorized", entityRole: "OWNER" },
  ])("does not update a changed target $entityId/$entityRole", async current => {
    let title = "Original title";
    const updateMany = vi.fn(async ({ where, data }: { where: { userId: string; entityId?: string; entityRole?: string }; data: { businessTitle: string } }) => {
      const matches = (where.entityId === undefined || where.entityId === current.entityId) && (where.entityRole === undefined || where.entityRole === current.entityRole);
      if (matches) title = data.businessTitle;
      return { count: matches ? 1 : 0 };
    });
    const store = new PrismaIdentityStore({ membership: { updateMany } } as never);
    await expect(store.updateMembershipBusinessTitle("target", "CFO", { entityId: "authorized", entityRole: "MEMBER" })).resolves.toBe(false);
    expect(title).toBe("Original title");
  });

  it("atomically includes authorized entity and role without changing permissions", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const store = new PrismaIdentityStore({ membership: { updateMany } } as never);
    await expect(store.updateMembershipBusinessTitle("target", "CFO", { entityId: "authorized", entityRole: "MEMBER" })).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({ where: { userId: "target", entityId: "authorized", entityRole: "MEMBER" }, data: { businessTitle: "CFO" } });
  });
});
