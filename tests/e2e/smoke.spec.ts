/**
 * E2E smoke — verifies the dev server boots and the placeholder renders.
 * Real flow specs will land alongside the shell.
 */

import { test, expect } from '@playwright/test';

test('atlas placeholder boots', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.atlas-placeholder h1')).toHaveText('atlas');
  await expect(page.locator('.atlas-placeholder')).toContainText('folder-first rebuild');
});
