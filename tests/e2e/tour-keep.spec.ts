/**
 * Keep the tour world (1.17, contract §7, §9 invariants 15-16, §10 bout 6).
 *
 * The keep un-demos world.json (K2), gives every bundle element a new id
 * (K3, journaled), then commits (K4: done key, registry, TK). Every crash
 * point is played as the state it leaves on disk and in localStorage, then a
 * reload: boot's resume must land in a kept world with fresh ids, no twins,
 * no tour bar, or (when the world cannot be opened) change nothing.
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

/** Start the tour, make its world through the real modal, jump to the finale. */
async function toFinale(page: Page) {
  await page.click('[data-action="start-tour"]');
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  await page.evaluate(async () => {
    const e = await import('/src/tour/tour-engine.ts' as string);
    await e.enterStep(15);
    await e.awaitTourSettled();
  });
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '16');
}

/** The world as it stands: registry, TK, done key, world.json, and how many bundle ids its files still hold. */
async function snapshot(page: Page, worldId?: string) {
  return page.evaluate(async (wid) => {
    const api = (window as any).__atlasTestApi;
    const s = api.getState();
    const id = wid ?? JSON.parse(localStorage.getItem('atlas_tour_v1') ?? '{}').worldId ?? s.active?.worldId;
    const entry = s.registry.worlds.find((w: any) => w.id === id);
    const bundle = await (await fetch('/src/demo/hyperion-world.json')).json();
    const bundleIds: string[] = bundle.elements.map((e: any) => e.id);
    // Read the world's own directory, not the active store: after a reload the
    // store may not be open at all.
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    const dir = await home.getDirectoryHandle(entry.folder.folder_name);
    const worldJson = JSON.parse(await (await (await dir.getFileHandle('world.json')).getFile()).text());
    const files: string[] = [];
    const ids: string[] = [];
    const elements = await dir.getDirectoryHandle('elements');
    for await (const t of (elements as any).values()) {
      if (t.kind !== 'directory') continue;
      for await (const f of (t as any).values()) {
        if (f.kind !== 'file' || !f.name.endsWith('.json')) continue;
        const text = await (await f.getFile()).text();
        files.push(text);
        ids.push(JSON.parse(text).id);
      }
    }
    const all = files.join('\n');
    let journal = true;
    try { await (await dir.getDirectoryHandle('.atlas')).getFileHandle('rekey-journal.json'); } catch { journal = false; }
    return {
      id,
      registryDemo: entry?.demo ?? null,
      where: entry?.where ?? null,
      tour: localStorage.getItem('atlas_tour_v1'),
      done: localStorage.getItem('atlas_tour_done_v1'),
      worldJsonDemo: worldJson.demo ?? null,
      elementCount: ids.length,
      distinctIds: new Set(ids).size,
      bundleIdsInFiles: bundleIds.filter(b => all.includes(b)).length,
      bundleIdsAsIds: ids.filter(i => bundleIds.includes(i)).length,
      journal,
      ids,
    };
  }, worldId);
}

/** Reload, and wait for boot (and its resume) to settle. */
async function reload(page: Page) {
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => { await (window as any).__atlasTestApi.awaitTourSettled(); });
}

/** The kept-world outcome every path must reach (contract §9 invariant 15). */
function expectKept(s: Awaited<ReturnType<typeof snapshot>>) {
  expect(s.registryDemo).toBeNull();
  expect(s.worldJsonDemo).toBeNull();
  expect(s.tour).toBeNull();
  expect(s.done).toBe('1');
  expect(s.journal).toBe(false);
  expect(s.elementCount).toBeGreaterThan(20);
  expect(s.distinctIds).toBe(s.elementCount); // no twins
  expect(s.bundleIdsAsIds).toBe(0);
  expect(s.bundleIdsInFiles, 'no link field or chip still names a bundle id').toBe(0);
}

test('the finale offers Keep, Save it to a folder and Start fresh; Keep makes the tour world yours', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  const controls = page.locator('.atlas-tour-controls');
  await expect(controls.locator('button', { hasText: /^Keep this world$/ })).toBeVisible();
  await expect(controls.locator('button', { hasText: /^Save it to a folder$/ })).toBeVisible();
  await expect(controls.locator('button', { hasText: /^Start fresh$/ })).toBeVisible();
  await expect(controls.locator('button', { hasText: /^Exit tour$/ })).toHaveCount(0);
  await expect(page.locator('.atlas-tour-meta')).toHaveText('Keep this world to go on building in it, save it to a folder on your drive, or start fresh. Start fresh deletes the tour world and everything you made in it.');
  const before = await snapshot(page);
  expect(before.bundleIdsAsIds).toBe(before.elementCount);
  // Keep asks the browser to keep worlds, inside the click and before any
  // await (contract §2.3, invariant 10): the spy records the call's moment.
  await page.evaluate(() => {
    (window as any).__persistCalls = [];
    navigator.storage.persist = () => {
      (window as any).__persistCalls.push(document.querySelector('[data-modal="keep-tour-world"]') ? 'late' : 'in-click');
      return new Promise(() => {}); // Firefox: may never settle
    };
  });

  await controls.locator('[data-tour-control="keep"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'Hyperion is yours now. It lives in this browser.' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).__persistCalls)).toEqual(['in-click']);
  const after = await snapshot(page, before.id);
  expectKept(after);
  expect(after.where).toBe('browser');
  expect(after.elementCount).toBe(before.elementCount);
  // The user lands in the kept world, its sidebar listing it among their own.
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().active?.worldId)).toBe(before.id);
  await expect(page.locator('body')).not.toHaveClass(/atlas-touring/);
  // Kept, it can go online: Settings offers Make online, not the sandbox line.
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/world`; }, before.id);
  await expect(page.locator('.atlas-settings-hint', { hasText: 'sandbox' })).toHaveCount(0);
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
  // And it survives a reload as an ordinary world.
  await reload(page);
  expectKept(await snapshot(page, before.id));
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
});

test('a reload after K2 (world.json un-demoed, nothing else) finishes the keep at boot', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  await page.evaluate(async () => {
    await (window as any).__atlasTestApi.getActiveStore().writeWorldMeta({ demo: undefined });
  });
  await reload(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'Hyperion is yours now. It lives in this browser.' })).toBeVisible();
  expectKept(await snapshot(page));
});

test('a reload inside K3 (a re-key journal on disk, half the ids moved) finishes it with no twins', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  const id = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.writeWorldMeta({ demo: undefined });
    const { startRekey } = await import('/src/store/rekey.ts' as string);
    const bundle = await (await fetch('/src/demo/hyperion-world.json')).json();
    const ids = bundle.elements.map((e: any) => e.id);
    const present = (await store.listElements()).map((e: any) => e.id).filter((i: string) => ids.includes(i));
    // The tab dies on the tenth element write.
    await startRekey(store, { worldId: api.getState().active.worldId, ids: present }, {
      onProgress: (done: number) => { if (done === 10) throw new Error('tab closed'); },
    }).catch(() => {});
    return api.getState().active.worldId;
  });
  const mid = await snapshot(page, id);
  expect(mid.journal).toBe(true);
  expect(mid.bundleIdsAsIds).toBeGreaterThan(0);
  await reload(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  expectKept(await snapshot(page, id));
});

test('a reload after K4 steps 1-2 (registry un-demoed, the tour key still set) lands in the kept world', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  const id = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const worldId = api.getState().active.worldId;
    await store.writeWorldMeta({ demo: undefined });
    const { giveTourWorldNewIds } = await import('/src/sync/rekey-run.ts' as string);
    const bundle = await (await fetch('/src/demo/hyperion-world.json')).json();
    const entry = api.getState().registry.worlds.find((w: any) => w.id === worldId);
    await giveTourWorldNewIds({ store, entry, bundleIds: new Set(bundle.elements.map((e: any) => e.id)) });
    // K4 (1) and (2), then the crash.
    localStorage.setItem('atlas_tour_done_v1', '1');
    const { saveRegistry, updateWorldEntry } = await import('/src/registry/registry.ts' as string);
    saveRegistry(updateWorldEntry(api.getState().registry, worldId, { demo: undefined }));
    return worldId;
  });
  expect(JSON.parse((await snapshot(page, id)).tour!).worldId).toBe(id);
  await reload(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  expectKept(await snapshot(page, id));
});

test('after K2, a boot in a second tab that cannot take the world over changes nothing', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  const id = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().writeWorldMeta({ demo: undefined });
    return api.getState().active.worldId;
  });
  // Tab A keeps the world open (its lock is live); tab B boots, resumes the
  // tour, finds the keep begun, and is asked to take over: it declines.
  const tabB = await page.context().newPage();
  let asked = 0;
  tabB.on('dialog', d => { asked++; void d.dismiss(); });
  await tabB.goto('/');
  await tabB.waitForSelector('.atlas-shell');
  await expect(tabB.locator('.ow-toast', { hasText: 'tries again the next time it starts' })).toBeVisible();
  expect(asked).toBe(1);
  const s = await snapshot(tabB, id);
  expect(s.registryDemo).toBe(true);
  expect(JSON.parse(s.tour!).worldId).toBe(id);
  expect(s.bundleIdsAsIds).toBe(s.elementCount); // K3 never ran
  await tabB.close();
});

test('a second tour after a keep: its ids never meet the kept world\'s, and Start fresh leaves the kept map\'s camera', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  await page.locator('.atlas-tour-controls [data-tour-control="keep"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  const kept = await snapshot(page);
  const keptMap = await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.type === 'map').id);
  await page.evaluate((mapId) => {
    const raw = JSON.parse(localStorage.getItem('atlas_map_camera_state') ?? '{}');
    raw[mapId] = { center: [1, 2], zoom: 3 };
    localStorage.setItem('atlas_map_camera_state', JSON.stringify(raw));
  }, keptMap);

  // Replay from Settings, the door a keeper has.
  await page.evaluate(async () => {
    const { launchTour } = await import('/src/tour/tour-engine.ts' as string);
    await launchTour();
  });
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  await page.evaluate(async () => {
    const e = await import('/src/tour/tour-engine.ts' as string);
    await e.enterStep(15);
    await e.awaitTourSettled();
  });
  const second = await snapshot(page);
  expect(second.id).not.toBe(kept.id);
  expect(second.ids.filter(i => kept.ids.includes(i))).toEqual([]);

  await page.locator('.atlas-tour-controls [data-tour-control="start-fresh"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  const after = await page.evaluate((mapId) => ({
    worlds: (window as any).__atlasTestApi.getState().registry.worlds.map((w: any) => w.id),
    camera: JSON.parse(localStorage.getItem('atlas_map_camera_state') ?? '{}')[mapId] ?? null,
  }), keptMap);
  expect(after.worlds).toEqual([kept.id]);
  expect(after.camera).toEqual({ center: [1, 2], zoom: 3 });
  expectKept(await snapshot(page, kept.id));
});

test('Save it to a folder: a cancelled picker changes nothing, and a world folder is refused as the destination', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  const save = page.locator('.atlas-tour-controls [data-tour-control="save"]');
  // No home folder yet: the dialog asks for one, then the picker is cancelled.
  await page.evaluate(() => (window as any).__atlasTestApi.setNextDirectory(null));
  await save.click();
  await page.locator('[data-modal="home-folder"] .atlas-btn-primary').click();
  await expect(save).toBeEnabled();
  let s = await snapshot(page);
  expect(s.registryDemo).toBe(true);
  expect(s.worldJsonDemo).toBe(true);
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '16');

  // A world folder picked as the destination: refused, the tour world untouched.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const w = await root.getDirectoryHandle('someones-world', { create: true });
    const f = await (await w.getFileHandle('world.json', { create: true })).createWritable();
    await f.write(JSON.stringify({ id: '0198a000-0000-7000-8000-000000000001', name: 'Someone' }));
    await f.close();
    (window as any).__atlasTestApi.setNextDirectory(w);
  });
  await save.click();
  await page.locator('[data-modal="home-folder"] .atlas-btn-primary').click();
  await expect(page.locator('.ow-toast', { hasText: 'That folder is a world.' })).toBeVisible();
  s = await snapshot(page);
  expect(s.registryDemo).toBe(true);
  expect(s.worldJsonDemo).toBe(true);
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().active?.worldId)).toBe(s.id);
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '16');
});

test('Save it to a folder keeps the world and moves it into the home folder', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    (window as any).__atlasTestApi.setNextDirectory(await root.getDirectoryHandle('home', { create: true }));
  });
  await toFinale(page);
  const id = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_tour_v1')!).worldId);
  await page.locator('.atlas-tour-controls [data-tour-control="save"]').click();
  await page.locator('[data-modal="home-folder"] .atlas-btn-primary').click();
  await expect(page.locator('.ow-toast', { hasText: 'Hyperion is yours now, in your OnlyWorlds folder.' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  const out = await page.evaluate(async (wid) => {
    const s = (window as any).__atlasTestApi.getState();
    const entry = s.registry.worlds.find((w: any) => w.id === wid);
    const bundle = await (await fetch('/src/demo/hyperion-world.json')).json();
    // The world's own folder as Atlas holds it (the door may make the home folder inside the pick).
    const { loadHandle } = await import('/src/store/handle-vault.ts' as string);
    const dir = await loadHandle(entry.folder.handle_key);
    const meta = JSON.parse(await (await (await dir.getFileHandle('world.json')).getFile()).text());
    let browserCopies = 0;
    try {
      for await (const _ of ((await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds')) as any).values()) browserCopies++;
    } catch { /* no browser home left */ }
    const elements = s.data.elements.map((e: any) => e.id);
    return {
      where: entry.where ?? 'folder', demo: entry.demo ?? null, metaDemo: meta.demo ?? null,
      tour: localStorage.getItem('atlas_tour_v1'), browserCopies,
      bundleIds: elements.filter((e: string) => bundle.elements.some((b: any) => b.id === e)).length,
      count: elements.length,
    };
  }, id);
  expect(out).toMatchObject({ where: 'folder', demo: null, metaDemo: null, tour: null, browserCopies: 0, bundleIds: 0 });
  expect(out.count).toBeGreaterThan(20);
});

test('@firefox the finale offers Keep and Start fresh, and Keep makes the tour world yours', async ({ page }) => {
  await freshBoot(page);
  await toFinale(page);
  const controls = page.locator('.atlas-tour-controls');
  await expect(controls.locator('button', { hasText: /^Keep this world$/ })).toBeVisible();
  await expect(controls.locator('button', { hasText: /^Start fresh$/ })).toBeVisible();
  await expect(controls.locator('button', { hasText: /^Save it to a folder$/ })).toHaveCount(0);
  await expect(page.locator('.atlas-tour-meta')).toHaveText('Keep this world to go on building in it in this browser, or start fresh. Start fresh deletes the tour world and everything you made in it.');
  await controls.locator('[data-tour-control="keep"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  expectKept(await snapshot(page));
});
