/**
 * Phase 3.5 — Tabbed settings panel.
 *
 * Covers:
 *   - Settings opens to the identity tab by default.
 *   - Clicking a tab updates the URL with the tab segment.
 *   - World tab is disabled when no world is active.
 *   - Atlas tab shows current root.
 *   - Sync tab: toggle pause-all, cadence, default policy, confirm-server-deletes.
 *   - All sync settings persist to localStorage.
 *   - World tab: rename, stay-offline toggle, unlink, refresh button (api-linked only).
 *
 * No real api call — we drive registry state via the test API and inspect
 * resulting localStorage.
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

async function setupAtlasRoot(page: Page, dirName: string = 'phase35-root') {
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

async function loadRegistry(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!));
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('settings opens to identity tab; world tab disabled without active world', async ({ page }) => {
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('.atlas-settings')).toBeVisible();
  await expect(page.locator('[data-settings-tab="identity"]')).toHaveClass(/active/);
  await expect(page.locator('[data-settings-tab="world"]')).toBeDisabled();
  // Identity tab fields are visible.
  await expect(page.locator('.atlas-settings input[name="email"]')).toBeVisible();
});

test('clicking tabs updates url + visible content', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');

  await page.click('[data-settings-tab="atlas"]');
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/atlas$/);
  await expect(page.locator('.atlas-settings')).toContainText('phase35-root');

  await page.click('[data-settings-tab="sync"]');
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/sync$/);
  await expect(page.locator('.atlas-settings input[name="pause-all"]')).toBeVisible();
});

test('sync tab — toggles persist to localStorage', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="sync"]');

  await page.check('input[name="pause-all"]');
  let reg = await loadRegistry(page);
  expect(reg.sync_pause_all).toBe(true);

  await page.uncheck('input[name="pause-all"]');
  reg = await loadRegistry(page);
  expect(reg.sync_pause_all).toBe(false);

  await page.check('input[name="pull-on-activate"]');
  reg = await loadRegistry(page);
  expect(reg.sync_pull_on_activate).toBe(true);

  await page.selectOption('select[name="cadence"]', '300000');
  reg = await loadRegistry(page);
  expect(reg.sync_cadence_ms).toBe(300_000);

  await page.check('input[name="policy"][value="pause-on-conflict"]');
  reg = await loadRegistry(page);
  expect(reg.sync_default_policy).toBe('pause-on-conflict');

  await page.uncheck('input[name="confirm-server-del"]');
  reg = await loadRegistry(page);
  expect(reg.sync_confirm_server_deletes).toBe(false);
});

test('world tab — rename + stay-offline toggle persist', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Original Name');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  // Rename
  await page.fill('input[name="world-name"]', 'Renamed');
  await page.locator('input[name="world-name"]').blur();
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Renamed' })).toBeVisible();

  // Stay-offline toggle is only present for api-linked worlds; verify it's absent here.
  await expect(page.locator('input[name="world-paused"]')).toHaveCount(0);
  // Make-online button IS visible (local-only world).
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
});

test('world tab — api-linked worlds get stay-offline + refresh + unlink + test', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Fake API World');
  // Mark the world as api-linked via direct localStorage mutation (UI-only assertion).
  await page.evaluate(() => {
    const raw = localStorage.getItem('atlas_worlds_registry')!;
    const reg = JSON.parse(raw);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: 'fake-id', api_key: 'fake-key' };
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-row[data-world-id]:has-text("Fake API World")');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  await expect(page.locator('input[name="world-paused"]')).toBeVisible();
  await expect(page.locator('[data-action="refresh-from-api"]')).toBeVisible();
  await expect(page.locator('[data-action="test-connection"]')).toBeVisible();
  await expect(page.locator('[data-action="unlink-from-api"]')).toBeVisible();
  // Make-online button should NOT appear for api-linked.
  await expect(page.locator('[data-action="make-online"]')).toHaveCount(0);

  // Stay-offline toggle persists.
  await page.check('input[name="world-paused"]');
  const reg = await loadRegistry(page);
  expect((reg.worlds as Array<{ sync_paused?: boolean }>)[0].sync_paused).toBe(true);
});

test('unlink-from-api flips state back to local-only', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Linked World');
  await page.evaluate(() => {
    const raw = localStorage.getItem('atlas_worlds_registry')!;
    const reg = JSON.parse(raw);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: 'fake-id', api_key: 'fake-key' };
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-row[data-world-id]:has-text("Linked World")');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  // Auto-accept the confirm dialog.
  page.on('dialog', d => d.accept());
  await page.click('[data-action="unlink-from-api"]');

  // Registry flipped back to local-only.
  const reg = await loadRegistry(page);
  const world = (reg.worlds as Array<{ state: string; api?: unknown }>)[0];
  expect(world.state).toBe('local-only');
  expect(world.api).toBeUndefined();

  // World tab now shows make-online (local-only), not unlink/refresh.
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
  await expect(page.locator('[data-action="unlink-from-api"]')).toHaveCount(0);
});
