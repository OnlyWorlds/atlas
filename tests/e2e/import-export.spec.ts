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
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: name })).toBeVisible();
}

async function openImport(page: Page) {
  await page.click('.atlas-room-nav-btn[data-room="import"]');
  await expect(page.locator('.atlas-import-room h1')).toHaveText('Import & export');
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

  await page.click('[data-action="import"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Blood Meridian' })).toBeVisible();
  // The new world is active and carries its elements + preserved relation.
  await expect.poll(async () => page.evaluate(() => {
    const els = (window as any).__atlasTestApi.getState().data.elements;
    const kid = els.find((e: any) => e.name === 'The Kid');
    return kid?.birthplace ?? null;
  })).toBe('068e5110-a410-7cbb-8000-5168e2a14b51');
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
