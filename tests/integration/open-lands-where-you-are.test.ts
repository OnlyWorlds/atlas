/**
 * A world's open lands where the person is (1.125.8, conv. 195).
 *
 * An open that finishes draws into the place the person is at that moment,
 * never back to the place it started from. A world picked meanwhile opens
 * next from there: the earlier open commits as it always did and only its
 * landing is skipped. Each case holds the open (the DEV hold,
 * `window.__atlasOpenHold` in `src/core/open-place.ts`, or a folder
 * permission that waits), presses what a person would press while it is
 * held, releases it, and reads the route, the list and the store.
 *
 * Families (the census in the build report): the boot's open of the world in
 * the address, a pick (the sidebar, Home, a link's Open it), and a restore
 * that ends by landing on the world it brought back (Bring it down again; the
 * other task flows are `tests/integration/open-lands-task-flows.test.ts`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState, patchSlice, subscribe } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores, getActiveStore } from '../../src/core/active-store';
import { settingsHash } from '../../src/core/router';

// A folder permission per world (the handle's name is its key): one that waits, or one refused.
const gates = vi.hoisted(() => ({ wait: new Map<string, Promise<boolean>>(), deny: new Set<string>(), parked: new WeakSet<object>() }));

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async (key: string) => ({ kind: 'directory', name: key }),
  ensureWritable: async (h: { name: string }) => (gates.wait.has(h.name) ? gates.wait.get(h.name)! : !gates.deny.has(h.name)),
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));

vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  class ParkingStore extends MockFolderStore {
    park(): void { gates.parked.add(this); }
    async unpark(): Promise<boolean> { gates.parked.delete(this); return true; }
  }
  class ELockHeld extends Error {}
  return { FsFolderStore: ParkingStore, ELockHeld };
});

const restore = vi.hoisted(() => ({ release: null as null | (() => void) }));
vi.mock('../../src/setup/bring-down-again', () => ({
  bringDownAgain: () => new Promise((res) => { restore.release = () => res({ failures: 0, syncWaits: null }); }),
}));
vi.mock('../../src/setup/world-parent', () => ({ askBrowserToKeepWorlds: () => {} }));

import { activateWorld } from '../../src/sidebar/worlds-sidebar';
import { BringDownAgainModal } from '../../src/ui/bring-down-again-modal';

const toasts = { error() {}, info() {}, success() {}, show() {}, dismiss() {}, problem() {} } as never;
const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

type HoldWindow = Window & { __atlasOpenHold?: Promise<void>; __atlasOpenHeld?: number };
let release: () => void = () => {};

/** Every open from here waits at its commit until `release()`. */
function holdOpens(): void {
  const w = window as HoldWindow;
  w.__atlasOpenHeld = 0;
  w.__atlasOpenHold = new Promise<void>(r => { release = r; });
}
function freeOpens(): void {
  const w = window as HoldWindow;
  delete w.__atlasOpenHold;
  delete w.__atlasOpenHeld;
}
async function untilHeld(n = 1): Promise<void> {
  await vi.waitFor(() => expect((window as HoldWindow).__atlasOpenHeld ?? 0).toBeGreaterThanOrEqual(n));
}
/** The world's folder permission waits until the returned function answers it. */
function holdPermission(worldId: string): (ok: boolean) => void {
  let answer: (ok: boolean) => void = () => {};
  gates.wait.set(`k-${worldId}`, new Promise<boolean>(r => { answer = r; }));
  return answer;
}

/** What the sidebar gear does (`src/sidebar/sidebar.ts`): Settings of the world open now, if any. */
function pressSettings(): void {
  window.location.hash = settingsHash(getState().active?.worldId ?? null);
}

/** Every world that became active, in order. */
function watchActive(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  let last = getState().active?.worldId ?? null;
  const stop = subscribe(() => {
    const now = getState().active?.worldId ?? null;
    if (now !== last && now) seen.push(now);
    last = now;
  });
  return { seen, stop };
}

/** Every address a hashchange announced, and how many fired. */
function watchHashes(): { seen: string[]; stop: () => void } {
  const seen: string[] = [];
  // A dispatched re-fire carries no newURL: the address it announces is the one there.
  const on = (e: HashChangeEvent) => { seen.push(e.newURL ? new URL(e.newURL).hash : window.location.hash); };
  window.addEventListener('hashchange', on);
  return { seen, stop: () => window.removeEventListener('hashchange', on) };
}

function worldEntry(id: string, name: string) {
  return { id, name, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: `f-${id}` } } as never;
}

/** w1 open with one element in it, at its writing room. */
async function onWorldOne(hash = '#/w/w1/writing'): Promise<void> {
  expect(await activateWorld('w1', toasts)).toBe(true);
  await getActiveStore()!.createElement('character', { name: 'Ada' } as never);
  patchSlice('data', { ...getState().data, elements: await getActiveStore()!.listElements() });
  window.location.hash = hash;
}
const activeParked = () => gates.parked.has(getActiveStore() as object);

const BOOT = { silent: true, preserveSelection: true, permissionMode: 'query' as const, sayLockHeld: true };

beforeEach(() => {
  freeOpens();
  gates.wait.clear();
  gates.deny.clear();
  restore.release = null;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', {
    ...defaultRegistry(),
    worlds: [worldEntry('w1', 'World One'), worldEntry('w2', 'World Two'), worldEntry('w3', 'World Three')],
  });
  window.location.hash = '#/';
});

afterEach(() => {
  freeOpens();
  document.body.innerHTML = '';
});

describe('the boot opens the world in the address', () => {
  it('Settings pressed while it opens stays Settings, now of that world', async () => {
    window.location.hash = '#/w/w1';
    holdOpens();
    const open = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    pressSettings();
    expect(window.location.hash).toBe('#/settings');
    release();
    expect(await open).toBe(true);
    await tick();
    expect(getState().active?.worldId).toBe('w1');
    expect(window.location.hash).toBe('#/w/w1/settings/onlyworlds');
  });

  it('a tab chosen under Settings keeps its tab', async () => {
    window.location.hash = '#/w/w1/element/e1';
    holdOpens();
    const open = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    window.location.hash = settingsHash(null, 'general');
    release();
    await open;
    await tick();
    expect(window.location.hash).toBe('#/w/w1/settings/general');
  });

  it('the Data room with no world, opened while it opens, is left as it is (the shell makes it that world\'s)', async () => {
    window.location.hash = '#/w/w1';
    holdOpens();
    const open = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    window.location.hash = '#/import';
    release();
    expect(await open).toBe(true);
    await tick();
    expect(window.location.hash).toBe('#/import');
  });

  it('another world picked while it opens: the boot commits as before, draws no landing, and the pick opens from the person\'s place', async () => {
    window.location.hash = '#/w/w1';
    const active = watchActive();
    holdOpens();
    const boot = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    pressSettings();
    const pick = activateWorld('w2', toasts);
    await tick();
    const hashes = watchHashes();
    release();
    expect(await boot).toBe(true);
    expect(await pick).toBe(true);
    await tick();
    active.stop();
    hashes.stop();
    expect(active.seen).toEqual(['w1', 'w2']);
    // The boot's own landing (Settings read onto w1) is never written.
    expect(hashes.seen).not.toContain('#/w/w1/settings/onlyworlds');
    expect(window.location.hash).toBe('#/w/w2/settings/onlyworlds');
    expect(activeParked()).toBe(false);
  });

  it('another world picked while it opens, which then fails: the address world is open, at its address', async () => {
    window.location.hash = '#/w/w1/writing';
    gates.deny.add('k-w2');
    holdOpens();
    const boot = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    const pick = activateWorld('w2', toasts);
    release();
    expect(await boot).toBe(true);
    expect(await pick).toBe(false);
    await tick();
    expect(getState().active?.worldId).toBe('w1');
    expect(activeParked()).toBe(false);
    expect(window.location.hash).toBe('#/w/w1/writing');
  });

  it('nothing pressed: the address it opened from, deep route and all, announced once more', async () => {
    window.location.hash = '#/w/w1/element/e1';
    await tick();
    holdOpens();
    const open = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    const hashes = watchHashes();
    release();
    expect(await open).toBe(true);
    hashes.stop();
    expect(window.location.hash).toBe('#/w/w1/element/e1');
    expect(getState().active?.worldId).toBe('w1');
    // The re-fire: route-aware subscribers that listen only to hashchange read the opened world.
    expect(hashes.seen).toEqual(['#/w/w1/element/e1']);
  });
});

describe('a pick opens a world', () => {
  it('Settings pressed while it opens (the gear reads the world still open) lands on the picked world\'s Settings, in place of the entry the press made', async () => {
    await onWorldOne();
    holdOpens();
    const open = activateWorld('w2', toasts);
    await untilHeld();
    expect(window.location.hash).toBe('#/w/w2/writing');
    pressSettings();
    expect(window.location.hash).toBe('#/w/w1/settings');
    const entries = history.length;
    release();
    expect(await open).toBe(true);
    await tick();
    expect(getState().active?.worldId).toBe('w2');
    expect(window.location.hash).toBe('#/w/w2/settings/onlyworlds');
    // Replaced, not pushed: Back never leads to the entry that named w1.
    expect(history.length).toBe(entries);
  });

  it('an open that fails leaves the person where they went, never back where it started', async () => {
    await onWorldOne();
    const answer = holdPermission('w2');
    const open = activateWorld('w2', toasts);
    await vi.waitFor(() => expect(window.location.hash).toBe('#/w/w2/writing'));
    pressSettings();
    answer(false);
    expect(await open).toBe(false);
    await tick();
    expect(getState().active?.worldId).toBe('w1');
    expect(window.location.hash).toBe('#/w/w1/settings');
  });

  it('an open that fails with nothing pressed goes back where it started, as before', async () => {
    await onWorldOne();
    gates.deny.add('k-w2');
    expect(await activateWorld('w2', toasts)).toBe(false);
    await tick();
    expect(window.location.hash).toBe('#/w/w1/writing');
  });

  it('picked over by the world the person was on: that world comes back whole, its store live', async () => {
    await onWorldOne();
    const answer = holdPermission('w2');
    const first = activateWorld('w2', toasts);
    await vi.waitFor(() => expect(window.location.hash).toBe('#/w/w2/writing'));
    const back = activateWorld('w1', toasts);
    answer(true);
    expect(await first).toBe(true);
    expect(await back).toBe(true);
    await tick();
    expect(getState().active?.worldId).toBe('w1');
    expect(getState().data.elements).toHaveLength(1);
    expect(activeParked()).toBe(false);
    expect(window.location.hash).toBe('#/w/w1/writing');
  });

  it('picked over by a world that then fails: the first pick stays open, its store live', async () => {
    await onWorldOne();
    const answer = holdPermission('w2');
    gates.deny.add('k-w3');
    const first = activateWorld('w2', toasts);
    await vi.waitFor(() => expect(window.location.hash).toBe('#/w/w2/writing'));
    const second = activateWorld('w3', toasts);
    answer(true);
    expect(await first).toBe(true);
    expect(await second).toBe(false);
    await tick();
    expect(getState().active?.worldId).toBe('w2');
    expect(activeParked()).toBe(false);
    expect(window.location.hash).toBe('#/w/w2/writing');
  });

  it('picked over with nothing else pressed: one history entry a pick, as before', async () => {
    await onWorldOne();
    await tick();
    const entries = history.length;
    holdOpens();
    const first = activateWorld('w2', toasts);
    await untilHeld();
    const second = activateWorld('w3', toasts);
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await tick();
    expect(window.location.hash).toBe('#/w/w3/writing');
    expect(history.length).toBe(entries + 2);
  });

  it('picked over: its landing is skipped, and the later pick opens from the person\'s place', async () => {
    await onWorldOne();
    holdOpens();
    const first = activateWorld('w2', toasts);
    await untilHeld();
    pressSettings();
    const second = activateWorld('w3', toasts);
    await tick();
    const hashes = watchHashes();
    release();
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    await tick();
    hashes.stop();
    expect(getState().active?.worldId).toBe('w3');
    expect(hashes.seen).not.toContain('#/w/w2/settings/onlyworlds');
    expect(window.location.hash).toBe('#/w/w3/settings/onlyworlds');
  });

  it('the same world asked for again while it opens still opens once', async () => {
    holdOpens();
    const first = activateWorld('w2', toasts);
    await untilHeld();
    const again = activateWorld('w2', toasts);
    release();
    expect(await first).toBe(true);
    expect(await again).toBe(true);
    expect(getState().active?.worldId).toBe('w2');
  });

  it('nothing pressed: the room it carried over, as before', async () => {
    await onWorldOne();
    holdOpens();
    const open = activateWorld('w2', toasts);
    await untilHeld();
    release();
    expect(await open).toBe(true);
    await tick();
    expect(window.location.hash).toBe('#/w/w2/writing');
  });
});

describe('a restore lands on the world it brought back', () => {
  function bringDown(): HTMLButtonElement {
    new BringDownAgainModal(worldEntry('w3', 'World Three'), toasts).open();
    return document.querySelector<HTMLButtonElement>('[data-modal="bring-down-again"] [data-action="bring-down"]')!;
  }

  it('a place the person moved to while it downloads stands, read onto that world', async () => {
    window.location.hash = '#/w/w1/timeline';
    bringDown().click();
    await vi.waitFor(() => expect(restore.release).not.toBeNull());
    // Back, under the locked dialog.
    window.location.hash = '#/w/w1/share';
    restore.release!();
    await vi.waitFor(() => expect(document.querySelector('[data-modal="bring-down-again"]')).toBeNull());
    await tick();
    expect(window.location.hash).toBe('#/w/w3/share');
  });

  it('a world picked while it downloads, and open when it lands: the restore draws nothing', async () => {
    await onWorldOne('#/w/w1/timeline');
    bringDown().click();
    await vi.waitFor(() => expect(restore.release).not.toBeNull());
    expect(await activateWorld('w2', toasts)).toBe(true);
    expect(window.location.hash).toBe('#/w/w2/timeline');
    restore.release!();
    await vi.waitFor(() => expect(document.querySelector('[data-modal="bring-down-again"]')).toBeNull());
    await tick();
    expect(getState().active?.worldId).toBe('w2');
    expect(window.location.hash).toBe('#/w/w2/timeline');
  });

  // The pick queued behind a restore has already put its own address up when the restore's lock lets go.
  for (const opens of [true, false]) {
    it(`a world picked and still opening when it lands: the address ends naming the open world (the pick ${opens ? 'opens' : 'fails'})`, async () => {
      await onWorldOne('#/w/w1/timeline');
      bringDown().click();
      await vi.waitFor(() => expect(restore.release).not.toBeNull());
      patchSlice('active', { worldId: 'w3', meta: { id: 'w3', name: 'World Three' }, opened: true } as never);
      const answer = holdPermission('w2');
      const pick = activateWorld('w2', toasts);
      await vi.waitFor(() => expect(window.location.hash).toBe('#/w/w2/timeline'));
      restore.release!();
      await vi.waitFor(() => expect(document.querySelector('[data-modal="bring-down-again"]')).toBeNull());
      await tick();
      answer(opens);
      expect(await pick).toBe(opens);
      await tick();
      expect(getState().active?.worldId).toBe(opens ? 'w2' : 'w3');
      expect(window.location.hash).toBe(`#/w/${opens ? 'w2' : 'w3'}/timeline`);
    });
  }

  it('nothing pressed: its Home, as before', async () => {
    window.location.hash = '#/w/w1/timeline';
    bringDown().click();
    await vi.waitFor(() => expect(restore.release).not.toBeNull());
    restore.release!();
    await vi.waitFor(() => expect(document.querySelector('[data-modal="bring-down-again"]')).toBeNull());
    await tick();
    expect(window.location.hash).toBe('#/w/w3');
  });
});
