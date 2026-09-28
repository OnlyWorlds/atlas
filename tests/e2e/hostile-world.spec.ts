/**
 * S360 — a HOSTILE WORLD. World folders are written by anyone (a public repo,
 * an AI agent, a converter), and atlas's origin holds every linked world's API
 * key, the PIN and the account token. Every value below arrives from a world
 * file; none of it may run as script, and none of it may break a surface.
 *
 * The canary: each payload sets `window.__xss` if it ever executes.
 */

import { test, expect, Page } from '@playwright/test';

const CANARY = `<img src=x onerror="window.__xss=(window.__xss||0)+1">`;
const QUOTE_BREAKOUT = `"><img src=x onerror="window.__xss=(window.__xss||0)+1">`;

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupWorld(page: Page) {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('hostile-root', { create: true }));
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'hostile world');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function xssCount(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__xss ?? 0);
}

test.beforeEach(async ({ page }) => {
  page.on('dialog', d => { throw new Error(`unexpected dialog: ${d.message()}`); });
});

test('a script-shaped element name on a pinned map draws as text and never runs', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Hostile Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Hostile Canvas' })).toBeVisible();

  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map');
    const ch = await store.createElement('character', { name });
    await store.createElement('pin', { name, map_id: map.id, element_id: ch.id, element_type: 'character', x: 500, y: 500 });
    api.patchData(await store.listElements());
  }, CANARY);

  const label = page.locator('.leaflet-2d-pin-label .pin-label-text');
  await expect(label).toHaveCount(1);
  await expect(label).toHaveText(CANARY);
  // The sidebar row renders the same name.
  await expect(page.locator('.atlas-sidebar', { hasText: 'onerror' })).toBeVisible();
  expect(await xssCount(page)).toBe(0);
});

test('a zone colour and a marker order from a file cannot break out of the zone page', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Zone Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Zone Canvas' })).toBeVisible();

  const { worldId, zoneId } = await page.evaluate(async ({ colour, order }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const st = api.getState();
    const map = st.data.elements.find((e: any) => e.type === 'map');
    const z = await store.createZone({ name: 'Hostile zone', supertype: 'Polygon', atlas_color: colour });
    await store.createMarker({ map_id: map.id, zone_id: z.id, x: 100, y: 100, order });
    await store.createMarker({ map_id: map.id, zone_id: z.id, x: 400, y: 100, order: 2 });
    await store.createMarker({ map_id: map.id, zone_id: z.id, x: 400, y: 400, order: 3 });
    api.patchData(await store.listElements());
    return { worldId: st.active.id as string, zoneId: z.id as string };
  }, { colour: QUOTE_BREAKOUT, order: CANARY });

  await page.evaluate(({ w, z }) => { window.location.hash = `#/w/${w}/element/${z}`; }, { w: worldId, z: zoneId });
  const colourInput = page.locator('.atlas-zone-visuals-color');
  await expect(colourInput).toBeVisible();
  // The hostile value never reaches the input; the picker starts from the default.
  await expect(colourInput).toHaveValue('#22d3ee');
  await expect(page.locator('.atlas-zone-markers-order').first()).toBeAttached();
  expect(await xssCount(page)).toBe(0);
});

test('foreign shapes load: a numeric name, a pin without x/y, string coordinates, a bare-string link', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', e => errors.push(e.message));
  await setupWorld(page);
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Shape Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Shape Canvas' })).toBeVisible();

  // Write the files the way another tool would, straight into the folder.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const st = api.getState();
    const map = st.data.elements.find((e: any) => e.type === 'map');
    const entry = st.registry.worlds.find((w: any) => w.id === st.active.worldId);
    const opfs = await navigator.storage.getDirectory();
    let dir: any = await opfs.getDirectoryHandle('hostile-root');
    for (const seg of ['onlyworlds-atlas', entry.folder.folder_name, 'elements']) dir = await dir.getDirectoryHandle(seg, { create: true });
    const put = async (type: string, name: string, body: unknown) => {
      const d = await dir.getDirectoryHandle(type, { create: true });
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(JSON.stringify(body)); await w.close();
    };
    const sp = 'aaaaaaaa-0000-4000-8000-000000000001';
    await put('species', 'elves.json', { id: sp, type: 'species', name: 'Elves' });
    await put('event', 'year.json', { id: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'event', name: 1453 });
    await put('character', 'lia.json', { id: 'aaaaaaaa-0000-4000-8000-000000000003', type: 'character', name: 'Lia', species: sp });
    await put('location', 'town.json', { id: 'aaaaaaaa-0000-4000-8000-000000000004', type: 'location', name: 'Town' });
    await put('pin', 'nowhere.json', { id: 'aaaaaaaa-0000-4000-8000-000000000005', type: 'pin', name: 'Nowhere', map: map.id, element_id: 'aaaaaaaa-0000-4000-8000-000000000004', element_type: 'location' });
    await put('pin', 'town-pin.json', { id: 'aaaaaaaa-0000-4000-8000-000000000006', type: 'pin', name: 'Town', map: map.id, element_id: 'aaaaaaaa-0000-4000-8000-000000000004', element_type: 'location', x: '300', y: '300' });
  });

  // Reopen the world from disk: reload, then activate it.
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await page.locator('.atlas-row[data-world-id]', { hasText: 'hostile world' }).click();
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  // The numeric name renders and search still works.
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: '1453' })).toBeVisible();
  await page.fill('[data-role="elements-search"]', 'Lia');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Lia' })).toBeVisible();

  // The string-coordinate pin draws; the coordinate-less one is skipped, not fatal.
  await page.locator('.atlas-tab', { hasText: 'Shape Canvas' }).click();
  await expect(page.locator('.leaflet-2d-pin-label .pin-label-text', { hasText: 'Town' })).toHaveCount(1);

  // The bare-string species link shows as a chip, not as an empty row.
  const lia = await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.name === 'Lia').id);
  const w = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate(({ w, lia }) => { window.location.hash = `#/w/${w}/element/${lia}`; }, { w, lia });
  await expect(page.locator('.atlas-link-chip', { hasText: 'Elves' })).toBeVisible();

  expect(errors).toEqual([]);
});
