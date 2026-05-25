/**
 * Phase 2 UI — end-to-end flows for the minimal user-facing build.
 *
 * Drives the real DOM via Playwright. The directory picker is swapped for an
 * OPFS-backed handle via `window.__atlasTestApi.setNextDirectory(...)`.
 * Everything downstream is the real code path.
 *
 * Many tests start by setting up the atlas root (one OPFS folder dedicated to
 * atlas), then create worlds inside it via the name-only flow.
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

/** Set up an atlas root by injecting an OPFS subdirectory into the picker. */
async function setupAtlasRoot(page: Page, dirName: string = 'atlas-test-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  // The setup button can be in welcome (no root yet) or in sidebar header.
  // Welcome's CTA is more visible after a fresh reset.
  await page.click('[data-action="setup-atlas"]');
  // Wait for sidebar to flip into "create local" mode.
  await page.waitForSelector('[data-action="create-local"]');
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('first launch shows the setup-atlas CTA, not create-local', async ({ page }) => {
  await expect(page.locator('.atlas-shell')).toBeVisible();
  await expect(page.locator('[data-action="setup-atlas"]').first()).toBeVisible();
  await expect(page.locator('[data-action="create-local"]')).toHaveCount(0);
  await expect(page.locator('.atlas-middle')).toContainText('Welcome to Atlas');
  await expect(page.locator('.atlas-middle')).toContainText('Set up atlas folder');
});

test('set up atlas folder flips the UI into create-local mode', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-a');
  // Sidebar now offers create local.
  await expect(page.locator('[data-action="create-local"]')).toBeVisible();
  await expect(page.locator('[data-action="setup-atlas"]')).toHaveCount(0);
  // Welcome shows the wrapped root: "atlas-worlds" inside the picked folder.
  await expect(page.locator('.atlas-middle')).toContainText('onlyworlds-atlas');
});

test('setup wraps the picked folder by creating atlas-worlds/ subfolder', async ({ page }) => {
  await setupAtlasRoot(page, 'my-parent-folder');
  // The picked folder should now contain an atlas-worlds/ subfolder with a marker.
  const result = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle('my-parent-folder');
    const wrapped = await parent.getDirectoryHandle('onlyworlds-atlas');
    // Verify .atlas-root marker exists inside the wrapped folder.
    const markerHandle = await wrapped.getFileHandle('.atlas-root');
    const text = await (await markerHandle.getFile()).text();
    return { wrappedExists: true, marker: JSON.parse(text) };
  });
  expect(result.wrappedExists).toBe(true);
  expect(result.marker.version).toBe(1);
});

test('re-use: picking a folder that is already an atlas root does NOT double-wrap', async ({ page }) => {
  // Pre-bake a folder that already has the .atlas-root marker.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('existing-root', { create: true });
    const fh = await dir.getFileHandle('.atlas-root', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 1, created_at: new Date().toISOString() }));
    await w.close();
    const api = (window as any).__atlasTestApi;
    api.setNextDirectory(dir);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');

  // Settings panel should show the picked folder as the root (no wrapper created).
  // Create a world to access settings.
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'In Existing Root');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'In Existing Root' })).toBeVisible();
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="storage"]');
  await expect(page.locator('.atlas-settings')).toContainText('existing-root');

  // No atlas-worlds subfolder should have been created.
  const noWrapper = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle('existing-root');
    try {
      await dir.getDirectoryHandle('onlyworlds-atlas');
      return false;
    } catch {
      return true;
    }
  });
  expect(noWrapper).toBe(true);
});

test('create local world inside atlas root → sidebar + welcome + URL', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-b');

  await page.click('[data-action="create-local"]');
  await expect(page.locator('[data-modal="create-world"]')).toBeVisible();
  // No folder picker prompt — the modal hint references the existing root.
  await expect(page.locator('.atlas-modal-hint')).toContainText('atlas-root-b');

  await page.fill('input[name="world-name"]', 'My First World');
  await page.click('[data-action="pick"]');

  await expect(page.locator('[data-modal="create-world"]')).toHaveCount(0);
  const row = page.locator('.atlas-row[data-world-id]', { hasText: 'My First World' });
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/selected/);
  // Active world shows in the sidebar mode toggle's right tab label.
  await expect(page.locator('[data-action="mode-elements"] .atlas-mode-btn-label')).toContainText('My First World');

  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toMatch(/^#\/w\/[0-9a-f-]+$/);

  // Verify the world was actually created inside the wrapped atlas-worlds/ subfolder.
  const layout = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle('atlas-root-b');
    const wrapped = await parent.getDirectoryHandle('onlyworlds-atlas');
    const entries: string[] = [];
    // @ts-ignore values() is FS Access API
    for await (const e of (wrapped as any).values()) entries.push(e.name);
    return entries.sort();
  });
  expect(layout).toContain('.atlas-root');
  expect(layout.some(n => n.startsWith('my-first-world-'))).toBe(true);
});

test('two worlds created in root share parent folder', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-c');

  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Alpha');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Alpha' })).toBeVisible();

  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Beta');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Beta' })).toBeVisible();

  // Beta is the most-recently-created so it's active.
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Beta' })).toHaveClass(/selected/);

  // Switch to Alpha. Session 223 decoupling: clicking a world activates it
  // and navigates to its home URL, but sidebar mode is now independent state
  // (no auto-flip to elements). User stays in worlds mode and sees Alpha
  // become the selected entry in the worlds list.
  await page.click('.atlas-row[data-world-id]:has-text("Alpha")');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Alpha' })).toHaveClass(/selected/);

  // Both worlds live as subfolders inside the wrapped atlas-worlds/ folder.
  const subfolders = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle('atlas-root-c');
    const wrapped = await parent.getDirectoryHandle('onlyworlds-atlas');
    const out: string[] = [];
    // @ts-ignore values()
    for await (const e of (wrapped as any).values()) {
      if (e.kind === 'directory') out.push(e.name);
    }
    return out.sort();
  });
  expect(subfolders.some(n => n.startsWith('alpha-'))).toBe(true);
  expect(subfolders.some(n => n.startsWith('beta-'))).toBe(true);
});

test('settings shows atlas folder + identity fields', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-d');

  // Need a world to access settings (gear sends to /w/<id>/settings which
  // requires an active world). Create one.
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'For Settings');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'For Settings' })).toBeVisible();

  await page.click('[data-action="open-settings"]');
  await expect(page.locator('.atlas-settings')).toBeVisible();

  // Default tab is 'account' — email/pin inputs are visible.
  await page.fill('input[name="email"]', 'titus@example.com');
  await page.locator('input[name="email"]').blur();
  await page.fill('input[name="pin"]', '4242');
  await page.locator('input[name="pin"]').blur();

  // Click storage tab to verify the picked folder name shows up.
  await page.click('[data-settings-tab="storage"]');
  await expect(page.locator('.atlas-settings')).toContainText('atlas-root-d');

  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!));
  expect(stored.email).toBe('titus@example.com');
  expect(stored.pin).toBe('4242');
  // atlas_root.folder_name is the actual root (atlas-worlds wrapper);
  // path_hint preserves the parent context for user-facing display.
  expect(stored.atlas_root.folder_name).toBe('onlyworlds-atlas');
  expect(stored.atlas_root.path_hint).toBe('atlas-root-d/onlyworlds-atlas');
});

test('legacy "atlas-worlds" wrapper is detected on re-pick (no double-wrap)', async ({ page }) => {
  // Simulate a parent folder that contains an already-set-up wrapper using the
  // legacy name. atlas should re-use it instead of creating onlyworlds-atlas/.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle('legacy-parent', { create: true });
    const legacyChild = await parent.getDirectoryHandle('atlas-worlds', { create: true });
    const fh = await legacyChild.getFileHandle('.atlas-root', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ version: 1, created_at: new Date().toISOString() }));
    await w.close();
    const api = (window as any).__atlasTestApi;
    api.setNextDirectory(parent);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');

  // Verify no onlyworlds-atlas/ was created alongside the legacy one.
  const noNewWrapper = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const parent = await root.getDirectoryHandle('legacy-parent');
    try {
      await parent.getDirectoryHandle('onlyworlds-atlas');
      return false;
    } catch {
      return true;
    }
  });
  expect(noNewWrapper).toBe(true);

  // Registry should record the legacy folder name as the actual root.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!));
  expect(stored.atlas_root.folder_name).toBe('atlas-worlds');
  expect(stored.atlas_root.path_hint).toBe('legacy-parent/atlas-worlds');
});

test('reload → atlas root + world both persist, click re-activates', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-e');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Persistent');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Persistent' })).toBeVisible();

  // Reload via `/` — this drops the URL hash, so auto-activate-from-url has no
  // worldId to act on. The world should remain listed but not active.
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');

  // Sidebar still in create-local mode (not setup-atlas) → root recalled from registry+vault.
  await expect(page.locator('[data-action="create-local"]')).toBeVisible();
  await expect(page.locator('[data-action="setup-atlas"]')).toHaveCount(0);

  // World is listed but not active (URL hash was cleared, nothing to auto-restore).
  const row = page.locator('.atlas-row[data-world-id]', { hasText: 'Persistent' });
  await expect(row).toBeVisible();
  await expect(row).not.toHaveClass(/selected/);

  // Click → activates. activateWorld navigates to `#/w/<id>/elements` so the
  // sidebar flips to elements mode. The right tab label reflects the active
  // world's name; that's the durable signal for "world is now active."
  await row.click();
  await expect(page.locator('[data-action="mode-elements"] .atlas-mode-btn-label')).toContainText('Persistent');
});

test('reload with world in URL hash → silent auto-activate preserves state', async ({ page }) => {
  // Set up a world and navigate explicitly to its hash before reloading.
  await setupAtlasRoot(page, 'atlas-root-e2');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'AutoOpen');
  await page.click('[data-action="pick"]');
  const row = page.locator('.atlas-row[data-world-id]', { hasText: 'AutoOpen' });
  await expect(row).toBeVisible();

  // Capture the world's id from its row and build a deep URL into elements mode.
  const worldId = await row.getAttribute('data-world-id');
  expect(worldId).toBeTruthy();

  // Reload preserving the worlds-mode URL for this world.
  await page.goto(`/#/w/${worldId}`);
  await page.waitForSelector('.atlas-shell');

  // OPFS handles auto-grant permission, so silent auto-activate succeeds.
  // The world should show as active in the sidebar without any click.
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'AutoOpen' })).toHaveClass(/selected/);
  // Sidebar mode toggle reflects the active world via its right-tab label.
  await expect(page.locator('[data-action="mode-elements"] .atlas-mode-btn-label')).toContainText('AutoOpen');
});

test('forget world removes it from sidebar + nav to root, atlas root preserved', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-f');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Doomed');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Doomed' })).toBeVisible();

  page.on('dialog', d => d.accept());
  await page.click('[data-action="open-settings"]');
  // Delete-world button lives on the World tab.
  await page.click('[data-settings-tab="world"]');
  await page.click('[data-action="delete-world"]');

  // World list empty but atlas root still present (we forgot the world, not the folder root).
  await expect(page.locator('.atlas-sidebar .atlas-pane-empty')).toBeVisible();
  await expect(page.locator('[data-action="create-local"]')).toBeVisible();
  await expect(page.locator('[data-action="setup-atlas"]')).toHaveCount(0);
});

test('change atlas folder swaps the root without losing existing worlds', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-g1');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Pre-Swap');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Pre-Swap' })).toBeVisible();

  // Go to settings, switch to storage tab, queue a different folder, click change.
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="storage"]');
  await expect(page.locator('.atlas-settings')).toContainText('atlas-root-g1');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('atlas-root-g2', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="change-atlas-root"]');

  // Settings now shows the new folder.
  await expect(page.locator('.atlas-settings')).toContainText('atlas-root-g2');
  // Pre-Swap world is still in the sidebar (its own handle is independent of root).
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Pre-Swap' })).toBeVisible();
});

test('settings gear opens panel without an active world', async ({ page }) => {
  // No atlas root, no worlds — clicking settings should still navigate to the
  // settings panel and let the user set up an atlas folder.
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('.atlas-settings')).toBeVisible();
  await expect(page.locator('.atlas-settings h2')).toContainText(/settings/i);
  // Click the storage tab to verify the "not set up" prompt is in there.
  await page.click('[data-settings-tab="storage"]');
  await expect(page.locator('.atlas-settings')).toContainText(/not set up yet/i);
  await expect(page.locator('[data-action="change-atlas-root"]')).toBeVisible();
  // URL hash uses the standalone settings route (with tab segment).
  const hash = await page.evaluate(() => window.location.hash);
  expect(hash).toMatch(/^#\/settings\/storage$/);
});

test('rescan: re-picking an existing root after a localStorage wipe imports worlds', async ({ page }) => {
  // 1. First-time setup, create two worlds.
  await setupAtlasRoot(page, 'persistent-root');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'kept world');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'kept world' })).toBeVisible();
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'second world');
  await page.click('[data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'second world' })).toBeVisible();

  // 2. Wipe localStorage + IDB ONLY (keep OPFS — that's the disk).
  await page.evaluate(async () => {
    localStorage.clear();
    await new Promise<void>((res) => {
      const req = indexedDB.deleteDatabase('atlas-handles');
      req.onsuccess = () => res();
      req.onerror = () => res();
      req.onblocked = () => res();
    });
  });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');

  // First-launch CTA returns; sidebar is empty.
  await expect(page.locator('[data-action="setup-atlas"]').first()).toBeVisible();
  await expect(page.locator('.atlas-sidebar .atlas-pane-empty')).toBeVisible();

  // 3. Re-pick the SAME parent folder. Discovery should find both worlds.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('persistent-root', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');

  // Both worlds should be visible in the sidebar again.
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'kept world' })).toBeVisible();
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'second world' })).toBeVisible();
});

test('create modal cancel button closes without creating a world', async ({ page }) => {
  await setupAtlasRoot(page, 'atlas-root-h');
  await page.click('[data-action="create-local"]');
  await expect(page.locator('[data-modal="create-world"]')).toBeVisible();
  await page.click('[data-action="cancel"]');
  await expect(page.locator('[data-modal="create-world"]')).toHaveCount(0);
  await expect(page.locator('.atlas-sidebar .atlas-pane-empty')).toBeVisible();
});
