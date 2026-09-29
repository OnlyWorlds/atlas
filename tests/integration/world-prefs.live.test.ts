/**
 * world-prefs.json while a world stays OPEN, and the registry across tabs
 * (S365, promoted from the orient lane B probes P1-P3):
 * - a pref change here must not overwrite what another machine synced into
 *   the file meanwhile (write-time three-way);
 * - a first-sync merge whose write-out fails must not grow the notes on every
 *   open (the merge is idempotent);
 * - a second tab saving its older registry copy must not erase notes typed
 *   in this tab (the per-entry registry merge), nor carry that loss into the
 *   file on reload.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import { loadRegistry, saveRegistry, __setRegistryTabBaseForTests } from '../../src/registry/registry';
import { loadWorldPrefs, installWorldPrefsSync, __resetWorldPrefsForTests } from '../../src/core/world-prefs';

const WID = 'w-prefs';
function entry(extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z', ...extra } as WorldRegistryEntry;
}
function setEntry(e: WorldRegistryEntry): void { patchSlice('registry', { ...defaultRegistry(), worlds: [e] }); }
const cur = () => getState().registry.worlds[0];
async function store(): Promise<MockFolderStore> { const s = new MockFolderStore(); await s.open(null as never); return s; }

beforeEach(() => { localStorage.clear(); __resetWorldPrefsForTests(); patchSlice('active', null); });

describe('world-prefs.json changed on disk while the world is open', () => {
  let uninstall: (() => void) | null = null;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { uninstall?.(); uninstall = null; vi.useRealTimers(); });

  it('a pref change in Atlas must not silently overwrite notes another machine synced into the file meanwhile', async () => {
    const s = await store();
    setActiveStore(s as unknown as FsFolderStore);
    setEntry(entry({ notes: 'machine A notes' }));
    await loadWorldPrefs(s, WID);           // base = A's prefs, file = A's prefs
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    await vi.advanceTimersByTimeAsync(10);

    // Dropbox / OneDrive / git pull lands machine B's edit while Atlas is open.
    s.worldPrefs = { ...s.worldPrefs!, notes: 'machine B rewrote the notes' };

    // The user pins a protagonist here (any pref change triggers the write).
    setEntry({ ...cur(), favorites: { protagonist_id: 'p-1', nexus_id: null } });
    await vi.advanceTimersByTimeAsync(300);

    // Correct: B's notes survive (the file changed since base; file wins or merge).
    expect(s.worldPrefs?.notes).toBe('machine B rewrote the notes');
    expect(s.worldPrefs?.favorites).toEqual({ protagonist_id: 'p-1', nexus_id: null });
    expect(cur().notes).toBe('machine B rewrote the notes');
  });
});

describe('a first-sync merge whose write fails', () => {
  it('notes do not grow on repeated opens when the write-out fails (view-only)', async () => {
    const s = await store();
    s.worldPrefs = { format: 'atlas-world-prefs', version: 1, notes: 'owner notes' };
    s.setViewOnly(true);
    setEntry(entry({ notes: 'my notes' }));
    await loadWorldPrefs(s, WID);
    const once = cur().notes;
    __resetWorldPrefsForTests();
    await loadWorldPrefs(s, WID);
    __resetWorldPrefsForTests();
    await loadWorldPrefs(s, WID);
    expect(cur().notes).toBe(once);
  });
});


describe('two tabs, two different worlds: notes typed in one survive the other\'s older save', () => {
  let uninstall: (() => void) | null = null;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { uninstall?.(); uninstall = null; vi.useRealTimers(); });

  it('notes typed in tab A survive tab B saving its (older) copy of the registry', async () => {
    const s = await store();
    setActiveStore(s as unknown as FsFolderStore);
    const W = entry({ notes: 'old' });
    const V = { ...entry(), id: 'w-other', name: 'V' } as WorldRegistryEntry;
    const reg0 = { ...defaultRegistry(), worlds: [W, V] };
    saveRegistry(reg0);
    patchSlice('registry', reg0);
    // Tab B booted now and holds reg0 in memory (its own state).
    const tabBMemory = structuredClone(reg0);

    await loadWorldPrefs(s, WID);
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    await vi.advanceTimersByTimeAsync(10);
    // Tab A: the user writes notes (the notes overlay saves the registry).
    const regA = { ...getState().registry, worlds: getState().registry.worlds.map(w => w.id === WID ? { ...w, notes: 'typed in tab A' } : w) };
    saveRegistry(regA);
    patchSlice('registry', regA);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.worldPrefs?.notes).toBe('typed in tab A');

    // Tab B does anything that saves the registry (switching worlds stamps last_opened_at).
    // (One JS realm here: give the save tab B's view, as tab B's module would hold.)
    __setRegistryTabBaseForTests(tabBMemory);
    saveRegistry({ ...tabBMemory, worlds: tabBMemory.worlds.map(w => w.id === 'w-other' ? { ...w, last_opened_at: 'now' } : w) });

    // Tab A reloads.
    uninstall(); uninstall = null;
    __resetWorldPrefsForTests();
    patchSlice('registry', loadRegistry());
    await loadWorldPrefs(s, WID);
    // Correct: the notes the user typed survive somewhere.
    const survived = cur().notes === 'typed in tab A' || s.worldPrefs?.notes === 'typed in tab A';
    expect({ registryNotes: getState().registry.worlds.find(w => w.id === WID)?.notes, fileNotes: s.worldPrefs?.notes, survived })
      .toMatchObject({ survived: true });
  });
});

describe('the write-time three-way, branch by branch', () => {
  let uninstall: (() => void) | null = null;
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { uninstall?.(); uninstall = null; vi.useRealTimers(); });

  async function openWith(s: MockFolderStore, e: WorldRegistryEntry): Promise<void> {
    setActiveStore(s as unknown as FsFolderStore);
    setEntry(e);
    await loadWorldPrefs(s, WID);
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true });
    await vi.advanceTimersByTimeAsync(10);
  }

  it('both sides changed the notes: both kept, the file\'s first', async () => {
    const s = await store();
    await openWith(s, entry({ notes: 'base' }));
    s.worldPrefs = { ...s.worldPrefs!, notes: 'theirs' };
    setEntry({ ...cur(), notes: 'mine' });
    await vi.advanceTimersByTimeAsync(300);
    expect(s.worldPrefs?.notes).toBe('theirs\n\nNotes from this browser:\nmine');
    expect(cur().notes).toBe('theirs\n\nNotes from this browser:\nmine');
  });

  it('this side removed a pref the other side left alone: it stays removed', async () => {
    const s = await store();
    await openWith(s, entry({ notes: 'n', active_calendar_id: 'cal-1' } as Partial<WorldRegistryEntry>));
    s.worldPrefs = { ...s.worldPrefs!, notes: 'n, edited elsewhere' };
    const { active_calendar_id: _drop, ...rest } = cur() as unknown as Record<string, unknown>;
    setEntry(rest as unknown as WorldRegistryEntry);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.worldPrefs && 'active_calendar_id' in s.worldPrefs).toBe(false);
    expect(s.worldPrefs?.notes).toBe('n, edited elsewhere');
  });
});
