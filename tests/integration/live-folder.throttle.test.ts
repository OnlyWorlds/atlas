/**
 * The live folder's focus throttle and its tour exemption (S365, promoted from
 * the orient lane B probe). Real FsFolderStore over the in-memory FS.
 * - A focus inside the 5 s throttle arms one trailing pass, so an agent's
 *   edit that lands seconds after the last pass still shows (M4).
 * - The tour exemption asks whether the ACTIVE world is the tour world; the
 *   tour flag is per origin, so a tour in another tab must not switch this
 *   tab's live folder off (L1), and the tour world itself is still skipped.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => null,
  getCurrentSyncWorldId: () => null,
  requestPushIfLinked: () => {},
  refreshMetaCacheNow: async () => {},
}));

import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import { rescanNow, installLiveFolder, __resetLiveFolderForTests } from '../../src/core/live-folder';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();

async function localWorld(): Promise<{ root: FakeDirHandle; store: FsFolderStore; id: string }> {
  const root = new FakeDirHandle('w');
  root.put('world.json', j({ id: 'w1', name: 'W' }));
  const store = new FsFolderStore({ clock, tabId: 'test', disableHeartbeat: true, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  const el = await store.createElement('character', { name: 'Gil' });
  setActiveStore(store);
  const entry = { id: 'w-local', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'w' }, created_at: 'x' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: 'w-local', meta: await store.readWorldMeta(), opened: true } as never);
  patchSlice('data', { elements: await store.listElements(), loading: false } as never);
  return { root, store, id: el.id };
}
function editOutside(root: FakeDirHandle, id: string, patch: Record<string, unknown>): void {
  const p = root.list().find(x => x.startsWith('elements/') && x.includes(id.slice(-8)))!;
  root.put(p, j({ ...JSON.parse(root.get(p)!), ...patch }));
}
const desc = (id: string) => getState().data.elements.find(e => e.id === id)?.description;

beforeEach(() => { localStorage.clear(); __resetLiveFolderForTests(); });
afterEach(() => { vi.useRealTimers(); });

describe('an agent edit landing inside the 5 s focus throttle', () => {
  it('coming back to the window within 5 s of the last pass still shows the edit (eventually, without another alt-tab)', async () => {
    const { root, id } = await localWorld();
    const off = installLiveFolder();
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      window.dispatchEvent(new Event('focus'));      // pass 1 at t=0 (user clicks into Atlas)
      await rescanNow();                              // join it
      await new Promise(r => setTimeout(r, 0));
      // t=1 s: user alt-tabs to the agent; t=2 s: agent writes; t=3 s: user comes back.
      editOutside(root, id, { description: 'agent wrote this' });
      now += 3_000;
      window.dispatchEvent(new Event('focus'));
      await new Promise(r => setTimeout(r, 50));
      // The user now stays in Atlas. Time passes; no further focus event.
      now += 60_000;
      await vi.waitFor(() => expect(desc(id)).toBe('agent wrote this'), { timeout: 4_000, interval: 50 });
    } finally { spy.mockRestore(); off(); }
  });
});

describe('the tour exemption is per world, not per origin', () => {
  it('a tour running in another tab does not switch off this tab\'s live folder', async () => {
    const { root, id } = await localWorld();
    // Tab 2 started the tour (localStorage is per origin, not per tab).
    localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true, step: 3, worldId: 'tour-w' }));
    editOutside(root, id, { description: 'agent' });
    const out = await rescanNow({ force: true, full: true });
    expect({ skipped: out.skipped, desc: desc(id) }).toEqual({ skipped: undefined, desc: 'agent' });
  });

  it('the tour world itself is never rescanned', async () => {
    const { root, id } = await localWorld();
    const reg = getState().registry;
    patchSlice('registry', { ...reg, worlds: reg.worlds.map(w => ({ ...w, demo: true })) });
    editOutside(root, id, { description: 'agent' });
    const out = await rescanNow({ force: true, full: true });
    expect({ skipped: out.skipped, desc: desc(id) }).toEqual({ skipped: 'busy', desc: undefined });
  });

  it('no pass runs under a zone reshape (S367: its old ui.zoneEditing check was dead)', async () => {
    const { root, id } = await localWorld();
    const edit = document.createElement('div');
    edit.className = 'atlas-zone-editing';
    document.body.appendChild(edit);
    editOutside(root, id, { description: 'agent' });
    const out = await rescanNow({ force: true, full: true });
    edit.remove();
    expect({ skipped: out.skipped, desc: desc(id) }).toEqual({ skipped: 'busy', desc: undefined });
  });
});

describe('control: the same return after 6 s shows the edit', () => {
  it('outside the throttle the harness sees the edit', async () => {
    const { root, id } = await localWorld();
    const off = installLiveFolder();
    let now = 1_000_000;
    const spy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      window.dispatchEvent(new Event('focus'));
      await rescanNow();
      await new Promise(r => setTimeout(r, 0));
      editOutside(root, id, { description: 'agent wrote this' });
      now += 6_000;
      window.dispatchEvent(new Event('focus'));
      await new Promise(r => setTimeout(r, 50));
      await rescanNow(); // join the in-flight pass, if any
      expect(desc(id)).toBe('agent wrote this');
    } finally { spy.mockRestore(); off(); }
  });
});
