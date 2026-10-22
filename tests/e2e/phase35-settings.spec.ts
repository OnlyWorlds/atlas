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
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function loadRegistry(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!));
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('settings opens to onlyworlds tab; world tab disabled without active world', async ({ page }) => {
  // Pre-root the bare splash hides the gear; the settings route stays live.
  await page.evaluate(() => { window.location.hash = '#/settings'; });
  await expect(page.locator('.atlas-settings')).toBeVisible();
  await expect(page.locator('[data-settings-tab="onlyworlds"]')).toHaveClass(/active/);
  await expect(page.locator('[data-settings-tab="world"]')).toBeDisabled();
  // Account block fields live on the OnlyWorlds page.
  await expect(page.locator('.atlas-settings input[name="email"]')).toBeVisible();
});

test('clicking tabs updates url + visible content', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');

  // Storage tab: device folder + merged sync settings in one place.
  await page.click('[data-settings-tab="storage"]');
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/storage$/);
  await expect(page.locator('.atlas-settings')).toContainText('phase35-root');
  await expect(page.locator('.atlas-settings input[name="pause-all"]')).toBeVisible();

  // Elements tab: field-edit mode radios.
  await page.click('[data-settings-tab="elements"]');
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/elements$/);
  await expect(page.locator('.atlas-settings input[name="field-edit-mode"]').first()).toBeVisible();

  // Maps tab: affordance toggles + view defaults (split out of Editing 2026-07-19).
  await page.click('[data-settings-tab="maps"]');
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings\/maps$/);
  await expect(page.locator('.atlas-settings input[name="show-map-names-in-header"]')).toBeVisible();
  await expect(page.locator('.atlas-settings select[data-map-default="pin_style"]')).toBeVisible();
});

test('storage tab — sync toggles persist to localStorage', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="storage"]');

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

  await page.check('input[name="policy"][value="pause-and-review"]');
  reg = await loadRegistry(page);
  expect(reg.sync_default_policy).toBe('pause-and-review');

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

  // Creating the world flipped the sidebar to elements mode; switch back to
  // worlds mode to see the renamed row.
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Renamed' })).toBeVisible();

  // Stay-offline toggle is only present for api-linked worlds; verify it's absent here.
  await expect(page.locator('input[name="world-paused"]')).toHaveCount(0);
  // Make-online button IS visible (local-only world).
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
});

test('world tab — image URL persists to world.json and mirrors to the home cover', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Cover World');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  // The field exists and starts empty (S311 — the one meta field that had no
  // edit surface anywhere in the ecosystem).
  const input = page.locator('input[name="world-image-url"]');
  await expect(input).toBeVisible();
  await expect(input).toHaveValue('');

  await input.fill('https://example.com/cover.png');
  await input.blur();

  // Persisted through writeWorldMeta — read it back from the store, not the UI.
  await expect.poll(() => page.evaluate(async () => {
    const meta = await (window as any).__atlasTestApi.getActiveStore().readWorldMeta();
    return meta.image_url;
  })).toBe('https://example.com/cover.png');

  // The oversize guard rejects instead of writing (the wire caps at 1024).
  await input.fill('https://example.com/' + 'x'.repeat(1100));
  await input.blur();
  await expect(page.locator('.ow-toast-error')).toContainText('too long');
  const kept = await page.evaluate(async () => {
    const meta = await (window as any).__atlasTestApi.getActiveStore().readWorldMeta();
    return meta.image_url;
  });
  expect(kept).toBe('https://example.com/cover.png');
});

test('world tab: units save trimmed to world.json and print after the numbers that carry them (#149)', async ({ page }) => {
  await setupAtlasRoot(page);
  await createWorld(page, 'Unit World');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  const length = page.locator('input[name="world-length-unit"]');
  await expect(length).toHaveValue('');
  await length.fill('  cm ');
  await length.blur();
  await page.locator('input[name="world-mass-unit"]').fill('stone');
  await page.locator('input[name="world-mass-unit"]').blur();
  await expect.poll(() => page.evaluate(async () => {
    const meta = await (window as any).__atlasTestApi.getActiveStore().readWorldMeta();
    return [meta.length_unit, meta.mass_unit, meta.distance_unit ?? null];
  })).toEqual(['cm', 'stone', null]);
  await expect(length).toHaveValue('cm');

  // A character with a height: the unit rides ::after, the value's text stays the bare number.
  const ids = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const c = await store.createElement('character', { name: 'Tall', height: 180, weight: 12 });
    const m = await store.createElement('map', { name: 'Chart', height: 900 });
    api.patchData(await store.listElements());
    return { c: c.id, m: m.id, w: api.getState().active.worldId };
  });
  const after = (field: string) => page.locator(`[data-field="${field}"] .atlas-field-value`).first()
    .evaluate((el) => [el.textContent, getComputedStyle(el, '::after').content]);
  await page.evaluate(({ w, c }) => { window.location.hash = `#/w/${w}/element/${c}`; }, ids);
  await expect.poll(() => after('height')).toEqual(['180', '" cm"']);
  expect(await after('weight')).toEqual(['12', '" stone"']);

  // Map pixels stay bare.
  await page.evaluate(({ w, m }) => { window.location.hash = `#/w/${w}/element/${m}`; }, ids);
  await expect.poll(() => after('height')).toEqual(['900', 'none']);
});

test('a save that lands while you type in the next field keeps your typing (the units race, S452)', async ({ page }) => {
  // The race the units test kept losing 1 in 5: the first unit's save patches
  // the active world, the panel's markup carries each saved value, so the
  // panel rebuilt and replaced the input still being typed in. Made
  // deterministic here: type, then land a state change while focus is inside.
  await setupAtlasRoot(page);
  await createWorld(page, 'Typing World');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  const mass = page.locator('input[name="world-mass-unit"]');
  await mass.click();
  await mass.pressSequentially('sto');
  await mass.evaluate((el) => { el.dataset.typedIn = 'yes'; });
  await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const active = getState().active!;
    patchSlice('active', { ...active, meta: { ...active.meta, length_unit: 'cm' } });
  });
  // Let the state change finish drawing before reading (a check that runs first can win the race).
  await page.waitForTimeout(300);
  await expect(mass).toHaveAttribute('data-typed-in', 'yes'); // the same field, not a rebuilt one
  await expect(mass).toHaveValue('sto');
  await expect(mass).toBeFocused();
  await mass.pressSequentially('ne');
  await mass.blur();
  await expect.poll(() => page.evaluate(async () => {
    const meta = await (window as any).__atlasTestApi.getActiveStore().readWorldMeta();
    return meta.mass_unit ?? null;
  })).toBe('stone');
  // Once focus leaves, the panel catches up with what changed meanwhile.
  await expect(page.locator('input[name="world-length-unit"]')).toHaveValue('cm');
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
  // Sidebar mode (elements, from world creation) persists across reload via
  // localStorage; switch back to worlds mode to click the row.
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("Fake API World")');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  await expect(page.locator('input[name="world-paused"]')).toBeVisible();
  await expect(page.locator('[data-action="refresh-from-api"]')).toBeVisible();
  await expect(page.locator('[data-action="test-connection"]')).toBeVisible();
  await expect(page.locator('[data-action="unlink-from-api"]')).toBeVisible();
  // Make-online button should NOT appear for api-linked.
  await expect(page.locator('[data-action="make-online"]')).toHaveCount(0);
  // Invite someone (S407): the world's Access pane on onlyworlds.com, a new tab.
  const invite = page.locator('[data-role="invite-line"] a[data-link="invite"]');
  await expect(invite).toBeVisible();
  await expect(invite).toHaveAttribute('href', 'https://www.onlyworlds.com/account/worlds/fake-id/access');
  await expect(invite).toHaveAttribute('target', '_blank');

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
  // Sidebar mode (elements, from world creation) persists across reload via
  // localStorage; switch back to worlds mode to click the row.
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("Linked World")');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');

  // Auto-accept the confirm dialog.
  page.on('dialog', d => d.accept());
  await page.click('[data-action="unlink-from-api"]');

  // The unlink handler is async (awaits resetSyncBaseline). Wait for the
  // visible signal that it completed: make-online replaces unlink in the
  // world tab. Without this, reading localStorage races the handler.
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
  await expect(page.locator('[data-action="unlink-from-api"]')).toHaveCount(0);

  // Registry flipped back to local-only.
  const reg = await loadRegistry(page);
  const world = (reg.worlds as Array<{ state: string; api?: unknown }>)[0];
  expect(world.state).toBe('local-only');
  expect(world.api).toBeUndefined();
});

test('general tab: theme toggle flips data-theme, persists across reload, dark restores (S315)', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/settings/general');
  await expect(page.locator('input[name="app-theme"][value="dark"]')).toBeChecked();
  // The absent half of the pair: no theme attribute in dark mode.
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');

  await page.check('input[name="app-theme"][value="light"]');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  // Persists: a fresh load stamps the attribute pre-paint from localStorage.
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.goto('/#/settings/general');
  await expect(page.locator('input[name="app-theme"][value="light"]')).toBeChecked();
  await page.check('input[name="app-theme"][value="dark"]');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', 'light');
});

test('general tab: a "Help and feedback" group, and the footer version opens the changelog (S368)', async ({ page }) => {
  await page.goto('/#/settings/general');
  const group = page.locator('.atlas-settings [data-role="help-feedback"]');
  await expect(group.locator('h3')).toHaveText('Help and feedback');
  await expect(group.locator('[data-link="feedback"]')).toHaveAttribute('href', 'https://onlyworlds.com/feedback?category=atlas');
  await expect(group.locator('[data-link="feedback"]')).toHaveAttribute('target', '_blank');
  await expect(group.locator('[data-link="discord"]')).toHaveAttribute('href', 'https://discord.gg/twCjqvVBwb');
  await expect(group.locator('[data-link="changelog"]')).toHaveAttribute('href', 'changelog.html');
  await expect(group.locator('[data-link="email"]')).toHaveText('info@onlyworlds.com');
  // The GitHub tracker link was replaced by Send feedback.
  await expect(page.locator('.atlas-settings a[href*="github.com/OnlyWorlds/feedback"]')).toHaveCount(0);

  const version = page.locator('.atlas-settings-version [data-link="version-changelog"]');
  await expect(version).toHaveText(/^Atlas v\d/);
  await expect(version).toHaveAttribute('href', 'changelog.html');
  await expect(version).toHaveAttribute('target', '_blank');
});
