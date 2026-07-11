/**
 * The sample-world demo (#/demo) — view-only presentation, session 254.
 *
 * The demo is NOT a world: no registry entry, no OPFS write, no folder.
 * It's an overlay built from the share renderer's payload path plus a
 * Leaflet hero. These tests lock the entry paths (share room's example
 * link), the view-only surface (map + pins + modal + cards), and the exits.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

test('the share room links into the demo; the demo renders map, pins, and cards', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('demo-entry-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Demo Entry World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a world flips the sidebar into elements mode (S255v3) — sync on
  // the elements body, not a worlds-list row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();

  await page.click('.atlas-room-nav-btn[data-room="share"]');
  await expect(page.locator('.atlas-share-example-line a')).toHaveText('See an example page');
  await page.locator('.atlas-share-example-line a').click();

  await expect(page).toHaveURL(/#\/demo/);
  await expect(page.locator('.atlas-demo-band-title')).toHaveText('Sikelia · example page · view only');
  // The Leaflet hero with all 196 pins (lazy chunks: generous timeout).
  await expect(page.locator('.atlas-demo-map path.leaflet-interactive')).toHaveCount(196, { timeout: 20000 });
  // The curated cards render through the payload renderer.
  await expect(page.locator('.atlas-demo-cards')).toContainText('Syrakousai');
  await expect(page.locator('.atlas-demo-cards')).toContainText('Pantalika');
});

test('pin click opens the read-only entry modal', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/demo');
  const pins = page.locator('.atlas-demo-map path.leaflet-interactive');
  await expect(pins).toHaveCount(196, { timeout: 20000 });
  await pins.nth(40).click({ force: true });
  const modal = page.locator('.atlas-share-pin-modal, .atlas-modal-overlay.visible');
  await expect(modal.first()).toBeVisible();
  await expect(modal.first()).toContainText('location');
});

test('the demo writes NOTHING: no registry entry, and exit returns to welcome', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/demo');
  await expect(page.locator('.atlas-demo-band-title')).toBeVisible();
  const worlds = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length);
  expect(worlds).toBe(0);

  await page.locator('[data-action="demo-exit"]').click();
  await expect(page.locator('.atlas-demo-overlay')).toHaveCount(0);
  await expect(page.locator('[data-action="setup-atlas"]').first()).toBeVisible();
});

test('Escape exits the demo', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/demo');
  await expect(page.locator('.atlas-demo-band-title')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-demo-overlay')).toHaveCount(0);
});
