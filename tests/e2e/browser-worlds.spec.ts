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
  // The boot reconciliation runs first on the activation chain; a seed that
  // writes browser-worlds/ raw (no make lock) while it runs gets adopted twice
  // (S381: one Firefox run in five). A no-op task queued behind it waits it out.
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
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
  await expect(rows).toHaveText(['In a folder on your drive', 'In this browser']);
  // No home folder and no earlier pick: this browser is pre-selected.
  await expect(page.locator('[data-modal="create-world"] input[name="where"][value="browser"]')).toBeChecked();
  await page.fill('[data-modal="create-world"] input[name="world-name"]', 'Hollow Reach');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect.poll(() => createdWorld(page, 'Hollow Reach')).toMatchObject({ where: 'browser', marker: false, active: true });
});

test('@firefox the create dialog says the world lives in this browser, and makes it there', async ({ page }) => {
  await boot(page);
  // Firefox may never answer persist() (contract §2.3, gate B M8): the make
  // must not wait on it. Pinned here as a promise that never settles.
  await page.evaluate(() => {
    (window as any).__persistCalls = 0;
    (navigator.storage as any).persist = () => { (window as any).__persistCalls++; return new Promise(() => {}); };
  });
  await openCreate(page);
  await expect(page.locator('[data-modal="create-world"] .atlas-where-row')).toHaveCount(0);
  await expect(page.locator('[data-modal="create-world"] [data-role="where-browser"]')).toHaveText('It lives in this browser.');
  await page.fill('[data-modal="create-world"] input[name="world-name"]', 'Hollow Reach');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect.poll(() => createdWorld(page, 'Hollow Reach')).toMatchObject({ where: 'browser', marker: false, active: true });
  expect(await page.evaluate(() => (window as any).__persistCalls)).toBe(1);
});

// ---------------------------------------------------------------------------
// Bringing a world down into this browser (bout 2): the link door through a
// page.route fake keel (the recipe of phase3-link-api.spec).
// ---------------------------------------------------------------------------

const V2 = 'https://www.onlyworlds.com/api/v2';
const SERVER_WORLD = '11111111-2222-4333-8444-555555555555';

async function mockKeel(page: Page, characters: number) {
  const now = '2026-10-05T12:00:00.000Z';
  const chars = Array.from({ length: characters }, (_, i) => ({
    id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    type: 'character', name: `Character ${i}`, updated_at: now, created_at: now,
  }));
  await page.route(`${V2}/**`, async (route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v2', '');
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: { id: SERVER_WORLD, name: 'Big World', updated_at: now } });
    }
    const type = path.split('/').filter(Boolean)[0];
    return route.fulfill({ json: { data: type === 'character' ? chars : [], has_more: false, next_cursor: null } });
  });
}

async function openLink(page: Page) {
  await page.evaluate(async () => {
    const { runAddWorldAction } = await import('/src/setup/world-doors.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    void (runAddWorldAction as any)('link-api', toastManager);
  });
  await page.waitForSelector('[data-modal="link-world"]');
  await page.fill('[data-modal="link-world"] input[name="api-key"]', 'ow_w_testkey');
  await page.fill('[data-modal="link-world"] input[name="api-pin"]', '1234');
}

async function linkedBrowserWorld(page: Page) {
  return page.evaluate(async (serverId) => {
    const { getState } = await import('/src/core/state.ts');
    const e = getState().registry.worlds.find((w: any) => w.api?.world_id === serverId);
    if (!e) return null;
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    const dir = await home.getDirectoryHandle(e.folder.folder_name);
    let marker = true;
    try { await (await dir.getDirectoryHandle('.atlas')).getFileHandle('making'); } catch { marker = false; }
    const meta = JSON.parse(await (await (await dir.getFileHandle('world.json')).getFile()).text());
    return {
      where: e.where ?? null, state: e.state, marker, worldJsonApi: meta.api?.world_id ?? null,
      active: getState().active?.worldId === e.id, elements: getState().data.elements.length,
    };
  }, SERVER_WORLD);
}

async function browserHomeDirs(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    let home: FileSystemDirectoryHandle;
    try { home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds'); } catch { return []; }
    const names: string[] = [];
    // @ts-expect-error values() is FS Access API
    for await (const e of home.values()) names.push(e.name);
    return names.sort(); // listing order is the engine's
  });
}

async function linkLandsInBrowser(page: Page, folderMode: boolean) {
  await boot(page);
  await mockKeel(page, 30);
  await openLink(page);
  const modal = page.locator('[data-modal="link-world"]');
  if (folderMode) {
    await expect(modal.locator('.atlas-where-row strong')).toHaveText(['In a folder on your drive', 'In this browser']);
    await expect(modal.locator('input[name="where"][value="browser"]')).toBeChecked();
  } else {
    await expect(modal.locator('.atlas-where-row')).toHaveCount(0);
    await expect(modal.locator('[data-role="where-browser"]')).toHaveText('It lives in this browser.');
  }
  await modal.locator('[data-action="link"]').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => linkedBrowserWorld(page)).toEqual({
    where: 'browser', state: 'api-linked', marker: false, worldJsonApi: SERVER_WORLD, active: true, elements: 30,
  });
}

test('a world brought down from OnlyWorlds lands in this browser, whole', async ({ page }) => {
  await linkLandsInBrowser(page, true);
});

test('@firefox a world brought down from OnlyWorlds lands in this browser, whole', async ({ page }) => {
  await linkLandsInBrowser(page, false);
});

/** Contract §3.3: the browser clears a linked world; its row says so and brings it down again, under the same row. */
async function bringDownAgainRestores(page: Page, folderMode: boolean) {
  await linkLandsInBrowser(page, folderMode);
  const before = await page.evaluate((serverId) => {
    const e = (window as any).__atlasTestApi.getState().registry.worlds.find((w: any) => w.api?.world_id === serverId);
    return { id: e.id, dir: e.folder.folder_name };
  }, SERVER_WORLD);
  // The browser clears the world's storage, and keeps Atlas's list.
  await page.evaluate(async () => {
    const { getActiveStore } = await import('/src/core/active-store.ts');
    await getActiveStore()?.close();
    await (await navigator.storage.getDirectory()).removeEntry('browser-worlds', { recursive: true });
  });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  const row = page.locator(`.atlas-row[data-world-id="${before.id}"]`);
  await expect(row.locator('.atlas-world-state-chip.cleared')).toBeVisible();
  await row.hover();
  await row.locator('[data-role="bring-down-cleared"]').click();
  const modal = page.locator('[data-modal="bring-down-again"]');
  await expect(modal).toContainText('not its pages');
  await modal.locator('[data-action="bring-down"]').click();
  await expect(page.locator('.ow-toast', { hasText: '"Big World" is back in this browser.' })).toBeVisible();
  const after = await page.evaluate(async (serverId) => {
    const s = (window as any).__atlasTestApi.getState();
    const rows = s.registry.worlds.filter((w: any) => w.api?.world_id === serverId);
    const e = rows[0];
    return { rows: rows.length, id: e.id, dir: e.folder.folder_name, cleared: e.cleared_at ?? null, review: e.review_first_sync ?? null, active: s.active?.worldId === e.id, elements: s.data.elements.length };
  }, SERVER_WORLD);
  expect(after).toMatchObject({ rows: 1, id: before.id, cleared: null, review: true, active: true, elements: 30 });
  expect(after.dir).not.toBe(before.dir);
  await expect(row.locator('.atlas-world-state-chip.cleared')).toHaveCount(0);
  expect(await browserHomeDirs(page)).toEqual([after.dir]);
}

test('a cleared linked world: its row brings it down again, under the same row', async ({ page }) => {
  await bringDownAgainRestores(page, true);
});

test('@firefox a cleared linked world: its row brings it down again, under the same row', async ({ page }) => {
  await bringDownAgainRestores(page, false);
});

test('Cancel link into this browser leaves no directory and no row', async ({ page }) => {
  await boot(page);
  await mockKeel(page, 1500);
  await openLink(page);
  const modal = page.locator('[data-modal="link-world"]');
  await modal.locator('[data-action="link"]').click();
  await expect(modal.locator('[data-role="progress"]')).toContainText('Downloading');
  await modal.locator('[data-action="cancel-link"]').click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'Link cancelled' })).toBeVisible();
  expect(await browserHomeDirs(page)).toEqual([]);
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length)).toBe(0);
});

test('two tabs: B reloads during A\'s slow link into this browser, and both end with one row', async ({ page }) => {
  // B's boot reconciliation meets A's half-made directory: its Web Lock is
  // held, so B skips it (never adopts it); A's commit then reaches B through
  // the registry's storage event (contract §3.2 rule 1, invariant 17).
  await boot(page);
  await mockKeel(page, 600);
  const tabB = await page.context().newPage();
  await tabB.goto('/');
  await tabB.waitForSelector('.atlas-shell');
  await openLink(page);
  const modal = page.locator('[data-modal="link-world"]');
  await modal.locator('[data-action="link"]').click();
  await expect(modal.locator('[data-role="progress"]')).toContainText('Downloading');
  expect((await browserHomeDirs(page)).length).toBe(1); // the make's directory exists, half-made
  await tabB.reload();
  await tabB.waitForSelector('.atlas-shell');
  await expect(modal).toHaveCount(0, { timeout: 60_000 });
  const rows = (p: Page) => p.evaluate(async (serverId) => {
    const { getState } = await import('/src/core/state.ts');
    return getState().registry.worlds.filter((w: any) => w.api?.world_id === serverId || w.folder?.handle_key?.startsWith(`world-${serverId}`)).length;
  }, SERVER_WORLD);
  await expect.poll(() => rows(page)).toBe(1);
  await expect.poll(() => rows(tabB)).toBe(1);
  expect((await browserHomeDirs(page)).length).toBe(1);
  // And B, reloaded once more, still sees one.
  await tabB.reload();
  await tabB.waitForSelector('.atlas-shell');
  await expect.poll(() => rows(tabB)).toBe(1);
  await tabB.close();
});

// ---------------------------------------------------------------------------
// Bout 3: Settings for a browser world, and Delete (contract §3.1, §3.4).
// ---------------------------------------------------------------------------

async function browserWorldSettingsAndDelete(page: Page) {
  await boot(page);
  const { a, b } = await seedTwoBrowserWorlds(page);
  expect(await activate(page, a)).toBe(true);
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/world`; }, a);
  const tab = page.locator('.atlas-settings');
  await expect(tab.locator('[data-role="stored-in"]')).toHaveText('This browser');
  await expect(tab.locator('[data-action="show-folder"]')).toHaveCount(0);
  await expect(tab.locator('[data-action="delete-world"]')).toHaveCount(0); // no Forget
  await expect(tab.locator('[data-action="delete-world-permanent"]')).toHaveCount(0);
  await expect(tab.locator('[data-action="delete-browser-world"]')).toHaveText('Delete world');

  // The dialog: what goes, no linked line for a local world; Cancel changes nothing.
  await tab.locator('[data-action="delete-browser-world"]').click();
  const modal = page.locator('[data-modal="delete-browser-world"]');
  await expect(modal).toContainText('deletes it from this browser: elements, maps and media. There is no undo.');
  await expect(modal.locator('[data-role="linked-line"]')).toHaveCount(0);
  await modal.locator('[data-action="cancel"]').click();
  await expect(modal).toHaveCount(0);
  expect(await browserHomeDirs(page)).toEqual(['alpha-0192a000-1a2b', 'beta-0192b000-3c4d']);

  // Delete: the open world closes, its directory goes, then its row; Beta stays.
  await tab.locator('[data-action="delete-browser-world"]').click();
  await modal.locator('[data-action="delete"]').click();
  await expect(modal).toHaveCount(0);
  expect(await browserHomeDirs(page)).toEqual(['beta-0192b000-3c4d']);
  const after = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return { ids: getState().registry.worlds.map((w: any) => w.id), active: getState().active?.worldId ?? null };
  });
  expect(after).toEqual({ ids: [b], active: null });
  await expect(page.locator('.ow-toast', { hasText: 'Deleted Alpha' })).toBeVisible();
}

test('a browser world: Settings says This browser, offers one Delete, and Delete removes it from the browser', async ({ page }) => {
  await browserWorldSettingsAndDelete(page);
});

test('@firefox a browser world: Settings says This browser, offers one Delete, and Delete removes it from the browser', async ({ page }) => {
  await browserWorldSettingsAndDelete(page);
});
