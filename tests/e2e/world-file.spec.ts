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
  // The boot reconciliation runs first on the activation chain; a seed that
  // writes browser-worlds/ raw (no make lock) while it runs gets adopted twice
  // (S381: one Firefox run in five). A no-op task queued behind it waits it out.
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
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

  // Open the file through the landing's own door (lens C W5: after a full
  // clear the landing is the only surface, so it must reach the world file).
  await page.click('[data-action="other-ways-in"]');
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

test('Chromium with a home folder: a new world file asks where, and the folder answer lands it there, no browser copy left', async ({ page }) => {
  await boot(page);
  const id = await seedBrowserWorld(page);
  expect(await activate(page, id)).toBe(true);
  const bytes = await downloadToBytes(page, id, true);

  // A fresh start with a home folder set (contract §5.2: the question needs one).
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.setNextDirectory(await (await navigator.storage.getDirectory()).getDirectoryHandle('wf-home', { create: true }));
    await api.setupHomeFolder();
  });
  await page.locator('[data-action="add-world"]').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-modal="add-world"] [data-choice="open-file"]').click(),
  ]);
  await chooser.setFiles({ name: 'alpha.zip', mimeType: 'application/zip', buffer: bytes });
  const ask = page.locator('[data-modal="where-ask"]');
  await expect(ask.locator('input[name="where"]').first()).toHaveAttribute('value', 'folder');
  await expect(ask.locator('input[name="where"][value="folder"]')).toBeChecked();
  await ask.locator('[data-action="go"]').click();
  await expect(page.locator('.ow-toast', { hasText: '"Alpha" now lives in a folder on your drive' })).toBeVisible();

  const after = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    const s = getState();
    const e = s.registry.worlds[0];
    const opfs = await navigator.storage.getDirectory();
    const left: string[] = [];
    try { for await (const [n] of (await opfs.getDirectoryHandle('browser-worlds') as any).entries()) left.push(n); } catch { /* none */ }
    const wrap = await (await opfs.getDirectoryHandle('wf-home')).getDirectoryHandle('onlyworlds-atlas');
    let inFolder = false;
    try { await (await wrap.getDirectoryHandle(e.folder.folder_name)).getFileHandle('world.json'); inFolder = true; } catch { /* absent */ }
    return { n: s.registry.worlds.length, where: e?.where ?? null, active: s.active?.worldId === e?.id, names: s.data.elements.map((x: any) => x.name), left, inFolder };
  });
  expect(after).toEqual({ n: 1, where: null, active: true, names: ['Ada'], left: [], inFolder: true });
});

test('Chromium with a home folder: "In this browser" keeps a new world file in this browser', async ({ page }) => {
  await boot(page);
  const id = await seedBrowserWorld(page);
  expect(await activate(page, id)).toBe(true);
  const bytes = await downloadToBytes(page, id, true);
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.setNextDirectory(await (await navigator.storage.getDirectory()).getDirectoryHandle('wf-home-2', { create: true }));
    await api.setupHomeFolder();
  });
  await page.locator('[data-action="add-world"]').click();
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('[data-modal="add-world"] [data-choice="open-file"]').click(),
  ]);
  await chooser.setFiles({ name: 'alpha.zip', mimeType: 'application/zip', buffer: bytes });
  const ask = page.locator('[data-modal="where-ask"]');
  await ask.locator('input[name="where"][value="browser"]').check();
  await ask.locator('[data-action="go"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Opened "Alpha". It lives in this browser.' })).toBeVisible();
  const where = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds[0]?.where ?? null);
  expect(where).toBe('browser');
});

// Folder spec §4.5 rule 11, §4.7 OW-8 (v0.3.15): a world whose records a tool
// keeps private asks before its file is made; left out unless the person asks.
async function seedPrivateRecords(page: Page) {
  await page.evaluate(async () => {
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    const records = await (await home.getDirectoryHandle('alpha-0192a000-1a2b')).getDirectoryHandle('records', { create: true });
    const write = async (d: FileSystemDirectoryHandle, file: string, body: string) => {
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(body);
      await w.close();
    };
    await write(records, 'RECORDS.json', JSON.stringify([
      { producer: 'lab', format: 'x', version: '1', deltas: false },
      { producer: 'fold', format: 'y', version: '1', deltas: false, private: true },
    ]));
    await write(await records.getDirectoryHandle('fold', { create: true }), 'spine.jsonl', '{}');
    await write(await records.getDirectoryHandle('lab', { create: true }), 'ledger.bin', 'L');
  });
}

async function zipNames(bytes: Buffer): Promise<string[]> {
  const { unzipSync } = await import('fflate');
  return Object.keys(unzipSync(new Uint8Array(bytes))).map(p => p.slice(p.indexOf('/') + 1));
}

for (const engine of ['chromium', 'firefox'] as const) {
  test(`${engine === 'firefox' ? '@firefox ' : ''}a world with private records asks first: left out by default, in when asked, no file when closed`, async ({ page }) => {
    const chromium = engine === 'chromium';
    await boot(page);
    const id = await seedBrowserWorld(page);
    await seedPrivateRecords(page);
    expect(await activate(page, id)).toBe(true);
    await page.evaluate((wid) => { window.location.hash = `#/w/${wid}/settings/world`; }, id);
    const btn = page.locator('.atlas-settings [data-action="download-world"]');
    await expect(btn).toHaveText('Download the whole world');
    const dialog = page.locator('[data-modal="private-records"]');
    const savedBytes = async (): Promise<Buffer> => Buffer.from(await page.evaluate(async () => {
      const f = await (await (await navigator.storage.getDirectory()).getFileHandle('saved-world.zip')).getFile();
      return Array.from(new Uint8Array(await f.arrayBuffer()));
    }));
    if (chromium) {
      await page.evaluate(() => {
        (window as any).showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('saved-world.zip', { create: true });
      });
    }
    // Each answer: the click, the dialog's answer, and the file (null when none is made).
    const run = async (answer: 'leave-out' | 'include' | 'escape'): Promise<string[] | null> => {
      const downloaded = chromium ? null : page.waitForEvent('download', { timeout: answer === 'escape' ? 1500 : 15000 }).catch(() => null);
      await btn.click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('records/fold');
      if (answer === 'escape') await page.keyboard.press('Escape');
      else await dialog.locator(`[data-action="${answer}"]`).click();
      await expect(dialog).toHaveCount(0);
      if (answer === 'escape') {
        await expect(btn).toHaveText('Download the whole world');
        return chromium ? null : ((await downloaded) ? [] : null);
      }
      // The button says Saving… until the file is written (a toast from the run before may still show).
      await expect(btn).toHaveText('Download the whole world');
      if (chromium) return zipNames(await savedBytes());
      const d = await downloaded;
      const { readFileSync } = await import('node:fs');
      return zipNames(readFileSync((await d!.path())!));
    };

    const out = await run('leave-out');
    expect(out).toContain('records/RECORDS.json');
    expect(out).toContain('records/lab/ledger.bin');
    expect(out!.some(p => p.startsWith('records/fold/'))).toBe(false);
    await expect(page.locator('.ow-toast', { hasText: 'Private records were left out.' })).toBeVisible();

    const all = await run('include');
    expect(all).toContain('records/fold/spine.jsonl');

    const before = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds[0]?.kept_download_at);
    if (chromium) await page.evaluate(async () => { await (await navigator.storage.getDirectory()).removeEntry('saved-world.zip'); });
    expect(await run('escape')).toBeNull();
    // Closed: no download recorded, and in Chromium nothing written to the picked file.
    expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds[0]?.kept_download_at)).toBe(before);
    if (chromium) expect((await savedBytes()).length).toBe(0);
  });
}
