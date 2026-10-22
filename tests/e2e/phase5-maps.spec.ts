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
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a local world flips the sidebar to elements mode (S255v3); use
  // that as the mode-independent completion signal instead of a worlds-list row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'map world');
});

test('right pane shows map index tab by default with empty state', async ({ page }) => {
  await expect(page.locator('.atlas-tab[data-tab-kind="map-index"]')).toBeVisible();
  await expect(page.locator('.atlas-tab[data-tab-kind="map-index"]')).toHaveClass(/active/);
  await expect(page.locator('.atlas-map-index-pane')).toBeVisible();
  await expect(page.locator('.atlas-map-index-pane')).toContainText('No maps yet');
});

test('create map via map index — adds row and opens map tab', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await expect(page.locator('[data-modal="create-map"]')).toBeVisible();
  await page.fill('input[name="map-name"]', 'Middle Earth');
  // Image source required for auto-open-tab behavior (session 212 R3).
  await page.fill('input[name="map-image-url"]', 'https://example.com/middle-earth.png');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);

  // Row appears in map index (have to switch back to see it since tab switched).
  await page.click('.atlas-tab[data-tab-kind="map-index"]');
  await expect(page.locator('.atlas-row[data-map-id]', { hasText: 'Middle Earth' })).toBeVisible();

  // New tab created for the map and is active.
  const mapTab = page.locator('.atlas-tab[data-tab-kind="map"]', { hasText: 'Middle Earth' });
  await expect(mapTab).toBeVisible();
});

test('clicking a map row opens or focuses its tab', async ({ page }) => {
  // Create two maps with image urls so tabs auto-open (session 212 R3).
  for (const name of ['Alpha Map', 'Beta Map']) {
    await page.click('[data-action="new-map"]');
    await page.fill('input[name="map-name"]', name);
    await page.fill('input[name="map-image-url"]', `https://example.com/${name.toLowerCase().replace(/\s+/g, '-')}.png`);
    await page.click('[data-modal="create-map"] [data-action="submit"]');
    await page.click('.atlas-tab[data-tab-kind="map-index"]');
  }
  // Both rows present.
  await expect(page.locator('.atlas-row[data-map-id]')).toHaveCount(2);

  // Click Alpha Map row → focuses Alpha tab.
  await page.click('.atlas-row[data-map-id]:has-text("Alpha Map")');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Alpha Map' })).toBeVisible();

  // Click Beta Map row → focuses Beta tab.
  await page.click('.atlas-tab[data-tab-kind="map-index"]');
  await page.click('.atlas-row[data-map-id]:has-text("Beta Map")');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Beta Map' })).toBeVisible();
});

test('close button on a map tab removes it from the bar', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('[data-modal="create-map"] input[name="map-name"]', 'Disposable');
  // Image source required for auto-open-tab behavior (session 212 R3).
  await page.fill('[data-modal="create-map"] input[name="map-image-url"]', 'https://example.com/disposable.png');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);

  const tab = page.locator('.atlas-tab[data-tab-kind="map"]', { hasText: 'Disposable' });
  await expect(tab).toBeVisible();
  await tab.locator('[data-role="close"]').click();
  await expect(tab).toHaveCount(0);

  // Map-index tab still present and active.
  await expect(page.locator('.atlas-tab[data-tab-kind="map-index"]')).toHaveClass(/active/);
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
  await page.click('[data-modal="create-map"] [data-action="submit"]');
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
  await page.click('.atlas-tab[data-tab-kind="map-index"]');
  const row = page.locator('.atlas-row[data-map-id]', { hasText: 'Pinned Map' });
  await expect(row.locator('.atlas-pin-count-badge')).toHaveText('1');
});

test('delete map cascades pins and removes the tab', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Doomed Map');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await page.click('.atlas-tab[data-tab-kind="map-index"]');

  page.on('dialog', d => d.accept());
  await page.locator('.atlas-row[data-map-id]', { hasText: 'Doomed Map' }).hover();
  await page.locator('.atlas-row[data-map-id] [data-action="delete-map"]').click();

  await expect(page.locator('.atlas-row[data-map-id]', { hasText: 'Doomed Map' })).toHaveCount(0);
  await expect(page.locator('.atlas-tab[data-tab-kind="map"]', { hasText: 'Doomed Map' })).toHaveCount(0);
});

test('pin button appears in element detail when a map tab is active', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Visible Map');
  // Image source required for auto-open-tab behavior (session 212 R3).
  await page.fill('input[name="map-image-url"]', 'https://example.com/visible.png');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
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

  // Placement feedback (S299): the map shows a banner naming the element +
  // the crosshair state on body; the armed button is lit (the .active class,
  // now styled).
  await expect(page.locator('.atlas-map-placement-hint')).toBeVisible();
  await expect(page.locator('.atlas-map-placement-hint-text')).toContainText('Pin-able');
  expect(await page.evaluate(() => document.body.classList.contains('atlas-placing'))).toBe(true);

  // Esc cancels placement — button un-lights, banner + crosshair clear.
  await page.keyboard.press('Escape');
  await expect(pinBtn).not.toHaveClass(/active/);
  await expect(page.locator('.atlas-map-placement-hint')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('atlas-placing'))).toBe(false);

  // Toggle via the button still works too.
  await pinBtn.click();
  await expect(pinBtn).toHaveClass(/active/);
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

test('+pin hides once the element has a pin on the active map; a pin detail opens its map (S313)', async ({ page }) => {
  // Map with an image auto-opens as the active right tab.
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Pin Home');
  await page.fill('input[name="map-image-url"]', 'https://example.com/home.png');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);

  // A pinnable character; creating it lands on its detail with the map active.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Pinnable One');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);

  // Before any pin: +pin is offered.
  const pinBtn = page.locator('[data-action="pin-element"]');
  await expect(pinBtn).toBeVisible();

  const ids = await page.evaluate(() => {
    const st = (window as any).__atlasTestApi.getState();
    return {
      wid: st.active.worldId,
      charId: st.data.elements.find((e: any) => e.name === 'Pinnable One')?.id,
      mapId: st.data.elements.find((e: any) => e.type === 'map' && e.name === 'Pin Home')?.id,
    };
  });
  expect(ids.charId && ids.mapId).toBeTruthy();

  // Place a pin for this character on the active map (store, not Leaflet).
  const pinId = await page.evaluate(async ({ mapId, charId }) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const pin = await store.createPin({ map_id: mapId, element_id: charId, x: 100, y: 100 });
    (window as any).__atlasTestApi.patchData(await store.listElements());
    return pin.id as string;
  }, { mapId: ids.mapId, charId: ids.charId });
  expect(pinId).toBeTruthy();

  // The re-render drops +pin (already pinned HERE) and shows the existing-pin
  // affordance instead — a second +pin would only hit the store's uniqueness wall.
  await expect(pinBtn).toHaveCount(0);
  await expect(page.locator('[data-action="goto-pin"]')).toBeVisible();

  // The pin element's OWN detail: it can open its map, and it is not itself
  // pinnable (no +pin on a spatial artifact).
  await page.evaluate(({ wid, pinId }) => { window.location.hash = `#/w/${wid}/element/${pinId}`; },
    { wid: ids.wid, pinId });
  await expect(page.locator('[data-action="open-map"]')).toBeVisible();
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
  await page.click('[data-modal="create-map"] [data-action="submit"]');
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

test('imageless map is first-class: flat canvas opens, pin places, zone draft starts (S300)', async ({ page }) => {
  // Create WITHOUT any image source → auto-opens its tab (new S300 behavior)
  // and the record carries the stamped square flat-canvas dims.
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Blank Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('[data-modal="create-map"]')).toHaveCount(0);
  await expect(page.locator('.atlas-tab.active', { hasText: 'Blank Canvas' })).toBeVisible();

  const dims = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi.getState();
    const map = state.data.elements.find((e: any) => e.type === 'map' && e.name === 'Blank Canvas');
    return { width: map?.width, height: map?.height, image: map?.image_url ?? null };
  });
  expect(dims).toEqual({ width: 2000, height: 2000, image: null });

  // Pin placement works on the flat canvas: create an element, arm the +pin
  // button, click the visible canvas → a real pin lands (the old
  // "set a map image first" gate is gone).
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Sketch Marker');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  const pinBtn = page.locator('[data-action="pin-element"]');
  await expect(pinBtn).toBeVisible();
  await pinBtn.click();
  await expect(page.locator('.atlas-map-placement-hint')).toBeVisible();
  // Leaflet stamps .leaflet-container onto the canvas-container div itself —
  // select via the wrapper (same form as tour.spec).
  const canvas = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await canvas.click({ position: { x: 200, y: 150 } });
  await expect(page.locator('.ow-toast', { hasText: 'Pin placed' })).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: 'Set a map image first' })).toHaveCount(0);
  const pin = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi.getState();
    const map = state.data.elements.find((e: any) => e.type === 'map' && e.name === 'Blank Canvas');
    const p = state.data.elements.find((e: any) => e.type === 'pin' && e.map_id === map.id);
    return p ? { x: p.x, y: p.y } : null;
  });
  expect(pin).not.toBeNull();
  expect(pin!.x).toBeGreaterThanOrEqual(0);
  expect(pin!.y).toBeGreaterThanOrEqual(0);

  // Zone drafting enters cleanly on the imageless canvas (gate removed).
  await page.click('[data-action="draw-polygon"]');
  await expect(page.locator('[data-zone-draft-overlay]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-zone-draft-overlay]')).toHaveCount(0);

  // A drawn zone says its shape in the standard's field (1.77, #362) and in atlas_shape; one made with
  // its supertype left empty carries the shape's word there too, for readers that know neither
  // (the Captain's interim, h20 #6839).
  await page.click('[data-action="draw-polygon"]');
  for (const [x, y] of [[150, 330], [300, 330], [220, 430]]) await canvas.click({ position: { x, y } });
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-role="zone-create-supertype"]')).toHaveValue('');
  await page.click('[data-action="create"]:has-text("Create zone")');
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const z = els.find((e: any) => e.type === 'zone');
    return z ? `${z.supertype}|${z.atlas_shape}|${z.shape}` : null;
  })).toBe('polygon|polygon|polygon');

  // "Add art later": attaching an image whose dims differ from the stamped
  // 2000x2000 square must REMOUNT the open tab into the image's coordinate
  // space (S300 close gate — a background re-apply alone leaves the manager
  // converting clicks in the old space, corrupting later pin y-coords).
  const containerBefore = await page.evaluate(() =>
    document.querySelector('.atlas-map-tab-wrapper .leaflet-container')?.id ?? null);
  const pinBefore = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const p = els.find((e: any) => e.type === 'pin');
    return { x: p.x, y: p.y };
  });
  // Attach through the REAL user path (the Image URL field on the map's
  // element page) so the §4.2 sketch-rescale hook runs — a raw store write
  // would bypass it.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 300; c.height = 200;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#123456';
    ctx.fillRect(0, 0, 300, 200);
    return c.toDataURL();
  });
  await page.click('[data-element-id]:has-text("Blank Canvas")');
  const urlRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Image URL' }) });
  await urlRow.locator('.atlas-field-value').click();
  const urlInput = page.locator('.atlas-edit-popover input');
  await urlInput.fill(dataUrl);
  await urlInput.press('Enter');
  // Decode → dims persist → sketch rescale: the blank-canvas pin scales
  // proportionally into the 300x200 image space (§4.2).
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const m = els.find((e: any) => e.type === 'map' && e.name === 'Blank Canvas');
    return m.width;
  })).toBe(300);
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const p = els.find((e: any) => e.type === 'pin');
    return { x: p.x, y: p.y };
  })).toEqual({
    x: Math.min(300, Math.round(pinBefore.x * (300 / 2000))),
    y: Math.min(200, Math.round(pinBefore.y * (200 / 2000))),
  });
  // The dims flip must REMOUNT the active tab (right-pane's lastActiveMapDimsKey
  // machinery) — a fresh leaflet container is the observable.
  await expect
    .poll(async () => page.evaluate(() =>
      document.querySelector('.atlas-map-tab-wrapper .leaflet-container')?.id ?? null))
    .not.toBe(containerBefore);
  // The remount lands the manager in the 300x200 space; a pin placed at the
  // canvas center must carry coords inside it (the stale 2000-space would
  // put y in the hundreds-to-thousands). Re-select the element first — the
  // zone-draft Escape above also fired the deselect-to-home hotkey, so the
  // +pin button (element-detail top bar) left the page.
  // A SECOND element, not Sketch Marker again: one element may hold only one
  // pin per map (S307), and Sketch Marker is already pinned on this canvas.
  // What this section actually asserts is the coordinate SPACE of a freshly
  // placed pin after the dims flip, which does not care whose pin it is.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Second Marker');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  const pinIdsBefore = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.filter((e: any) => e.type === 'pin').map((p: any) => p.id);
  });
  await page.locator('[data-action="pin-element"]').click();
  await expect(page.locator('.atlas-map-placement-hint')).toBeVisible();
  const canvas2 = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await canvas2.click({ position: { x: 230, y: 220 } });
  // Identify the NEW pin by id diff — listElements order is not creation
  // order ("last in list" selects the wrong pin), and the first placement's
  // toast can still be visible (a toast wait races the async createPin) —
  // this test's own first two red runs proved both. Poll the store.
  let newPin: { x: number; y: number } | null = null;
  await expect.poll(async () => {
    newPin = await page.evaluate(async (before: string[]) => {
      const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
      const p = els.find((e: any) => e.type === 'pin' && !before.includes(e.id));
      return p ? { x: p.x, y: p.y } : null;
    }, pinIdsBefore);
    return newPin;
  }).not.toBeNull();
  expect(newPin!.x).toBeGreaterThanOrEqual(0);
  expect(newPin!.x).toBeLessThanOrEqual(300);
  expect(newPin!.y).toBeGreaterThanOrEqual(0);
  expect(newPin!.y).toBeLessThanOrEqual(200);
});

test('deleting a map closes its right-pane tab (S306)', async ({ page }) => {
  // The tab used to survive the delete and fall through to the stale card
  // ("Map from another world") — wrong on its face, since it WAS this world's,
  // and it looked unclosable. Captain's find.
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Doomed Map');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Doomed Map' })).toBeVisible();

  // Delete it from its element page.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-element-id]:has-text("Doomed Map")');
  page.once('dialog', d => void d.accept());
  await page.locator('[data-action="delete-element"]').click();

  await expect(page.locator('.atlas-tab', { hasText: 'Doomed Map' })).toHaveCount(0);
  await expect(page.locator('.atlas-map-stale-title')).toHaveCount(0);
  // ...and we land on the map index, not an arbitrary neighbour.
  await expect(page.locator('.atlas-tab[data-tab-kind="map-index"]')).toHaveClass(/active/);
});

test('the density layer (S356): a 40-pin cluster keeps its icons apart and its labels from overprinting; "always" shows every label', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Dense Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Dense Canvas' })).toBeVisible();

  // Forty locations pinned in a 400x400 patch of a 2000x2000 canvas, plus a
  // Line zone written the way another tool writes it (supertype, capitalised).
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const st = api.getState();
    const map = st.data.elements.find((e: any) => e.type === 'map' && e.name === 'Dense Canvas');
    for (let i = 0; i < 40; i++) {
      // Interior towns outweigh their neighbours (a description is weight):
      // S356's last resort let such a label cover a lighter icon (S382).
      const heavy = [9, 18, 27, 36].includes(i);
      const loc = await store.createElement('location', { name: `Town ${i}`, ...(heavy ? { description: 'A great city. '.repeat(40) } : {}) });
      await store.createPin({ map_id: map.id, element_id: loc.id, x: 800 + (i % 8) * 50, y: 800 + Math.floor(i / 8) * 50 });
    }
    const zone = await store.createZone({ name: 'the Long River', supertype: 'Line', subtype: 'River' });
    await store.createMarker({ map_id: map.id, zone_id: zone.id, x: 100, y: 100, order: 1 });
    await store.createMarker({ map_id: map.id, zone_id: zone.id, x: 1900, y: 1900, order: 2 });
    api.patchData(await store.listElements());
  });
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await expect(container.locator('.leaflet-marker-icon.leaflet-interactive')).toHaveCount(40);
  await expect(container.locator('.leaflet-2d-pin-label')).toHaveCount(40);

  // A capitalised legacy supertype renders as a LINE: an open path with no fill.
  const linePaths = await container.locator('svg path[fill="none"]').count();
  expect(linePaths).toBeGreaterThanOrEqual(1);

  const measure = async () => container.evaluate((c) => {
    const ov = (a: DOMRect, b: DOMRect) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const labelEls = Array.from(c.querySelectorAll<HTMLElement>('.leaflet-2d-pin-label:not(.atlas-label-culled)'))
      .map(el => ({ el, r: el.querySelector('.pin-label-text')!.getBoundingClientRect() })).filter(l => l.r.width > 0);
    const labels = labelEls.map(l => l.r);
    let overlaps = 0;
    for (let i = 0; i < labels.length; i++) for (let j = i + 1; j < labels.length; j++) if (ov(labels[i], labels[j])) overlaps++;
    // A pin's icon and its label are two markers at one latlng with the same
    // transform; any other icon under a label is another pin covered (S382).
    const icons = Array.from(c.querySelectorAll<HTMLElement>('.leaflet-marker-icon.leaflet-interactive'));
    let onIcons = 0;
    for (const l of labelEls) for (const i of icons) {
      if (i.style.transform !== l.el.style.transform && ov(l.r, i.getBoundingClientRect())) onIcons++;
    }
    const icon = icons[0];
    return { visibleLabels: labels.length, overlaps, onIcons, iconPx: icon.getBoundingClientRect().width };
  });

  // 'auto' (the factory default): the 50-unit gap at the mounted zoom is
  // narrower than a 32px icon, so icons shrink, and only the labels that
  // have room stay. What stays never overprints a label or another pin —
  // measured on rendered ink (S382: a heavy pin's label no longer covers a
  // lighter icon as a last resort; it waits for hover like the rest).
  const auto = await measure();
  expect(auto.iconPx).toBeLessThan(32);
  expect(auto.visibleLabels).toBeGreaterThan(0);
  expect(auto.visibleLabels).toBeLessThan(40);
  expect(auto.overlaps).toBe(0);
  expect(auto.onIcons).toBe(0);

  // 'always' restores every label without a remount (the popover path).
  await page.evaluate(() => {
    localStorage.setItem('atlas_map_view_defaults', JSON.stringify({ pin_labels: 'always', zone_labels: 'always' }));
  });
  await page.click('[data-action="map-visual-settings"]');
  await page.click('.atlas-popover-radio-row[data-field="pin_labels"] label:has(input[value="always"])');
  await expect.poll(async () => (await measure()).visibleLabels).toBe(40);
  await page.click('.atlas-popover-radio-row[data-field="pin_labels"] label:has(input[value="auto"])');
  await expect.poll(async () => (await measure()).visibleLabels).toBeLessThan(40);
});

test('a map prints a name once (S382, #121): a zone and the pin of the same name share one label', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Name Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Name Canvas' })).toBeVisible();

  // Moppetopia's shape: a place pinned inside the zone of the same name, plus
  // a zone with no pin of its name.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Name Canvas');
    const loc = await store.createElement('location', { name: 'Snack Nebula' });
    await store.createPin({ map_id: map.id, element_id: loc.id, x: 1000, y: 1000 });
    const square = async (name: string, x0: number, y0: number) => {
      const z = await store.createZone({ name, supertype: 'Polygon' });
      const pts = [[x0, y0], [x0 + 600, y0], [x0 + 600, y0 + 600], [x0, y0 + 600]];
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({ map_id: map.id, zone_id: z.id, x: pts[i][0], y: pts[i][1], order: i + 1 });
      }
    };
    await square('Snack Nebula', 700, 700);
    await square('Crumblefields', 100, 100);
    api.patchData(await store.listElements());
  });
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await expect(container.locator('.leaflet-2d-pin-label')).toHaveCount(1);
  await expect(container.locator('.atlas-zone-label')).toHaveCount(2);

  const shown = async () => container.evaluate((c) =>
    Array.from(c.querySelectorAll<HTMLElement>('.leaflet-2d-pin-label .pin-label-text, .atlas-zone-label span'))
      .filter(e => e.getBoundingClientRect().width > 0 && getComputedStyle(e.closest('.leaflet-marker-icon')!).display !== 'none')
      .map(e => e.textContent!.trim()).sort());
  await expect.poll(shown).toEqual(['Crumblefields', 'Snack Nebula']);
});

test('the zone panel (S356): kinds group, a kind colour is a world style that survives reload, the eye hides a kind, the zone page says what it inherits', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Kinds Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Kinds Canvas' })).toBeVisible();

  // Two rivers, one route (Line zones as another tool writes them) and a chora polygon.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const st = api.getState();
    const map = st.data.elements.find((e: any) => e.type === 'map' && e.name === 'Kinds Canvas');
    const line = async (name: string, subtype: string, y: number) => {
      const z = await store.createZone({ name, supertype: 'Line', subtype });
      await store.createMarker({ map_id: map.id, zone_id: z.id, x: 100, y, order: 1 });
      await store.createMarker({ map_id: map.id, zone_id: z.id, x: 1900, y: y + 50, order: 2 });
      return z.id as string;
    };
    await line('the Anapos', 'River', 300);
    await line('the Hyblaios', 'River', 700);
    await line('Syracuse road', 'Route', 1100);
    const chora = await store.createZone({ name: 'Chora of Gela', supertype: 'Polygon', subtype: 'Chora' });
    for (const [i, [x, y]] of [[400, 1400], [800, 1400], [800, 1800], [400, 1800]].entries()) {
      await store.createMarker({ map_id: map.id, zone_id: chora.id, x, y, order: i + 1 });
    }
    api.patchData(await store.listElements());
  });
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await expect(container.locator('svg path[fill="none"]')).toHaveCount(6); // 3 lines × (visible + hit)

  // The fold-out groups by kind, closed, with counts.
  await page.click('[data-action="zones-dropdown"]');
  const panel = page.locator('[data-role="zones-dropdown-panel"]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.atlas-zone-kind-name')).toHaveText(['Line · River', 'Line · Route', 'Polygon · Chora']);
  await expect(panel.locator('.atlas-zone-chip:visible')).toHaveCount(0);

  // Pick a colour for rivers: both river strokes turn blue, the route does not,
  // and the rule is on disk under .atlas/styles.json.
  const riverKind = panel.locator('.atlas-zone-kind', { hasText: 'Line · River' });
  // The swatch opens atlas's own picker (not the native dialog): a preset
  // commits on click; the hex field commits on Apply. Use the hex path so
  // the exact value is under test, and the panel must stay open through it.
  await riverKind.locator('[data-action="swatch"]').click();
  const picker = page.locator('.atlas-colour-popover');
  await expect(picker).toBeVisible();
  await picker.locator('.atlas-colour-hex').fill('#3b82f6');
  await picker.locator('[data-action="apply"]').click();
  await expect(picker).toHaveCount(0);
  await expect(panel).toBeVisible();
  await expect(container.locator('svg path[stroke="#3b82f6"]')).toHaveCount(2);
  // State lands first and the disk write follows: poll the file, never
  // read it on the DOM's sync point (the S323 law, again).
  await expect.poll(async () => page.evaluate(async () => (await (window as any).__atlasTestApi.getActiveStore().readStyles()).rules))
    .toEqual([{ type: 'zone', supertype: 'Line', subtype: 'River', color: '#3b82f6' }]);

  // Open the kind: its rows; hovering a row lights that zone on the map.
  await riverKind.locator('[data-action="toggle-kind"]').click();
  await expect(riverKind.locator('.atlas-zone-chip:visible')).toHaveCount(2);
  await riverKind.locator('.atlas-zone-chip', { hasText: 'the Anapos' }).hover();
  await expect(container.locator('svg .atlas-zone-hovered')).toHaveCount(1);

  // The eye hides every route on this map (stroke opacity 0), and the panel still lists it.
  const routeKind = panel.locator('.atlas-zone-kind', { hasText: 'Line · Route' });
  await routeKind.locator('[data-action="toggle-kind-visible"]').click();
  await expect(container.locator('svg path[stroke-opacity="0"][stroke-width="2"]')).toHaveCount(1);
  await expect(routeKind).toHaveClass(/is-hidden/);

  // Search narrows to matching zones and opens their kinds.
  await page.fill('[data-role="zone-search"]', 'hybl');
  await expect(panel.locator('.atlas-zone-chip:visible .atlas-zone-chip-name')).toHaveText(['the Hyblaios']);

  // Reload: the rule comes back from the folder; the hide (session-only) does not.
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await expect.poll(async () => page.evaluate(() => (window as any).__atlasTestApi.getState().styles.rules.length), { timeout: 15_000 }).toBe(1);

  // The zone page says where its colour comes from, and the taxonomy swatch lights the subtype.
  const anaposId = await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.name === 'the Anapos').id);
  const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate(({ wid, id }) => { window.location.hash = `#/w/${wid}/element/${id}`; }, { wid, id: anaposId });
  await expect(page.locator('.atlas-zone-visuals-inherit')).toContainText('Colour from the world style for Line · River');
  await expect(page.locator('.atlas-zone-visuals-color')).toHaveValue('#3b82f6');
  await expect(page.locator('.atlas-field-style-swatch')).toHaveCount(1);
  await expect(page.locator('.atlas-zone-visuals-section .atlas-detail-section-hint')).toHaveText('Synced');
});

// F-60 (Seethe h20 #10346): Tab walked out of an open dialog into the page behind, where Enter
// could open a second dialog over the first. What sits behind the topmost modal is inert.
test('an open dialog keeps the keyboard: Tab never reaches the page behind, and closing it gives the page back (F-60)', async ({ page }) => {
  const opener = page.locator('[data-action="new-map"]');
  await opener.focus();
  await page.keyboard.press('Enter');
  const panel = page.locator('[data-modal="create-map"]');
  await expect(panel).toBeVisible();
  const shellInert = () => page.evaluate(() => !!document.querySelector('.atlas-shell')?.closest('[inert]'));
  await expect.poll(shellInert).toBe(true);
  // More Tabs than the panel has stops: each lands in the panel, or leaves the page (never the app).
  const outside: string[] = [];
  for (let i = 0; i < 16; i++) {
    await page.keyboard.press('Tab');
    const where = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return 'body';
      return a.closest('[data-modal="create-map"]') ? 'panel' : (a as HTMLElement).outerHTML.slice(0, 80);
    });
    if (where !== 'panel' && where !== 'body') outside.push(where);
  }
  expect(outside).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(panel).toHaveCount(0);
  await expect.poll(shellInert).toBe(false);
  await expect(opener).toBeFocused();
});

test("the standard's shape (1.75, #362): a zone that says line draws open, one that says polygon closes, whatever else it carries", async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Shape Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Shape Canvas' })).toBeVisible();

  // Three marker lines each; only `shape` tells them apart from what they would draw without it.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Shape Canvas');
    const zoneOf = async (fields: Record<string, unknown>, y: number) => {
      const z = await store.createZone(fields);
      for (const [i, x] of [100, 1000, 1900].entries()) {
        await store.createMarker({ map_id: map.id, zone_id: z.id, x, y: y + i * 60, order: i + 1 });
      }
    };
    await zoneOf({ name: 'the Long River', supertype: 'River', shape: 'line' }, 300);
    await zoneOf({ name: 'the Old Wall', supertype: 'Line', atlas_shape: 'line', shape: 'polygon' }, 900);
    await zoneOf({ name: 'the Unsaid', supertype: 'River', shape: 'Line' }, 1500);
    await zoneOf({ name: 'the Short River', subtype: 'River', shape: 'line' }, 1800);
    api.patchData(await store.listElements());
  });
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await expect(container.locator('.atlas-zone-label')).toHaveCount(4);
  // Two open lines (visible + hit path each); the Old Wall and the Unsaid close.
  // Without `shape` read first: one line (the Old Wall), so 2 paths.
  await expect(container.locator('svg path[fill="none"]')).toHaveCount(4);
});

test('the zone panel by role (S362): rivers split by rank, a role colour paints only its role, a road drawn as its segments is listed and lights them', async ({ page }) => {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Roles Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Roles Canvas' })).toBeVisible();

  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Roles Canvas');
    const line = async (name: string, subtype: string, role: string, y: number) => {
      const z = await store.createZone({ name, supertype: 'Line', subtype, role });
      await store.createMarker({ map_id: map.id, zone_id: z.id, x: 100, y, order: 1 });
      await store.createMarker({ map_id: map.id, zone_id: z.id, x: 1900, y: y + 50, order: 2 });
      return z.id as string;
    };
    await line('the Anapos', 'River', 'major river', 300);
    await line('the Kakyparis', 'River', 'major river', 500);
    await line('a brook', 'River', 'minor stream', 700);
    const s1 = await line('coast road, north', 'Route', 'East Coastal Road', 1100);
    const s2 = await line('coast road, south', 'Route', 'East Coastal Road', 1300);
    // The road itself: no markers, its segments linked (Sikelia's shape).
    await store.createZone({ name: 'East Coastal Road', supertype: 'Line', subtype: 'Road', linked_zones: [s1, s2] });
    api.patchData(await store.listElements());
  });
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await expect(container.locator('svg path[fill="none"]')).toHaveCount(10); // 5 lines x (visible + hit); the road draws nothing

  await page.click('[data-action="zones-dropdown"]');
  const panel = page.locator('[data-role="zones-dropdown-panel"]');
  await expect(panel.locator('.atlas-zone-kind-name')).toHaveText([
    'Line · River · major river', 'Line · River · minor stream', 'Line · Road', 'Line · Route · East Coastal Road',
  ]);

  // A role colour paints the two major rivers and not the brook; the rule on disk names the role.
  const major = panel.locator('.atlas-zone-kind', { hasText: 'major river' });
  await major.locator('[data-action="swatch"]').click();
  const picker = page.locator('.atlas-colour-popover');
  await picker.locator('.atlas-colour-hex').fill('#1d4ed8');
  await picker.locator('[data-action="apply"]').click();
  await expect(container.locator('svg path[stroke="#1d4ed8"]')).toHaveCount(2);
  await expect.poll(async () => page.evaluate(async () => (await (window as any).__atlasTestApi.getActiveStore().readStyles()).rules))
    .toEqual([{ type: 'zone', supertype: 'Line', subtype: 'River', role: 'major river', color: '#1d4ed8' }]);

  // The road: listed with its parts, no colour/tune/eye, and hovering it lights both segments.
  const road = panel.locator('.atlas-zone-kind', { hasText: 'Line · Road' });
  await expect(road.locator('[data-action="swatch"], [data-action="tune"], [data-action="toggle-kind-visible"]')).toHaveCount(0);
  await road.locator('[data-action="toggle-kind"]').click();
  const chip = road.locator('.atlas-zone-chip.is-linked');
  await expect(chip).toContainText('2 parts');
  await chip.hover();
  await expect(container.locator('svg .atlas-zone-hovered')).toHaveCount(2);
});

test('north is up: a pin by the schema\'s bottom-left numbers draws where the standard says, and a click stores bottom-left y (S361)', async ({ page }) => {
  // pin.yaml: "x/y coordinate, from bottom left of the map". Atlas stored y
  // top-down until S361, so every standard world (Sikelia) drew mirrored.
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Compass Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Compass Canvas' })).toBeVisible();

  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Compass Canvas');
    for (const [name, y] of [['Northreach', 1600], ['Midfield', 1000], ['Southmoor', 400]] as const) {
      const loc = await store.createElement('location', { name });
      // x spread so the density layer never has to cull a label.
      await store.createPin({ map_id: map.id, element_id: loc.id, x: name === 'Midfield' ? 1400 : 600, y });
    }
    api.patchData(await store.listElements());
  });
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  await expect(container.locator('.leaflet-2d-pin-label')).toHaveCount(3);

  // READ. Each label hangs the same fixed offset below its anchor, so
  // differences between labels are differences between anchors.
  const tops = await container.evaluate((c) => {
    const top = (name: string) => {
      const label = Array.from(c.querySelectorAll('.leaflet-2d-pin-label'))
        .find(l => l.textContent?.includes(name)) as HTMLElement | undefined;
      const r = label?.getBoundingClientRect();
      return r ? { top: r.top, left: r.left, width: r.width } : null;
    };
    return { north: top('Northreach'), mid: top('Midfield'), south: top('Southmoor') };
  });
  expect({ n: !!tops.north, m: !!tops.mid, s: !!tops.south }).toEqual({ n: true, m: true, s: true });
  // North is up (the old top-down storage drew it at the bottom)...
  expect(tops.north!.top).toBeLessThan(tops.south!.top);
  // ...and y 1000 sits halfway between y 1600 and y 400.
  const midFrac = (tops.mid!.top - tops.north!.top) / (tops.south!.top - tops.north!.top);
  expect(midFrac).toBeGreaterThan(0.4);
  expect(midFrac).toBeLessThan(0.6);

  // WRITE: a click just above the north label, off to its side, stores a y
  // north of centre (the old conversion stored the mirror, south of 1000).
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Clicked Place');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await page.locator('[data-action="pin-element"]').click();
  await expect(page.locator('.atlas-map-placement-hint')).toBeVisible();
  const cBox = (await container.boundingBox())!;
  const n = tops.north!;
  await container.click({ position: { x: n.left - cBox.x + n.width + 40, y: n.top - cBox.y - 6 } });
  await expect(page.locator('.ow-toast', { hasText: 'Pin placed' })).toBeVisible();
  const placed = await page.evaluate(() => {
    const st = (window as any).__atlasTestApi.getState();
    const el = st.data.elements.find((e: any) => e.name === 'Clicked Place');
    const p = st.data.elements.find((e: any) => e.type === 'pin' && e.element_id === el?.id);
    return p ? p.y : null;
  });
  expect(placed).not.toBeNull();
  expect(placed as number).toBeGreaterThan(1300);
});
