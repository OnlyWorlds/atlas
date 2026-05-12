/**
 * E2E smoke — verifies the dev server boots and the app shell renders.
 */

import { test, expect } from '@playwright/test';

test('atlas shell boots with sidebar and middle pane', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.atlas-shell')).toBeVisible();
  await expect(page.locator('.atlas-sidebar')).toBeVisible();
  await expect(page.locator('.atlas-middle')).toBeVisible();
});
