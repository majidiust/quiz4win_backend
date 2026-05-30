/**
 * Playwright E2E configuration for the Quiz4Win admin panel.
 *
 * Prerequisites:
 *   cd admin && npm install -D @playwright/test
 *   npx playwright install chromium
 *
 * Run:
 *   cd admin && npx playwright test
 *   cd admin && npx playwright test --ui            (interactive)
 *   cd admin && npx playwright test e2e/templates   (templates only)
 *
 * The tests assume the admin panel is running locally at ADMIN_BASE_URL
 * (default: http://localhost:3000) with a valid Supabase local stack
 * (supabase start).
 *
 * Authentication: set E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD in .env.test.local
 * so Playwright can log in before each test suite.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,           // serial to avoid template name collisions
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: process.env.ADMIN_BASE_URL ?? "http://localhost:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    // Setup: authenticate once and save session to .auth/admin.json
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: "e2e/.auth/admin.json",
      },
      dependencies: ["setup"],
    },
  ],
});
