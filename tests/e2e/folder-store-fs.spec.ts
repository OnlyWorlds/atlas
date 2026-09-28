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
  // `spatial/` is NOT created for a fresh world (the union read, 2026-07-28):
  // `elements/<type>/` is the format for all 22 types, and atlas no longer
  // mints a legacy directory tree inside a folder it was asked to open.
  expect(layout).toEqual(['.atlas', 'elements', 'media']);
});

test('world.json is born with format_version and a foreign world.json is never given one', async ({ page }) => {
  // Folder-format §4.2 (v0.3.6): a writer SHOULD record the spec version it
  // wrote against. Atlas stamps it once, when it creates the file, and never
  // adds it to a folder it merely opened and edited (a reader must not
  // rewrite keys as a side effect; an edit is not a capture).
  const r = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'fv-tab', disableHeartbeat: true });
    await store.open(root);
    await store.writeWorldMeta({ id: 'w-born', name: 'Born here' });
    const born = await store.readWorldMeta();
    await store.writeWorldMeta({ name: 'Renamed' });
    const edited = await store.readWorldMeta();
    await store.close();

    // A foreign folder: world.json written by another tool, no version key.
    const foreign = await root.getDirectoryHandle('foreign', { create: true });
    const fh = await foreign.getFileHandle('world.json', { create: true });
    const w = await fh.createWritable();
    await w.write(JSON.stringify({ id: 'w-foreign', name: 'Theirs' }));
    await w.close();
    const store2 = new api.FsFolderStore({ tabId: 'fv-tab-2', disableHeartbeat: true });
    await store2.open(foreign);
    await store2.writeWorldMeta({ name: 'Theirs, edited' });
    const theirs = await store2.readWorldMeta();
    await store2.close();
    return { born, edited, theirs };
  });
  expect(r.born.format_version).toBe('0.3.6');
  expect(r.edited.format_version).toBe('0.3.6');
  expect(r.edited.name).toBe('Renamed');
  expect(r.theirs.name).toBe('Theirs, edited');
  expect(r.theirs.format_version).toBeUndefined();
});

test('a fresh world creates every element type under elements/, spatial types included', async ({ page }) => {
  const dirs = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    await store.close();
    const elements = await root.getDirectoryHandle('elements');
    const names: string[] = [];
    // @ts-ignore values()
    for await (const entry of (elements as any).values()) {
      if (entry.kind === 'directory') names.push(entry.name);
    }
    return names.sort();
  });
  for (const t of ['map', 'pin', 'zone', 'marker', 'character', 'location']) {
    expect(dirs).toContain(t);
  }
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
    // Alice on TWO maps: one element may hold only one pin per map (S307),
    // and crossing maps is the stronger cascade case anyway.
    const map2 = await store.createMap({ id: 'map-2', name: 'The Inn' });
    await store.createPin({ id: 'pin-1', name: 'p1', element_id: char.id, map_id: map.id, x: 0, y: 0 });
    await store.createPin({ id: 'pin-2', name: 'p2', element_id: char.id, map_id: map2.id, x: 1, y: 1 });
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

// ---- Body cache (speed bout, 2026-07-19) ----
// The store keeps parsed bodies in memory and serves clones; every write sink
// must update BOTH disk and cache. The decisive lock: a warm store's view and
// a fresh store's cold-from-disk view must be identical after any mix of
// writes — if a sink skips either side, the two views diverge here.

test('body cache: warm view equals cold-from-disk view after every write kind', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const a = await store.createElement('character', { name: 'Warm', description: 'v1' });
    await store.updateElement(a.id, { description: 'v2' });
    await store.stampServerUpdatedAt(a.id, 'character', '2026-07-19T10:00:00.000Z');
    const b = await store.createElement('location', { name: 'Doomed' });
    await store.deleteElement(b.id);
    await store.applyServerRecord('character', { id: crypto.randomUUID(), name: 'Pulled', description: 'from server' }, '2026-07-19T11:00:00.000Z');

    const norm = (els: any[]) => els
      .map((e: any) => ({ id: e.id, type: e.type, name: e.name, description: e.description, server: e.server_updated_at ?? null }))
      .sort((x: any, y: any) => x.id < y.id ? -1 : 1);
    const warm = norm(await store.listElements());
    await store.close();

    const fresh = new api.FsFolderStore({ tabId: 'test-tab-2', disableHeartbeat: true });
    await fresh.open(root);
    const cold = norm(await fresh.listElements());
    await fresh.close();
    return { warm, cold };
  });
  expect(result.warm.length).toBe(2);
  expect(result.warm).toEqual(result.cold);
});

test('body cache: returned elements are clones — caller mutation never leaks into later reads', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);

    const a = await store.createElement('character', { name: 'Pure', species: ['orc-1'] });
    const first = await store.getElement(a.id);
    first.name = 'MUTATED';
    (first.species as string[]).push('orc-2');
    const second = await store.getElement(a.id);
    const listed = (await store.listElements('character'))[0];
    await store.close();
    return {
      secondName: second.name,
      secondSpecies: second.species,
      listedName: listed.name,
    };
  });
  expect(result.secondName).toBe('Pure');
  expect(result.secondSpecies).toEqual(['orc-1']);
  expect(result.listedName).toBe('Pure');
});

test('listElements onProgress: cold walk reports monotonic counts ending at done === total', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const seeder = new api.FsFolderStore({ tabId: 'seed-tab', disableHeartbeat: true });
    await seeder.open(root);
    for (let i = 0; i < 12; i++) {
      await seeder.createElement('character', { name: 'p' + i });
    }
    await seeder.close();

    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const ticks: Array<[number, number]> = [];
    const cold = await store.listElements(undefined, { onProgress: (done: number, total: number) => ticks.push([done, total]) });
    const warmTicks: Array<[number, number]> = [];
    await store.listElements(undefined, { onProgress: (done: number, total: number) => warmTicks.push([done, total]) });
    await store.close();
    const monotonic = ticks.every(([d], i) => i === 0 || d >= ticks[i - 1][0]);
    return {
      count: cold.length,
      firstTick: ticks[0],
      lastTick: ticks[ticks.length - 1],
      monotonic,
      warmTickCount: warmTicks.length,
    };
  });
  expect(result.count).toBe(12);
  expect(result.firstTick).toEqual([0, 12]);
  expect(result.lastTick).toEqual([12, 12]);
  expect(result.monotonic).toBe(true);
  // Warm calls are cache-served — no cold walk, no progress ticks.
  expect(result.warmTickCount).toBe(0);
});

/**
 * FOREIGN-WRITER TOLERANCE (2026-07-28). The folder format is an interop
 * surface: other OW tools, export scripts and hand edits write into it, and
 * they do not all stamp the in-body `type`. Before this guard, ONE such file
 * blanked the entire elements sidebar and the home desk — `renderElementRow`
 * escapes `el.type` unguarded, so `undefined` threw inside the list's `.map()`
 * and the room rendered empty with nothing but a console error.
 *
 * The directory already carries the type, so the store stamps it. Fill-only:
 * a body that DECLARES a type keeps it even when it contradicts its directory
 * (convention #14 — the body is the schema).
 */
test('indexing stamps a missing in-body type from the directory, and never overrides a declared one', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const writeJson = async (dir: FileSystemDirectoryHandle, name: string, obj: unknown) => {
      const fh = await dir.getFileHandle(name, { create: true });
      const ws = await fh.createWritable();
      await ws.write(JSON.stringify(obj));
      await ws.close();
    };
    const elements = await root.getDirectoryHandle('elements', { create: true });
    const chars = await elements.getDirectoryHandle('character', { create: true });
    // Bare: id + name only. No type, no created_at, no local_updated_at.
    await writeJson(chars, 'bare.json', { id: 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', name: 'Bare' });
    // Declares a type that disagrees with its directory — the body wins.
    await writeJson(chars, 'declared.json', { id: 'bbbbbbbb-1111-4111-8111-bbbbbbbbbbbb', name: 'Declared', type: 'location' });
    // No id at all — skipped entirely, left on disk (existing contract).
    await writeJson(chars, 'idless.json', { name: 'Idless' });

    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const listed = await store.listElements('character');
    const bare = listed.find((e: any) => e.name === 'Bare');
    const declared = listed.find((e: any) => e.name === 'Declared');
    await store.close();
    return {
      count: listed.length,
      bareType: bare?.type ?? null,
      bareLocalUpdatedAt: bare?.local_updated_at ?? null,
      declaredType: declared?.type ?? null,
      names: listed.map((e: any) => e.name).sort(),
    };
  });
  // The id-less file is skipped; the other two both serve.
  expect(result.count).toBe(2);
  expect(result.names).toEqual(['Bare', 'Declared']);
  // Stamped from the directory it was found in.
  expect(result.bareType).toBe('character');
  // Timestamps stay genuinely optional — nothing synthesises them on read.
  expect(result.bareLocalUpdatedAt).toBeNull();
  // Declared type survives even though the file sits in elements/character/.
  expect(result.declaredType).toBe('location');
});

/**
 * ── THE UNION READ (2026-07-28) ───────────────────────────────────────────
 *
 * Atlas through v1.0 was the only implementation that split maps, pins, zones
 * and markers into `spatial/<type>/`. Folder Format spec v0.3 rules
 * `elements/<type>/` for all 22 types; every other writer already did that.
 *
 * The failure being guarded is SILENT: before these tests, a world written by
 * any other tool opened in atlas showing every content element, a clean UI,
 * and no maps, pins, zones or markers at all, with no warning anywhere. A
 * world that looks complete while missing an entire subsystem is the exact
 * shape the folder format exists to prevent.
 */

const MAP_A = 'cccccccc-1111-4111-8111-cccccccccccc';
const MAP_B = 'dddddddd-1111-4111-8111-dddddddddddd';

/** Write a raw element file into <layout>/<type>/, bypassing the store. */
async function seedRawElement(
  page: import('@playwright/test').Page,
  layout: string,
  type: string,
  filename: string,
  body: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(async (args: { layout: string; type: string; filename: string; body: unknown }) => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const outer = await root.getDirectoryHandle(args.layout, { create: true });
    const dir = await outer.getDirectoryHandle(args.type, { create: true });
    const fh = await dir.getFileHandle(args.filename, { create: true });
    const ws = await fh.createWritable();
    await ws.write(JSON.stringify(args.body));
    await ws.close();
  }, { layout, type, filename, body });
}

/** Names of the *.json files in <layout>/<type>/, or null when the dir is absent. */
async function listLayoutFiles(
  page: import('@playwright/test').Page,
  layout: string,
  type: string,
): Promise<string[] | null> {
  return page.evaluate(async (args: { layout: string; type: string }) => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    try {
      const outer = await root.getDirectoryHandle(args.layout);
      const dir = await outer.getDirectoryHandle(args.type);
      const names: string[] = [];
      // @ts-ignore values()
      for await (const entry of (dir as any).values()) {
        if (entry.kind === 'file' && entry.name.endsWith('.json')) names.push(entry.name);
      }
      return names.sort();
    } catch {
      return null;
    }
  }, { layout, type });
}

test('reads a map written to elements/map/ — the layout every other tool writes', async ({ page }) => {
  await seedRawElement(page, 'elements', 'map', 'shipped-world--cccccccc.json', {
    id: MAP_A, type: 'map', name: 'Shipped World',
  });
  const result = await page.evaluate(async (mapId: string) => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const maps = await store.listMaps();
    const direct = await store.getElement(mapId);
    await store.close();
    return { count: maps.length, name: maps[0]?.name ?? null, directName: direct?.name ?? null };
  }, MAP_A);
  expect(result.count).toBe(1);
  expect(result.name).toBe('Shipped World');
  // getElement's cold-start warm loop must find it too, not only listMaps.
  expect(result.directName).toBe('Shipped World');
});

test('still reads a legacy spatial/map/, and keeps writing that world there', async ({ page }) => {
  await seedRawElement(page, 'spatial', 'map', 'legacy--dddddddd.json', {
    id: MAP_B, type: 'map', name: 'Legacy World',
  });
  const result = await page.evaluate(async (mapId: string) => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const maps = await store.listMaps();
    // A NEW map in a legacy-layout world joins its siblings rather than
    // splitting one world across two directories.
    await store.createMap({ name: 'Second Legacy' });
    // An EDIT to the existing one rewrites it where it lives.
    await store.updateElement(mapId, { description: 'edited' });
    await store.awaitTidies();
    const reread = await store.getElement(mapId);
    await store.close();
    return { count: maps.length, name: maps[0]?.name ?? null, desc: reread?.description ?? null };
  }, MAP_B);
  expect(result.count).toBe(1);
  expect(result.name).toBe('Legacy World');
  expect(result.desc).toBe('edited');
  // Two maps in the legacy home; the canonical map dir was never created.
  expect(await listLayoutFiles(page, 'spatial', 'map')).toHaveLength(2);
  expect((await listLayoutFiles(page, 'elements', 'map')) ?? []).toHaveLength(0);
});

test('an id present in BOTH layouts serves one copy and deletes neither file', async ({ page }) => {
  // Both seeded at their CANONICAL filenames, so the open-time tidy is a
  // no-op and this test measures deletion only (Kael's differential, 998
  // comparisons: a name that already matches short-circuits before any I/O).
  await seedRawElement(page, 'elements', 'map', 'canonical-copy--cccccccc.json', {
    id: MAP_A, type: 'map', name: 'Canonical Copy', local_updated_at: '2026-07-28T10:00:00.000Z',
  });
  await seedRawElement(page, 'spatial', 'map', 'legacy-copy--cccccccc.json', {
    id: MAP_A, type: 'map', name: 'Legacy Copy', local_updated_at: '2026-07-28T12:00:00.000Z',
  });
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const maps = await store.listMaps();
    await store.awaitTidies();
    await store.close();
    return { count: maps.length, name: maps[0]?.name ?? null };
  });
  // One element, not two — the id is the identity.
  expect(result.count).toBe(1);
  // The newer stamp wins.
  expect(result.name).toBe('Legacy Copy');
  // NEITHER file is removed. Same-directory twins are a rename crash and get
  // deduped; cross-directory twins are two tools writing legitimately, and
  // atlas does not resolve someone else's folder by destroying half of it.
  expect(await listLayoutFiles(page, 'elements', 'map')).toEqual(['canonical-copy--cccccccc.json']);
  expect(await listLayoutFiles(page, 'spatial', 'map')).toEqual(['legacy-copy--cccccccc.json']);
});

test('a foreign capture serves its content AND spatial elements in one list', async ({ page }) => {
  await seedRawElement(page, 'elements', 'character', 'kid--eeeeeeee.json', {
    id: 'eeeeeeee-1111-4111-8111-eeeeeeeeeeee', type: 'character', name: 'The Kid',
  });
  await seedRawElement(page, 'elements', 'map', 'territory--cccccccc.json', {
    id: MAP_A, type: 'map', name: 'The Territory',
  });
  await seedRawElement(page, 'elements', 'zone', 'border--ffffffff.json', {
    id: 'ffffffff-1111-4111-8111-ffffffffffff', type: 'zone', name: 'The Border',
  });
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const all = await store.listElements();
    await store.close();
    return { count: all.length, types: all.map((e: any) => e.type).sort() };
  });
  // The capture opens WHOLE: 3 of 3, not 1 of 3 with a clean UI.
  expect(result.count).toBe(3);
  expect(result.types).toEqual(['character', 'map', 'zone']);
});

/**
 * ── BORN BARE (S359, Skeld's ruling 2026-09-28) ──────────────────────────
 *
 * A folder atlas creates writes pin/marker links under the format's bare
 * names (`map`, `zone`), the spelling every other implementation reads. In
 * memory they stay `map_id`/`zone_id` (atlas's one spelling above the store).
 * A folder that already carries the suffixed spelling keeps it (the sticky
 * half is guarded in folder-conformance.spec.ts and below).
 */
test('a new folder is born bare: pins and markers write map and zone, not map_id and zone_id', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const map = await store.createElement('map', { name: 'Chart' });
    const char = await store.createElement('character', { name: 'Pinned' });
    const zone = await store.createElement('zone', { name: 'Reach' });
    const pin = await store.createElement('pin', { name: 'p', map_id: map.id, element_id: char.id, element_type: 'character', x: 1, y: 2 });
    const marker = await store.createElement('marker', { name: 'm', map_id: map.id, zone_id: zone.id, x: 3, y: 4, order: 0 });
    const inMemory = await store.getElement(pin.id);
    await store.close();
    const readOne = async (type: string) => {
      const dir = await (await root.getDirectoryHandle('elements')).getDirectoryHandle(type);
      for await (const entry of (dir as any).values()) {
        if (entry.kind === 'file') return JSON.parse(await (await (await dir.getFileHandle(entry.name)).getFile()).text());
      }
      return null;
    };
    const pinRaw = await readOne('pin');
    const markerRaw = await readOne('marker');
    return {
      mapId: map.id, zoneId: zone.id, charId: char.id,
      pinMap: pinRaw?.map ?? null, pinHasSuffix: pinRaw ? 'map_id' in pinRaw : null,
      pinElement: pinRaw?.element_id ?? null,
      markerMap: markerRaw?.map ?? null, markerZone: markerRaw?.zone ?? null,
      markerHasSuffix: markerRaw ? ('map_id' in markerRaw || 'zone_id' in markerRaw) : null,
      memoryMap: inMemory?.map_id ?? null,
      memoryHasBare: inMemory ? 'map' in inMemory : null,
      markerId: marker.id,
    };
  });
  expect(result.pinMap).toBe(result.mapId);
  expect(result.pinHasSuffix).toBe(false);
  // `element_id` IS the schema's name for a pin's target: never renamed.
  expect(result.pinElement).toBe(result.charId);
  expect(result.markerMap).toBe(result.mapId);
  expect(result.markerZone).toBe(result.zoneId);
  expect(result.markerHasSuffix).toBe(false);
  expect(result.memoryMap).toBe(result.mapId);
  expect(result.memoryHasBare).toBe(false);
});

test('a folder whose pins already use map_id keeps that spelling for a new pin', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const writeJson = async (dir: FileSystemDirectoryHandle, name: string, obj: unknown) => {
      const fh = await dir.getFileHandle(name, { create: true });
      const ws = await fh.createWritable();
      await ws.write(JSON.stringify(obj, null, 2) + '\n');
      await ws.close();
    };
    const elements = await root.getDirectoryHandle('elements', { create: true });
    const maps = await elements.getDirectoryHandle('map', { create: true });
    const pins = await elements.getDirectoryHandle('pin', { create: true });
    const mapId = 'cccccccc-1111-4111-8111-cccccccccccc';
    await writeJson(maps, 'old-map--cccccccc.json', { id: mapId, name: 'Old map' });
    await writeJson(pins, 'old-pin--dddddddd.json', { id: 'dddddddd-1111-4111-8111-dddddddddddd', name: 'Old pin', map_id: mapId, x: 0, y: 0 });
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    await store.listElements();
    const created = await store.createElement('pin', { name: 'Newer', map_id: mapId, x: 5, y: 5 });
    await store.close();
    let raw: Record<string, unknown> | null = null;
    for await (const entry of (pins as any).values()) {
      if (entry.kind === 'file' && entry.name.startsWith('newer--')) {
        raw = JSON.parse(await (await (await pins.getFileHandle(entry.name)).getFile()).text());
      }
    }
    return { createdId: created.id, rawMapId: raw?.map_id ?? null, rawHasBare: raw ? 'map' in raw : null };
  });
  expect(result.rawMapId).toBe('cccccccc-1111-4111-8111-cccccccccccc');
  expect(result.rawHasBare).toBe(false);
});

/**
 * ── AN OUTSIDE EDIT SURVIVES ATLAS'S NEXT WRITE (S359) ────────────────────
 *
 * Atlas caches every body at open and does not watch the folder. Before
 * S359 an update merged its patch into the CACHED body, so a field another
 * tool (an AI following the toolkit's writer rules, a text editor) changed
 * in the file was overwritten the next time atlas wrote that element. The
 * write paths now merge into the body as it is on disk (`readForWrite`).
 */
test('a field edited in the file by another tool survives an atlas update to a different field', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'test-tab', disableHeartbeat: true });
    await store.open(root);
    const el = await store.createElement('character', { name: 'Aldric', description: 'as atlas wrote it' });
    await store.listElements(); // the cache now holds the body
    // Another tool rewrites the file in place, bypassing the store.
    const dir = await (await root.getDirectoryHandle('elements')).getDirectoryHandle('character');
    let filename = '';
    for await (const entry of (dir as any).values()) {
      if (entry.kind === 'file' && entry.name.startsWith('aldric--')) filename = entry.name;
    }
    const fh = await dir.getFileHandle(filename);
    const body = JSON.parse(await (await fh.getFile()).text());
    body.description = 'edited outside atlas';
    body.x_other_tool = { note: 'kept' };
    const ws = await fh.createWritable();
    await ws.write(JSON.stringify(body, null, 2) + '\n');
    await ws.close();
    // Atlas edits a DIFFERENT field of the same element.
    const returned = await store.updateElement(el.id, { motivations: 'written by atlas' });
    // What the UI re-lists after a save (element-detail-fields re-reads the list).
    const listed = (await store.listElements('character')).find((e: any) => e.id === el.id);
    await store.close();
    const raw = JSON.parse(await (await (await dir.getFileHandle(filename)).getFile()).text());
    return {
      rawDescription: raw.description, rawMotivations: raw.motivations, rawExtension: raw.x_other_tool?.note ?? null,
      returnedDescription: returned.description,
      listedDescription: listed?.description ?? null,
    };
  });
  expect(result.rawMotivations).toBe('written by atlas');
  expect(result.rawDescription).toBe('edited outside atlas');
  expect(result.rawExtension).toBe('kept');
  // The returned body (what the UI adopts) carries the outside edit too.
  expect(result.returnedDescription).toBe('edited outside atlas');
  expect(result.listedDescription).toBe('edited outside atlas');
});
