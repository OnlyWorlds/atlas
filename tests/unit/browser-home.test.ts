/**
 * The browser home's reconciliation (1.17 bout 1, conv. 129; contract §3.2).
 * It must never adopt a half-made world, never delete a world of the user's
 * own, and say which worlds the browser cleared.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { BROWSER_HOME } from '../../src/core/browser-worlds';
import { mintBrowserDirName, reconcileBrowserHome, staleBrowserCopies, worldAlreadyHere } from '../../src/core/browser-home';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry, WorldsRegistry } from '../../src/core/types';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const W1 = '0192a000-0000-7000-8000-00000000aaaa';
const W2 = '0192b000-0000-7000-8000-00000000bbbb';

function homeWith(files: Record<string, string>): FakeDirHandle {
  const home = new FakeDirHandle(BROWSER_HOME);
  for (const [p, body] of Object.entries(files)) home.put(p, body);
  return home;
}
const asDir = (h: FakeDirHandle) => h as unknown as FileSystemDirectoryHandle;

function entry(over: Partial<WorldRegistryEntry>): WorldRegistryEntry {
  return {
    id: 'reg-' + Math.random().toString(16).slice(2, 8), name: 'X', state: 'local-only',
    folder: { handle_key: `world-${W1}`, folder_name: 'x' }, created_at: '2026-10-01T00:00:00.000Z', ...over,
  };
}
const regOf = (...worlds: WorldRegistryEntry[]): WorldsRegistry => ({ ...defaultRegistry(), worlds });

/** A fake Web Locks API: names in `held` are taken by another tab. */
function fakeLocks(held: Set<string>) {
  (navigator as unknown as { locks?: unknown }).locks = {
    request: async (name: string, opts: { ifAvailable?: boolean }, cb: (l: unknown) => unknown) =>
      cb(opts?.ifAvailable && held.has(name) ? null : { name }),
  };
}
afterEach(() => { delete (navigator as unknown as { locks?: unknown }).locks; });

describe('mintBrowserDirName / worldAlreadyHere', () => {
  it('a fresh nonce every time, so a name is never re-made', () => {
    const a = mintBrowserDirName('Hollow Reach', W1);
    const b = mintBrowserDirName('Hollow Reach', W1);
    expect(a).toMatch(/^hollow-reach-0192a000-[0-9a-f]{4}$/);
    expect(a === b).toBe(false); // 1 in 65,536 to flake; the nonce is the point
  });
  it('matches a suffixed handle key and a linked world by its server id', () => {
    const reg = regOf(entry({ folder: { handle_key: `world-${W1}-2`, folder_name: 'a' } }));
    expect(worldAlreadyHere(reg, W1)).toBeTruthy();
    expect(worldAlreadyHere(reg, W2)).toBeUndefined();
    const linked = regOf(entry({ folder: { handle_key: 'world-local', folder_name: 'b' }, state: 'api-linked', api: { world_id: W2, api_key: 'k' } }));
    expect(worldAlreadyHere(linked, W2)).toBeTruthy();
  });
});

describe('reconcileBrowserHome', () => {
  it('re-adopts a world the registry lost, as a browser world, with its link', async () => {
    const home = homeWith({
      'alpha-0192a000-1a2b/world.json': j({ id: W1, name: 'Alpha' }),
      'beta-0192b000-3c4d/world.json': j({ id: W2, name: 'Beta', api: { world_id: 'srv', api_key: 'ow_w_x' } }),
    });
    const out = await reconcileBrowserHome(regOf(), { tourActive: false, home: asDir(home) });
    expect(out.adopted.sort()).toEqual(['alpha-0192a000-1a2b', 'beta-0192b000-3c4d']);
    const alpha = out.next.worlds.find(w => w.name === 'Alpha')!;
    expect(alpha.where).toBe('browser');
    expect(alpha.folder.handle_key).toBe(`world-${W1}`);
    expect(out.next.worlds.find(w => w.name === 'Beta')!.api?.world_id).toBe('srv');
  });

  it('removes a crashed make (marker, free lock) and never adopts it', async () => {
    const home = homeWith({
      'half-0192a000-1a2b/.atlas/making': 'x',
      'half-0192a000-1a2b/world.json': j({ id: W1, name: 'Half' }), // import and link write world.json first
    });
    fakeLocks(new Set());
    const out = await reconcileBrowserHome(regOf(), { tourActive: false, home: asDir(home) });
    expect(out.removed).toEqual(['half-0192a000-1a2b']);
    expect(out.adopted).toEqual([]);
    expect(home.children.size).toBe(0);
  });

  it('skips a make another tab still holds: neither adopted nor removed', async () => {
    const home = homeWith({
      'busy-0192a000-1a2b/.atlas/making': 'x',
      'busy-0192a000-1a2b/world.json': j({ id: W1, name: 'Busy' }),
    });
    fakeLocks(new Set(['atlas-world:busy-0192a000-1a2b']));
    const out = await reconcileBrowserHome(regOf(), { tourActive: false, home: asDir(home) });
    expect(out.removed).toEqual([]);
    expect(out.adopted).toEqual([]);
    expect(home.children.size).toBe(1);
  });

  it('removes an unclaimed tour scaffold only when no tour is running', async () => {
    const files = { 'hyperion-0192a000-1a2b/world.json': j({ id: W1, name: 'Hyperion', demo: true }) };
    const during = homeWith(files);
    expect((await reconcileBrowserHome(regOf(), { tourActive: true, home: asDir(during) })).removed).toEqual([]);
    const after = homeWith(files);
    expect((await reconcileBrowserHome(regOf(), { tourActive: false, home: asDir(after) })).removed).toEqual(['hyperion-0192a000-1a2b']);
  });

  it('never adopts a stale copy of a world the registry places in a folder, and removes it only when a move named it', async () => {
    const files = { 'alpha-0192a000-1a2b/world.json': j({ id: W1, name: 'Alpha' }) };
    const folderWorld = entry({ folder: { handle_key: `world-${W1}`, folder_name: 'alpha-0192a000' } });
    const left = await reconcileBrowserHome(regOf(folderWorld), { tourActive: false, home: asDir(homeWith(files)) });
    expect(left.adopted).toEqual([]);
    expect(left.removed).toEqual([]);
    expect(left.stale).toEqual(['alpha-0192a000-1a2b']);
    // Settings, Storage counts what the last pass left (contract §3.4).
    expect(staleBrowserCopies()).toEqual(['alpha-0192a000-1a2b']);
    const moved = { ...folderWorld, moved_from: 'alpha-0192a000-1a2b' } as WorldRegistryEntry;
    const done = await reconcileBrowserHome(regOf(moved), { tourActive: false, home: asDir(homeWith(files)) });
    expect(done.removed).toEqual(['alpha-0192a000-1a2b']);
    expect(staleBrowserCopies()).toEqual([]);
  });

  it('marks every browser world of the user own whose directory is gone, keeps its link, leaves the tour alone', async () => {
    const gone = entry({ where: 'browser', folder: { handle_key: `world-${W1}`, folder_name: 'gone-0192a000-1a2b' }, state: 'api-linked', api: { world_id: 's', api_key: 'k' } });
    const here = entry({ where: 'browser', folder: { handle_key: `world-${W2}`, folder_name: 'here-0192b000-3c4d' } });
    const tour = entry({ where: 'browser', demo: true, folder: { handle_key: 'world-t', folder_name: 'hyperion-t' } });
    const home = homeWith({ 'here-0192b000-3c4d/world.json': j({ id: W2, name: 'Here' }) });
    const out = await reconcileBrowserHome(regOf(gone, here, tour), { tourActive: false, home: asDir(home) });
    expect(out.cleared).toEqual([gone.id]);
    const g = out.next.worlds.find(w => w.id === gone.id)!;
    expect(g.cleared_at).toBeTruthy();
    expect(g.api?.api_key).toBe('k');
    expect(out.next.worlds.find(w => w.id === tour.id)!.cleared_at).toBeUndefined();
    expect(out.next.worlds).toHaveLength(3);
  });

  it('with no browser home at all, marks every browser world of the user own', async () => {
    const gone = entry({ where: 'browser', folder: { handle_key: `world-${W1}`, folder_name: 'gone' } });
    const root = new FakeDirHandle('opfs');
    const { setOpfsRootForTests } = await import('../../src/core/browser-worlds');
    setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
    try {
      const out = await reconcileBrowserHome(regOf(gone), { tourActive: false });
      expect(out.cleared).toEqual([gone.id]);
    } finally {
      setOpfsRootForTests(null);
    }
  });

  it('a directory that comes back clears its mark; two entries for one directory collapse into the older', async () => {
    const back = entry({ where: 'browser', cleared_at: '2026-10-02T00:00:00.000Z', folder: { handle_key: `world-${W1}`, folder_name: 'back-0192a000-1a2b' }, created_at: '2026-10-01T00:00:00.000Z' });
    const twin = { ...back, id: 'twin', cleared_at: undefined, created_at: '2026-10-03T00:00:00.000Z' };
    const home = homeWith({ 'back-0192a000-1a2b/world.json': j({ id: W1, name: 'Back' }) });
    const out = await reconcileBrowserHome(regOf(back, twin), { tourActive: false, home: asDir(home) });
    expect(out.next.worlds.map(w => w.id)).toEqual([back.id]);
    expect(out.next.worlds[0].cleared_at).toBeUndefined();
  });

  it('leaves an unreadable world.json and a directory with no world.json alone', async () => {
    const home = homeWith({ 'odd-1/world.json': '{ nope', 'empty-2/elements/character/.keep': '' });
    const out = await reconcileBrowserHome(regOf(), { tourActive: false, home: asDir(home) });
    expect(out.removed).toEqual([]);
    expect(out.adopted).toEqual([]);
    expect(home.children.size).toBe(2);
  });
});
