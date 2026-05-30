/**
 * Playwright global setup: logs in as admin and saves session storage.
 *
 * This runs once before the test suite. All tests in e2e/ reuse the session
 * via storageState so no extra sign-in round-trips occur per test.
 *
 * Env vars:
 *   E2E_ADMIN_EMAIL     — admin user email (must exist in local Supabase)
 *   E2E_ADMIN_PASSWORD  — admin user password
 */

import { test as setup, expect } from "@playwright/test";
import * as path from "path";

export const authFile = path.join(__dirname, ".auth/admin.json");

setup("authenticate as admin", async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL ?? "admin@quiz4win.local";
  const password = process.env.E2E_ADMIN_PASSWORD ?? "changeme";

  await page.goto("/login");

  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password/i).fill(password);
  await page.getByRole("button", { name: /sign in|log in/i }).click();

  // Wait until we land on the dashboard (redirect after successful login).
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
  await expect(page).toHaveURL(/dashboard/);

  // Save auth state for reuse in tests.
  await page.context().storageState({ path: authFile });
});
