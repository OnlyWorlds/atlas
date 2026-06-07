/**
 * Real FolderStore (FS Access API) — Playwright E2E.
 *
 * Drives FsFolderStore against an OPFS-backed handle (same interface as a
 * user-chosen folder; no file picker needed). Verifies the same contract the
 * MockFolderStore satisfies in vitest, plus FS-specific concerns (lock file,
 * tombstone durability, layout creation).
 *
 * Bout 3 will pull the shared "contract" assertions out of this file and the
 * vitest suite into a single parameterized suite. For now this serves both as
 * the FS-impl smoke and as the staging ground for that extraction.
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
  // Wait for the test API to attach (dev-only).
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  // Clear OPFS between tests so each starts fresh.
  await page.evaluate(async () => {
    await window.__atlasTestApi.opfsRoot({ clear: true });
  });
});

test('opens an OPFS handle and creates the atlas folder layout', async ({ page }) => {
  const layout = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    // Enumerate top-level directories.
    const dirs: string[] = [];
    // @ts-ignore values()
    for await (const entry of (root as any).values()) {
      if (entry.kind === 'directory') dirs.push(entry.name);
    }
    return dirs.sort();
  });
  expect(layout).toEqual(['.atlas', 'elements', 'media', 'spatial']);
});

test('round-trips a character through create / read / list', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const created = await store.createElement('character', { name: 'Alice', description: 'a hobbit' });
    const fetched = await store.getElement(created.id);
    const listed = await store.listElements('character');

    return {
      createdId: created.id,
      createdLocal: created.local_updated_at,
      fetchedName: fetched?.name,
      fetchedDesc: fetched?.description,
      listedCount: listed.length,
    };
  });
  expect(result.createdId).toBeTruthy();
  expect(result.createdLocal).toBeTruthy();
  expect(result.fetchedName).toBe('Alice');
  expect(result.fetchedDesc).toBe('a hobbit');
  expect(result.listedCount).toBe(1);
});

test('updateElement advances local_updated_at and persists patch fields', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const a = await store.createElement('character', { name: 'Bob' });
    const t1 = a.local_updated_at;
    // Force a different ISO string by reopening with a clock injection.
    await new Promise(r => setTimeout(r, 5));
    const b = await store.updateElement(a.id, { description: 'a knight' });
    return { t1, t2: b.local_updated_at, name: b.name, description: b.description };
  });
  expect(result.name).toBe('Bob');
  expect(result.description).toBe('a knight');
  expect(result.t2 > result.t1).toBe(true);
});

test('concurrent updates to the same element serialize — both fields land (convention #79)', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const created = await store.createElement('character', { name: 'Alice' });
    // Unserialized, the second read-merge-write's read predates the first's
    // write and silently reverts its field (the session-237 lost-update class)
    // — against the REAL store the gap is genuine disk I/O.
    await Promise.all([
      store.updateElement(created.id, { description: 'a hobbit' }),
      store.updateElement(created.id, { physicality: 'short' }),
    ]);
    const after = await store.getElement(created.id);
    return { desc: after?.description, phys: (after as any)?.physicality };
  });
  expect(result.desc).toBe('a hobbit');
  expect(result.phys).toBe('short');
});

test('reopens the same folder and reads back persisted data', async ({ page }) => {
  const fetched = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    // First session — create + close.
    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    await s1.createElement('location', { id: 'loc-1', name: 'Shire' });
    await s1.close();

    // Second session — reopen the same root, read back.
    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    const elem = await s2.getElement('loc-1');
    await s2.close();
    return elem?.name;
  });
  expect(fetched).toBe('Shire');
});

test('deleteElement cascades pins referencing the deleted character', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const char = await store.createElement('character', { id: 'char-1', name: 'Alice' });
    const map = await store.createMap({ id: 'map-1', name: 'Atlas' });
    await store.createPin({ id: 'pin-1', name: 'p1', element_id: char.id, map_id: map.id, x: 0, y: 0 });
    await store.createPin({ id: 'pin-2', name: 'p2', element_id: char.id, map_id: map.id, x: 1, y: 1 });
    await store.createPin({ id: 'pin-other', name: 'decoy', element_id: 'someone-else', map_id: map.id, x: 0, y: 0 });

    const preview = await store.findDependents(char.id);
    const { tombstones } = await store.deleteElement(char.id);
    const remaining = await store.listElements('pin');

    return {
      previewIds: preview.map((p: any) => p.id).sort(),
      tombstoneIds: tombstones.map((t: any) => t.id),
      remainingPinIds: remaining.map((p: any) => p.id).sort(),
    };
  });
  expect(result.previewIds).toEqual(['pin-1', 'pin-2']);
  // Primary is last; cascade entries precede.
  expect(result.tombstoneIds[result.tombstoneIds.length - 1]).toBe('char-1');
  expect(result.tombstoneIds.slice(0, -1).sort()).toEqual(['pin-1', 'pin-2']);
  expect(result.remainingPinIds).toEqual(['pin-other']);
});

test('tombstones persist across close/reopen', async ({ page }) => {
  const tombs = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    const s1 = new api.FsFolderStore({ tabId: 'tab-1', disableHeartbeat: true });
    await s1.open(root);
    await s1.createElement('character', { id: 'char-1', name: 'Alice' });
    await s1.deleteElement('char-1');
    await s1.close();

    const s2 = new api.FsFolderStore({ tabId: 'tab-2', disableHeartbeat: true });
    await s2.open(root);
    const list = await s2.listTombstonesSince(null);
    await s2.close();
    return list.map((t: any) => t.id);
  });
  expect(tombs).toEqual(['char-1']);
});

test('sync state round-trips', async ({ page }) => {
  const state = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    await store.writeSyncState({ last_pull_at: '2026-01-01T00:00:00.000Z', paused: true });
    return await store.readSyncState();
  });
  expect(state.last_pull_at).toBe('2026-01-01T00:00:00.000Z');
  expect(state.paused).toBe(true);
});

test('lock file is written on open and removed on close', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const afterOpen = await store.__debug_readLock();
    await store.close();
    const afterClose = await store.__debug_readLock();

    return { afterOpenTabId: afterOpen?.tab_id, afterCloseExists: afterClose !== null };
  });
  expect(result.afterOpenTabId).toBe('test-tab');
  expect(result.afterCloseExists).toBe(false);
});

test('second tab with a live lock cannot take over', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    const owner = new api.FsFolderStore({ tabId: 'owner', disableHeartbeat: true });
    await owner.open(root);

    let caught: string | null = null;
    const peer = new api.FsFolderStore({ tabId: 'peer', disableHeartbeat: true, takeStaleLock: false });
    try {
      await peer.open(root);
    } catch (err) {
      caught = err instanceof Error ? err.name : 'unknown';
    }
    await owner.close();
    return caught;
  });
  expect(result).toBe('ELockHeld');
});

test('stale lock (older than TTL) is taken over by a new tab', async ({ page }) => {
  const newOwner = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();

    // Forge a stale lock by injecting an old heartbeat directly.
    const atlasDir = await root.getDirectoryHandle('.atlas', { create: true });
    const fh = await atlasDir.getFileHandle('lock', { create: true });
    const w = await fh.createWritable();
    const stale = {
      tab_id: 'dead-tab',
      started_at: new Date(Date.now() - 600_000).toISOString(),
      last_heartbeat: new Date(Date.now() - 300_000).toISOString(), // 5 minutes ago
    };
    await w.write(JSON.stringify(stale));
    await w.close();

    // New tab opens — should take the lock.
    const store = new api.FsFolderStore({ tabId: 'fresh', disableHeartbeat: true });
    await store.open(root);
    const lock = await store.__debug_readLock();
    await store.close();
    return lock?.tab_id;
  });
  expect(newOwner).toBe('fresh');
});

test('listLocallyChangedSince finds elements without server_updated_at', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    await store.createElement('character', { id: 'c1', name: 'fresh' });
    const synced = await store.createElement('character', { id: 'c2', name: 'pre-synced' });
    await store.stampServerUpdatedAt(synced.id, 'character', synced.local_updated_at);

    const pending = await store.listLocallyChangedSince(null);
    return pending.map((e: any) => e.id).sort();
  });
  expect(result).toEqual(['c1']);
});

test('applyServerRecord writes both timestamps from the server value', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const serverTs = '2026-03-15T10:00:00.000Z';
    await store.applyServerRecord('location', { id: 'l1', name: 'Mordor' }, serverTs);

    const fetched = await store.getElement('l1');
    // Verify it's not flagged as locally-changed.
    const pending = await store.listLocallyChangedSince(null);
    return {
      local: fetched?.local_updated_at,
      server: fetched?.server_updated_at,
      pendingCount: pending.length,
    };
  });
  expect(result.local).toBe('2026-03-15T10:00:00.000Z');
  expect(result.server).toBe('2026-03-15T10:00:00.000Z');
  expect(result.pendingCount).toBe(0);
});
