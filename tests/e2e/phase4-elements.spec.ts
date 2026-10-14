/**
 * Bout A — elements sidebar mode, create modal, minimal detail view.
 *
 * Builds on the Phase 2 atlas-root + create-world flow. Each test starts with
 * an atlas root and one world, then exercises the elements surface.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    await (window as any).__atlasTestApi.resetAll();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupAtlasRoot(page: Page, dirName: string = 'atlas-test-root') {
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
  // Creating a world now flips the sidebar into elements mode (S255v3), so
  // world rows are no longer visible here — wait for the elements body instead.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function setupWorldA(page: Page) {
  await freshBoot(page);
  await setupAtlasRoot(page, 'elements-test-root');
  await createWorld(page, 'world a');
}

test('right tab is hidden without an active world; worlds tab remains', async ({ page }) => {
  await freshBoot(page);
  // Pre-root the whole sidebar header is silent (S255v3); set up a root (no
  // world) so the toggle exists. Right tab (per-world label) is rendered only
  // when a world is active — with none there's nothing meaningful to switch to.
  await setupAtlasRoot(page, 'elements-noworld-root');
  await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveCount(0);
  await expect(page.locator('.atlas-mode-btn[data-action="mode-worlds"]')).toBeEnabled();
});

test('elements mode becomes enabled and toggles when a world is active', async ({ page }) => {
  await setupWorldA(page);

  // Creating a world lands directly in elements mode (S255v3).
  await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveClass(/active/);

  // Toggle back to worlds mode, then forward again, to confirm the switch works.
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await expect(page.locator('.atlas-mode-btn[data-action="mode-worlds"]')).toHaveClass(/active/);

  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  // Session 223 decoupling: toggle clicks change sidebar mode (state), NOT
  // the URL. URL stays on the active world. Elements body renders.
  await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveClass(/active/);
  await expect(page.locator('.atlas-sidebar .atlas-list')).toBeVisible();
  // Empty world: no narration line; the + button pulses and the search field
  // invites creating instead (S255v3).
  await expect(page.locator('[data-role="elements-search"]')).toHaveAttribute('placeholder', 'Create an element…');
});

test('create element from elements sidebar → row + detail view', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  await page.click('[data-action="create-element"]');
  await expect(page.locator('[data-modal="create-element"]')).toBeVisible();

  await page.fill('input[name="element-name"]', 'Aragorn');
  // Default selected type is character — submit directly.
  await page.click('[data-modal="create-element"] [data-action="create"]');

  // Modal closed, row visible, URL updated to element detail.
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);
  const row = page.locator('.atlas-row[data-element-id]', { hasText: 'Aragorn' });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/selected/);
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/element\/[0-9a-f-]+$/);

  // Detail view shows name + type.
  await expect(page.locator('.atlas-middle-header h2')).toContainText('Aragorn');
});

test('default new-element type from settings preselects the create modal category', async ({ page }) => {
  await setupWorldA(page);

  // Set the default create type to 'location' via Settings → Elements.
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="elements"]');
  await page.selectOption('.atlas-settings select[name="default-create-type"]', 'location');

  // Persists to the ui-prefs localStorage object.
  expect(
    await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_ui_prefs')!).defaultCreateType)
  ).toBe('location');

  // Open the create modal with no explicit type → it should preselect Location.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await expect(page.locator('[data-modal="create-element"]')).toBeVisible();
  await expect(page.locator('.atlas-create-type-btn[data-type="location"]')).toHaveClass(/active/);
  // OnlyWorlds labels are lowercase throughout.
  await expect(page.locator('input[name="element-type"]')).toHaveValue('location');
});

test('create multiple elements of different types and filter by type', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  // Character
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Aragorn');
  await page.click('.atlas-create-type-btn[data-type="character"]');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Aragorn' })).toBeVisible();

  // Location
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Rivendell');
  await page.click('.atlas-create-type-btn[data-type="location"]');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Rivendell' })).toBeVisible();

  // Species
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Elf');
  await page.click('.atlas-create-type-btn[data-type="species"]');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Elf' })).toBeVisible();

  // All three visible.
  await expect(page.locator('.atlas-row[data-element-id]')).toHaveCount(3);

  // Filter to character only.
  await page.click('.atlas-filter-btn[data-filter-type="character"]');
  await expect(page.locator('.atlas-row[data-element-id]')).toHaveCount(1);
  await expect(page.locator('.atlas-row[data-element-id]')).toContainText('Aragorn');

  // Clear filter — all visible again.
  await page.click('.atlas-filter-btn[data-filter-type="character"]');
  await expect(page.locator('.atlas-row[data-element-id]')).toHaveCount(3);
});

test('search input filters element list', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  // Add three with distinct names.
  for (const name of ['Aragorn', 'Frodo', 'Boromir']) {
    await page.click('[data-action="create-element"]');
    await page.fill('input[name="element-name"]', name);
    await page.click('[data-modal="create-element"] [data-action="create"]');
    await expect(page.locator('.atlas-row[data-element-id]', { hasText: name })).toBeVisible();
  }

  await page.fill('[data-role="elements-search"]', 'ar');
  // Aragorn matches "ar"; Boromir matches "ar" in "Boromar"? no — Boromir contains no "ar".
  // Actually: aragorn (yes), boromir (no), frodo (no).
  await expect(page.locator('.atlas-row[data-element-id]')).toHaveCount(1);
  await expect(page.locator('.atlas-row[data-element-id]')).toContainText('Aragorn');

  await page.fill('[data-role="elements-search"]', '');
  await expect(page.locator('.atlas-row[data-element-id]')).toHaveCount(3);
});

test('edit element name via the header title persists to FolderStore', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Original');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  // The name is edited via the header's click-to-edit title (convention #80) —
  // there is NO separate Name field in the Base section (F1).
  const title = page.locator('.atlas-middle-header h2.atlas-element-name');
  await expect(title).toContainText('Original');
  await title.click();
  const input = page.locator('.atlas-middle-header input.atlas-element-name-input');
  await input.waitFor({ state: 'visible' });
  await input.fill('Renamed');
  await input.press('Enter');

  await expect(title).toContainText('Renamed');
  // Sidebar row reflects rename.
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Renamed' })).toBeVisible();

  // TYPED rename with a SPACE (S312 regression): the h2's activation listener
  // used to swallow every Space typed inside the mounted rename input
  // (preventDefault before the input saw it — Captain had to PASTE names with
  // spaces) and re-open the editor on Enter. fill() bypasses per-key handling,
  // which is exactly why the assertion above never caught it — this leg types
  // real keystrokes.
  await title.click();
  await input.waitFor({ state: 'visible' });
  await input.press('ControlOrMeta+a');
  await input.pressSequentially('Frodo of the Shire');
  await input.press('Enter');
  await expect(title).toContainText('Frodo of the Shire');
});

test('edit element description via field popover (textarea)', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Bilbo');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  const descRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Description' }) });
  await descRow.locator('.atlas-field-value').click();
  await expect(page.locator('.atlas-edit-popover')).toBeVisible();

  const textarea = page.locator('.atlas-edit-popover .atlas-textarea');
  await textarea.fill('Bagginses of Bag End, master of riddles.');
  // Long widget: Ctrl+Enter saves.
  await textarea.press('Control+Enter');
  await expect(page.locator('.atlas-edit-popover')).toHaveCount(0);
  await expect(descRow.locator('.atlas-field-value')).toContainText('Bagginses of Bag End');
});

test('delete element returns to home and removes the row', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Doomed');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  page.on('dialog', d => d.accept());
  await page.click('[data-action="delete-element"]');

  // Row gone, URL back to home (session 223: delete navigates to home, not
  // /elements, since sidebar mode is independent of URL now).
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Doomed' })).toHaveCount(0);
  expect(await page.evaluate(() => window.location.hash)).toMatch(/#\/w\/[0-9a-f-]+$/);
});

test('reload preserves elements via FolderStore (cache rehydrates on activate)', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Persistent Knight');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Persistent Knight' })).toBeVisible();

  // Reload — world auto-listed but not auto-activated (sidebar click needed).
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await page.locator('.atlas-row[data-world-id]', { hasText: 'world a' }).click();
  await expect(page.locator('[data-action="mode-elements"] .atlas-mode-btn-label')).toContainText('world a');

  // Switch to elements mode — knight should still be there.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Persistent Knight' })).toBeVisible();
});

test('switching worlds resets the elements view to the new world', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'multi-root');
  await createWorld(page, 'world alpha');
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'alpha hero');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'alpha hero' })).toBeVisible();

  // Switch back to worlds mode and make a second world.
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await createWorld(page, 'world beta');

  // Now active world is beta — switch to elements mode, alpha hero must NOT appear.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'alpha hero' })).toHaveCount(0);
  // Empty world: no narration line; the search field placeholder invites
  // creating instead (S255v3).
  await expect(page.locator('[data-role="elements-search"]')).toHaveAttribute('placeholder', 'Create an element…');
});

test('muted types (S356): pins and markers close the strip greyed, stay out of "show all", list when filtered to, right-click toggles and persists per world', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  // A place, a map, a pin on it, and a zone with two markers.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const loc = await store.createElement('location', { name: 'Syracuse' });
    const map = await store.createElement('map', { name: 'Sicily', width: 2000, height: 2000 });
    await store.createPin({ map_id: map.id, element_id: loc.id, x: 100, y: 100 });
    const zone = await store.createZone({ name: 'the Anapos', supertype: 'Line', subtype: 'River' });
    await store.createMarker({ map_id: map.id, zone_id: zone.id, x: 100, y: 100, order: 1 });
    await store.createMarker({ map_id: map.id, zone_id: zone.id, x: 900, y: 900, order: 2 });
    api.patchData(await store.listElements());
  });

  const strip = page.locator('.atlas-filter-strip');
  const types = await strip.locator('.atlas-filter-btn').evaluateAll(btns => btns.map(b => b.getAttribute('data-filter-type')));
  expect(types.slice(-2)).toEqual(['pin', 'marker']);
  await expect(strip.locator('.atlas-filter-btn.muted')).toHaveCount(2);

  // Showing all: the place, the map and the zone; no pin, no marker.
  const rowTypes = () => page.locator('.atlas-row[data-element-id]').evaluateAll(rows => rows.map(r => r.getAttribute('data-element-type')).sort());
  expect(await rowTypes()).toEqual(['location', 'map', 'zone']);

  // Filter TO markers: they list.
  await strip.locator('[data-filter-type="marker"]').click();
  expect(await rowTypes()).toEqual(['marker', 'marker']);
  await strip.locator('[data-filter-type="marker"]').click();

  // Right-click unmutes markers: they join "show all"; the choice is saved for this world.
  await strip.locator('[data-filter-type="marker"]').click({ button: 'right' });
  await expect(strip.locator('.atlas-filter-btn.muted')).toHaveCount(1);
  expect(await rowTypes()).toEqual(['location', 'map', 'marker', 'marker', 'zone']);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_muted_types') ?? '{}'));
  expect(Object.values(saved)[0]).toEqual(['pin']);

  // Right-click a content type mutes it (and drops it from an active filter).
  await strip.locator('[data-filter-type="location"]').click();
  await strip.locator('[data-filter-type="location"]').click({ button: 'right' });
  await expect(strip.locator('[data-filter-type="location"]')).toHaveClass(/muted/);
  await expect(strip.locator('[data-filter-type="location"]')).not.toHaveClass(/active/);
  expect(await rowTypes()).toEqual(['map', 'marker', 'marker', 'zone']);
});

test('type names on the strip (#24, h20 B8): icons by default, the held types named, or every type', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  const worldId = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Ada' });
    await store.createElement('character', { name: 'Bram' });
    await store.createElement('location', { name: 'Harbour' });
    api.patchData(await store.listElements());
    return api.getState().active.worldId;
  });
  const strip = page.locator('.atlas-filter-strip');
  const names = strip.locator('.atlas-filter-name');
  const pick = async (value: string) => {
    await page.evaluate((h) => { window.location.hash = h; }, `#/w/${worldId}/settings/elements`);
    await page.locator(`input[name="type-strip-names"][value="${value}"]`).check();
  };

  // A, the default: icons only, the name on hover.
  await expect(strip).toHaveAttribute('data-names', 'icons');
  await expect(names).toHaveCount(0);

  // C: the two held types named, first, with their counts; a break; the rest icons.
  await pick('held');
  await expect(strip).toHaveAttribute('data-names', 'held');
  await expect(names).toHaveText(['Characters', 'Locations']);
  const order = await strip.locator('.atlas-filter-btn, .atlas-filter-break').evaluateAll(els =>
    els.slice(0, 3).map(e => e.classList.contains('atlas-filter-break') ? 'break' : e.getAttribute('data-filter-type')));
  expect(order).toEqual(['character', 'location', 'break']);
  await expect(strip.locator('[data-filter-type="character"] .atlas-filter-count')).toHaveText('2');
  // A named chip says its name, so no hover tip doubles it; an icon keeps its tip.
  await expect(strip.locator('[data-filter-type="character"]')).not.toHaveAttribute('data-tip', /.+/);
  await expect(strip.locator('[data-filter-type="creature"]')).toHaveAttribute('data-tip', 'creatures');

  // B: every type named.
  await pick('all');
  const buttons = await strip.locator('.atlas-filter-btn').count();
  await expect(names).toHaveCount(buttons);
  await expect(strip.locator('.atlas-filter-break')).toHaveCount(0);
  const saved = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.editor_settings?.type_strip_names);
  expect(saved).toBe('all');

  // Back to A.
  await pick('icons');
  await expect(names).toHaveCount(0);
});

/** Setup shortcut through the active FolderStore (the real FsFolderStore on OPFS). */
async function storeCreate(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const created = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return created.id;
  }, { type, data });
}

async function storeField(page: Page, id: string, field: string): Promise<unknown> {
  return await page.evaluate(async ({ id, field }) => {
    const el = await (window as any).__atlasTestApi.getActiveStore().getElement(id);
    return el?.[field];
  }, { id, field });
}

test('deleting an element removes it from every link that named it (S362, keel parity)', async ({ page }) => {
  await setupWorldA(page);
  const castle = await storeCreate(page, 'location', { name: 'Castle' });
  const strahd = await storeCreate(page, 'character', { name: 'Strahd', location: castle });
  const feast = await storeCreate(page, 'event', { name: 'Feast', locations: [castle] });

  await page.evaluate((id) => { window.location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/element/${id}`; }, castle);
  await expect(page.locator('.atlas-middle-header h2')).toContainText('Castle');
  page.on('dialog', d => d.accept());
  await page.click('[data-action="delete-element"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Castle' })).toHaveCount(0);

  await expect.poll(() => storeField(page, strahd, 'location')).toBeNull();
  expect(await storeField(page, feast, 'locations')).toEqual([]);
});

test('Settings → World offers to remove links to elements that are gone (local world)', async ({ page }) => {
  await setupWorldA(page);
  const kept = await storeCreate(page, 'location', { name: 'Village' });
  // A link left behind by a delete from before the scrub, or a partial import.
  const strahd = await storeCreate(page, 'character', { name: 'Strahd', location: '0199aaaa-0000-7000-8000-00000000dead', species: [] });
  const ireena = await storeCreate(page, 'character', { name: 'Ireena', location: kept });

  await page.evaluate(() => { const api = (window as any).__atlasTestApi; window.location.hash = `#/w/${api.getState().active.worldId}/settings/world`; });
  const box = page.locator('.atlas-settings [data-role="dangling-links"]');
  await expect(box).toBeVisible();
  await expect(box).toContainText('1 element links to something no longer in this world');
  await box.locator('[data-action="remove-dangling-links"]').click();
  await expect(box).toBeHidden();

  expect(await storeField(page, strahd, 'location')).toBeNull();
  expect(await storeField(page, ireena, 'location')).toBe(kept);
});
