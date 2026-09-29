// Promoted from the S364 composition gate probe `b-lifecycle.probe.test.ts` (Forge/Notes/2026-09-29-s364-gate/): it asserts the fixed behaviour.
/**
 * Lens B probes: the live folder's lifecycle across world switches.
 * Real FsFolderStore over the in-memory FS; sync-attach is a stub (as in
 * tests/integration/live-folder.app.test.ts) whose world id the probe moves.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let holdGate: Promise<void> | null = null;
const release = vi.fn();
const engine = {
  hold: vi.fn(async () => { if (holdGate) await holdGate; return release; }),
  pause: vi.fn(),
};
let syncWorld: string | null = 'wA';
vi.mock('../../src/sync/sync-attach', () => ({
  getCurrentSyncEngine: () => (syncWorld ? engine : null),
  getCurrentSyncWorldId: () => syncWorld,
  requestPushIfLinked: () => {},
  refreshMetaCacheNow: async () => {},
}));

import { FakeDirHandle } from '../fixtures/fake-fs';
import { FsFolderStore } from '../../src/store/folder-store-fs';
import { setActiveStore } from '../../src/core/active-store';
import { patchSlice, getState } from '../../src/core/state';
import { onLeaveWorld } from '../../src/core/leave-flush';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import { rescanNow, getDiskNotice, installLiveFolder, BIG_BATCH, __resetLiveFolderForTests } from '../../src/core/live-folder';

const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
let t = 0;
const clock = () => new Date(Date.UTC(2026, 1, 1, 0, 0, t++)).toISOString();
const SYNCED = '2026-03-01T00:00:00.000Z';
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));

type W = { root: FakeDirHandle; store: FsFolderStore; ids: string[]; wid: string };
async function makeWorld(wid: string, n: number): Promise<W> {
  const root = new FakeDirHandle(wid);
  root.put('world.json', j({ id: wid, name: wid }));
  const store = new FsFolderStore({ clock, tabId: 'probe-' + wid, disableHeartbeat: true, forceTakeLock: true });
  await store.open(root as unknown as FileSystemDirectoryHandle);
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const el = await store.createElement('character', { name: `${wid}-C${i}` });
    await store.stampServerUpdatedAt(el.id, 'character', SYNCED);
    ids.push(el.id);
  }
  await store.listElements();
  return { root, store, ids, wid };
}
function registry(...wids: string[]): void {
  const worlds = wids.map(id => ({ id, name: id, state: 'api-linked', folder: { handle_key: id, folder_name: id }, created_at: SYNCED }) as unknown as WorldRegistryEntry);
  patchSlice('registry', { ...defaultRegistry(), worlds });
}
async function activate(w: W): Promise<void> {
  setActiveStore(w.store);
  syncWorld = syncWorld === null ? null : w.wid;
  patchSlice('active', { worldId: w.wid, meta: await w.store.readWorldMeta(), opened: true } as never);
  patchSlice('data', { elements: await w.store.listElements(), loading: false } as never);
}
function editOutside(w: W, id: string, patch: Record<string, unknown>): void {
  const p = w.root.list().find(x => x.startsWith('elements/') && x.includes(id.slice(-8)))!;
  w.root.put(p, j({ ...JSON.parse(w.root.get(p)!), ...patch }));
}
function go(hash: string): void {
  window.location.hash = hash;
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

beforeEach(() => {
  localStorage.clear();
  __resetLiveFolderForTests();
  engine.hold.mockClear(); release.mockClear();
  holdGate = null;
  syncWorld = 'wA';
  window.location.hash = '';
});

describe('lens B lifecycle', () => {
  it('F1: a held batch is forgotten on a world switch; the next engine flush-on-attach set holds all of it', async () => {
    const uninstall = installLiveFolder();
    const A = await makeWorld('wA', BIG_BATCH + 1);
    const B = await makeWorld('wB', 1);
    registry('wA', 'wB');
    await activate(A);
    go('#/w/wA');
    for (const id of A.ids) editOutside(A, id, { description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' });
    await rescanNow({ force: true });
    expect(getDiskNotice()?.held?.count).toBe(BIG_BATCH + 1);
    go('#/w/wB');
    await activate(B);
    go('#/w/wA');
    await activate(A);
    const again = await rescanNow({ force: true });
    const pendingForFlush = await A.store.listLocallyChangedSince(null);
    console.log(`[probe F1] revive changes=${again.changes.length} notice=${JSON.stringify(getDiskNotice())} hold calls=${engine.hold.mock.calls.length} release calls=${release.mock.calls.length} flushPendingOnAttach would push=${pendingForFlush.length}`);
    uninstall();
    expect(getDiskNotice()?.held).toBeTruthy();
  });

  it('F2: a hold that resolves after the world switched leaves a stale held notice and fires events into the new world', async () => {
    const A = await makeWorld('wA', BIG_BATCH + 1);
    const B = await makeWorld('wB', 1);
    registry('wA', 'wB');
    await activate(A);
    for (const id of A.ids) editOutside(A, id, { description: 'agent', local_updated_at: '2026-04-01T00:00:00.000Z' });
    let open!: () => void;
    holdGate = new Promise<void>(r => { open = r; });
    const seen: string[] = [];
    const onEv = () => seen.push(getState().active!.worldId);
    document.addEventListener('atlas:disk-changes', onEv);
    const p = rescanNow({ force: true });
    for (let i = 0; i < 100 && engine.hold.mock.calls.length === 0; i++) await tick();
    expect(engine.hold).toHaveBeenCalled();
    await activate(B);
    open();
    await p;
    console.log(`[probe F2] disk-changes dispatched while active=${JSON.stringify(seen)}`);
    await activate(A);
    console.log(`[probe F2] notice on return to A: held=${JSON.stringify(getDiskNotice()?.held ?? null)} marked=${getDiskNotice()?.marked.size}`);
    document.removeEventListener('atlas:disk-changes', onEv);
    expect(seen).not.toContain('wB');
  });

  it('F3: the revive pass for a parked world is swallowed by a pass still running for the world just left', async () => {
    const A = await makeWorld('wA', 1);
    const B = await makeWorld('wB', 2);
    registry('wA', 'wB');
    syncWorld = null;
    await activate(A);
    let openFlush!: () => void;
    const flushGate = new Promise<void>(r => { openFlush = r; });
    const unFlush = onLeaveWorld(() => flushGate);
    const focusPass = rescanNow();
    await tick(5);
    editOutside(B, B.ids[0], { description: 'written while parked' });
    await activate(B);
    const revive = rescanNow({ force: true });
    openFlush();
    const [a, b] = await Promise.all([focusPass, revive]);
    unFlush();
    const shown = getState().data.elements.find(e => e.id === B.ids[0])?.description;
    console.log(`[probe F3] focus pass=${a.changes.length} revive pass=${b.changes.length} B element shows description=${JSON.stringify(shown)}`);
    expect(shown).toBe('written while parked');
  });

  it('F4: focus + visibilitychange in one tick run two passes (throttle stamp set after an await)', async () => {
    const A = await makeWorld('wA', 3);
    registry('wA');
    syncWorld = null;
    await activate(A);
    const spy = vi.spyOn(A.store, 'rescanDisk');
    const uninstall = installLiveFolder();
    window.dispatchEvent(new Event('focus'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    await tick(50);
    uninstall();
    console.log(`[probe F4] store.rescanDisk calls=${spy.mock.calls.length}`);
    expect(spy.mock.calls.length).toBe(1);
  });

  it('F5: opening a changed scene in the writing room does not clear its mark', async () => {
    const A = await makeWorld('wA', 2);
    registry('wA');
    syncWorld = null;
    await activate(A);
    const uninstall = installLiveFolder();
    editOutside(A, A.ids[0], { description: 'x' });
    await rescanNow({ force: true });
    expect(getDiskNotice()?.marked.has(A.ids[0])).toBe(true);
    go(`#/w/wA/writing/${A.ids[0]}`);
    const writing = getDiskNotice()?.marked.has(A.ids[0]) ?? false;
    go(`#/w/wA/element/${A.ids[0]}`);
    const element = getDiskNotice()?.marked.has(A.ids[0]) ?? false;
    uninstall();
    console.log(`[probe F5] still marked after writing route=${writing}, after element route=${element}`);
    expect(writing).toBe(false);
  });
});
