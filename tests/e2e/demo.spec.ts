/**
 * The sample-world demo (#/demo) — view-only presentation, session 254.
 *
 * The demo is NOT a world: no registry entry, no OPFS write, no folder.
 * It's an overlay built from the share renderer's payload path plus a
 * Leaflet hero. These tests lock the entry paths (welcome link), the
 * view-only surface (map + pins + modal + cards), and the exits.
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

test('welcome links into the demo; the demo renders map, pins, and cards', async ({ page }) => {
  await freshBoot(page);
  await expect(page.locator('.atlas-middle')).toContainText('Atlas is a free, local worldbuilding studio.');
  await page.locator('.atlas-welcome-demo-link').first().click();

  await expect(page).toHaveURL(/#\/demo/);
  await expect(page.locator('.atlas-demo-band-title')).toHaveText('Sikelia · sample world · view only');
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
