/**
 * E2E test — DDEX Export flow
 */
import { test, expect } from "@playwright/test";

// Login helper
async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.fill("input[type='email'], input[name='email']", "admin@bealpha.com");
  await page.fill("input[type='password']", "admin123");
  await page.getByRole("button", { name: /sign in|login|log in/i }).click();
  await page.waitForURL("/", { timeout: 10000 });
}

test.describe("DDEX Export", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should show distribution panel", async ({ page }) => {
    // Click on Distribution in sidebar
    await page.locator("text=/distribution/i").first().click();
    await expect(page.locator("text=/ddex|distribution|deliver/i")).toBeVisible({
      timeout: 5000,
    });
  });

  test("should display DDEX delivery options", async ({ page }) => {
    await page.locator("text=/distribution/i").first().click();

    // Should see DDEX-related buttons or options
    await expect(
      page.locator("text=/generate|validate|deliver|export/i")
    ).toBeVisible({ timeout: 5000 });
  });
});
