import { expect, test, type Page } from "@playwright/test";

type RoleFixture = {
  entityType: "SUPER_ADMIN" | "SYSTEM_ADMIN" | "ORGANIZATION" | "SUB_ACCOUNT";
  entityRole: "OWNER" | "ADMIN" | "ACCOUNTANT";
  title: string;
  primaryAction: string;
  canAccessDistribution: boolean;
};

const roles: RoleFixture[] = [
  {
    entityType: "SUB_ACCOUNT",
    entityRole: "OWNER",
    title: "Complete your next release",
    primaryAction: "Open releases",
    canAccessDistribution: false,
  },
  {
    entityType: "ORGANIZATION",
    entityRole: "OWNER",
    title: "Organization release operations",
    primaryAction: "Open releases",
    canAccessDistribution: false,
  },
  {
    entityType: "SYSTEM_ADMIN",
    entityRole: "ADMIN",
    title: "Platform review queue",
    primaryAction: "Open releases",
    canAccessDistribution: false,
  },
  {
    entityType: "SUPER_ADMIN",
    entityRole: "OWNER",
    title: "Distribution operations",
    primaryAction: "Open distribution",
    canAccessDistribution: true,
  },
  {
    entityType: "ORGANIZATION",
    entityRole: "ACCOUNTANT",
    title: "Royalty reconciliation",
    primaryAction: "Open earnings",
    canAccessDistribution: false,
  },
];

async function mockPlatform(page: Page, role: RoleFixture) {
  await page.route("**/api/v1/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const membership = {
      entityId: "11111111-1111-4111-8111-111111111111",
      entityType: role.entityType,
      entityRole: role.entityRole,
      entityName: `${role.entityType} workspace`,
      entityPath: "root.system.organization.account",
      tenantId:
        role.entityType === "SUPER_ADMIN"
          ? null
          : "22222222-2222-4222-8222-222222222222",
    };

    let data: unknown = [];
    if (pathname === "/api/v1/auth/refresh") {
      data = { accessToken: "e2e-token", expiresIn: 300, user: {} };
    } else if (pathname === "/api/v1/auth/profile") {
      data = {
        id: "33333333-3333-4333-8333-333333333333",
        email: "operator@example.test",
        name: "Workflow Operator",
        stageName: null,
        phone: null,
        avatar: null,
        twoFactorEnabled: true,
        language: "en",
        timezone: "Asia/Ho_Chi_Minh",
        currency: "USD",
        theme: "dark",
        notifyReleases: true,
        notifyRoyalties: true,
        notifyNews: false,
        notifyMarketing: false,
        staffRoles: [],
        createdAt: "2026-08-22T00:00:00.000Z",
        updatedAt: "2026-08-22T00:00:00.000Z",
        membership,
      };
    } else if (pathname === "/api/v1/catalog/tenant-brand") {
      data = {
        tenantId: membership.tenantId ?? "00000000-0000-4000-8000-000000000000",
        displayName: "BeAlpha Music",
        logoAssetId: null,
        logoUrl: null,
        accentColor: "#3B82F6",
        accentTextColor: "#FFFFFF",
        supportEmail: null,
        supportUrl: null,
        defaultLocale: "en",
        version: 1,
      };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ data, error: null, requestId: "e2e-request" }),
    });
  });
}

test.describe("role-first workbench", () => {
  test("BeAlpha creates a direct Label without sending the Distributor tier", async ({ page }) => {
    await mockPlatform(page, roles[2]);
    await page.route("**/api/v1/catalog/entities", async route => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ status: 201, json: { data: { id: "22222222-2222-4222-8222-222222222222" }, error: null, requestId: "fixture" } });
    });
    await page.goto("/?panel=entities");
    await page.getByRole("button", { name: "Create Direct Unit", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: /^Managed label/ }).click();
    await expect(dialog.getByRole("button", { name: /^Managed label/ })).toHaveAttribute("aria-pressed", "true");
    await dialog.getByLabel("Official Name").fill("Direct Label");
    const sent = page.waitForRequest(request => request.url().endsWith("/api/v1/catalog/entities") && request.method() === "POST");
    await dialog.getByRole("button", { name: "Create Direct Unit", exact: true }).click();
    expect((await sent).postDataJSON()).toMatchObject({
      parentId: "11111111-1111-4111-8111-111111111111", entityType: "ORGANIZATION", businessTier: "LABEL", officialName: "Direct Label",
    });
  });

  for (const role of roles) {
    test(`${role.entityType} ${role.entityRole} sees its workflow responsibility`, async ({ page }) => {
      await mockPlatform(page, role);
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto("/");

      await expect(page.getByRole("heading", { level: 1, name: role.title })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Needs action" })).toBeVisible();
      await expect(page.getByRole("button", { name: role.primaryAction, exact: true })).toBeVisible();

      const distributionNav = page.getByRole("button", { name: "Distribution", exact: true });
      if (role.canAccessDistribution) await expect(distributionNav).toBeVisible();
      else await expect(distributionNav).toHaveCount(0);
    });
  }

  test("BeAlpha owner sees manual packages instead of automated DSP delivery controls", async ({ page }) => {
    await mockPlatform(page, roles[3]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?panel=distribution");
    await expect(page.getByRole("heading", { name: "Manual delivery packages" })).toBeVisible();
    await expect(page.getByText("Automated DSP and VEVO delivery is disabled")).toBeVisible();
    await expect(page.getByRole("button", { name: /deliver/i })).toHaveCount(0);
  });

  test("organization form keeps focus while typing", async ({ page }) => {
    await mockPlatform(page, roles[2]);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/?panel=entities");

    await expect(page.getByRole("heading", { name: "Organization Structure" })).toBeVisible();
    await page.getByRole("button", { name: "Create Direct Unit" }).click();
    const name = page.getByLabel("Official Name");
    await name.pressSequentially("Acme Records", { delay: 10 });

    await expect(name).toHaveValue("Acme Records");
    await expect(name).toBeFocused();
    await expect(page.getByRole("button", { name: "Close dialog" })).not.toBeFocused();
  });

  for (const width of [320, 375, 414, 768]) {
    test(`organization workflow has no page overflow at ${width}px`, async ({ page }) => {
      await mockPlatform(page, roles[1]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto("/");
      await expect(page.getByRole("heading", { level: 1, name: roles[1].title })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Needs action" })).toBeVisible();

      const overflow = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        content: document.documentElement.scrollWidth,
      }));
      expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
      await expect(page.getByRole("button", { name: "Open releases", exact: true })).toBeVisible();
    });
  }
});
