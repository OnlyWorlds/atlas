/**
 * The boot reconciliation against concurrent saves (contract
 * §3.2): the pass decides inside each directory's lock against the registry
 * as STORED, returns deltas, and its caller applies them to the registry as
 * it is when the pass ends. Real `saveRegistry` merge, real storage events
 * (adoptStoredRegistry, as app.ts's listener runs it), fake Web Locks: tab A
 * is played by writes to localStorage and a held lock.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { installFakeLocks, type FakeLocks } from '../fixtures/fake-locks';
import { BROWSER_HOME, setOpfsRootForTests } from '../../src/core/browser-worlds';
import { beginBootReconciliation, openBrowserMake, reconcileAtBoot, RECONCILE_WAIT_LIMIT_MS } from '../../src/core/browser-home';
import { adoptStoredRegistry, loadRegistry } from '../../src/registry/registry';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const WID = '0192a000-0000-7000-8000-00000000aaaa';
const XID = '0192c000-0000-7000-8000-00000000cccc';
const TID = '0192d000-0000-7000-8000-00000000dddd';
const VID = '0192e000-0000-7000-8000-00000000eeee';

const browserEntry = (id: string, worldId: string, dir: string, over: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry => ({
  id, name: id, state: 'local-only', where: 'browser', created_at: '2026-10-01T00:00:00.000Z',
  folder: { handle_key: `world-${worldId}`, folder_name: dir, last_path_hint: `browser storage/${dir}` }, ...over,
} as WorldRegistryEntry);
const regOf = (...worlds: WorldRegistryEntry[]): WorldsRegistry => ({ ...defaultRegistry(), worlds });

const W = browserEntry('regW', WID, 'w-0192a000-0001');
const stored = (): WorldsRegistry => JSON.parse(localStorage.getItem(REGISTRY_STORAGE_KEY)!);

let home: FakeDirHandle;
let locks: FakeLocks;
let uninstall: () => void;

/** This tab booted with `reg` (storage and memory agree, the merge base set). */
function bootWith(reg: WorldsRegistry): void {
  localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(reg));
  patchSlice('registry', loadRegistry());
}

/** Another tab saves `reg`; with `event`, this tab's storage listener folds it in. */
function otherTabSaves(reg: WorldsRegistry, event: boolean): void {
  localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(reg));
  if (event) {
    const merged = adoptStoredRegistry(getState().registry);
    if (merged) patchSlice('registry', merged);
  }
}

/** Run `fn` once, while the pass reads `dir`'s world.json (inside its lock, before it decides). */
function duringPassAt(dir: string, fn: () => void): void {
  const d = home.children.get(dir) as unknown as { getFileHandle: (n: string, o?: unknown) => Promise<unknown> };
  const real = d.getFileHandle.bind(d);
  let fired = false;
  d.getFileHandle = async (n: string, o?: unknown) => {
    if (n === 'world.json' && !fired) { fired = true; fn(); }
    return real(n, o);
  };
}

beforeEach(() => {
  localStorage.clear();
  home = new FakeDirHandle(BROWSER_HOME);
  home.put(`${W.folder.folder_name}/world.json`, j({ id: WID, name: 'W' }));
  ({ locks, uninstall } = installFakeLocks());
});
afterEach(() => {
  uninstall();
  setOpfsRootForTests(null);
});

describe('a make another tab commits during the pass (gate B1 scenario A)', () => {
  for (const event of [true, false]) {
    it(`keeps one row for the made world, the maker's own (storage event ${event ? 'before' : 'after'} the save)`, async () => {
      const X = browserEntry('regX', XID, 'x-0192c000-0002');
      home.put(`${X.folder.folder_name}/world.json`, j({ id: XID, name: 'X' }));
      bootWith(regOf(W));
      const releaseX = await locks.hold(`atlas-world:${X.folder.folder_name}`); // tab A's make holds it
      duringPassAt(W.folder.folder_name, () => {
        otherTabSaves(regOf(W, X), event); // tab A commits, then releases
        releaseX();
      });
      await reconcileAtBoot({ home: home as unknown as FileSystemDirectoryHandle });
      const naming = stored().worlds.filter(w => w.folder.folder_name === X.folder.folder_name);
      expect(naming.map(w => w.id)).toEqual(['regX']);
    });
  }
});

describe('any save another tab makes during the pass survives it (gate B1 scenario B)', () => {
  it('a Make online saved mid-pass keeps its api while the pass marks another world cleared', async () => {
    const V = browserEntry('regV', VID, 'v-0192e000-0003'); // its directory is gone: the pass marks it
    bootWith(regOf(W, V));
    duringPassAt(W.folder.folder_name, () => {
      const online = { ...W, state: 'api-linked', api: { world_id: 'srv-w', api_key: 'k' } } as WorldRegistryEntry;
      otherTabSaves(regOf(online, V), true);
    });
    await reconcileAtBoot({ home: home as unknown as FileSystemDirectoryHandle });
    const w = stored().worlds.find(e => e.id === 'regW')!;
    expect(w.api?.world_id).toBe('srv-w');
    expect(w.state).toBe('api-linked');
    expect(stored().worlds.find(e => e.id === 'regV')?.cleared_at).toBeTruthy();
    expect(getState().registry.worlds.find(e => e.id === 'regW')?.api?.world_id).toBe('srv-w');
  });
});

describe('a save whose storage event has not arrived when the pass applies', () => {
  it('a world another tab deleted mid-pass does not come back as cleared', async () => {
    const V = browserEntry('regV', VID, 'v-0192e000-0003'); // its directory is gone: the pass queues a mark
    bootWith(regOf(W, V));
    duringPassAt(W.folder.folder_name, () => otherTabSaves(regOf(W), false)); // tab A deleted V
    await reconcileAtBoot({ home: home as unknown as FileSystemDirectoryHandle });
    expect(stored().worlds.map(w => w.id)).toEqual(['regW']);
  });

  it('an orphan another tab adopted mid-pass keeps one row', async () => {
    const dir = 'l-0192c000-0006';
    home.put(`${dir}/world.json`, j({ id: XID, name: 'L' }));
    const later = 'z-0192f000-0007'; // decided after L: a directory with no world.json
    home.put(`${later}/notes.txt`, 'x');
    bootWith(regOf(W));
    // The other tab's adoption lands after this pass decided L, before it applies.
    duringPassAt(later, () => otherTabSaves(regOf(W, browserEntry('regL-A', XID, dir)), false));
    const naming = async () => {
      await reconcileAtBoot({ home: home as unknown as FileSystemDirectoryHandle });
      return stored().worlds.filter(w => w.folder.folder_name === dir).map(w => w.id);
    };
    expect(await naming()).toEqual(['regL-A']);
  });
});

describe('a tour started after the pass began (gate B1 scenario C)', () => {
  it('keeps its directory: the tour flag is read when the directory is decided, not when the pass starts', async () => {
    const T = browserEntry('regT', TID, 'hyperion-0192d000-0004', { demo: true });
    home.put(`${T.folder.folder_name}/world.json`, j({ id: TID, name: 'Hyperion', demo: true }));
    bootWith(regOf(W));
    const releaseT = await locks.hold(`atlas-world:${T.folder.folder_name}`); // the scaffold's make
    duringPassAt(W.folder.folder_name, () => {
      localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 2, worldId: 'regT' }));
      otherTabSaves(regOf(W, T), false);
      releaseT();
    });
    await reconcileAtBoot({ home: home as unknown as FileSystemDirectoryHandle });
    expect(home.children.has(T.folder.folder_name)).toBe(true);
  });

  it('an unclaimed tour directory is left while a tour runs that began after the pass did (rule 3 read live)', async () => {
    const dir = 'hyperion-0192d000-0005';
    home.put(`${dir}/world.json`, j({ id: TID, name: 'Hyperion', demo: true }));
    bootWith(regOf(W));
    duringPassAt(W.folder.folder_name, () => {
      localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 1 }));
    });
    await reconcileAtBoot({ home: home as unknown as FileSystemDirectoryHandle });
    expect(home.children.has(dir)).toBe(true);
  });
});

describe('every make waits for the pass (contract §3.2)', () => {
  it('openBrowserMake creates nothing until the boot reconciliation settles', async () => {
    const root = new FakeDirHandle('opfs');
    setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
    const settle = beginBootReconciliation();
    let made = false;
    const pending = openBrowserMake('Late', XID).then(m => { made = true; return m; });
    await new Promise(r => setTimeout(r, 20));
    expect(made).toBe(false);
    expect(root.children.has(BROWSER_HOME)).toBe(false);
    settle();
    const make = await pending;
    expect(made).toBe(true);
    await make.abort();
  });

  it('a pass that never ends holds a make only so long', async () => {
    const root = new FakeDirHandle('opfs');
    setOpfsRootForTests(async () => root as unknown as FileSystemDirectoryHandle);
    vi.useFakeTimers();
    try {
      beginBootReconciliation(); // never settled: a hung hydrateAtlasRoot
      let made = false;
      const pending = openBrowserMake('Late', XID).then(m => { made = true; return m; });
      await vi.advanceTimersByTimeAsync(RECONCILE_WAIT_LIMIT_MS - 1);
      expect(made).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      vi.useRealTimers();
      const make = await pending;
      expect(made).toBe(true);
      await make.abort();
    } finally {
      vi.useRealTimers();
    }
  });
});
