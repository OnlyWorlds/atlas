/**
 * THE WHOLE WORLD IN THE FOLDER (S364): a world's notes, cast, calendar lens
 * and writing labels are written to `.atlas/world-prefs.json`, and read back
 * at open with a three-way against `prefs_synced` (core/world-prefs.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import { loadWorldPrefs, installWorldPrefsSync, prefsKey, prefsSyncedFor, __resetWorldPrefsForTests } from '../../src/core/world-prefs';

const WID = 'w-prefs';
const CAST = { protagonist_id: 'p-1', nexus_id: 'n-1' };
const LABELS = { l1: 'Saga', l2: 'Part', l3: 'Scene', l4: 'Beat' };

function entry(extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z', ...extra } as WorldRegistryEntry;
}
function setEntry(e: WorldRegistryEntry): void {
  patchSlice('registry', { ...defaultRegistry(), worlds: [e] });
}
const cur = () => getState().registry.worlds[0];

async function store(): Promise<MockFolderStore> {
  const s = new MockFolderStore();
  await s.open(null as never);
  return s;
}

beforeEach(() => {
  localStorage.clear();
  __resetWorldPrefsForTests();
  patchSlice('active', null);
});

describe('loadWorldPrefs (at open)', () => {
  it('no file yet: seeds it from this browser\'s registry (the migration), and remembers what it wrote', async () => {
    const s = await store();
    setEntry(entry({ notes: 'the moon is wrong', favorites: CAST, active_calendar_id: 'cal-1', writing_labels: LABELS, writing_initialized: true }));
    await loadWorldPrefs(s, WID);
    expect(s.worldPrefs).toMatchObject({ format: 'atlas-world-prefs', version: 1, notes: 'the moon is wrong', favorites: CAST, active_calendar_id: 'cal-1', writing_labels: LABELS, writing_initialized: true });
    expect(prefsSyncedFor(WID)).toBe(prefsKey(s.worldPrefs!));
    // The base lives in its own key: seeding the file never re-saves the registry.
    expect(JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? 'null')).toBeNull();
    // Read-both-write-new: the registry keeps its copy.
    expect(cur().notes).toBe('the moon is wrong');
  });

  it('the file is what this browser last wrote: the registry wins (a change that never reached the file)', async () => {
    const s = await store();
    setEntry(entry({ notes: 'v1' }));
    await loadWorldPrefs(s, WID);
    // The notes changed and the tab closed inside the write debounce.
    setEntry({ ...cur(), notes: 'v2' });
    await loadWorldPrefs(s, WID);
    expect(s.worldPrefs?.notes).toBe('v2');
    expect(cur().notes).toBe('v2');
  });

  it('the file changed elsewhere (a copied folder, another machine): the file wins, keys it lacks are cleared', async () => {
    const s = await store();
    s.worldPrefs = { format: 'atlas-world-prefs', version: 1, notes: 'from the other machine', favorites: CAST };
    localStorage.setItem('atlas_world_prefs_synced', JSON.stringify({ [WID]: 'something older' }));
    setEntry(entry({ notes: 'stale here', active_calendar_id: 'cal-old' }));
    await loadWorldPrefs(s, WID);
    expect(cur().notes).toBe('from the other machine');
    expect(cur().favorites).toEqual(CAST);
    expect(cur().active_calendar_id).toBeUndefined();
    expect(prefsSyncedFor(WID)).toBe(prefsKey(s.worldPrefs!));
  });

  it('a file that will not parse is left alone and the registry keeps serving', async () => {
    const s = await store();
    s.worldPrefsCorrupt = true;
    setEntry(entry({ notes: 'kept' }));
    await expect(loadWorldPrefs(s, WID)).resolves.toBeUndefined();
    expect(cur().notes).toBe('kept');
    expect(prefsSyncedFor(WID)).toBeUndefined();
  });

  it('a view-only world reads the file but never writes it', async () => {
    const s = await store();
    s.setViewOnly(true);
    setEntry(entry({ notes: 'mine' }));
    await expect(loadWorldPrefs(s, WID)).resolves.toBeUndefined();
    expect(s.worldPrefs).toBeNull();
  });

  it('the tour\'s demo world is skipped', async () => {
    const s = await store();
    setEntry(entry({ demo: true, notes: 'x' }));
    await loadWorldPrefs(s, WID);
    expect(s.worldPrefs).toBeNull();
  });
});

describe('installWorldPrefsSync (on change)', () => {
  let uninstall: (() => void) | null = null;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { uninstall?.(); uninstall = null; vi.useRealTimers(); });

  it('a change to the active world\'s notes or cast reaches the file after the debounce', async () => {
    const s = await store();
    setActiveStore(s as unknown as FsFolderStore);
    setEntry(entry({ notes: 'first' }));
    await loadWorldPrefs(s, WID);
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    setEntry({ ...cur(), notes: 'second', favorites: CAST });
    expect(s.worldPrefs?.notes).toBe('first');
    await vi.advanceTimersByTimeAsync(300);
    expect(s.worldPrefs?.notes).toBe('second');
    expect(s.worldPrefs?.favorites).toEqual(CAST);
  });

  it('a world made active without an open (create, link) is reconciled once, then kept in sync', async () => {
    const s = await store();
    setActiveStore(s as unknown as FsFolderStore);
    setEntry(entry({ notes: 'typed on day one' }));
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    await vi.advanceTimersByTimeAsync(10);
    expect(s.worldPrefs?.notes).toBe('typed on day one');
    setEntry({ ...cur(), writing_labels: LABELS });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.worldPrefs?.writing_labels).toEqual(LABELS);
  });

  it('a world whose file cannot be written (view-only) tries once per change, not once per tick', async () => {
    const s = await store();
    s.setViewOnly(true);
    setActiveStore(s as unknown as FsFolderStore);
    setEntry(entry({ notes: 'read-only here' }));
    const spy = vi.spyOn(s, 'writeWorldPrefs');
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    await vi.advanceTimersByTimeAsync(10);
    for (let i = 0; i < 20; i++) { patchSlice('ui', { ...getState().ui, search: `q${i}` }); await vi.advanceTimersByTimeAsync(300); }
    expect(spy).toHaveBeenCalledTimes(1); // the open's seed attempt
    setEntry({ ...cur(), notes: 'changed' });
    await vi.advanceTimersByTimeAsync(300);
    for (let i = 0; i < 5; i++) { patchSlice('ui', { ...getState().ui, search: `r${i}` }); await vi.advanceTimersByTimeAsync(300); }
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a registry change that does not touch the prefs writes nothing', async () => {
    const s = await store();
    setActiveStore(s as unknown as FsFolderStore);
    setEntry(entry({ notes: 'same' }));
    await loadWorldPrefs(s, WID);
    const spy = vi.spyOn(s, 'writeWorldPrefs');
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    setEntry({ ...cur(), last_opened_at: '2026-09-29T00:00:00Z', sync_paused: true });
    await vi.advanceTimersByTimeAsync(300);
    expect(spy).not.toHaveBeenCalled();
  });
});
