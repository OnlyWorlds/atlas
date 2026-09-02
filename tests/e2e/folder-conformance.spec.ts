/**
 * THE CONFORMANCE FIXTURE, run against the reference implementation.
 *
 * `tests/fixtures/folder-conformance/` is an ecosystem artifact, not an atlas
 * one: one tiny world folder plus a machine-readable answer key that any
 * OnlyWorlds Folder Format reader can run against (npm SDK, a Unity reader, a
 * third party). Its README states the contract. This spec is atlas answering
 * it, so the claim "shipped atlas reads the format" is a failing test rather
 * than a sentence in a capability card that someone quotes six weeks later.
 *
 * The fixture is seeded into OPFS byte-for-byte from disk — no re-encoding, no
 * store helpers — so what atlas reads here is exactly what a stranger's folder
 * would hand it.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { test, expect } from '@playwright/test';

// Playwright transpiles specs to CJS (no `"type": "module"` in package.json),
// so `__dirname` is the portable anchor here and `import.meta.url` is not.
const FIXTURE_ROOT = join(__dirname, '..', 'fixtures', 'folder-conformance');
const WORLD_DIR = join(FIXTURE_ROOT, 'world');

interface ExpectedElement { id: string; name: string; type: string }
interface Expected {
  world: { id: string; name: string };
  elements: ExpectedElement[];
  legacy_elements: ExpectedElement[];
  skipped_files: Array<{ path: string; must_remain_on_disk: boolean }>;
}
const EXPECTED: Expected = JSON.parse(readFileSync(join(FIXTURE_ROOT, 'expected.json'), 'utf8'));

/** Every file in the fixture world, as posix-ish relative path → raw text. */
function readFixtureFiles(dir: string, acc: Array<{ path: string; text: string }> = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) readFixtureFiles(full, acc);
    else acc.push({ path: relative(WORLD_DIR, full).split(sep).join('/'), text: readFileSync(full, 'utf8') });
  }
  return acc;
}

declare global {
  interface Window {
    __atlasTestApi: {
      FsFolderStore: new (opts?: Record<string, unknown>) => any;
      opfsRoot: (opts?: { clear?: boolean }) => Promise<FileSystemDirectoryHandle>;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await window.__atlasTestApi.opfsRoot({ clear: true }); });
  // Seed the fixture verbatim.
  await page.evaluate(async (files: Array<{ path: string; text: string }>) => {
    const root = await window.__atlasTestApi.opfsRoot();
    for (const file of files) {
      const parts = file.path.split('/');
      const name = parts.pop()!;
      let dir = root;
      for (const segment of parts) dir = await dir.getDirectoryHandle(segment, { create: true });
      const fh = await dir.getFileHandle(name, { create: true });
      const ws = await fh.createWritable();
      await ws.write(file.text);
      await ws.close();
    }
  }, readFixtureFiles(WORLD_DIR));
});

// The counts come from `expected.json` and are never written into this title:
// an earlier title said "6 normative + 1 legacy", was true when written, and
// went stale the moment the answer key grew while the assertion below (derived)
// stayed correct. A test name is a claim like any other.
test('atlas reads the conformance fixture: every element in the answer key, nothing invented', async ({ page }) => {
  const report = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'conformance', disableHeartbeat: true });
    await store.open(root);
    const meta = await store.readWorldMeta();
    const all = await store.listElements();
    await store.awaitTidies();
    await store.close();
    return {
      worldId: meta.id ?? null,
      worldName: meta.name ?? null,
      elements: all.map((e: any) => ({
        id: e.id,
        name: e.name,
        type: e.type,
        hasCreatedAt: e.created_at !== undefined,
        hasLocalUpdatedAt: e.local_updated_at !== undefined,
        probe: e.x_probe_note ?? null,
        pinMap: e.map_id ?? null,
      })),
    };
  });

  expect(report.worldId).toBe(EXPECTED.world.id);
  expect(report.worldName).toBe(EXPECTED.world.name);

  const byId = new Map(report.elements.map(e => [e.id, e]));
  // Atlas is a legacy-tolerant reader: it covers both tiers.
  expect(report.elements).toHaveLength(EXPECTED.elements.length + EXPECTED.legacy_elements.length);

  for (const want of [...EXPECTED.elements, ...EXPECTED.legacy_elements]) {
    const got = byId.get(want.id);
    expect(got, `expected element ${want.name} (${want.id})`).toBeTruthy();
    expect(got!.name).toBe(want.name);
    // The body wins over the directory: `Declared Elsewhere` is a location.
    expect(got!.type).toBe(want.type);
  }

  // Only `name` is required — nothing may be synthesised onto a bare element.
  const onlyName = byId.get('11111111-2222-4333-8444-555555555501')!;
  expect(onlyName.hasCreatedAt).toBe(false);
  expect(onlyName.hasLocalUpdatedAt).toBe(false);

  // Unknown extension fields survive the read.
  expect(byId.get('11111111-2222-4333-8444-555555555507')!.probe).toContain('round trip');

  // A mapless pin is a legitimate app pattern (Captain's ruling, 2026-07-28):
  // it loads, and atlas does not invent a map for it.
  expect(byId.get('11111111-2222-4333-8444-555555555505')!.pinMap).toBeNull();

  // A pin linked under the SPEC spelling (`map`, §5 bare link names) resolves
  // to its map in memory (S354). Before this, a folder written by another
  // tool opened with every pin missing and the map index reading 0.
  expect(byId.get('11111111-2222-4333-8444-555555555508')!.pinMap).toBe('11111111-2222-4333-8444-555555555503');
});

/**
 * THE LINK SPELLING IS PER FILE AND STICKY (S354, §5).
 *
 * Editing a bare-spelled pin must write `map` back, not `map_id`; creating a
 * new pin in a folder whose pins are all bare must follow the folder; and an
 * atlas-spelled file keeps its suffix. In memory every pin reads `map_id`.
 * Runs on a COPY of the fixture (this test writes), so the byte-identical
 * test below still sees the pristine seed.
 */
test('a bare-spelled pin keeps its spelling through an edit, and a new pin follows the folder', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'conformance-spelling', disableHeartbeat: true });
    await store.open(root);
    const bareId = '11111111-2222-4333-8444-555555555508';
    const mapId = '11111111-2222-4333-8444-555555555503';
    await store.listElements();
    await store.awaitTidies();
    // Edit the bare pin: a plain field change, nothing about its map.
    await store.updateElement(bareId, { description: 'moved a little' });
    // Create a new pin: the folder's pins are all bare, so it follows.
    const created = await store.createElement('pin', { name: 'Newcomer', map_id: mapId, x: 1, y: 2 });
    const inMemory = await store.getElement(bareId);
    const fresh = await store.getElement(created.id);
    await store.close();
    // Read the bytes back, bypassing the store.
    const pinDir = await (await root.getDirectoryHandle('elements')).getDirectoryHandle('pin');
    const readRaw = async (name: string) => JSON.parse(await (await (await pinDir.getFileHandle(name)).getFile()).text());
    const bareRaw = await readRaw('on-the-map--55555508.json');
    // The fixture carries a legacy `spatial/` directory, so the union read's
    // sticky layout sends NEW spatial files there (convention #91). The
    // spelling rule is layout-independent; look in both homes.
    let newRaw: Record<string, unknown> | null = null;
    for (const segments of [['elements', 'pin'], ['spatial', 'pin']]) {
      let dir: FileSystemDirectoryHandle | null = root;
      for (const s of segments) {
        try { dir = await dir!.getDirectoryHandle(s); } catch { dir = null; break; }
      }
      if (!dir) continue;
      for await (const entry of (dir as any).values()) {
        if (entry.kind === 'file' && entry.name.startsWith('newcomer--')) {
          newRaw = JSON.parse(await (await (await dir.getFileHandle(entry.name)).getFile()).text());
        }
      }
    }
    return {
      memoryMap: inMemory?.map_id ?? null,
      memoryHasBare: inMemory ? 'map' in inMemory : null,
      freshMap: fresh?.map_id ?? null,
      bareRawMap: bareRaw.map ?? null,
      bareRawHasSuffix: 'map_id' in bareRaw,
      bareRawDescription: bareRaw.description ?? null,
      newRawMap: newRaw?.map ?? null,
      newRawHasSuffix: newRaw ? 'map_id' in newRaw : null,
    };
  });
  expect(result.memoryMap).toBe('11111111-2222-4333-8444-555555555503');
  expect(result.memoryHasBare).toBe(false);
  expect(result.freshMap).toBe('11111111-2222-4333-8444-555555555503');
  expect(result.bareRawDescription).toBe('moved a little');
  expect(result.bareRawMap).toBe('11111111-2222-4333-8444-555555555503');
  expect(result.bareRawHasSuffix).toBe(false);
  expect(result.newRawMap).toBe('11111111-2222-4333-8444-555555555503');
  expect(result.newRawHasSuffix).toBe(false);
});

/**
 * THE NOW, UNDER EITHER SPELLING (folder-format v0.3.5).
 *
 * Canonical `schema/world.yaml` names this field `time_current` — atlas's disk
 * name is the standard's name, and keel's `time_range_current` is the
 * deviation (renamed in its v1→v2 migration, standard never updated). A
 * capture written straight from the v2 wire therefore carries the wire's
 * spelling, and before this guard its world opened with no now at all.
 *
 * The second assertion is the load-bearing one: the foreign key is NOT
 * rewritten. A reader must not migrate a key spelling as a side effect of
 * being pointed at a folder.
 */
test('a capture written with the wire spelling still has its now, and keeps its own key', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    // Overwrite the fixture's world.json with a capture-shaped one: the wire
    // spelling only, exactly as another implementation's writer emits it.
    const fh = await root.getFileHandle('world.json', { create: true });
    const ws = await fh.createWritable();
    await ws.write(JSON.stringify({
      id: '0f01d3ea-0000-4000-8000-000000000001',
      name: 'Conformance',
      time_basic_unit: 'Year',
      time_range_min: -300,
      time_range_max: 100,
      time_range_current: 42,
      snapshot_label: 'ch05',
    }, null, 2));
    await ws.close();

    const store = new api.FsFolderStore({ tabId: 'conformance', disableHeartbeat: true });
    await store.open(root);
    const meta = await store.readWorldMeta();
    await store.close();

    const onDisk = JSON.parse(await (await (await root.getFileHandle('world.json')).getFile()).text());
    return {
      now: meta.time_current ?? null,
      diskHasWireKey: Object.prototype.hasOwnProperty.call(onDisk, 'time_range_current'),
      diskHasCanonicalKey: Object.prototype.hasOwnProperty.call(onDisk, 'time_current'),
      unit: meta.time_basic_unit ?? null,
    };
  });
  // The now is READ, under the canonical name the rest of atlas consumes.
  expect(result.now).toBe(42);
  expect(result.unit).toBe('Year');
  // And the file is untouched: its own spelling survives, no canonical key
  // was invented on disk. Opening a capture must never migrate it.
  expect(result.diskHasWireKey).toBe(true);
  expect(result.diskHasCanonicalKey).toBe(false);
});

test('a read leaves the fixture folder byte-identical, id-less file included', async ({ page }) => {
  const after = await page.evaluate(async () => {
    const api = window.__atlasTestApi;
    const root = await api.opfsRoot();
    const store = new api.FsFolderStore({ tabId: 'conformance', disableHeartbeat: true });
    await store.open(root);
    await store.listElements();
    await store.awaitTidies();
    await store.close();

    const walk = async (dir: any, prefix: string, out: Record<string, string>) => {
      for await (const entry of dir.values()) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.kind === 'directory') await walk(entry, path, out);
        else out[path] = await (await entry.getFile()).text();
      }
      return out;
    };
    return walk(root, '', {} as Record<string, string>);
  });

  const before = Object.fromEntries(readFixtureFiles(WORLD_DIR).map(f => [f.path, f.text]));
  // The id-less file is still there, untouched. It is not an element, and it
  // is not atlas's to delete.
  expect(after['elements/character/idless.json']).toBe(before['elements/character/idless.json']);
  // Every seeded element file survives at its original path with its original
  // bytes: the fixture's filenames are already canonical, so the open-time
  // tidy short-circuits before any I/O (Kael's 998-comparison differential).
  for (const [path, text] of Object.entries(before)) {
    expect(after[path], `fixture file ${path} should be unchanged`).toBe(text);
  }
  // Atlas DOES create its own scaffolding on open (`.atlas/`, empty type dirs).
  // That is the known look-don't-touch gap, tracked separately — it adds
  // entries, and this test's contract is that it never alters existing ones.
});
