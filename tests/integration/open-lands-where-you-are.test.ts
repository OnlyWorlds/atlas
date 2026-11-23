/**
 * A world's open lands where the person is (1.125.8, conv. 195).
 *
 * An open that finishes draws into the place the person is at that moment,
 * never back to the place it started from; a world picked meanwhile wins, and
 * the earlier open draws nothing. Each case holds the open with the DEV hold
 * (`window.__atlasOpenHold`, `src/core/open-place.ts`), presses what a person
 * would press while it is held, releases it, and reads the route.
 *
 * Families (the census in the build report): the boot's open of the world in
 * the address, a pick (the sidebar, Home, a link's Open it), and a restore
 * that ends by landing on the world it brought back (Bring it down again; the
 * download dialogs share its ending, `landOpen`).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getState, patchSlice, subscribe } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../src/core/active-store';
import { settingsHash } from '../../src/core/router';

const gates = vi.hoisted(() => ({ permission: null as null | Promise<boolean> }));

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => ({ kind: 'directory', name: 'fake' }),
  ensureWritable: async () => (gates.permission ? gates.permission : true),
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));

vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  class ParkingStore extends MockFolderStore {
    park(): void {}
    async unpark(): Promise<boolean> { return true; }
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

function worldEntry(id: string, name: string) {
  return { id, name, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: `f-${id}` } } as never;
}

const BOOT = { silent: true, preserveSelection: true, permissionMode: 'query' as const, sayLockHeld: true };

beforeEach(() => {
  freeOpens();
  gates.permission = null;
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

  it('another world picked while it opens wins: the address world is never drawn', async () => {
    window.location.hash = '#/w/w1';
    const watch = watchActive();
    holdOpens();
    const boot = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    const pick = activateWorld('w2', toasts);
    release();
    expect(await boot).toBe(false);
    expect(await pick).toBe(true);
    watch.stop();
    expect(watch.seen).toEqual(['w2']);
    expect(window.location.hash).toBe('#/w/w2');
  });

  it('nothing pressed: the address it opened from, deep route and all', async () => {
    window.location.hash = '#/w/w1/element/e1';
    holdOpens();
    const open = activateWorld('w1', toasts, BOOT);
    await untilHeld();
    release();
    expect(await open).toBe(true);
    expect(window.location.hash).toBe('#/w/w1/element/e1');
    expect(getState().active?.worldId).toBe('w1');
  });
});

describe('a pick opens a world', () => {
  async function onWorldOne(hash: string): Promise<void> {
    expect(await activateWorld('w1', toasts)).toBe(true);
    window.location.hash = hash;
  }

  it('Settings pressed while it opens (the gear reads the world still open) lands on the picked world\'s Settings', async () => {
    await onWorldOne('#/w/w1/writing');
    holdOpens();
    const open = activateWorld('w2', toasts);
    await untilHeld();
    expect(window.location.hash).toBe('#/w/w2/writing');
    pressSettings();
    expect(window.location.hash).toBe('#/w/w1/settings');
    release();
    expect(await open).toBe(true);
    await tick();
    expect(getState().active?.worldId).toBe('w2');
    expect(window.location.hash).toBe('#/w/w2/settings/onlyworlds');
  });

  it('an open that fails leaves the person where they went, never back where it started', async () => {
    await onWorldOne('#/w/w1/writing');
    let deny: (ok: boolean) => void = () => {};
    gates.permission = new Promise<boolean>(r => { deny = r; });
    const open = activateWorld('w2', toasts);
    await vi.waitFor(() => expect(window.location.hash).toBe('#/w/w2/writing'));
    pressSettings();
    deny(false);
    expect(await open).toBe(false);
    await tick();
    expect(getState().active?.worldId).toBe('w1');
    expect(window.location.hash).toBe('#/w/w1/settings');
  });

  it('an open that fails with nothing pressed goes back where it started, as before', async () => {
    await onWorldOne('#/w/w1/writing');
    gates.permission = Promise.resolve(false);
    expect(await activateWorld('w2', toasts)).toBe(false);
    await tick();
    expect(window.location.hash).toBe('#/w/w1/writing');
  });

  it('another world picked while it opens wins: the first pick is never drawn', async () => {
    await onWorldOne('#/w/w1/knowledge');
    const watch = watchActive();
    holdOpens();
    const first = activateWorld('w2', toasts);
    await untilHeld();
    const second = activateWorld('w3', toasts);
    release();
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    watch.stop();
    expect(watch.seen).toEqual(['w3']);
    expect(window.location.hash).toBe('#/w/w3/knowledge');
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
    await onWorldOne('#/w/w1/writing');
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
