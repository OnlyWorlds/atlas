/**
 * E2E smoke — verifies the dev server boots and the app shell renders.
 */

import { test, expect } from '@playwright/test';

test('atlas shell boots with sidebar and middle pane', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.atlas-shell')).toBeVisible();
  await expect(page.locator('.atlas-middle')).toBeVisible();
  // Pre-setup the splash is a bare stage (S297 v2.1): the sidebar exists but
  // stays hidden until an atlas root or world exists.
  await expect(page.locator('.atlas-landing')).toBeVisible();
  await expect(page.locator('.atlas-sidebar')).toBeHidden();
});
