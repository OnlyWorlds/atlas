/**
 * FsFolderStore — slug-prefix filename refactor (E2E).
 *
 * Locks the on-disk filename contract end-to-end:
 *   - createElement('Alice') writes `alice--<id-tail8>.json` (short fixture
 *     ids stay whole; identity is the id INSIDE the file).
 *   - updateElement renames the file when the element name changes.
 *   - The rename-crash window is recoverable: if two files claim the same id
 *     on next open, dedupe-by-newest cleans it up.
 *   - Reopen reads the slug-prefixed file correctly.
 *
 * Unit coverage of slugify/parseIdFromFilename lives in
 * `tests/unit/fs-utils.slug.test.ts`. This spec validates the FS contract.
 */

import { test, expect } from '@playwright/test';

declare global {
  interface Window {
    __atlasTestApi: {
      FsFolderStore: new (opts?: Record<string, unknown>) => any;
      ELockHeld: new (...args: unknown[]) => Error;
      opfsRoot: (opts?: { clear?: boolean }) => Promise<FileSystemDirectoryHandle>;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    await window.__atlasTestApi.opfsRoot({ clear: true });
  });
});

/**
 * Helper: list filenames inside a type subdir (elements/<type>/ or spatial/<type>/).
 * Returns sorted basenames, .tmp stragglers filtered.
 */
async function listTypeFilesInRoot(
  page: import('@playwright/test').Page,
  segment: 'elements' | 'spatial',
  type: string,
): Promise<string[]> {
  return await page.evaluate(async ({ segment, type }) => {
    const root = await window.__atlasTestApi.opfsRoot();
    const outer = await (root as any).getDirectoryHandle(segment);
    const dir = await outer.getDirectoryHandle(type);
    const names: string[] = [];
    // @ts-ignore values()
    for await (const entry of (dir as any).values()) {
      if (entry.kind === 'file' && !entry.name.endsWith('.tmp')) names.push(entry.name);
    }
    return names.sort();
  }, { segment, type });
}

test('createElement writes <slug>--<uuid>.json', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const created = await store.createElement('character', { name: 'Alice the Wandering' });
    await store.close();
    return { id: created.id };
  });
  const files = await listTypeFilesInRoot(page, 'elements', 'character');
  expect(files).toHaveLength(1);
  // Canonical form: slug + the LAST 8 chars of the uuid (Folder Format rule —
  // the filename is presentation; the full id lives inside the file).
  expect(files[0]).toBe(`alice-the-wandering--${result.id.slice(-8)}.json`);
});

test('createElement writes bare <uuid>.json when name is empty', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const created = await store.createElement('location', { name: '' });
    await store.close();
    return { id: created.id };
  });
  const files = await listTypeFilesInRoot(page, 'elements', 'location');
  expect(files).toEqual([`${result.id}.json`]);
});

test('updateElement with a name change renames the file', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const created = await store.createElement('character', { name: 'Alice' });
    await new Promise(r => setTimeout(r, 5));
    await store.updateElement(created.id, { name: 'Aliyah' });
    await store.close();
    return { id: created.id };
  });
  const files = await listTypeFilesInRoot(page, 'elements', 'character');
  expect(files).toEqual([`aliyah--${result.id.slice(-8)}.json`]);
});

test('updateElement keeps the same filename when name unchanged', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const created = await store.createElement('character', { name: 'Bob' });
    await store.updateElement(created.id, { description: 'a wandering knight' });
    await store.close();
    return { id: created.id };
  });
  const files = await listTypeFilesInRoot(page, 'elements', 'character');
  expect(files).toEqual([`bob--${result.id.slice(-8)}.json`]);
});

test('reopen reads slug-prefixed file by id', async ({ page }) => {
  const fetched = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    const created = await s1.createElement('location', { id: 'loc-1', name: 'Shire' });
    await s1.close();

    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    const elem = await s2.getElement(created.id);
    const list = await s2.listElements('location');
    await s2.close();
    return { name: elem?.name, listCount: list.length };
  });
  expect(fetched.name).toBe('Shire');
  expect(fetched.listCount).toBe(1);

  const files = await listTypeFilesInRoot(page, 'elements', 'location');
  expect(files).toEqual(['shire--loc-1.json']);
});

test('duplicate files for same id are deduped on next open (rename-crash recovery)', async ({ page }) => {
  // Simulate an atlas crash mid-rename: write BOTH the new and old file by hand,
  // then open the store. ensureIndexFor should dedupe by latest local_updated_at.
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    // First, normal create so the layout exists.
    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    const created = await s1.createElement('character', { id: 'char-x', name: 'Old' });
    await s1.close();

    // Forge a duplicate file for the same id with a NEWER timestamp.
    const charDir = await (root as any)
      .getDirectoryHandle('elements')
      .then((d: any) => d.getDirectoryHandle('character'));
    const newer = { ...created, name: 'New', local_updated_at: '2099-12-31T23:59:59.999Z' };
    const fh = await charDir.getFileHandle(`new--char-x.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(newer));
    await w.close();

    // List BEFORE reopening — should have two files.
    const before: string[] = [];
    // @ts-ignore
    for await (const e of (charDir as any).values()) {
      if (e.kind === 'file' && !e.name.endsWith('.tmp')) before.push(e.name);
    }
    before.sort();

    // Reopen: ensureIndexFor on listElements should dedupe.
    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    const list = await s2.listElements('character');

    // List AFTER — should have only the survivor.
    const after: string[] = [];
    // @ts-ignore
    for await (const e of (charDir as any).values()) {
      if (e.kind === 'file' && !e.name.endsWith('.tmp')) after.push(e.name);
    }
    after.sort();
    await s2.close();
    return {
      before,
      after,
      listCount: list.length,
      survivorName: list[0]?.name,
    };
  });

  expect(result.before).toHaveLength(2);
  expect(result.after).toEqual(['new--char-x.json']);
  expect(result.listCount).toBe(1);
  expect(result.survivorName).toBe('New');
});

test('a hand-made variant sharing an id is set aside in .atlas/quarantine, never deleted', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    const created = await s1.createElement('character', { id: 'char-v', name: 'Aldric', description: 'the original' });
    await s1.close();
    // Someone copies the file by hand and edits the copy (an older stamp, so
    // it loses the newest-wins vote).
    const charDir = await (root as any).getDirectoryHandle('elements').then((d: any) => d.getDirectoryHandle('character'));
    const variant = { ...created, description: 'my alternative take', local_updated_at: '2000-01-01T00:00:00.000Z' };
    const fh = await charDir.getFileHandle('aldric-variant.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(variant));
    await w.close();

    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    await s2.listElements('character');
    await s2.close();

    const q = await (root as any).getDirectoryHandle('.atlas')
      .then((d: any) => d.getDirectoryHandle('quarantine'))
      .then((d: any) => d.getDirectoryHandle('character'));
    const kept = JSON.parse(await (await (await q.getFileHandle('aldric-variant.json')).getFile()).text());
    const inPlace: string[] = [];
    // @ts-ignore
    for await (const e of (charDir as any).values()) if (e.kind === 'file') inPlace.push(e.name);
    return { keptDescription: kept.description, inPlace: inPlace.sort() };
  });
  expect(result.keptDescription).toBe('my alternative take');
  expect(result.inPlace).toEqual(['aldric--char-v.json']);
});

test('legacy full-uuid file tidies to canonical on open; second open is a no-op', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    // Lay out the folder skeleton via a normal create, then hand-seed a
    // LEGACY-form file (slug--<full-id>) for a different element.
    const s0 = new api.FsFolderStore({ tabId: 'tab-0', disableHeartbeat: true });
    await s0.open(root);
    await s0.createElement('character', { id: 'seed-1', name: 'Seed' });
    await s0.close();

    const dir = await (root as any)
      .getDirectoryHandle('elements')
      .then((d: any) => d.getDirectoryHandle('character'));
    const legacyId = 'e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b';
    const legacyBody = {
      id: legacyId, type: 'character', name: 'Old Timer',
      local_updated_at: '2026-01-01T00:00:00.000Z',
    };
    const fh = await dir.getFileHandle(`old-timer--${legacyId}.json`, { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify(legacyBody));
    await w.close();

    const listNames = async (): Promise<string[]> => {
      const names: string[] = [];
      // @ts-ignore
      for await (const e of (dir as any).values()) {
        if (e.kind === 'file' && !e.name.endsWith('.tmp')) names.push(e.name);
      }
      return names.sort();
    };

    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    const list1 = await s1.listElements('character');
    await s1.awaitTidies(); // tidy is a background pass since 2026-07-19
    const afterFirst = await listNames();
    await s1.close();

    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    await s2.listElements('character');
    await s2.awaitTidies();
    const afterSecond = await listNames();
    const fetched = await s2.getElement(legacyId);
    await s2.close();

    return { count: list1.length, afterFirst, afterSecond, fetchedName: fetched?.name };
  });
  expect(result.count).toBe(2);
  // Legacy full-uuid tail converged to the short-tail canonical form.
  expect(result.afterFirst).toContain('old-timer--0d2a8c2b.json');
  expect(result.afterFirst).not.toContain('old-timer--e4e6dc8e-4b1f-4d56-8d2d-aa6e0d2a8c2b.json');
  // Convergence is stable: a second open changes nothing.
  expect(result.afterSecond).toEqual(result.afterFirst);
  expect(result.fetchedName).toBe('Old Timer');
});

test('tidy never overwrites a readable stranger occupying the canonical name', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    const s0 = new api.FsFolderStore({ tabId: 'tab-0', disableHeartbeat: true });
    await s0.open(root);
    await s0.createElement('character', { id: 'seed-1', name: 'Seed' });
    await s0.close();

    const dir = await (root as any)
      .getDirectoryHandle('elements')
      .then((d: any) => d.getDirectoryHandle('character'));
    const write = async (name: string, body: unknown) => {
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(JSON.stringify(body));
      await w.close();
    };
    // Stranger B sits at exactly the name that is element A's canonical form
    // (A: name 'Hero', id tail '12345678'). A itself sits at a non-canonical
    // legacy name. The tidy must move A to its FULL-ID fallback, not clobber B.
    await write('hero--12345678.json', {
      id: 'bbbb-b1', type: 'character', name: 'Bystander',
      local_updated_at: '2026-01-01T00:00:00.000Z',
    });
    await write('zz-legacy--aaaa12345678.json', {
      id: 'aaaa12345678', type: 'character', name: 'Hero',
      local_updated_at: '2026-01-01T00:00:00.000Z',
    });

    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    const list = await s1.listElements('character');
    await s1.awaitTidies(); // background tidy must settle before name checks
    const hero = await s1.getElement('aaaa12345678');
    const bystander = await s1.getElement('bbbb-b1');
    await s1.close();

    const names: string[] = [];
    // @ts-ignore
    for await (const e of (dir as any).values()) {
      if (e.kind === 'file' && !e.name.endsWith('.tmp')) names.push(e.name);
    }
    return { count: list.length, heroName: hero?.name, bystanderName: bystander?.name, names: names.sort() };
  });
  // Both elements survive with their own bodies.
  expect(result.count).toBe(3);
  expect(result.heroName).toBe('Hero');
  expect(result.bystanderName).toBe('Bystander');
  // Hero took the full-id fallback; Bystander converged to ITS canonical.
  expect(result.names).toContain('hero--aaaa12345678.json');
  expect(result.names).toContain('bystander--bbbb-b1.json');
});

test('tail collision at create: second element falls back to full-id; layout is reopen-stable', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    // Same name, same last-8 tail, different ids.
    await s1.createElement('character', { id: 'a-12345678', name: 'Hero' });
    await s1.createElement('character', { id: 'b-12345678', name: 'Hero' });
    await s1.close();

    const dir = await (root as any)
      .getDirectoryHandle('elements')
      .then((d: any) => d.getDirectoryHandle('character'));
    const listNames = async (): Promise<string[]> => {
      const names: string[] = [];
      // @ts-ignore
      for await (const e of (dir as any).values()) {
        if (e.kind === 'file' && !e.name.endsWith('.tmp')) names.push(e.name);
      }
      return names.sort();
    };
    const before = await listNames();

    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    const list = await s2.listElements('character');
    await s2.close();
    const after = await listNames();
    return { before, after, count: list.length };
  });
  expect(result.count).toBe(2);
  // Lower id keeps the short form; the collider carries its full id.
  expect(result.before).toEqual(['hero--12345678.json', 'hero--b-12345678.json']);
  // Reopen (tidy) does not churn the resolved layout.
  expect(result.after).toEqual(result.before);
});

test('case-variant of a valid form is left in place (sticky, never "corrected")', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    const s0 = new api.FsFolderStore({ tabId: 'tab-0', disableHeartbeat: true });
    await s0.open(root);
    await s0.createElement('character', { id: 'seed-1', name: 'Seed' });
    await s0.close();

    const dir = await (root as any)
      .getDirectoryHandle('elements')
      .then((d: any) => d.getDirectoryHandle('character'));
    // A foreign tool wrote the file as a CASE-VARIANT of the short canonical
    // form ('mixed-case--12345678.json' for id x-12345678, tail '12345678').
    // On a case-folding filesystem this is the SAME physical entry as the
    // canonical — atlas must not write-new + delete-old over it. (OPFS is
    // case-sensitive, so what we lock here is the sticky rule itself: no
    // rename is even attempted.)
    const fh = await dir.getFileHandle('Mixed-Case--12345678.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({
      id: 'x-12345678', type: 'character', name: 'Mixed Case',
      local_updated_at: '2026-01-01T00:00:00.000Z',
    }));
    await w.close();

    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    await s1.listElements('character');
    // Body-only edit must stay sticky too.
    await s1.updateElement('x-12345678', { description: 'still here' });
    const after = await s1.getElement('x-12345678');
    await s1.close();

    const names: string[] = [];
    // @ts-ignore
    for await (const e of (dir as any).values()) {
      if (e.kind === 'file' && !e.name.endsWith('.tmp')) names.push(e.name);
    }
    return { names: names.sort(), desc: after?.description };
  });
  expect(result.names).toContain('Mixed-Case--12345678.json');
  expect(result.names).not.toContain('mixed-case--12345678.json');
  expect(result.desc).toBe('still here');
});

test('applyServerRecord renames when the server changes the name', async ({ page }) => {
  const fetchedName = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    // Local element: "Original".
    const elem = await store.createElement('location', { id: 'loc-1', name: 'Original' });
    await store.stampServerUpdatedAt(elem.id, 'location', '2026-01-01T00:00:00.000Z');

    // Server pull changes the name.
    await store.applyServerRecord(
      'location',
      { id: 'loc-1', name: 'Renamed by server' },
      '2026-01-02T00:00:00.000Z',
    );

    const after = await store.getElement('loc-1');
    await store.close();
    return after?.name;
  });
  expect(fetchedName).toBe('Renamed by server');

  const files = await listTypeFilesInRoot(page, 'elements', 'location');
  expect(files).toEqual(['renamed-by-server--loc-1.json']);
});
