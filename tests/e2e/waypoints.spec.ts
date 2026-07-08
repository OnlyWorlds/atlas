/**
 * Bout OW — waypoints + the OnlyWorlds settings page.
 *
 * Covers the user-visible contract (hookmap doc):
 *   - Creating a world (a real gesture) completes 'first-world'; the OW page
 *     shows the lit row + the quiet counter.
 *   - The first waypoint toast carries the "These are optional." rider.
 *   - Creating an element via the modal completes 'first-element'.
 *   - Legacy /settings/account URLs alias to the renamed onlyworlds tab.
 *   - The sidebar footer OW icon routes to the tab.
 *   - "mark all as familiar" stamps everything.
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
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('creating a world completes first-world; OW page shows it lit + counted', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Waypoint World');

  // The first-ever waypoint toast appears, with the optional-rider.
  const toast = page.locator('.atlas-waypoint-toast');
  await expect(toast).toBeVisible();
  await expect(toast).toContainText('Your world, your files');
  await expect(toast).toContainText('These are optional.');

  // The OW page lists it as met with the quiet counter.
  await page.click('[data-action="open-onlyworlds"]');
  await expect(page.locator('.atlas-settings')).toBeVisible();
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/onlyworlds$/);
  await expect(page.locator('[data-waypoint="first-world"]')).toHaveClass(/is-met/);
  await expect(page.locator('.atlas-ow-waypoints-count')).toHaveText('1 of 10');
});

test('creating an element via the modal completes first-element', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Element World');

  // Sidebar flips to the world's elements mode; create via the + modal.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await expect(page.locator('[data-modal="create-element"]')).toBeVisible();
  await page.fill('input[name="element-name"]', 'Waypoint Hero');
  await page.click('.atlas-create-type-btn[data-type="character"]');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);

  await page.click('[data-action="open-onlyworlds"]');
  await expect(page.locator('[data-waypoint="first-element"]')).toHaveClass(/is-met/);
});

test('legacy /settings/account URL aliases to the onlyworlds tab', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Alias World');
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate((w) => { window.location.hash = `#/w/${w}/settings/account`; }, worldId);
  await expect(page.locator('[data-settings-tab="onlyworlds"]')).toHaveClass(/active/);
  await expect(page.locator('.atlas-settings input[name="email"]')).toBeVisible();
});

test('mark all as familiar stamps every waypoint', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Veteran World');
  await page.click('[data-action="open-onlyworlds"]');
  await page.click('[data-action="waypoints-mark-all"]');
  await expect(page.locator('.atlas-ow-waypoints-count')).toHaveText('10 of 10');
  await expect(page.locator('.atlas-ow-waypoint.is-met')).toHaveCount(10);
});
