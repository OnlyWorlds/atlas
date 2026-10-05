/**
 * The world file (1.17 bout 5, contract §5, §9 invariants 13 and 14): a world
 * downloaded as one file, the site's data cleared, the file opened through
 * "add a world", and the world is back, whole, in this browser. Chromium
 * saves through the save picker (stubbed to an OPFS file: the native dialog
 * cannot be driven); Firefox hands a Blob to its own downloads.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
}

const WID = '0192a000-0000-7000-8000-00000000aaaa';

async function seedBrowserWorld(page: Page): Promise<string> {
  return page.evaluate(async (worldId) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const dirName = 'alpha-0192a000-1a2b';
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds', { create: true });
    const dir = await home.getDirectoryHandle(dirName, { create: true });
    const write = async (d: FileSystemDirectoryHandle, file: string, body: string | Uint8Array) => {
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(body);
      await w.close();
    };
    await write(dir, 'world.json', JSON.stringify({ id: worldId, name: 'Alpha' }, null, 2) + '\n');
    const chars = await (await dir.getDirectoryHandle('elements', { create: true })).getDirectoryHandle('character', { create: true });
    await write(chars, 'ada--0000ada0.json', JSON.stringify({ id: `${worldId.slice(0, -4)}ada0`, name: 'Ada', type: 'character' }, null, 2) + '\n');
    await write(await dir.getDirectoryHandle('media', { create: true }), 'map.png', new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]));
    const { next, entry } = (reg as any).createLocalWorld(getState().registry, {
      name: 'Alpha', folderName: dirName, handleKey: `world-${worldId}`, pathHint: `browser storage/${dirName}`,
    });
    const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
    (reg as any).saveRegistry(withWhere);
    patchSlice('registry', withWhere);
    return entry.id as string;
  }, WID);
}

async function activate(page: Page, worldId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    return (activateWorld as any)(id, toastManager);
  }, worldId);
}

async function downloadToBytes(page: Page, id: string, chromium: boolean): Promise<Buffer> {
  await page.evaluate((wid) => { window.location.hash = `#/w/${wid}/settings/world`; }, id);
  const btn = page.locator('.atlas-settings [data-action="download-world"]');
  await expect(btn).toHaveText('Download the whole world');
  if (chromium) {
    await page.evaluate(() => {
      (window as any).showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('saved-world.zip', { create: true });
    });
    await btn.click();
    await expect(page.locator('.ow-toast', { hasText: 'Keep it: it brings this world back.' })).toBeVisible();
    const bytes = await page.evaluate(async () => {
      const f = await (await (await navigator.storage.getDirectory()).getFileHandle('saved-world.zip')).getFile();
      return Array.from(new Uint8Array(await f.arrayBuffer()));
    });
    return Buffer.from(bytes);
  }
  const [download] = await Promise.all([page.waitForEvent('download'), btn.click()]);
  expect(download.suggestedFilename()).toMatch(/^alpha-\d{4}-\d{2}-\d{2}\.zip$/);
  await expect(page.locator('.ow-toast', { hasText: 'Keep the file: it brings this world back.' })).toBeVisible();
  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  return readFileSync(path!);
}

async function roundTrip(page: Page, chromium: boolean) {
  await boot(page);
  const id = await seedBrowserWorld(page);
  expect(await activate(page, id)).toBe(true);
  const bytes = await downloadToBytes(page, id, chromium);
  expect(bytes.length).toBeGreaterThan(100);

  // Clear the site's data: the list and the worlds go.
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length)).toBe(0);

  // Open the file through "add a world".
  await page.evaluate(async () => {
    const { openAddWorldChooser } = await import('/src/setup/world-doors.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    (openAddWorldChooser as any)(toastManager);
  });
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-modal="add-world"] [data-choice="open-file"]').click(),
  ]);
  await chooser.setFiles({ name: 'alpha.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('.ow-toast', { hasText: 'Opened "Alpha". It lives in this browser.' })).toBeVisible();
  const back = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    const s = getState();
    const e = s.registry.worlds[0];
    return { n: s.registry.worlds.length, where: e?.where ?? null, key: e?.folder.handle_key, active: s.active?.worldId === e?.id, names: s.data.elements.map((x: any) => x.name) };
  });
  expect(back).toEqual({ n: 1, where: 'browser', key: `world-${WID}`, active: true, names: ['Ada'] });

  // The same file again: the world is already here, and nothing is added.
  await page.evaluate(async () => {
    const { openAddWorldChooser } = await import('/src/setup/world-doors.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    (openAddWorldChooser as any)(toastManager);
  });
  const [again] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-modal="add-world"] [data-choice="open-file"]').click(),
  ]);
  await again.setFiles({ name: 'alpha.zip', mimeType: 'application/zip', buffer: bytes });
  await expect(page.locator('.ow-toast', { hasText: 'This world is already in Atlas.' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length)).toBe(1);
}

test('a world downloaded as one file comes back whole after the site data is cleared', async ({ page }) => {
  await roundTrip(page, true);
});

test('@firefox a world downloaded as one file comes back whole after the site data is cleared', async ({ page }) => {
  await roundTrip(page, false);
});
