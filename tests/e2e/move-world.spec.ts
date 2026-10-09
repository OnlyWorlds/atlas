/**
 * Move to a folder (1.17 bout 4, contract §4, §9 invariants 4-8). Chromium
 * only: the destination is the home folder, which only the folder picker
 * gives. The "drive" here is an OPFS directory handed to the picker, so the
 * whole run is real browser storage on both sides.
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

const ALPHA = '0192a000-0000-7000-8000-00000000aaaa';
const ALPHA_DIR = 'alpha-0192a000-1a2b';

/** One browser world, registered as the app registers one, with an optional api block. */
async function seedBrowserWorld(page: Page, api?: { world_id: string; api_key: string }): Promise<string> {
  return page.evaluate(async ({ worldId, dirName, api }) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds', { create: true });
    const dir = await home.getDirectoryHandle(dirName, { create: true });
    const write = async (d: FileSystemDirectoryHandle, file: string, body: unknown) => {
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(JSON.stringify(body, null, 2) + '\n');
      await w.close();
    };
    await write(dir, 'world.json', api ? { id: worldId, name: 'Alpha', api } : { id: worldId, name: 'Alpha' });
    const chars = await (await dir.getDirectoryHandle('elements', { create: true })).getDirectoryHandle('character', { create: true });
    const now = '2026-01-01T00:00:00.000Z'; // in the past: a later edit must read as newer
    await write(chars, 'ada--0000ada0.json', { id: `${worldId.slice(0, -4)}ada0`, name: 'Ada', type: 'character', ...(api ? { server_updated_at: now, local_updated_at: now } : {}) });
    const media = await dir.getDirectoryHandle('media', { create: true });
    const w = await (await media.getFileHandle('map.png', { create: true })).createWritable();
    await w.write(new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]));
    await w.close();
    const base = { name: 'Alpha', folderName: dirName, handleKey: `world-${worldId}`, pathHint: `browser storage/${dirName}` };
    const { next, entry } = api
      ? (reg as any).createApiLinkedWorld(getState().registry, { ...base, apiWorldId: api.world_id, apiKey: api.api_key })
      : (reg as any).createLocalWorld(getState().registry, base);
    const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
    (reg as any).saveRegistry(withWhere);
    patchSlice('registry', withWhere);
    return entry.id as string;
  }, { worldId: ALPHA, dirName: ALPHA_DIR, api });
}

/** A home folder: an OPFS directory standing in for the drive, set up through the real door. */
async function setHomeFolder(page: Page) {
  await page.evaluate(async () => {
    const drive = await (await navigator.storage.getDirectory()).getDirectoryHandle('the-drive', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(drive);
    const { setupAtlasRoot } = await import('/src/setup/atlas-root-flow.ts');
    await (setupAtlasRoot as any)();
  });
  await page.waitForFunction(() => !!(window as any).__atlasTestApi.getState().atlasRoot);
}

async function activate(page: Page, worldId: string): Promise<boolean> {
  return page.evaluate(async (id) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    return (activateWorld as any)(id, toastManager);
  }, worldId);
}

async function where(page: Page) {
  return page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    const e = getState().registry.worlds.find((w: any) => w.name === 'Alpha');
    const list = async (d: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> => {
      const out: string[] = [];
      // @ts-expect-error entries() is FS Access API
      for await (const [n, h] of d.entries()) {
        const p = prefix ? `${prefix}/${n}` : n;
        if (h.kind === 'directory') out.push(...await list(h, p)); else out.push(p);
      }
      return out.sort();
    };
    const opfs = await navigator.storage.getDirectory();
    // The home folder as Atlas holds it (the door may make its own folder inside the pick).
    const { loadHandle } = await import('/src/store/handle-vault.ts');
    const drive = await (loadHandle as any)('__atlas_root__');
    let browser: string[] = [];
    try { browser = await list(await opfs.getDirectoryHandle('browser-worlds')); } catch { /* none */ }
    return {
      where: e?.where ?? null, folder: e?.folder.folder_name, move: e?.move ?? null, movedFrom: e?.moved_from ?? null,
      drive: (await list(drive)).filter(p => !p.startsWith('.atlas-root') && !p.endsWith('/.atlas/lock')),
      browser,
    };
  });
}

async function openMove(page: Page, worldId: string) {
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/world`; }, worldId);
  await page.locator('.atlas-settings [data-action="move-to-folder"]').click();
  return page.locator('[data-modal="move-browser-world"]');
}

test('a browser world moved to a folder: the folder holds it, the browser copy is gone, and it reopens from the folder', async ({ page }) => {
  await boot(page);
  await setHomeFolder(page);
  const id = await seedBrowserWorld(page);
  expect(await activate(page, id)).toBe(true);
  const modal = await openMove(page, id);
  await expect(modal).toContainText('checks the copy, then removes it from this browser');
  await modal.locator('[data-action="move-confirm"]').click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: '"Alpha" now lives in a folder on your drive' })).toBeVisible();

  const after = await where(page);
  expect(after).toMatchObject({ where: null, folder: 'alpha-0192a000', move: null, movedFrom: null, browser: [] });
  expect(after.drive.filter(p => p.startsWith('alpha-0192a000/') && !p.includes('/.atlas/'))).toEqual([
    'alpha-0192a000/elements/character/ada--0000ada0.json', 'alpha-0192a000/media/map.png', 'alpha-0192a000/world.json',
  ]);
  expect(after.drive.some(p => /\/\.atlas\/move[^/]*\.json$/.test(p))).toBe(false);

  // Settings says where it is now, and offers the folder's actions.
  const tab = page.locator('.atlas-settings');
  await expect(tab.locator('[data-role="stored-in"]')).toHaveCount(0);
  await expect(tab.locator('[data-action="show-folder"]')).toBeVisible();
  await expect(tab.locator('[data-action="move-to-folder"]')).toHaveCount(0);

  // An edit lands in the folder.
  await page.evaluate(async () => {
    const { getActiveStore } = await import('/src/core/active-store.ts');
    await (getActiveStore() as any).createElement('character', { name: 'Bel' });
  });
  expect((await where(page)).drive.some(p => p.startsWith('alpha-0192a000/elements/character/bel--'))).toBe(true);

  // A reload opens it from the folder, whole.
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  expect(await activate(page, id)).toBe(true);
  const names = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return getState().data.elements.map((e: any) => e.name).sort();
  });
  expect(names).toEqual(['Ada', 'Bel']);
});

test('a linked world moved to a folder syncs its next edit', async ({ page }) => {
  const V2 = 'https://www.onlyworlds.com/api/v2';
  const SERVER = '11111111-2222-4333-8444-555555555555';
  const writes: string[] = [];
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    const now = new Date().toISOString();
    if (req.method() !== 'GET') {
      writes.push(`${req.method()} ${path}`);
      const body = req.postDataJSON?.() ?? {};
      if (path.startsWith('/bulk')) return route.fulfill({ json: { created: [], updated: [], errors: [] } });
      return route.fulfill({ json: { ...body, id: path.split('/').filter(Boolean)[1] ?? body.id, updated_at: now } });
    }
    if (path === '/world' || path === '/world/') return route.fulfill({ json: { id: SERVER, name: 'Alpha', updated_at: '2026-01-01T00:00:00.000Z' } });
    const [type, elId] = path.split('/').filter(Boolean);
    // The engine reads an element back before it updates it.
    if (type === 'character' && elId) return route.fulfill({ json: { id: elId, type: 'character', name: 'Ada', updated_at: '2026-01-01T00:00:00.000Z' } });
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
  await boot(page);
  await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const { saveRegistry } = await import('/src/registry/registry.ts');
    const next = { ...getState().registry, pin: '1234' };
    saveRegistry(next); patchSlice('registry', next);
  });
  await setHomeFolder(page);
  const id = await seedBrowserWorld(page, { world_id: SERVER, api_key: 'ow_w_testkey' });
  expect(await activate(page, id)).toBe(true);
  const modal = await openMove(page, id);
  await modal.locator('[data-action="move-confirm"]').click();
  await expect(modal).toHaveCount(0);
  expect((await where(page)).where).toBeNull();
  writes.length = 0;
  await page.evaluate(async () => {
    const { getActiveStore } = await import('/src/core/active-store.ts');
    const { getState } = await import('/src/core/state.ts');
    const { requestPushIfLinked } = await import('/src/sync/sync-attach.ts');
    const ada = getState().data.elements.find((e: any) => e.name === 'Ada');
    await (getActiveStore() as any).updateElement(ada.id, { description: 'moved and still syncing' });
    (requestPushIfLinked as any)();
  });
  await expect.poll(() => writes.some(w => /character/.test(w)), { timeout: 20_000 }).toBe(true);
});

test('two tabs: B, opening the world while A copies it, is told it is being moved and is never offered a take-over', async ({ page }) => {
  await boot(page);
  await setHomeFolder(page);
  const id = await seedBrowserWorld(page);
  expect(await activate(page, id)).toBe(true);
  // A's copy waits at world.json (the last file) until B has tried.
  await page.evaluate(() => {
    const proto = (window as any).FileSystemFileHandle.prototype;
    const orig = proto.createWritable;
    (window as any).__copyGate = new Promise<void>(r => { (window as any).__openCopyGate = r; });
    proto.createWritable = async function (this: FileSystemFileHandle, ...a: unknown[]) {
      if (this.name === 'world.json' && (window as any).__copyGate) {
        (window as any).__copyAtGate = true;
        await (window as any).__copyGate;
      }
      return orig.apply(this, a);
    };
  });
  const modal = await openMove(page, id);
  await modal.locator('[data-action="move-confirm"]').click();
  await page.waitForFunction(() => (window as any).__copyAtGate === true);

  const tabB = await page.context().newPage();
  let dialogs = 0;
  tabB.on('dialog', d => { dialogs++; void d.dismiss(); });
  await tabB.goto('/');
  await tabB.waitForSelector('.atlas-shell');
  expect(await activate(tabB, id)).toBe(false);
  await expect(tabB.locator('.ow-toast', { hasText: 'This world is being moved to a folder in another tab.' })).toBeVisible();
  expect(dialogs).toBe(0);

  // A DUPLICATED tab shares A's tab id (Duplicate copies sessionStorage), so
  // the lock file reads as its own: the world's Web Lock is what refuses it
  // (S373 gate F2).
  const aId = await page.evaluate(() => sessionStorage.getItem('atlas_tab_id'));
  expect(aId).toBeTruthy();
  const dup = await page.context().newPage();
  await dup.addInitScript((id) => { sessionStorage.setItem('atlas_tab_id', id as string); }, aId);
  await dup.goto('/');
  await dup.waitForSelector('.atlas-shell');
  expect(await dup.evaluate(() => sessionStorage.getItem('atlas_tab_id'))).toBe(aId);
  expect(await activate(dup, id)).toBe(false);
  await expect(dup.locator('.ow-toast', { hasText: 'This world is being moved to a folder in another tab.' })).toBeVisible();
  await dup.close();

  await page.evaluate(() => { (window as any).__copyGate = null; (window as any).__openCopyGate(); });
  await expect(modal).toHaveCount(0);
  expect((await where(page)).where).toBeNull();
  // B follows the registry to the folder: it opens there now.
  await expect.poll(() => tabB.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return getState().registry.worlds.find((w: any) => w.name === 'Alpha')?.where ?? null;
  })).toBeNull();
  await tabB.close();
});
