// Promoted from the S364 composition gate probe `b-world-prefs.probe.test.ts` (Forge/Notes/2026-09-29-s364-gate/): it asserts the fixed behaviour.
/**
 * Lens B probes: world-prefs three-way edges.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import { loadWorldPrefs, installWorldPrefsSync, __resetWorldPrefsForTests } from '../../src/core/world-prefs';

function entry(id: string, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return { id, name: id, state: 'local', folder: { handle_key: id, folder_name: id }, created_at: '2026-01-01T00:00:00Z', ...extra } as WorldRegistryEntry;
}
const find = (id: string) => getState().registry.worlds.find(w => w.id === id)!;

beforeEach(() => {
  localStorage.clear();
  __resetWorldPrefsForTests();
  patchSlice('active', null);
});

describe('world-prefs edges', () => {
  it('W1: first sync in a second browser/machine (no base) with its OWN notes: the local notes are dropped', async () => {
    // Machine A upgraded first and seeded the file; machine B has its own notes for the same folder.
    const s = new MockFolderStore();
    await s.open(null as never);
    s.worldPrefs = { format: 'atlas-world-prefs', version: 1, notes: 'notes typed on machine A' };
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wB', { notes: 'notes typed on machine B', active_calendar_id: 'cal-B' })] });
    await loadWorldPrefs(s, 'wB');
    console.log(`[probe W1] registry after open: notes=${JSON.stringify(find('wB').notes)} calendar=${JSON.stringify(find('wB').active_calendar_id)}; saved registry has B notes anywhere=${(localStorage.getItem('atlas_worlds_registry') ?? '').includes('machine B')}`);
    expect(JSON.stringify(getState().registry)).toContain('notes typed on machine B');
  });

  it('W2: a prefs change inside the debounce, then a world switch: the write is dropped until that world is opened again', async () => {
    vi.useFakeTimers();
    const a = new MockFolderStore(); await a.open(null as never);
    const b = new MockFolderStore(); await b.open(null as never);
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wA', { notes: 'v1' }), entry('wB')] });
    setActiveStore(a as unknown as FsFolderStore);
    await loadWorldPrefs(a, 'wA');
    const un = installWorldPrefsSync();
    patchSlice('active', { worldId: 'wA', meta: { id: 'a', name: 'A' }, opened: true });
    patchSlice('registry', { ...getState().registry, worlds: [{ ...find('wA'), notes: 'v2 typed then switched' }, find('wB')] });
    await vi.advanceTimersByTimeAsync(100);
    setActiveStore(b as unknown as FsFolderStore);
    patchSlice('active', { worldId: 'wB', meta: { id: 'b', name: 'B' }, opened: true });
    await vi.advanceTimersByTimeAsync(1000);
    console.log(`[probe W2] world A file notes after switch=${JSON.stringify(a.worldPrefs?.notes)}`);
    un();
    vi.useRealTimers();
    expect(a.worldPrefs?.notes).toBe('v2 typed then switched');
  });

  it('U1 (upheld): a cast remap made after the open-time load but before the world is active reaches the file', async () => {
    vi.useFakeTimers();
    const s = new MockFolderStore(); await s.open(null as never);
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wR', { favorites: { protagonist_id: 'old-1' } as never })] });
    const un = installWorldPrefsSync();
    setActiveStore(s as unknown as FsFolderStore);
    await loadWorldPrefs(s, 'wR'); // activateWorld: before re-key recovery
    // Recovery remaps the registry's cast (active is still the previous world / null).
    patchSlice('registry', { ...getState().registry, worlds: [{ ...find('wR'), favorites: { protagonist_id: 'new-1' } as never }] });
    patchSlice('active', { worldId: 'wR', meta: { id: 'r', name: 'R' }, opened: true });
    await vi.advanceTimersByTimeAsync(400);
    console.log(`[probe U1] file favorites=${JSON.stringify(s.worldPrefs?.favorites)}`);
    un();
    vi.useRealTimers();
    expect((s.worldPrefs?.favorites as { protagonist_id: string }).protagonist_id).toBe('new-1');
  });

  it('U2 (upheld): Forget world + re-add (a new registry id) gets the notes back from the file', async () => {
    const s = new MockFolderStore(); await s.open(null as never);
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wOld', { notes: 'keep me' })] });
    await loadWorldPrefs(s, 'wOld');
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('wNew')] });
    await loadWorldPrefs(s, 'wNew');
    console.log(`[probe U2] re-added notes=${JSON.stringify(find('wNew').notes)}`);
    expect(find('wNew').notes).toBe('keep me');
  });

  afterEach(() => { vi.useRealTimers(); });
});
