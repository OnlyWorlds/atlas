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
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: name })).toBeVisible();
}

async function setupWorldA(page: Page) {
  await freshBoot(page);
  await setupAtlasRoot(page, 'elements-test-root');
  await createWorld(page, 'world a');
}

test('right tab is hidden without an active world; worlds tab remains', async ({ page }) => {
  await freshBoot(page);
  // Right tab (per-world label) is rendered only when a world is active. With
  // no active world there's nothing meaningful to switch to.
  await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveCount(0);
  await expect(page.locator('.atlas-mode-btn[data-action="mode-worlds"]')).toBeEnabled();
});

test('elements mode becomes enabled and toggles when a world is active', async ({ page }) => {
  await setupWorldA(page);

  // Worlds mode is active by default.
  await expect(page.locator('.atlas-mode-btn[data-action="mode-worlds"]')).toHaveClass(/active/);

  await page.click('.atlas-mode-btn[data-action="mode-elements"]');

  // URL flipped; elements body rendered.
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/elements$/);
  await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveClass(/active/);
  await expect(page.locator('.atlas-sidebar .atlas-list')).toBeVisible();
  await expect(page.locator('.atlas-sidebar .atlas-pane-empty')).toContainText('no elements yet');
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

test('edit element name via field popover persists to FolderStore', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Original');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  // Click the Name field value in the Base section to open popover.
  const nameRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Name' }) });
  await nameRow.locator('.atlas-field-value').click();
  await expect(page.locator('.atlas-edit-popover')).toBeVisible();

  // Replace value, save.
  const input = page.locator('.atlas-edit-popover .atlas-input');
  await input.fill('Renamed');
  await page.click('.atlas-edit-popover .atlas-btn-primary');

  await expect(page.locator('.atlas-edit-popover')).toHaveCount(0);
  await expect(page.locator('.atlas-middle-header h2')).toContainText('Renamed');
  // Sidebar row reflects rename.
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Renamed' })).toBeVisible();
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

test('delete element returns to elements list and removes the row', async ({ page }) => {
  await setupWorldA(page);
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', 'Doomed');
  await page.click('[data-modal="create-element"] [data-action="create"]');

  page.on('dialog', d => d.accept());
  await page.click('[data-action="delete-element"]');

  // Row gone, URL back to elements list.
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: 'Doomed' })).toHaveCount(0);
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/elements$/);
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
  await expect(page.locator('.atlas-middle-header h2')).toContainText('world a');

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
  await expect(page.locator('.atlas-pane-empty')).toBeVisible();
});
