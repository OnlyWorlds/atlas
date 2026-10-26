/**
 * #139 (Titus's ask in 2026-10-09): from a map, into the map of a
 * place pinned on it, and back up. Selecting a pin whose Location has its own
 * map shows a door beside that pin; the submap's toolbar names the way up.
 * Both swap the current map tab in place.
 */
import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('submap-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Submap World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Realm');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Realm' })).toBeVisible();
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const realm = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Realm');
    const isle = await store.createElement('location', { name: 'Isle' });
    const plain = await store.createElement('location', { name: 'Plain Place' });
    await store.createElement('map', { name: 'Isle Map', location: isle.id, parent_map: realm.id });
    await store.createElement('pin', { name: 'Isle', map_id: realm.id, element_id: isle.id, element_type: 'location', x: 400, y: 400 });
    await store.createElement('pin', { name: 'Plain Place', map_id: realm.id, element_id: plain.id, element_type: 'location', x: 1200, y: 1200 });
    api.patchData(await store.listElements());
  });
}

const pinOf = (page: Page, name: string) =>
  page.locator(`xpath=//div[contains(@class,'leaflet-2d-pin-label')][span[text()='${name}']]/preceding-sibling::img[1]`);

test('a pin whose place has its own map opens it, and the submap leads back up, in the same tab', async ({ page }) => {
  await setupWorld(page);
  const mapTabs = page.locator('.atlas-tab', { hasText: /Realm|Isle Map/ });
  await expect(mapTabs).toHaveCount(1);
  await expect(page.locator('[data-action="map-up"]')).toHaveCount(0); // Realm is a root

  await pinOf(page, 'Isle').click();
  const door = page.locator('[data-action="open-submap"]');
  await expect(door).toHaveText(/Open Isle Map/);
  await door.click();

  await expect(page.locator('.atlas-tab.active', { hasText: 'Isle Map' })).toBeVisible();
  await expect(mapTabs).toHaveCount(1); // swapped in place, not a second tab
  const up = page.locator('[data-action="map-up"]');
  await expect(up).toHaveAttribute('aria-label', 'Up to Realm');
  await up.click();

  await expect(page.locator('.atlas-tab.active', { hasText: 'Realm' })).toBeVisible();
  await expect(mapTabs).toHaveCount(1);
  await expect(page.locator('[data-action="map-up"]')).toHaveCount(0);
});

test('a place with no map of its own gets no door, and leaving the selection removes it', async ({ page }) => {
  await setupWorld(page);
  await pinOf(page, 'Plain Place').click();
  await expect(page).toHaveURL(/\/element\//);
  await expect(page.locator('[data-action="open-submap"]')).toHaveCount(0);

  await pinOf(page, 'Isle').click();
  await expect(page.locator('[data-action="open-submap"]')).toHaveCount(1);
  // Selecting something else takes the door away.
  await pinOf(page, 'Plain Place').click();
  await expect(page.locator('[data-action="open-submap"]')).toHaveCount(0);

  // So does clearing the selection with the chip's × (#175: on an element
  // route it used to select straight back).
  await pinOf(page, 'Isle').click();
  await expect(page.locator('[data-action="open-submap"]')).toHaveCount(1);
  await page.locator('.atlas-room-nav-selected [data-action="clear-selection"]').click();
  await expect(page.locator('[data-action="open-submap"]')).toHaveCount(0);
  await expect(page.locator('.atlas-room-nav-selected')).toHaveCount(0);
});

test("every pin's image is named by its place, never 'Marker' (#176)", async ({ page }) => {
  await setupWorld(page);
  const pins = page.locator('.leaflet-marker-pane img.leaflet-marker-icon');
  await expect(pins).toHaveCount(2);
  const alts = await pins.evaluateAll(imgs => imgs.map(i => (i as HTMLImageElement).alt).sort());
  expect(alts).toEqual(['Isle', 'Plain Place']);

  // A rename reaches the name a screen reader hears.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const plain = api.getState().data.elements.find((e: any) => e.name === 'Plain Place');
    await store.updateElement(plain.id, { name: 'Wide Plain' });
    api.patchData(await store.listElements());
  });
  await expect(page.locator('.leaflet-marker-pane img[alt="Wide Plain"]')).toHaveCount(1);
  await expect(page.locator('.leaflet-marker-pane img[alt="Marker"]')).toHaveCount(0);
});

test('the map badge says what it means on hover, and only on a location with its own map (2026-10-15)', async ({ page }) => {
  await setupWorld(page);
  const HINT = 'This location has its own map: click it, then Open';
  const titleOf = (alt: string) => page.locator(`.leaflet-marker-pane img[alt="${alt}"]`).getAttribute('title');
  await expect(page.locator('.leaflet-marker-pane img[alt="Isle"]')).toHaveAttribute('title', HINT);
  expect(await titleOf('Plain Place')).toBeFalsy();

  // A map made for the plain place gives its pin the words; the isle's map gone takes them away.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const els = api.getState().data.elements;
    const plain = els.find((e: any) => e.name === 'Plain Place');
    const isleMap = els.find((e: any) => e.name === 'Isle Map');
    await store.createElement('map', { name: 'Plain Map', location: plain.id });
    await store.deleteElement(isleMap.id);
    api.patchData(await store.listElements());
  });
  await expect(page.locator('.leaflet-marker-pane img[alt="Plain Place"]')).toHaveAttribute('title', HINT);
  await expect.poll(() => titleOf('Isle')).toBeFalsy();
});

test("help follows a map open in the right pane, whose address stays the room's (2026-10-15)", async ({ page }) => {
  await setupWorld(page);
  expect(await page.evaluate(() => window.location.hash)).not.toContain('/map/');
  await page.keyboard.press('?');
  const openMap = page.locator('[data-modal="help-overlay"] [data-role="help-open-map"]');
  await expect(openMap).toContainText('give a location its own map');
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-modal="help-overlay"]')).toHaveCount(0);

  // With the maps list in front instead of a map, the room's help stands alone.
  await page.locator('.atlas-tab', { hasText: 'Maps' }).first().click();
  await page.keyboard.press('?');
  await expect(page.locator('[data-modal="help-overlay"]')).toBeVisible();
  await expect(openMap).toHaveCount(0);
});
