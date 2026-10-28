/**
 * The waypoints on Settings, OnlyWorlds (the guide, step 1): the list as the
 * memory of what the open world can do.
 *
 * Covers the user-visible contract:
 *   - Every row is lit from the world itself, never from a stamp: a world
 *     made by the store (as an import makes it) reads lit as surely as one
 *     made by hand, and there is no count.
 *   - The notes' switch and Show the notes again.
 *   - Legacy /settings/account URLs alias to the renamed onlyworlds tab.
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

async function setupAtlasRoot(page: Page, dirName: string = 'waypoints-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

const litRows = (page: Page) => page.locator('[data-waypoint]')
  .evaluateAll(els => els.filter(e => e.getAttribute('data-lit') === 'true').map(e => e.getAttribute('data-waypoint')));

test('rows are lit from the world itself: what the store wrote reads as surely as what a hand made', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Waypoint World');
  await page.click('[data-action="open-onlyworlds"]');
  await expect(page.locator('.atlas-settings')).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/onlyworlds$/);
  // A folder world already has its copy; nothing else yet; no count anywhere.
  expect(await litRows(page)).toEqual(['copy']);
  await expect(page.locator('[data-role="waypoints-section"]')).not.toContainText(/\d+ of \d+/);
  // The store writes what an import would: a placed pair, a dated Event, a pin, a Trait.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const keep = await store.createElement('location', { name: 'Hollow Keep' });
    await store.createElement('character', { name: 'Ada', location: keep.id });
    await store.createElement('event', { name: 'The Founding', start_date: 120 });
    await store.createElement('trait', { name: 'Stubborn' });
    api.patchData(await store.listElements());
  });
  await expect.poll(() => litRows(page)).toEqual(['someone', 'placed', 'happened', 'copy', 'ring-traits']);
  // An unlit row keeps its way in; a lit one has none.
  await expect(page.locator('[data-waypoint="story"] .atlas-ow-waypoint-arrow')).toHaveCount(1);
  await expect(page.locator('[data-waypoint="someone"] .atlas-ow-waypoint-arrow')).toHaveCount(0);
});

test('the notes switch and Show the notes again', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Switch World');
  await page.click('[data-action="open-onlyworlds"]');
  const sw = page.locator('[data-action="guide-notes-switch"]');
  await expect(sw).toHaveText('Notes after what you do: On');
  await sw.click();
  await expect(sw).toHaveText('Notes after what you do: Off');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_guide_v1')!).off)).toBe(true);
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: { someone: 'x' }, off: true })));
  await page.click('[data-action="guide-notes-again"]');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_guide_v1')!).seen)).toEqual({});
});

test('legacy /settings/account URL aliases to the onlyworlds tab', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Alias World');
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate((w) => { window.location.hash = `#/w/${w}/settings/account`; }, worldId);
  await expect(page.locator('[data-settings-tab="onlyworlds"]')).toHaveClass(/active/);
  await expect(page.locator('.atlas-settings input[name="email"]')).toBeVisible();
});
