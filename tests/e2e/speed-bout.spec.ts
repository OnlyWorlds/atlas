/**
 * Speed-bout features (2026-07-19): store parking, open-world-folder,
 * structured extension fields (the [object Object] destruction class).
 */

import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __atlasTestApi: any;
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    await window.__atlasTestApi.resetAll();
  });
});

test('park/unpark: caches survive, writes work after revive, lock still ours', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'tab-a' });
    await store.open(root);
    const a = await store.createElement('character', { name: 'Kept' });

    store.park();
    const revived = await store.unpark();
    const after = await store.getElement(a.id);
    // Writes must still work after revive (lock retained + reclaimed).
    await store.updateElement(a.id, { description: 'post-park edit' });
    const edited = await store.getElement(a.id);
    await store.close();
    return { revived, afterName: after?.name, editedDesc: edited?.description };
  });
  expect(result.revived).toBe(true);
  expect(result.afterName).toBe('Kept');
  expect(result.editedDesc).toBe('post-park edit');
});

test('unpark refuses when another tab held the world in between', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const first = new api.FsFolderStore({ tabId: 'tab-a', disableHeartbeat: true });
    await first.open(root);
    first.park();

    // Another tab takes the world over (consent path) and closes cleanly.
    const intruder = new api.FsFolderStore({ tabId: 'tab-b', disableHeartbeat: true, forceTakeLock: true });
    await intruder.open(root);
    await intruder.createElement('character', { name: 'Sneaky' });
    await intruder.close();

    // The parked store's caches are stale — unpark must refuse.
    const revived = await first.unpark();
    await first.close();
    return { revived };
  });
  expect(result.revived).toBe(false);
});

test('openWorldFolder registers an existing folder in place; re-open dedupes by id', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    // Build a bare world folder by hand (as if copied from another machine).
    const opfs = await api.opfsRoot();
    const dir = await opfs.getDirectoryHandle('carried-world', { create: true });
    const write = async (d: FileSystemDirectoryHandle, name: string, body: unknown) => {
      const fh = await d.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(body, null, 2));
      await w.close();
    };
    const worldId = crypto.randomUUID();
    await write(dir, 'world.json', { id: worldId, name: 'Carried World' });
    const elements = await dir.getDirectoryHandle('elements', { create: true });
    const chars = await elements.getDirectoryHandle('character', { create: true });
    const elId = crypto.randomUUID();
    await write(chars, 'hero--' + elId.slice(-8) + '.json', { id: elId, type: 'character', name: 'Hero' });

    const { openWorldFolder } = await import('/src/setup/atlas-root-flow.ts');
    const one = await openWorldFolder(dir);
    const two = await openWorldFolder(dir); // second open dedupes
    const reg = api.getState().registry.worlds.map((w: any) => ({ id: w.id, name: w.name, state: w.state }));

    // A folder without world.json is refused with a teaching message.
    const bare = await opfs.getDirectoryHandle('not-a-world', { create: true });
    let refusal = '';
    try { await openWorldFolder(bare); } catch (e) { refusal = e instanceof Error ? e.message : String(e); }

    return { one, two, reg, refusal };
  });
  // Registry ids are minted fresh (never the world.json id); the contract is
  // one entry, both calls resolving to it, second flagged as already-known.
  expect(result.one.already).toBe(false);
  expect(result.two).toEqual({ worldId: result.one.worldId, already: true });
  expect(result.reg).toEqual([{ id: result.one.worldId, name: 'Carried World', state: 'local-only' }]);
  expect(result.refusal).toContain('world.json');
});

test('object-valued extension fields render read-only, never as an editable row', async ({ page }) => {
  // Bootstrap a minimal active world through the UI recipe, then give an
  // element a structured x_ field the way tangle's record writer does.
  await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    api.setNextDirectory(root);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Hazardville');
  await page.click('[data-action="pick"]');
  await page.waitForFunction(() => window.__atlasTestApi.getState().active?.opened);

  const elementId = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const store = api.getActiveStore();
    const el = await store.createElement('event', {
      name: 'The Battle',
      supertype: 'Chronicle',
      x_note: 'a plain scalar field',
      x_other_tool: { some: 'unknown structure', n: 7 },
      x_tangle_battle: {
        engineVersion: '1.0', seed: 12345, durationSeconds: 95, winner: 'Left',
        sides: [{ name: 'Left', fallen: 3 }, { name: 'Right', fallen: 9 }],
        units: [{ name: 'Left Hoplites', side: 'Left', type: 'hoplite', started: 64, remaining: 61, outcome: 'held' }],
      },
    });
    api.patchData(await store.listElements());
    return el.id;
  });

  await page.evaluate((id) => {
    const wid = window.__atlasTestApi.getState().active.worldId;
    window.location.hash = `#/w/${wid}/element/${id}`;
  }, elementId);

  // The tangle record renders as a real battle card…
  const card = page.locator('.atlas-tangle-card');
  await expect(card).toHaveCount(1);
  await expect(card.locator('.atlas-tangle-outcome')).toContainText('Left held the field');
  await expect(card.locator('.atlas-tangle-side')).toHaveCount(2);
  await expect(card.locator('.atlas-tangle-units')).toContainText('Left Hoplites');
  await expect(card.locator('.atlas-tangle-card-foot')).toContainText('seed 3039');
  // …the UNKNOWN structured field falls back to the generic read-only row…
  const generic = page.locator('.atlas-custom-structured-row:not(.atlas-custom-structured-card)');
  await expect(generic).toHaveCount(1);
  await expect(generic.locator('.atlas-custom-structured-label')).toHaveText('Other Tool');
  await expect(generic.locator('.atlas-custom-structured-value')).toContainText('"unknown structure"');
  // …and NEITHER renders as an editable field row (the destruction class).
  await expect(page.locator('.atlas-field[data-field="x_tangle_battle"]')).toHaveCount(0);
  await expect(page.locator('.atlas-field[data-field="x_other_tool"]')).toHaveCount(0);
  // The scalar custom field keeps its normal editable row.
  await expect(page.locator('.atlas-field[data-field="x_note"]')).toHaveCount(1);
  // Chronicle sparkle: the sidebar row carries the quiet recorded-from-play mark.
  await expect(page.locator(`.atlas-row[data-element-id="${elementId}"] .atlas-row-chronicle`)).toHaveCount(1);
});
