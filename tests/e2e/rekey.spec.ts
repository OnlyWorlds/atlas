/**
 * Giving elements new ids on the REAL folder store (OPFS), and from
 * the app: the store calls the mock cannot prove (directory enumeration,
 * file binding, media on disk), the Settings flow, and recovery after a
 * crash on the next open.
 */
import { test, expect, Page } from '@playwright/test';

const L = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const M = '44444444-4444-4444-8444-444444444444';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
}

test.describe('store calls on a real folder', () => {
  test.beforeEach(async ({ page }) => {
    await boot(page);
    await page.evaluate(async () => { await (window as any).__atlasTestApi.opfsRoot({ clear: true }); });
  });

  test('a verbatim create keeps the old file\'s directory and link spelling', async ({ page }) => {
    const r = await page.evaluate(async ({ M }) => {
      const api = (window as any).__atlasTestApi;
      const root: FileSystemDirectoryHandle = await api.opfsRoot();
      const write = async (dirs: string[], name: string, body: unknown) => {
        let d = root;
        for (const s of dirs) d = await d.getDirectoryHandle(s, { create: true });
        const w = await (await d.getFileHandle(name, { create: true })).createWritable();
        await w.write(JSON.stringify(body));
        await w.close();
      };
      // A folder from two writers: a bare-spelled pin in elements/, a suffixed
      // one in the legacy spatial/ home (so new pins default to the suffix; the
      // layout half only holds the line, since new files go to elements/ anyway).
      await write(['elements', 'map'], 'map.json', { id: M, type: 'map', name: 'Map' });
      await write(['elements', 'pin'], 'p.json', { id: 'aaaaaaaa-0000-4000-8000-000000000001', type: 'pin', name: 'P', map: M, x: 1, y: 1 });
      await write(['spatial', 'pin'], 'q.json', { id: 'aaaaaaaa-0000-4000-8000-000000000002', type: 'pin', name: 'Q', map_id: M, x: 2, y: 2 });
      const store = new api.FsFolderStore({ tabId: 'rk', disableHeartbeat: true });
      await store.open(root);
      const p = await store.getElement('aaaaaaaa-0000-4000-8000-000000000001');
      const N = 'bbbbbbbb-0000-4000-8000-000000000001';
      const first = await store.createElementVerbatim('pin', { ...p, id: N }, { bindingFrom: p.id });
      const again = await store.createElementVerbatim('pin', { ...p, id: N, name: 'changed' }, { bindingFrom: p.id });
      // Find N's file by its BODY (the id inside is identity; names are presentation).
      const find = async (top: string): Promise<string | null> => {
        try {
          const d = await (await root.getDirectoryHandle(top)).getDirectoryHandle('pin');
          for await (const e of (d as any).values()) {
            if (!e.name.endsWith('.json')) continue;
            const text = await (await (e as FileSystemFileHandle).getFile()).text();
            if (JSON.parse(text).id === N) return text;
          }
        } catch { /* absent */ }
        return null;
      };
      await store.close();
      const inElements = await find('elements');
      const inSpatial = await find('spatial');
      const where = inElements ? 'elements' : inSpatial ? 'spatial' : 'nowhere';
      const text = inElements ?? inSpatial ?? '';
      return { created: first.created, again: again.created, againName: again.element.name, text, where };
    }, { M });
    expect(r.created).toBe(true);
    expect(r.again).toBe(false); // an existing new file is never rewritten
    expect(r.againName).toBe('P');
    expect(r.where).toBe('elements');
    expect(r.text).toContain('"map":');
    expect(r.text).not.toContain('"map_id"');
  });

  test('media copies with its bytes, and removing the old directory leaves the new one whole', async ({ page }) => {
    const r = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const root = await api.opfsRoot();
      const store = new api.FsFolderStore({ tabId: 'rk2', disableHeartbeat: true });
      await store.open(root);
      const O = 'cccccccc-0000-4000-8000-000000000001';
      const N = 'dddddddd-0000-4000-8000-000000000001';
      await store.createElement('location', { id: O, name: 'Old' });
      const item = await store.addMedia(O, new File(['pixels'], 'map.png', { type: 'image/png' }));
      await store.createElementVerbatim('location', { ...(await store.getElement(O)), id: N }, { bindingFrom: O });
      const copied = await store.copyMediaDir(O, N);
      await store.removeMediaDir(O);
      await store.removeMediaDir(O); // idempotent
      const blob = await store.getMediaBlob(item.id);
      const listed = await store.listMedia(N);
      const oldLeft = await store.listMedia(O);
      await store.close();
      return { copied, text: blob ? await blob.text() : null, owners: listed.map((m: any) => m.element_id), oldLeft: oldLeft.length, N };
    });
    expect(r.copied).toBe(2);
    expect(r.text).toBe('pixels');
    expect(r.owners).toEqual([r.N]);
    expect(r.oldLeft).toBe(0);
  });
});

async function setupWorld(page: Page, name: string): Promise<void> {
  await boot(page);
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await boot(page);
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('rekey-root', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** Mark the active world api-linked with no PIN (so no engine, no network). */
async function fakeLink(page: Page): Promise<void> {
  await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: 'fake-api', api_key: 'fake-key' };
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
}

async function openWorldSettings(page: Page, name: string): Promise<void> {
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click(`.atlas-row[data-world-id]:has-text("${name}")`);
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
}

test('Settings → World gives foreign elements new ids, and every link follows', async ({ page }) => {
  await setupWorld(page, 'Copied World');
  await page.evaluate(async ({ L, C }) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    await store.createElement('location', { id: L, name: 'Rivendell' });
    await store.createElement('character', { id: C, name: 'Elrond', location: L });
    await store.createElement('narrative', { name: 'Council', story: `[Elrond](ow://character/${C}) spoke.`, characters: [C] });
    await store.updateSyncState(() => ({
      foreign: { api_world_id: 'fake-api', ids: [{ id: L, type: 'location', first_seen: 'x' }, { id: C, type: 'character', first_seen: 'x' }] },
    }));
  }, { L, C });
  await fakeLink(page);
  await openWorldSettings(page, 'Copied World');

  const line = page.locator('[data-role="foreign-ids"]');
  await expect(line).toBeVisible();
  await expect(line).toContainText('2 elements could not upload: their ids belong to another OnlyWorlds world.');
  await page.click('[data-action="give-new-ids"]');
  const modal = page.locator('[data-modal="rekey"]');
  await expect(modal).toContainText('Give 2 elements new ids?');
  await modal.locator('[data-action="rekey-confirm"]').click();
  await expect(modal).toHaveCount(0);
  await expect(line).toBeHidden();

  const after = await page.evaluate(async ({ L, C }) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const all = await store.listElements();
    const loc = all.find((e: any) => e.type === 'location');
    const chr = all.find((e: any) => e.type === 'character');
    const story = all.find((e: any) => e.type === 'narrative');
    return {
      oldIdsLeft: all.filter((e: any) => e.id === L || e.id === C).length,
      link: chr.location === loc.id,
      storyOk: story.story.includes(`ow://character/${chr.id}`) && !story.story.includes(C),
      chars: story.characters,
      chrId: chr.id,
      journal: await store.hasRekeyJournal(),
    };
  }, { L, C });
  expect(after.oldIdsLeft).toBe(0);
  expect(after.link).toBe(true);
  expect(after.storyOk).toBe(true);
  expect(after.chars).toEqual([after.chrId]);
  expect(after.journal).toBe(false);
});

test('an id update interrupted by a closed tab finishes on the next open', async ({ page }) => {
  await setupWorld(page, 'Crashed World');
  const N = '99999999-9999-4999-8999-999999999999';
  await page.evaluate(async ({ L, C, N }) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    await store.createElement('location', { id: L, name: 'Rivendell' });
    await store.createElement('character', { id: C, name: 'Elrond', location: L });
    // The tab closed after step 2: both copies exist, the referrer names the old.
    const old = await store.getElement(L);
    await store.createElementVerbatim('location', { ...old, id: N }, { bindingFrom: L });
    const worldId = (window as any).__atlasTestApi.getState().active.worldId;
    await store.writeRekeyJournal({
      version: 1, world_id: worldId, map: { [L]: N }, types: { [L]: 'location' },
      stamps: { [L]: old.local_updated_at }, unrewritten: [], started_at: 'x',
    });
  }, { L, C, N });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("Crashed World")');
  await expect.poll(async () => page.evaluate(async () => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    return store ? store.hasRekeyJournal() : true;
  })).toBe(false);
  const r = await page.evaluate(async ({ L, C }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    return {
      old: await store.getElement(L),
      loc: (await store.getElement(C)).location,
      shown: api.getState().data.elements.map((e: any) => e.id),
    };
  }, { L, C });
  expect(r.old).toBeNull();
  expect(r.loc).toBe(N);
  expect(r.shown).not.toContain(L);
});
