/**
 * Worlds in browser storage (1.17, conv. 129). Bout 0: a browser world is
 * found by its path under `browser-worlds/`, and one whose directory the
 * browser no longer holds keeps its row (and its link), marked cleared, and
 * never hears "Your files are safe". Each case runs in Chromium and, tagged
 * @firefox, in real Firefox.
 * Contract: Forge/Notes/2026-10-04-browser-worlds-contract.md §1.3, §3.3.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
}

/** Two browser worlds, registered as the app would register them. */
async function seedTwoBrowserWorlds(page: Page): Promise<{ a: string; b: string }> {
  return page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const root = await navigator.storage.getDirectory();
    const home = await root.getDirectoryHandle('browser-worlds', { create: true });
    const make = async (name: string, worldId: string, dirName: string) => {
      const dir = await home.getDirectoryHandle(dirName, { create: true });
      const write = async (d: FileSystemDirectoryHandle, file: string, body: unknown) => {
        const w = await (await d.getFileHandle(file, { create: true })).createWritable();
        await w.write(JSON.stringify(body, null, 2) + '\n');
        await w.close();
      };
      await write(dir, 'world.json', { id: worldId, name });
      const chars = await (await dir.getDirectoryHandle('elements', { create: true })).getDirectoryHandle('character', { create: true });
      await write(chars, `ada--${worldId.slice(-8)}.json`, { id: `${worldId}-ada`, name: 'Ada', type: 'character' });
      const { next, entry } = (reg as any).createLocalWorld(getState().registry, {
        name, folderName: dirName, handleKey: `world-${worldId}`, pathHint: `browser storage/${dirName}`,
      });
      const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
      (reg as any).saveRegistry(withWhere);
      patchSlice('registry', withWhere);
      return entry.id as string;
    };
    const a = await make('Alpha', '0192a000-0000-7000-8000-00000000aaaa', 'alpha-0192a000-1a2b');
    const b = await make('Beta', '0192b000-0000-7000-8000-00000000bbbb', 'beta-0192b000-3c4d');
    return { a, b };
  });
}

async function activate(page: Page, worldId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    return (activateWorld as any)(id, toastManager);
  }, worldId);
}

async function goneKeepsItsRow(page: Page) {
  await boot(page);
  const { a, b } = await seedTwoBrowserWorlds(page);

  // A browser world opens from its path: no vault handle was ever stored.
  expect(await activate(page, a)).toBe(true);
  await expect.poll(() => page.evaluate(async () => (await import('/src/core/state.ts')).getState().active?.worldId)).toBe(a);

  // The browser clears Beta's storage.
  await page.evaluate(async () => {
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    await home.removeEntry('beta-0192b000-3c4d', { recursive: true });
  });

  expect(await activate(page, b)).toBe(false);
  const after = await page.evaluate(async (id) => {
    const { getState } = await import('/src/core/state.ts');
    const e = getState().registry.worlds.find((w: any) => w.id === id);
    const stored = JSON.parse(localStorage.getItem('atlas_worlds_registry')!).worlds.find((w: any) => w.id === id);
    return { kept: !!e, cleared: e?.cleared_at ?? null, storedCleared: stored?.cleared_at ?? null, active: getState().active?.worldId };
  }, b);
  expect(after.kept).toBe(true);
  expect(after.cleared).not.toBeNull();
  expect(after.storedCleared).not.toBeNull();
  expect(after.active).toBe(a); // still on Alpha
  await expect(page.locator('body')).not.toContainText('Your files are safe');
  await expect(page.locator('.ow-toast').filter({ hasText: 'cleared by this browser' })).toBeVisible();

  // The row says so, and still does after a reload (the boot reconciliation
  // keeps the mark; it never drops the entry).
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  const row = page.locator('.atlas-row[data-world-id]', { hasText: 'Beta' });
  await expect(row.locator('.atlas-world-state-chip.cleared')).toHaveText('cleared');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Alpha' }).locator('.atlas-world-state-chip.cleared')).toHaveCount(0);

  // Removed only on the user's word.
  page.once('dialog', d => d.accept());
  await row.hover();
  await row.locator('[data-role="remove-cleared"]').click();
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'Beta' })).toHaveCount(0);
}

/** The registry lost (localStorage cleared), the browser storage kept: the world comes back. */
async function lostRegistryReadopts(page: Page) {
  await boot(page);
  await seedTwoBrowserWorlds(page);
  await page.evaluate(() => localStorage.removeItem('atlas_worlds_registry'));
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await expect.poll(() => page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return getState().registry.worlds.filter((w: any) => w.where === 'browser').map((w: any) => w.name).sort().join(',');
  })).toBe('Alpha,Beta');
}

test('a browser world opens from its path, and one whose storage is gone keeps its row', async ({ page }) => {
  await goneKeepsItsRow(page);
});

test('@firefox a browser world opens from its path, and one whose storage is gone keeps its row', async ({ page }) => {
  await goneKeepsItsRow(page);
});

test('boot re-adopts browser worlds whose registry was lost', async ({ page }) => {
  await lostRegistryReadopts(page);
});

test('@firefox boot re-adopts browser worlds whose registry was lost', async ({ page }) => {
  await lostRegistryReadopts(page);
});

/** Open the create dialog the way every door does (the runner). */
async function openCreate(page: Page) {
  await page.evaluate(async () => {
    const { runAddWorldAction } = await import('/src/setup/world-doors.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    void (runAddWorldAction as any)('create-local', toastManager);
  });
  await page.waitForSelector('[data-modal="create-world"]');
}

async function createdWorld(page: Page, name: string) {
  return page.evaluate(async (n) => {
    const { getState } = await import('/src/core/state.ts');
    const e = getState().registry.worlds.find((w: any) => w.name === n);
    if (!e) return null;
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    const dir = await home.getDirectoryHandle(e.folder.folder_name);
    let marker = true;
    try { await (await dir.getDirectoryHandle('.atlas')).getFileHandle('making'); } catch { marker = false; }
    return { where: e.where ?? null, folder: e.folder.folder_name, marker, active: getState().active?.worldId === e.id };
  }, name);
}

test('on Chromium the create dialog asks where, folder first, and "In this browser" makes a browser world', async ({ page }) => {
  await boot(page);
  await openCreate(page);
  const rows = page.locator('[data-modal="create-world"] .atlas-where-row strong');
  await expect(rows).toHaveText(['In a folder on your drive (your AI can work on it)', 'In this browser']);
  // No home folder and no earlier pick: this browser is pre-selected.
  await expect(page.locator('[data-modal="create-world"] input[name="where"][value="browser"]')).toBeChecked();
  await page.fill('[data-modal="create-world"] input[name="world-name"]', 'Hollow Reach');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect.poll(() => createdWorld(page, 'Hollow Reach')).toMatchObject({ where: 'browser', marker: false, active: true });
});

test('@firefox the create dialog says the world lives in this browser, and makes it there', async ({ page }) => {
  await boot(page);
  await openCreate(page);
  await expect(page.locator('[data-modal="create-world"] .atlas-where-row')).toHaveCount(0);
  await expect(page.locator('[data-modal="create-world"] [data-role="where-browser"]')).toHaveText('It lives in this browser.');
  await page.fill('[data-modal="create-world"] input[name="world-name"]', 'Hollow Reach');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect.poll(() => createdWorld(page, 'Hollow Reach')).toMatchObject({ where: 'browser', marker: false, active: true });
});
