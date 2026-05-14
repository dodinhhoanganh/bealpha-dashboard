/**
 * E2E test — Login flow
 */
import { test, expect } from "@playwright/test";

test.describe("Login Page", () => {
  test("should display login form", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("input[type='email'], input[name='email']")).toBeVisible();
    await expect(page.locator("input[type='password']")).toBeVisible();
    await expect(page.getByRole("button", { name: /sign in|login|log in/i })).toBeVisible();
  });

  test("should show error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[name='email']", "wrong@example.com");
    await page.fill("input[type='password']", "wrongpassword");
    await page.getByRole("button", { name: /sign in|login|log in/i }).click();

    // Should show error message
    await expect(page.locator("text=/invalid|incorrect|error|failed/i")).toBeVisible({
      timeout: 5000,
    });
  });

  test("should redirect to login when accessing protected page unauthenticated", async ({
    page,
  }) => {
    await page.goto("/");
    // Proxy should redirect to /login
    await expect(page).toHaveURL(/\/login/);
  });

  test("should login successfully with valid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.fill("input[type='email'], input[name='email']", "admin@bealpha.com");
    await page.fill("input[type='password']", "admin123");
    await page.getByRole("button", { name: /sign in|login|log in/i }).click();

    // Should redirect to dashboard
    await page.waitForURL("/", { timeout: 10000 });
    // Dashboard should be visible
    await expect(page.locator("text=/dashboard|overview/i")).toBeVisible({
      timeout: 10000,
    });
  });
});
