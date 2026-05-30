/**
 * E2E smoke test: Game Templates admin UI
 *
 * Covers:
 *   - List page renders without error
 *   - Create template dialog — fill form, submit, redirect to detail
 *   - Detail page shows correct fields
 *   - Edit page — change name, save, verify update on detail page
 *   - Activate / Deactivate actions
 *   - Generate Now action (overlap guard accepted)
 *   - Delete template
 *
 * Run:
 *   cd admin && npx playwright test e2e/templates.spec.ts
 */

import { test, expect, type Page } from "@playwright/test";
import { authFile } from "./auth.setup";

// Unique prefix per test run to avoid naming collisions.
const RUN = Date.now().toString(36).toUpperCase();
const TPL_NAME = `E2E-Template-${RUN}`;
const TPL_NAME_UPDATED = `${TPL_NAME}-Updated`;

test.use({ storageState: authFile });

// ---------------------------------------------------------------------------
// Helper: navigate to templates list
// ---------------------------------------------------------------------------
async function gotoTemplates(page: Page) {
  await page.goto("/templates");
  await page.waitForLoadState("networkidle");
}

// ---------------------------------------------------------------------------
// 1. List page
// ---------------------------------------------------------------------------
test("templates list page loads", async ({ page }) => {
  await gotoTemplates(page);
  await expect(page.getByRole("heading", { name: /game templates/i })).toBeVisible();
});

// ---------------------------------------------------------------------------
// 2. Create template
// ---------------------------------------------------------------------------
test("create a new template", async ({ page }) => {
  await gotoTemplates(page);

  // Open the create dialog
  await page.getByRole("button", { name: /new template|create template/i }).click();
  await expect(page.getByRole("dialog")).toBeVisible();

  // Fill the minimum required fields
  await page.getByLabel(/name/i).fill(TPL_NAME);

  // Cron preset — select a predefined preset to ensure valid cron is set
  const presetSelect = page.locator("[data-testid='cron-preset'], select").first();
  if (await presetSelect.isVisible()) {
    await presetSelect.selectOption({ index: 1 });
  }

  // Submit
  await page.getByRole("button", { name: /create|save/i }).last().click();

  // After create, we should be redirected to the detail page
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}/, { timeout: 15_000 });
  await expect(page.getByText(TPL_NAME)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3. Detail page fields
// ---------------------------------------------------------------------------
test("template detail page shows schedule and status", async ({ page }) => {
  await gotoTemplates(page);

  // Find the row for our template and click through
  await page.getByText(TPL_NAME).first().click();
  await page.waitForLoadState("networkidle");

  // Detail page should show cron expression and Inactive badge
  await expect(page.getByText(/inactive/i)).toBeVisible();
  await expect(page.getByText(/cron/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. Edit template
// ---------------------------------------------------------------------------
test("edit template — change name and save", async ({ page }) => {
  await gotoTemplates(page);
  await page.getByText(TPL_NAME).first().click();
  await page.waitForLoadState("networkidle");

  // Click Edit button
  await page.getByRole("link", { name: /edit/i }).click();
  await page.waitForURL(/\/edit$/, { timeout: 10_000 });

  // Clear the name field and type a new one
  const nameInput = page.getByLabel(/name/i).first();
  await nameInput.clear();
  await nameInput.fill(TPL_NAME_UPDATED);

  // Save
  await page.getByRole("button", { name: /save changes/i }).click();

  // Redirected back to detail with updated name
  await page.waitForURL(/\/templates\/[0-9a-f-]{36}$/, { timeout: 10_000 });
  await expect(page.getByText(TPL_NAME_UPDATED)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 5. Activate / Deactivate
// ---------------------------------------------------------------------------
test("activate then deactivate a template", async ({ page }) => {
  await gotoTemplates(page);
  await page.getByText(TPL_NAME_UPDATED).first().click();
  await page.waitForLoadState("networkidle");

  // Activate
  await page.getByRole("button", { name: /activate/i }).click();
  await expect(page.getByText(/active/i)).toBeVisible({ timeout: 8_000 });

  // Deactivate
  await page.getByRole("button", { name: /deactivate/i }).click();
  await expect(page.getByText(/inactive/i)).toBeVisible({ timeout: 8_000 });
});

// ---------------------------------------------------------------------------
// 6. Generate Now
// ---------------------------------------------------------------------------
test("generate-now creates a game linked to the template", async ({ page }) => {
  await gotoTemplates(page);
  await page.getByText(TPL_NAME_UPDATED).first().click();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /generate now/i }).click();

  // Confirm skip-overlap dialog if it appears
  const skipBtn = page.getByRole("button", { name: /skip.*overlap|generate anyway/i });
  if (await skipBtn.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await skipBtn.click();
  }

  // A success toast or updated "Generated games" count should appear
  await expect(
    page.getByText(/game generated|generated successfully/i).or(page.getByText(/generated games.*1/i))
  ).toBeVisible({ timeout: 15_000 });
});

// ---------------------------------------------------------------------------
// 7. Delete template
// ---------------------------------------------------------------------------
test("delete template removes it from the list", async ({ page }) => {
  await gotoTemplates(page);
  await page.getByText(TPL_NAME_UPDATED).first().click();
  await page.waitForLoadState("networkidle");

  await page.getByRole("button", { name: /delete/i }).click();

  // Confirm in the alert dialog
  await page.getByRole("button", { name: /confirm|yes.*delete/i }).click();

  // Redirected to list, template no longer visible
  await page.waitForURL(/\/templates$/, { timeout: 10_000 });
  await expect(page.getByText(TPL_NAME_UPDATED)).not.toBeVisible();
});
