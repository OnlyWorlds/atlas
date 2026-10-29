/**
 * Bring in a file, notes or JSON before a world exists (#856, from the entry
 * sweep's E4): two taps from the first screen to the Data room, with no world
 * made by hand; the import itself makes the world.
 */

import { test, expect, type Page } from '@playwright/test';

const LOOSE = JSON.stringify({ Character: [{ name: 'Mira Salt' }], Location: [{ name: 'The Saltmarsh' }] });
const FULL = JSON.stringify({ World: { name: 'Notes World' }, Character: [{ name: 'Oren Vale' }] });

async function freshBoot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

const worldCount = (page: Page) => page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length as number);

/** The door from the first screen: Other ways in, then the row. */
async function twoTaps(page: Page): Promise<void> {
  await page.click('[data-action="other-ways-in"]');
  await page.click('[data-modal="add-world"] [data-choice="bring-in"]');
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.locator('.atlas-import-room')).toBeVisible();
}

async function pasteAndLoad(page: Page, json: string): Promise<void> {
  await page.fill('[data-role="paste"]', json);
  await page.click('[data-action="load"]');
  await expect(page.locator('.atlas-import-review')).toBeVisible();
}

/** Create world, answering the where-question with this browser when it is asked. */
async function createWorld(page: Page): Promise<void> {
  await page.click('.atlas-import-review [data-action="import"]');
  const where = page.locator('[data-modal="where-ask"]');
  await where.waitFor({ timeout: 3000 }).catch(() => {});
  if (await where.isVisible()) {
    await where.locator('input[name="where"][value="browser"]').check();
    await where.locator('[data-action="go"]').click();
  }
}

test('two taps to the Data room with no world made; loose JSON from notes becomes a world on Import', async ({ page }) => {
  await freshBoot(page);
  await twoTaps(page);
  expect(await worldCount(page)).toBe(0);
  // A room of its own: the room bar's preview names Data as here, and the way back is on the page.
  await expect(page.locator('.atlas-room-nav-strip.is-preview [aria-current="page"]')).toContainText('Data');
  await expect(page.locator('[data-action="back-to-start"]')).toBeVisible();
  await expect(page.locator('.atlas-import-ai-note')).toHaveCount(0);

  await pasteAndLoad(page, LOOSE);
  // Loose elements with no world: a new world, never a merge into nothing.
  await expect(page.locator('input[name="imp-mode"][value="new"]')).toBeChecked();
  await expect(page.locator('input[name="imp-mode"][value="merge"]')).toHaveCount(0);
  await expect(page.locator('[data-role="world-name"]')).toHaveValue('Imported world');
  await page.fill('[data-role="world-name"]', 'From my notes');
  expect(await worldCount(page)).toBe(0);
  await createWorld(page);
  await expect(page.locator('h1', { hasText: 'From my notes' })).toBeVisible({ timeout: 15000 });
  expect(await worldCount(page)).toBe(1);
  const names = await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.map((e: { name: string }) => e.name).sort());
  expect(names).toEqual(['Mira Salt', 'The Saltmarsh']);
});

test('a full world from the world-less room takes its own name, and is the only world', async ({ page }) => {
  await freshBoot(page);
  await twoTaps(page);
  await pasteAndLoad(page, FULL);
  await expect(page.locator('[data-role="world-name"]')).toHaveValue('Notes World');
  await createWorld(page);
  await expect(page.locator('h1', { hasText: 'Notes World' })).toBeVisible({ timeout: 15000 });
  expect(await worldCount(page)).toBe(1);
});

test('with a world open: the door asks for a new world, the world\'s own Data room still merges', async ({ page }) => {
  await freshBoot(page);
  await twoTaps(page);
  await pasteAndLoad(page, FULL);
  await createWorld(page);
  await expect(page.locator('h1', { hasText: 'Notes World' })).toBeVisible({ timeout: 15000 });
  const worldImport = page.url().replace(/#.*$/, '') + (await page.evaluate(() => window.location.hash)).replace(/\/?$/, '/import');
  // The door with a world open is that world's Data room, and loose JSON defaults to a new world.
  await page.evaluate(() => { window.location.hash = '#/import'; });
  await expect(page).toHaveURL(/#\/w\/[^/]+\/import$/);
  await pasteAndLoad(page, LOOSE);
  await expect(page.locator('input[name="imp-mode"][value="new"]')).toBeChecked();
  await expect(page.locator('input[name="imp-mode"][value="merge"]')).toHaveCount(1);
  // The world's own Data room: loose JSON merges by default, as always.
  await page.evaluate(() => { window.location.hash = '#/'; });
  await page.goto(worldImport);
  await page.waitForSelector('.atlas-import-room');
  await pasteAndLoad(page, LOOSE);
  await expect(page.locator('input[name="imp-mode"][value="merge"]')).toBeChecked();
});

test('#/bring-in from the site lands in the world-less Data room; Back to start returns', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/bring-in');
  await page.waitForSelector('.atlas-shell');
  await expect(page).toHaveURL(/#\/import$/);
  await expect(page.locator('.atlas-import-room')).toBeVisible();
  await expect(page.locator('[data-modal="create-world"]')).toHaveCount(0);
  expect(await worldCount(page)).toBe(0);
  await page.click('[data-action="back-to-start"]');
  await expect(page.locator('[data-action="other-ways-in"]')).toBeVisible();
});

test('a closed world\'s Data room address never shows the world-less room', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/w/00000000-0000-4000-8000-0000000000aa/import');
  await page.waitForSelector('.atlas-shell');
  await page.waitForTimeout(500);
  await expect(page.locator('.atlas-import-room')).toHaveCount(0);
});

test('under the tour, the door is refused and goes to the start', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(() => localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true })));
  await page.evaluate(() => { window.location.hash = '#/import'; });
  await expect(page.locator('.ow-toast', { hasText: 'yours to use after the tour' })).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toBe('#/');
  await expect(page.locator('.atlas-import-room')).toHaveCount(0);
  // A fresh load of the site's link under the tour: refused the same way.
  await page.goto('about:blank');
  await page.goto('/#/bring-in');
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.ow-toast', { hasText: 'yours to use after the tour' })).toBeVisible();
  await expect(page.locator('.atlas-import-room')).toHaveCount(0);
});

test('a phone: two taps to the Data room, the sidebar toggle still in the room bar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshBoot(page);
  await twoTaps(page);
  await expect(page.locator('.atlas-room-nav-strip.is-preview [data-drawer="sidebar"]')).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
