/**
 * FsFolderStore — slug-prefix filename refactor (E2E).
 *
 * Locks the on-disk filename contract end-to-end:
 *   - createElement('Alice') writes `alice--<uuid>.json`.
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
  expect(files[0]).toBe(`alice-the-wandering--${result.id}.json`);
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
  expect(files).toEqual([`aliyah--${result.id}.json`]);
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
  expect(files).toEqual([`bob--${result.id}.json`]);
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
