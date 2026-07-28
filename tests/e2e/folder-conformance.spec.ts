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

test('atlas reads the conformance fixture: 6 normative elements + 1 legacy, nothing invented', async ({ page }) => {
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
