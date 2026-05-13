/**
 * Phase 3 — Link Existing API World UI surface.
 *
 * Verifies that the `+ link api` button + modal layout are wired up. The
 * actual network-driven link flow runs against the real OW API in Captain's
 * manual smoke (Bout I); browser-side MSW interception would need a service
 * worker installation that's deferred.
 *
 * Covered here:
 *   - `+ link api` button appears when an atlas root is set, not before.
 *   - Modal opens with the right fields (api-key, pin, display-name).
 *   - PIN field is pre-filled from `registry.pin` when set in settings.
 *   - Cancel button closes the modal cleanly.
 *   - Escape key closes the modal cleanly.
 *   - Submitting empty fields shows a validation error inline.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    await (window as any).__atlasTestApi.resetAll();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupAtlasRoot(page: Page, dirName: string = 'link-api-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('+ link api button is hidden until atlas root is configured', async ({ page }) => {
  await expect(page.locator('[data-action="link-api"]')).toHaveCount(0);
  await setupAtlasRoot(page);
  await expect(page.locator('[data-action="link-api"]')).toBeVisible();
});

test('+ link api opens a modal with api-key, pin, and display-name fields', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');

  await expect(page.locator('[data-modal="link-world"]')).toBeVisible();
  await expect(page.locator('input[name="api-key"]')).toBeVisible();
  await expect(page.locator('input[name="api-pin"]')).toBeVisible();
  await expect(page.locator('input[name="display-name"]')).toBeVisible();
  await expect(page.locator('[data-modal="link-world"] [data-action="link"]')).toBeVisible();
});

test('link modal pin field is pre-filled from registry.pin', async ({ page }) => {
  await setupAtlasRoot(page);
  // Seed PIN via the test API — registry update + state hydration in one go.
  await page.evaluate(() => {
    const raw = localStorage.getItem('atlas_worlds_registry')!;
    const reg = JSON.parse(raw);
    reg.pin = '9876';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  // Reload to hydrate the pin into state.
  await page.reload();
  await page.waitForSelector('.atlas-shell');

  await page.click('[data-action="link-api"]');
  await expect(page.locator('input[name="api-pin"]')).toHaveValue('9876');
});

test('link modal cancel button closes without side-effects', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');
  await expect(page.locator('[data-modal="link-world"]')).toBeVisible();
  await page.click('[data-modal="link-world"] [data-action="cancel"]');
  await expect(page.locator('[data-modal="link-world"]')).toHaveCount(0);
  // No worlds appeared in the sidebar.
  await expect(page.locator('.atlas-row[data-world-id]')).toHaveCount(0);
});

test('link modal Escape key closes the modal', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');
  await expect(page.locator('[data-modal="link-world"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-modal="link-world"]')).toHaveCount(0);
});

test('link modal submit with empty fields shows inline error', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');
  // Clear any pre-filled PIN first so both fields are empty.
  await page.fill('input[name="api-pin"]', '');
  await page.click('[data-modal="link-world"] [data-action="link"]');
  await expect(page.locator('[data-modal="link-world"] [data-role="error"]')).toBeVisible();
});
