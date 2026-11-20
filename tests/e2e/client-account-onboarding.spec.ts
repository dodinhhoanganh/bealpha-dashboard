import { expect, test, type Page } from "@playwright/test";

const orgId = "11111111-1111-4111-8111-111111111111";
const firstId = "22222222-2222-4222-8222-222222222222";
const secondId = "33333333-3333-4333-8333-333333333333";
const labelId = "44444444-4444-4444-8444-444444444444";

async function setup(page: Page, options: { saveFails?: boolean; slowFirst?: boolean; level?: number; theme?: string; existingOwner?: boolean } = {}) {
  let saved: string[] = options.existingOwner ? [labelId] : [];
  const writes: string[][] = [];
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let data: unknown = [];
    if (path === "/api/v1/auth/refresh") data = { accessToken: "fixture-token", expiresIn: 900, user: {} };
    if (path === "/api/v1/auth/profile") data = {
      id: orgId, email: "owner@example.test", name: "Test owner", staffRoles: [], language: "en", theme: options.theme ?? "dark",
      membership: { entityId: orgId, entityType: "ORGANIZATION", entityRole: "OWNER", entityName: "Meridian Distribution", entityPath: "root.ops.distributor", tenantId: orgId },
    };
    if (path === "/api/v1/catalog/entities") data = [
      { id: orgId, officialName: "Meridian Distribution", entityType: "ORGANIZATION", parentId: "ops", path: "root.ops.distributor", businessLevel: options.level ?? 2 },
      { id: firstId, officialName: "Artist One", entityType: "SUB_ACCOUNT", parentId: orgId, path: "root.ops.distributor.one", businessLevel: 3 },
      { id: secondId, officialName: "Artist Two", entityType: "SUB_ACCOUNT", parentId: orgId, path: "root.ops.distributor.two", businessLevel: 3 },
    ];
    if (path === "/api/v1/identity/users") {
      if (options.slowFirst && url.searchParams.get("entityId") === firstId) await new Promise((resolve) => setTimeout(resolve, 800));
      data = options.existingOwner ? { users: [{ id: "owner-user", name: "Artist Owner", email: "owner@example.test", membership: { id: "membership", entityRole: "OWNER" } }], total: 1 } : { users: [], total: 0 };
    }
    if (path === "/api/v1/identity/invitations") data = { invitations: [] };
    if (path === "/api/v1/catalog/labels") data = [{ id: labelId, name: "Meridian Records" }];
    if (path.endsWith("/label-access")) {
      if (route.request().method() === "PUT") {
        writes.push(route.request().postDataJSON().labelIds);
        if (options.saveFails) return route.fulfill({ status: 503, json: { data: null, error: { code: "SERVICE_UNAVAILABLE", message: "Test failure" }, requestId: "test" } });
        saved = route.request().postDataJSON().labelIds;
      }
      data = { subAccountId: path.split("/").at(-2), labelIds: saved };
    }
    await route.fulfill({ status: 200, json: { data, error: null, requestId: "test" } });
  });
  await page.goto("/?panel=entities");
  await page.getByPlaceholder("Search organizations or accounts...").fill("Artist");
  return writes;
}

async function openInvite(page: Page) {
  await page.getByRole("button", { name: "Artist One", exact: false }).click();
  await page.getByRole("button", { name: /^\+ Invite$/ }).click();
  await page.getByLabel("Email Address", { exact: true }).fill("artist@example.test");
  await page.getByLabel("Job title", { exact: true }).fill("Artist");
}

test("owner invitation waits until label grants are saved", async ({ page }) => {
  const writes = await setup(page);
  await openInvite(page);
  const send = page.getByRole("button", { name: "Send Invitation", exact: true });
  await expect(send).toBeDisabled();
  await page.getByRole("checkbox", { name: "Meridian Records" }).check();
  await expect(send).toBeDisabled();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(send).toBeEnabled();
  expect(writes).toEqual([[labelId]]);
});

test("an existing Artist owner does not prevent inviting an accountant", async ({ page }) => {
  await setup(page, { existingOwner: true });
  await page.route("**/api/v1/identity/invitations", async route => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fulfill({ status: 201, json: { data: { id: "invite" }, error: null, requestId: "fixture" } });
  });
  await openInvite(page);
  await page.getByLabel("Access level", { exact: true }).selectOption("ACCOUNTANT");
  const request = page.waitForRequest(req => req.url().endsWith("/api/v1/identity/invitations") && req.method() === "POST");
  await page.getByRole("button", { name: "Send Invitation", exact: true }).click();
  expect((await request).postDataJSON()).toMatchObject({ entityId: firstId, role: "ACCOUNTANT", email: "artist@example.test" });
});

test("failed label save does not unlock invitation", async ({ page }) => {
  await setup(page, { saveFails: true });
  await openInvite(page);
  await page.getByRole("checkbox", { name: "Meridian Records" }).check();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByRole("alert").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Send Invitation", exact: true })).toBeDisabled();
});

test("slow earlier account response does not replace the latest selection", async ({ page }) => {
  await setup(page, { slowFirst: true });
  await page.getByRole("button", { name: "Artist One", exact: false }).click();
  await page.getByRole("button", { name: "Artist Two", exact: false }).click();
  await expect(page.getByRole("heading", { name: "Artist Two", exact: true })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.getByRole("heading", { name: "Artist Two", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Artist One", exact: true })).toHaveCount(0);
});

test("level-three label business can create only a client account", async ({ page }) => {
  await setup(page, { level: 3 });
  await page.getByRole("button", { name: "Create Direct Unit", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Client Account");
  await expect(page.getByRole("dialog").getByRole("button", { name: "Managed label" })).toHaveCount(0);
});

for (const theme of ["light", "dark"]) {
  for (const width of [320, 375, 414, 768]) {
    test(`client account setup fits ${width}px in ${theme} mode`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await setup(page, { theme });
      await page.getByRole("button", { name: "Artist One", exact: false }).click();
      await expect(page.getByRole("checkbox", { name: "Meridian Records" })).toBeVisible();
      const dimensions = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
      expect(dimensions[0]).toBeLessThanOrEqual(dimensions[1]);
    });
  }
}
