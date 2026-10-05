/**
 * The sample-world demo (#/demo) — view-only presentation, session 254.
 *
 * The demo is NOT a world: no registry entry, no OPFS write, no folder.
 * It's an overlay built from the share renderer's payload path plus a
 * Leaflet hero. These tests lock the direct route (its in-app doors were
 * removed in S368; old links still land), the view-only surface (map + pins
 * + modal + cards), and the exits.
 */

import { test, expect, Page } from '@playwright/test';
// The payload is the single source for counts (S309): the demo copy derives
// its numbers from it at render, and so do these assertions.
import demoData from '../../src/demo/demo-page.json';
const DEMO_PIN_COUNT = (demoData as { map: { pins: unknown[] } }).map.pins.length;

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

// S368: the three doors into the demo (landing "see an example page", the
// share room's empty-state line, the settings Links entry) were removed. The
// route stays for old links, so this test now proves both halves: no door in
// the share room, and #/demo still renders when visited directly.
test('the share room no longer links to the demo; #/demo still renders map, pins, and cards', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('demo-entry-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Demo Entry World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a world flips the sidebar into elements mode (S255v3) — sync on
  // the elements body, not a worlds-list row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();

  await page.click('.atlas-room-nav-btn[data-room="share"]');
  await expect(page.locator('.atlas-share-empty')).toBeVisible();
  await expect(page.locator('a[href="#/demo"]')).toHaveCount(0);

  await page.evaluate(() => { window.location.hash = '#/demo'; });
  await expect(page).toHaveURL(/#\/demo/);
  await expect(page.locator('.atlas-demo-band-title')).toHaveText('Sikelia · example page · view only');
  // The Leaflet hero with all 196 pins (lazy chunks: generous timeout).
  await expect(page.locator('.atlas-demo-map path.leaflet-interactive')).toHaveCount(DEMO_PIN_COUNT, { timeout: 20000 });
  // The curated cards render through the payload renderer.
  await expect(page.locator('.atlas-demo-cards')).toContainText('Syrakousai');
  await expect(page.locator('.atlas-demo-cards')).toContainText('Pantalika');
  await page.locator('.atlas-demo-cards').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'Notes/ui-snapshots/2026-07-12/demo-two-col-cards.png' });
});

test('pin click opens the read-only entry modal', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/demo');
  const pins = page.locator('.atlas-demo-map path.leaflet-interactive');
  await expect(pins).toHaveCount(DEMO_PIN_COUNT, { timeout: 20000 });
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
  await expect(page.locator('[data-action="start-world"]').first()).toBeVisible();
});

test('Escape exits the demo', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/demo');
  await expect(page.locator('.atlas-demo-band-title')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-demo-overlay')).toHaveCount(0);
});
