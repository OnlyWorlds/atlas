/**
 * Try the demo world (#113): one click on the landing brings Moppetopia
 * down by its demo key as an unlinked, editable copy in this browser, and no
 * request ever writes to OnlyWorlds. Keel is mocked; every request to it is
 * recorded, so the claim "nothing goes back" is an assertion, not a hope.
 */
import { test, expect, Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const WORLD_ID = '0695db52-5433-7332-8000-db7fe10da375';
const NOW = '2026-10-09T12:00:00.000Z';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
}

interface Seen { method: string; path: string; key: string | null; pin: string | null }

/** Moppetopia in miniature: three characters and a location that links one. */
async function mockMoppetopia(page: Page, opts: { failType?: string } = {}): Promise<Seen[]> {
  const seen: Seen[] = [];
  const chars = ['Admiral Fluffington', 'Captain Snoot', 'Drip'].map((name, i) => ({
    id: `0695db83-b69a-772b-8000-00000000000${i}`, type: 'character', name, updated_at: NOW, created_at: NOW,
  }));
  const place = { id: '0695db83-b69a-772b-8000-0000000000aa', type: 'location', name: 'Crumblefields', primary_power_id: chars[0].id, updated_at: NOW, created_at: NOW };
  await page.route('https://www.onlyworlds.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const headers = await req.allHeaders();
    seen.push({ method: req.method(), path: url.pathname, key: headers['api-key'] ?? null, pin: headers['api-pin'] ?? null });
    const path = url.pathname.replace('/api/v2', '');
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: {
        id: WORLD_ID, name: 'Moppetopia', description: 'A world of moppets.', image_url: '',
        time_basic_unit: 'Year', time_format_names: [], time_format_equivalents: [],
        time_range_min: 0, time_range_max: 1000, time_range_current: 453, updated_at: NOW,
      } });
    }
    const type = path.split('/').filter(Boolean)[0];
    if (type === opts.failType) return route.fulfill({ status: 500, body: 'boom' });
    const data = type === 'character' ? chars : type === 'location' ? [place] : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  return seen;
}

async function scratchLeft(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    let dir: FileSystemDirectoryHandle;
    try { dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('atlas-scratch'); } catch { return []; }
    const names: string[] = [];
    // @ts-expect-error values() is FS Access API
    for await (const e of dir.values()) names.push(e.name);
    return names;
  });
}

async function tryDemoOpensACopy(page: Page) {
  await boot(page);
  const seen = await mockMoppetopia(page);
  // What an interrupted try (a reload mid-download) leaves behind is swept by the next one.
  await page.evaluate(async () => {
    const scratch = await (await navigator.storage.getDirectory()).getDirectoryHandle('atlas-scratch', { create: true });
    const left = await scratch.getDirectoryHandle('try-left-by-a-reload', { create: true });
    await (await (await left.getFileHandle('world.json', { create: true })).createWritable()).close();
  });
  // From here on, record every folder made in browser storage (#126):
  // the scratch lives in memory, so the try must never make `atlas-scratch`.
  await page.evaluate(() => {
    const made: string[] = [];
    (window as any).__dirsMade = made;
    const proto = (window as any).FileSystemDirectoryHandle.prototype;
    const orig = proto.getDirectoryHandle;
    proto.getDirectoryHandle = function (name: string, opts?: { create?: boolean }) {
      if (opts?.create) made.push(name);
      return orig.call(this, name, opts);
    };
  });
  // A double click is one ask: one copy, and no "already opening" error.
  await page.locator('[data-action="try-demo"]').dblclick();
  await expect(page.locator('.ow-toast', { hasText: 'your own copy, in this browser' })).toBeVisible({ timeout: 20_000 });

  const state = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    const s = getState();
    const e = s.registry.worlds.find((w: any) => w.name === 'Moppetopia');
    const meta = await (window as any).__atlasTestApi.worldMetaOnDisk();
    return {
      entries: s.registry.worlds.length,
      state: e?.state, where: e?.where, api: e?.api ?? null,
      active: s.active?.worldId === e?.id && s.active?.opened === true,
      names: s.data.elements.map((x: any) => x.name).sort(),
      meta,
    };
  });
  expect(state.entries).toBe(1);
  await expect(page.locator('.ow-toast-error')).toHaveCount(0);
  const worldReads = () => seen.filter(r => /\/api\/v2\/world\/?$/.test(r.path)).length;
  await page.waitForTimeout(1000); // a second run would have read the world by now
  expect(worldReads()).toBe(1);
  expect(state).toMatchObject({ state: 'local-only', where: 'browser', api: null, active: true });
  expect(state.names).toEqual(['Admiral Fluffington', 'Captain Snoot', 'Crumblefields', 'Drip']);
  // The world's own fields came down; the link and the key did not.
  expect(state.meta).toMatchObject({ id: WORLD_ID, name: 'Moppetopia', time_current: 453, time_basic_unit: 'Year', description: 'A world of moppets.' });
  expect((state.meta as any).api).toBeUndefined();
  // It opens onto its elements, not the worlds list (Titus, 2026-10-09).
  expect(await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return getState().ui.sidebarMode;
  })).toBe('elements');
  // Its way out on its home: a world of your own, and where its delete lives
  // (1.98.0 keyed this to the tour's flag, so it never showed here).
  const demoLine = page.locator('[data-role="demo-line"]');
  await expect(demoLine).toBeVisible();
  await expect(demoLine.locator('[data-action="demo-delete"]')).toBeVisible();
  // A world to look at: its dots stay quiet, though this one has no story to light them all.
  await expect(page.locator('[data-role="guide-block"]')).toHaveCount(0);

  // Editable: a new element and an edit land on disk.
  await page.evaluate(async () => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    await store.createElement('character', { name: 'Moppet of My Own' });
    const fluff = (await store.listElements()).find((x: any) => x.name === 'Admiral Fluffington');
    await store.updateElement(fluff.id, { description: 'Mine now.' });
  });
  const after = await page.evaluate(async () => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const all = await store.listElements();
    return { mine: all.some((x: any) => x.name === 'Moppet of My Own'), fluff: all.find((x: any) => x.name === 'Admiral Fluffington')?.description };
  });
  expect(after).toEqual({ mine: true, fluff: 'Mine now.' });

  // The demo earns no note: its copy coming down is no gesture, and a gesture in it is silent.
  expect(await page.locator('[data-role="guide-note"]').count()).toBe(0);
  expect(await page.evaluate(async () => {
    const { loadGuideState } = await import('/src/core/guide.ts');
    return Object.keys(loadGuideState().seen);
  })).toEqual([]);

  // A second try, from another world, opens the copy: no download, no twin (gate F3).
  await page.evaluate(async () => { const { navigate } = await import('/src/core/router.ts'); navigate('#/'); });
  await page.evaluate(async () => {
    const { runAddWorldAction } = await import('/src/setup/world-doors.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    await (runAddWorldAction as any)('try-demo', toastManager);
  });
  await expect(page.locator('.ow-toast', { hasText: 'Opened your copy of Moppetopia.' })).toBeVisible();
  expect(worldReads()).toBe(1);
  expect(await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return getState().registry.worlds.length;
  })).toBe(1);

  // Nothing ever wrote to OnlyWorlds, and every read rode the demo key alone.
  await page.waitForTimeout(1500); // a stray push would have fired by now
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.filter(r => r.method !== 'GET')).toEqual([]);
  expect(seen.every(r => r.key === '0000000001' && r.pin === null)).toBe(true);
  expect(await scratchLeft(page)).toEqual([]);
  // The copy was built in memory: no scratch folder was made in browser
  // storage, and the world's own folder was (#126).
  const made: string[] = await page.evaluate(() => (window as any).__dirsMade);
  expect(made).not.toContain('atlas-scratch');
  expect(made.some(n => n.startsWith('try-'))).toBe(false);
  expect(made).toContain('browser-worlds');
}

test('try a demo world: one click opens an editable, unlinked Moppetopia, and nothing writes to OnlyWorlds', async ({ page }) => {
  await tryDemoOpensACopy(page);
});

test('@firefox try a demo world: one click opens an editable, unlinked Moppetopia, and nothing writes to OnlyWorlds', async ({ page }) => {
  await tryDemoOpensACopy(page);
});

test('the #/try-demo link (1.18.1) opens the same copy once; a reload does not ask again', async ({ page }) => {
  await boot(page);
  const seen = await mockMoppetopia(page);
  // The onlyworlds.com home page links here: a fresh load straight onto the hash.
  await page.goto('/#/try-demo');
  await expect(page.locator('.ow-toast', { hasText: 'your own copy, in this browser' })).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => window.location.hash)).not.toContain('try-demo');
  const read = async () => page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    const s = getState();
    return { entries: s.registry.worlds.length, active: s.registry.worlds.find((w: any) => w.id === s.active?.worldId)?.name ?? null };
  });
  expect(await read()).toEqual({ entries: 1, active: 'Moppetopia' });
  const worldReads = () => seen.filter(r => /\/api\/v2\/world\/?$/.test(r.path)).length;
  expect(worldReads()).toBe(1);
  // Its files land behind the open world (#865): down before the reload, as
  // a person's would be once the home's saving line has gone.
  await page.evaluate(() => (window as unknown as { __atlasTestApi: { landed(): Promise<void> } }).__atlasTestApi.landed());
  // Back and a reload land where the link left off; nothing downloads again.
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.waitForTimeout(1500);
  expect(worldReads()).toBe(1);
  // Still the open world, never a row cleared by a landing cut short (a count alone stays 1 then: code gate C5).
  expect(await read()).toEqual({ entries: 1, active: 'Moppetopia' });
  expect(seen.filter(r => r.method !== 'GET')).toEqual([]);
});

test('with Moppetopia already linked (view only), try says how to make room for a copy and downloads nothing', async ({ page }) => {
  await boot(page);
  const seen = await mockMoppetopia(page);
  await page.evaluate(async (worldId) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const { next } = (reg as any).createApiLinkedWorld(getState().registry, {
      name: 'Moppetopia', apiWorldId: worldId, apiKey: '0000000001', readOnly: true,
      handleKey: `world-${worldId}`, folderName: 'moppetopia-0695db52-ab12', pathHint: 'browser storage/moppetopia-0695db52-ab12',
    });
    (reg as any).saveRegistry(next);
    patchSlice('registry', next);
  }, WORLD_ID);
  // A world in the list grounds Atlas, so the landing has gone: the chooser's row.
  await page.locator('[data-action="add-world"]').click();
  await page.locator('[data-modal="add-world"] [data-choice="try-demo"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'linked to OnlyWorlds. To try your own copy, remove that one first' })).toBeVisible();
  expect(seen).toEqual([]);
  expect(await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    return getState().registry.worlds.length;
  })).toBe(1);
});

test('a demo world that does not come down whole opens nothing and leaves nothing behind', async ({ page }) => {
  await boot(page);
  await mockMoppetopia(page, { failType: 'location' });
  await page.locator('[data-action="try-demo"]').click();
  await expect(page.locator('.ow-toast-error')).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => scratchLeft(page)).toEqual([]);
  const left = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    let dirs: string[] = [];
    try {
      const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
      // @ts-expect-error values() is FS Access API
      for await (const e of home.values()) dirs.push(e.name);
    } catch { dirs = []; }
    return { worlds: getState().registry.worlds.length, dirs };
  });
  expect(left).toEqual({ worlds: 0, dirs: [] });
});

test('once a world exists, Settings offers Explore Moppetopia above Replay the tour (2026-10-15)', async ({ page }) => {
  await boot(page);
  const seen = await mockMoppetopia(page);
  // A world first, so the first screen's door is gone.
  await page.click('[data-action="start-world"]');
  const rows = page.locator('[data-modal="create-world"] .atlas-where-row input');
  if (await rows.count() > 1) await rows.nth(1).check();
  await page.fill('[data-modal="create-world"] input[name="world-name"]', 'Mine');
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('h1', { hasText: 'Mine' })).toBeVisible();
  await expect(page.locator('[data-action="try-demo"]')).toHaveCount(0);

  await page.evaluate(() => { const m = window.location.hash.match(/#\/w\/([^/]+)/); window.location.hash = `#/w/${m![1]}/settings`; });
  const chips = page.locator('.atlas-settings-replay-chip');
  await expect(chips).toHaveText(['Explore Moppetopia', 'Replay the tour']);
  await chips.first().click();
  await expect(page.locator('.ow-toast', { hasText: 'your own copy, in this browser' })).toBeVisible({ timeout: 20_000 });
  const state = await page.evaluate(async () => {
    const { getState } = await import('/src/core/state.ts');
    const s = getState();
    return { names: s.registry.worlds.map((w: any) => w.name).sort(), active: s.registry.worlds.find((w: any) => w.id === s.active?.worldId)?.name ?? null };
  });
  expect(state).toEqual({ names: ['Mine', 'Moppetopia'], active: 'Moppetopia' });
  expect(seen.filter(r => r.method !== 'GET')).toEqual([]);
});
