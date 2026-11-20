import { defineConfig, devices } from "@playwright/test";

const localPort = process.env.PLAYWRIGHT_PORT || "3100";
const baseURL = process.env.PLAYWRIGHT_BASE_URL || `http://127.0.0.1:${localPort}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // A single worker keeps Next dev-server startup deterministic on Windows CI/dev hosts.
  workers: 1,
  reporter: process.env.CI ? "github" : "html",
  timeout: 30_000,

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        ...(process.env.PLAYWRIGHT_CHANNEL
          ? { channel: process.env.PLAYWRIGHT_CHANNEL }
          : {}),
      },
    },
  ],

  /* Local E2E must not depend on a pre-existing production build. */
  webServer: process.env.CI || process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: `node ./node_modules/next/dist/bin/next dev -H 127.0.0.1 -p ${localPort}`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 120_000,
      },
});
