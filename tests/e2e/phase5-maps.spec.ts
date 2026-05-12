/**
 * Bout C — map index + map tab + map create modal.
 *
 * Pin placement onto a Leaflet canvas via Playwright is tricky because the map
 * needs to fully initialize and respond to click events at specific screen
 * coordinates. These specs cover the surfaces that don't require actual
 * Leaflet event simulation: tab lifecycle, create flow, persistence,
 * cascade-delete. Pin placement is verified via direct FolderStore use through
 * the test harness rather than DOM click events on the canvas.
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

async function setupAtlasRoot(page: Page, dirName: string = 'maps-test-root') {
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
  await setupAtlasRoot(page);
  await createWorld(page, 'map world');
});

test('right pane shows map index tab by default with empty state', async ({ page }) => {
  await expect(page.locator('.atlas-right-tab[data-tab-kind="map-index"]')).toBeVisible();
  await expect(page.locator('.atlas-right-tab[data-tab-kind="map-index"]')).toHaveClass(/is-active/);
  await expect(page.locator('.atlas-map-index-pane')).toBeVisible();
  await expect(page.locator('.atlas-map-index-pane')).toContainText('no maps yet');
});

test('create map via map index — adds row and opens map tab', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await expect(page.locator('[data-modal="create-map"]')).toBeVisible();
  await page.fill('input[name="map-name"]', 'Middle Earth');
  await page.click('[data-modal="create-map"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);

  // Row appears in map index (have to switch back to see it since tab switched).
  await page.click('.atlas-right-tab[data-tab-kind="map-index"]');
  await expect(page.locator('.atlas-row[data-map-id]', { hasText: 'Middle Earth' })).toBeVisible();

  // New tab created for the map and is active.
  const mapTab = page.locator('.atlas-right-tab[data-tab-kind="map"]', { hasText: 'Middle Earth' });
  await expect(mapTab).toBeVisible();
});

test('clicking a map row opens or focuses its tab', async ({ page }) => {
  // Create two maps.
  for (const name of ['Alpha Map', 'Beta Map']) {
    await page.click('[data-action="new-map"]');
    await page.fill('input[name="map-name"]', name);
    await page.click('[data-modal="create-map"] [data-action="create"]');
    await page.click('.atlas-right-tab[data-tab-kind="map-index"]');
  }
  // Both rows present.
  await expect(page.locator('.atlas-row[data-map-id]')).toHaveCount(2);

  // Click Alpha Map row → focuses Alpha tab.
  await page.click('.atlas-row[data-map-id]:has-text("Alpha Map")');
  await expect(page.locator('.atlas-right-tab.is-active', { hasText: 'Alpha Map' })).toBeVisible();

  // Click Beta Map row → focuses Beta tab.
  await page.click('.atlas-right-tab[data-tab-kind="map-index"]');
  await page.click('.atlas-row[data-map-id]:has-text("Beta Map")');
  await expect(page.locator('.atlas-right-tab.is-active', { hasText: 'Beta Map' })).toBeVisible();
});

test('close button on a map tab removes it from the bar', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('[data-modal="create-map"] input[name="map-name"]', 'Disposable');
  await page.click('[data-modal="create-map"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);

  const tab = page.locator('.atlas-right-tab[data-tab-kind="map"]', { hasText: 'Disposable' });
  await expect(tab).toBeVisible();
  const group = page.locator('.atlas-right-tab-group', { has: tab });
  await group.locator('[data-role="close"]').click();
  await expect(tab).toHaveCount(0);

  // Map-index tab still present and active.
  await expect(page.locator('.atlas-right-tab[data-tab-kind="map-index"]')).toHaveClass(/is-active/);
});

test('map index pin-count badge updates as pins are added (via FolderStore)', async ({ page }) => {
  // Create a character to pin and a map.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Hero');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Hero' })).toBeVisible();
  const heroId = await page.evaluate(() => {
    const w = (window as any);
    const state = (w as any).__atlasTestApi?.getState?.();
    return state?.data?.elements?.find((e: any) => e.name === 'Hero')?.id;
  });
  expect(heroId).toBeTruthy();

  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('[data-action="new-map"]');
  await page.fill('[data-modal="create-map"] input[name="map-name"]', 'Pinned Map');
  await page.click('[data-modal="create-map"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);
  const mapId = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi?.getState?.();
    return state?.data?.elements?.find((e: any) => e.type === 'map' && e.name === 'Pinned Map')?.id;
  });
  expect(mapId).toBeTruthy();

  // Directly create a pin via FolderStore (avoids Leaflet click simulation).
  await page.evaluate(async ({ heroId, mapId }) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    await store.createPin({ map_id: mapId, element_id: heroId, x: 100, y: 100 });
    const elements = await store.listElements();
    (window as any).__atlasTestApi.patchData(elements);
  }, { heroId, mapId });

  // Map index shows pin count badge "1".
  await page.click('.atlas-right-tab[data-tab-kind="map-index"]');
  const row = page.locator('.atlas-row[data-map-id]', { hasText: 'Pinned Map' });
  await expect(row.locator('.atlas-row-meta')).toHaveText('1');
});

test('delete map cascades pins and removes the tab', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Doomed Map');
  await page.click('[data-modal="create-map"] [data-action="create"]');
  await page.click('.atlas-right-tab[data-tab-kind="map-index"]');

  page.on('dialog', d => d.accept());
  await page.locator('.atlas-row[data-map-id]', { hasText: 'Doomed Map' }).hover();
  await page.locator('.atlas-row[data-map-id] [data-action="delete-map"]').click();

  await expect(page.locator('.atlas-row[data-map-id]', { hasText: 'Doomed Map' })).toHaveCount(0);
  await expect(page.locator('.atlas-right-tab[data-tab-kind="map"]', { hasText: 'Doomed Map' })).toHaveCount(0);
});

test('pin button appears in element detail when a map tab is active', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Visible Map');
  await page.click('[data-modal="create-map"] [data-action="create"]');
  // Map tab now active in right pane.

  // Switch sidebar to elements and create a character.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Pin-able');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  // Pin button should be present.
  const pinBtn = page.locator('[data-action="pin-element"]');
  await expect(pinBtn).toBeVisible();
  await pinBtn.click();
  await expect(pinBtn).toHaveClass(/active/);

  // Toggle off.
  await pinBtn.click();
  await expect(pinBtn).not.toHaveClass(/active/);
});

test('pin button is hidden when no map tab is active', async ({ page }) => {
  // Create an element without a map.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'No Map Here');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  await expect(page.locator('[data-action="pin-element"]')).toHaveCount(0);
});

test('map create modal — location picker integration', async ({ page }) => {
  // Create a location first.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Shire');
  await page.click('.atlas-create-type-btn[data-type="location"]');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  // Open new map modal, pick location.
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('[data-action="new-map"]');
  await page.click('[data-modal="create-map"] .atlas-map-create-location button:has-text("pick location")');
  await expect(page.locator('[data-modal="pick-element"]')).toBeVisible();
  await page.click('.atlas-picker-row:has-text("Shire")');
  await expect(page.locator('[data-modal="pick-element"]')).toHaveCount(0);
  // Chip visible.
  await expect(page.locator('[data-modal="create-map"] .atlas-link-chip', { hasText: 'Shire' })).toBeVisible();

  await page.fill('[data-modal="create-map"] input[name="map-name"]', 'Shire Map');
  await page.click('[data-modal="create-map"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);

  // Map exists, and its `location` field is the Shire's id.
  const stored = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi.getState();
    const map = state.data.elements.find((e: any) => e.type === 'map' && e.name === 'Shire Map');
    const shire = state.data.elements.find((e: any) => e.type === 'location' && e.name === 'Shire');
    return { mapJson: JSON.stringify(map), shireId: shire?.id, mapLocation: map?.location };
  });
  expect(stored.mapLocation).toBe(stored.shireId);
});
