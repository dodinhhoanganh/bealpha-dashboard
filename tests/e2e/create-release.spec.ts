/**
 * E2E test — Create Release flow
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

test.describe("Create Release", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("should navigate to releases panel", async ({ page }) => {
    // Click on Products/Releases in sidebar
    await page.locator("text=/products|releases/i").first().click();
    await expect(page.locator("text=/releases/i")).toBeVisible();
  });

  test("should open create release form", async ({ page }) => {
    // Navigate to releases
    await page.locator("text=/products|releases/i").first().click();
    
    // Click add/create button
    await page.getByRole("button", { name: /add|create|new/i }).first().click();

    // Form should appear
    await expect(
      page.locator("input[name='title'], input[placeholder*='title' i]")
    ).toBeVisible({ timeout: 5000 });
  });

  test("should validate required fields", async ({ page }) => {
    // Navigate to releases
    await page.locator("text=/products|releases/i").first().click();
    await page.getByRole("button", { name: /add|create|new/i }).first().click();

    // Try to submit empty form
    await page.getByRole("button", { name: /save|submit|create/i }).first().click();

    // Should show validation errors
    await expect(page.locator("text=/required|must|cannot be empty/i")).toBeVisible({
      timeout: 5000,
    });
  });
});
