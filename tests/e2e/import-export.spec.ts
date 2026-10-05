/**
 * Import & export room e2e (DESIGN_IMPORT.md). Drives the real room:
 *   - full-world JSON → new world (Mode A)
 *   - loose elements → merge into current world (Mode B)
 *   - bring in / take out tab switch
 *   - export → download an ow.com-compatible JSON
 *
 * Bootstrap mirrors knowledge.spec's freshBoot/setupWorld recipe (OPFS dir +
 * the create-local flow via __atlasTestApi).
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

async function setupWorld(page: Page, name = 'Barovia') {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const dir = await navigator.storage.getDirectory();
    const sub = await dir.getDirectoryHandle('import-e2e-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a local world flips the sidebar to elements mode (S255v3); use
  // that as the mode-independent completion signal instead of a worlds-list row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function openImport(page: Page) {
  await page.click('.atlas-room-nav-btn[data-room="import"]');
  await expect(page.locator('.atlas-import-room h1')).toHaveText('Data');
}

/**
 * Import as new asks where the world lives as its own step (1.17, conv. 129):
 * two rows, the folder first and pre-selected when a home folder is set.
 */
async function importAsNew(page: Page, where: 'folder' | 'browser' = 'folder') {
  await page.click('[data-action="import"]');
  const ask = page.locator('[data-modal="where-ask"]');
  await expect(ask.locator('.atlas-where-row strong')).toHaveText([
    'In a folder on your drive (your AI can work on it)',
    'In this browser',
  ]);
  await expect(ask.locator('input[name="where"][value="folder"]')).toBeChecked();
  await ask.locator(`input[name="where"][value="${where}"]`).check();
  await ask.locator('[data-action="go"]').click();
  await expect(ask).toHaveCount(0);
}

const FULL_WORLD = {
  World: { api_key: '0000000099', name: 'Blood Meridian', description: 'The Glanton gang rides.' },
  Character: [
    { id: '068e5012-d77c-799d-8000-95548fbae78d', name: 'The Kid', birthplace: '068e5110-a410-7cbb-8000-5168e2a14b51' },
  ],
  Location: [{ id: '068e5110-a410-7cbb-8000-5168e2a14b51', name: 'Nacogdoches' }],
};

test('import full-world JSON creates a new world (Mode A)', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  await page.fill('[data-role="paste"]', JSON.stringify(FULL_WORLD));
  await page.click('[data-action="load"]');

  await expect(page.locator('.atlas-import-badge')).toHaveText('full world');
  await expect(page.locator('input[name="imp-mode"][value="new"]')).toBeChecked();
  await expect(page.locator('.atlas-import-name')).toHaveValue('Blood Meridian');

  await importAsNew(page);
  // Import (Mode A) creates and activates the new world; sidebar mode is
  // untouched by the import flow itself, but stays wherever setupWorld left
  // it (elements). Switch back to worlds mode to assert on the row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Blood Meridian' })).toBeVisible();
  // The new world is active and carries its elements + preserved relation.
  await expect.poll(async () => page.evaluate(() => {
    const els = (window as any).__atlasTestApi.getState().data.elements;
    const kid = els.find((e: any) => e.name === 'The Kid');
    return kid?.birthplace ?? null;
  })).toBe('068e5110-a410-7cbb-8000-5168e2a14b51');
});

test('import as new into this browser: the where-step lands a browser world, and Cancel imports nothing', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  await page.fill('[data-role="paste"]', JSON.stringify(FULL_WORLD));
  await page.click('[data-action="load"]');
  // Cancel at the where-step: nothing imported, the review still there.
  await page.click('[data-action="import"]');
  await page.locator('[data-modal="where-ask"] [data-action="cancel"]').click();
  await expect(page.locator('[data-modal="where-ask"]')).toHaveCount(0);
  await expect(page.locator('[data-action="import"]')).toBeEnabled();
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length)).toBe(1);
  // Then into this browser.
  await importAsNew(page, 'browser');
  await expect.poll(async () => page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    const w = s.registry.worlds.find((x: any) => x.name === 'Blood Meridian');
    return w ? { where: w.where ?? null, active: s.active?.worldId === w.id } : null;
  })).toEqual({ where: 'browser', active: true });
});

test('import loose elements merges into the current world (Mode B)', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  await page.fill('[data-role="paste"]', JSON.stringify({ Character: [{ name: 'Toadvine' }] }));
  await page.click('[data-action="load"]');

  await expect(page.locator('.atlas-import-badge')).toHaveText('loose elements');
  await page.click('[data-action="import"]');

  await expect.poll(async () => page.evaluate(() =>
    (window as any).__atlasTestApi.getState().data.elements.some((e: any) => e.name === 'Toadvine'),
  )).toBe(true);
});

const ENVELOPE = {
  format: 'onlyworlds-world-export',
  schema_version: '0.30.00',
  exported_at: '2026-07-22T19:05:12Z',
  world: { id: '068e012b-52a9-79bf-8000-26bb67891425', name: 'Hyperion' },
  elements: {
    character: [{ type: 'character', id: '068e2e60-fc37-789e-8000-a64560195ff8', name: 'The Consul', change_seq: 1 }],
    location: [{ type: 'location', id: '068e2e70-1111-7000-8000-000000000001', name: 'Hegemony' }],
  },
};

test('import the keel envelope creates a world and ADOPTS its world id (S313)', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  await page.fill('[data-role="paste"]', JSON.stringify(ENVELOPE));
  await page.click('[data-action="load"]');

  await expect(page.locator('.atlas-import-badge')).toHaveText('full world');
  await expect(page.locator('input[name="imp-mode"][value="new"]')).toBeChecked();
  await importAsNew(page);

  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  // The created world carries the EXPORTED id verbatim — a lossless round-trip,
  // not a fresh mint.
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__atlasTestApi.getState().active?.meta?.id ?? null,
  )).toBe('068e012b-52a9-79bf-8000-26bb67891425');
});

test('re-importing a world that already exists offers merge-or-new and merges without duplicating (S313)', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  // First import adopts the id, creating + activating the world.
  await page.fill('[data-role="paste"]', JSON.stringify(ENVELOPE));
  await page.click('[data-action="load"]');
  await importAsNew(page);
  // Completion signal: the ADOPTED world is active. The old wait (elements
  // search visible) was vacuous — it is already visible from setupWorld's
  // Barovia, so the test raced on and loaded the second payload while the
  // first import was still writing (S315 flake; the S301 sync-point class).
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__atlasTestApi.getState().active?.meta?.id ?? null,
  )).toBe('068e012b-52a9-79bf-8000-26bb67891425');

  // Re-open import and load the SAME world, now grown by one element. Its id
  // matches a local world, so the mode choice becomes merge-or-separate-copy.
  await openImport(page);
  const grown = {
    ...ENVELOPE,
    elements: {
      ...ENVELOPE.elements,
      object: [{ type: 'object', id: '068e5012-d77c-799d-8000-0000000000c3', name: 'The Steinway' }],
    },
  };
  await page.fill('[data-role="paste"]', JSON.stringify(grown));
  await page.click('[data-action="load"]');

  await expect(page.locator('.atlas-import-warn', { hasText: 'already exists' })).toBeVisible();
  await expect(page.locator('input[name="imp-mode"][value="merge"]')).toBeChecked();
  await page.click('[data-action="import"]');

  // The new element merged in, and no second Hyperion was created.
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__atlasTestApi.getState().data.elements.some((e: any) => e.name === 'The Steinway'),
  )).toBe(true);
  const hyperionCount = await page.evaluate(() =>
    (window as any).__atlasTestApi.getState().registry.worlds.filter((w: any) => w.name === 'Hyperion').length);
  expect(hyperionCount).toBe(1);
});

test('validation surfaces issues and a fix prompt', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  await page.fill('[data-role="paste"]', JSON.stringify({ Character: [{ name: 'X', vibe: 'spooky' }] }));
  await page.click('[data-action="load"]');
  await expect(page.locator('.atlas-import-issues')).toBeVisible();
  await expect(page.locator('[data-action="copy-fix"]')).toBeVisible();
});

test('tabs switch between bring in and take out', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  await expect(page.locator('[data-panel="in"]')).toBeVisible();
  await page.click('.atlas-room-tab[data-tab="out"]');
  await expect(page.locator('[data-panel="out"]')).toBeVisible();
  await expect(page.locator('[data-panel="in"]')).toBeHidden();
  await page.click('.atlas-room-tab[data-tab="in"]');
  await expect(page.locator('[data-panel="in"]')).toBeVisible();
  await expect(page.locator('[data-panel="out"]')).toBeHidden();
});

test('IE6: paste box shows live validity (green valid / red invalid)', async ({ page }) => {
  await setupWorld(page);
  await openImport(page);
  // Not JSON → red border + inline error (debounced ~400ms; assertions auto-retry).
  await page.fill('[data-role="paste"]', 'not json at all');
  await expect(page.locator('[data-role="paste"]')).toHaveClass(/is-invalid/);
  await expect(page.locator('.atlas-import-live.is-invalid')).toBeVisible();
  // Recognizable OW shape → green border + inline read-out.
  await page.fill('[data-role="paste"]', JSON.stringify(FULL_WORLD));
  await expect(page.locator('[data-role="paste"]')).toHaveClass(/is-valid/);
  await expect(page.locator('.atlas-import-live.is-valid')).toContainText('Full world');
});

test('IE3: take-out shows grouped type rows with an all/none toggle', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Strahd' });
    api.patchData(await store.listElements());
  });
  await openImport(page);
  await page.click('.atlas-room-tab[data-tab="out"]');
  await expect(page.locator('.atlas-import-type-all')).toBeVisible();
  await expect(page.locator('.atlas-import-type-row')).toHaveCount(1);
  // Unticking "all types" clears the per-type checkboxes and disables export.
  await page.uncheck('[data-role="all"]');
  await expect(page.locator('.atlas-import-type-row input')).not.toBeChecked();
  await expect(page.locator('[data-action="export"]')).toBeDisabled();
});

test('export downloads an ow.com-compatible JSON', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Strahd' });
    api.patchData(await store.listElements());
  });
  await openImport(page);
  await page.click('.atlas-room-tab[data-tab="out"]');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('[data-action="export"]'),
  ]);
  expect(download.suggestedFilename()).toMatch(/^onlyworlds_.*\.json$/);
});

// S364 gate lens C C5: the Data room remounts per world since S364 (conv. 109),
// and a loaded payload rides across a WORLD switch (load a file, then click
// the world to merge it into), as the S256 room-stable switch intended.
// Leaving for another room still drops it.
test('a loaded payload survives switching worlds in the Data room, not leaving the room', async ({ page }) => {
  await setupWorld(page, 'alpha');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'beta');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await openImport(page);
  await page.fill('[data-role="paste"]', JSON.stringify({ Character: [{ name: 'Toadvine' }] }));
  await page.click('[data-action="load"]');
  await expect(page.locator('.atlas-import-badge')).toBeVisible();
  // The sync point is the NEW room: right after the click the old one is
  // still on screen, badge and all (a first version of this test asserted
  // there and passed with the carry removed).
  await page.evaluate(() => { (document.querySelector('.atlas-import-room') as HTMLElement).dataset.probe = 'old'; });

  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("alpha")');
  await expect(page.locator('.atlas-import-room[data-probe="old"]')).toHaveCount(0);
  await expect(page.locator('.atlas-import-room h1')).toHaveText('Data');
  await expect(page.locator('.atlas-import-badge')).toBeVisible();
  await expect(page.locator('[data-role="paste"]')).toHaveValue(/Toadvine/);

  // Another room, then back: gone, as before.
  await page.click('.atlas-room-nav-btn[data-room="home"]');
  await openImport(page);
  await expect(page.locator('.atlas-import-badge')).toHaveCount(0);
});
