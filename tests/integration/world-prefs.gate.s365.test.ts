/**
 * World prefs while open: the overlay, a failing write, two tabs.
 * Each asserts the fixed behaviour; red on the code before the fixes.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { setActiveStore } from '../../src/core/active-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { WorldRegistryEntry, WorldsRegistry } from '../../src/core/types';
import type { FsFolderStore } from '../../src/store/folder-store-fs';
import { saveRegistry, setActiveWorld, __setRegistryTabBaseForTests } from '../../src/registry/registry';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { loadWorldPrefs, installWorldPrefsSync, __resetWorldPrefsForTests } from '../../src/core/world-prefs';
import { openNotesOverlay } from '../../src/ui/notes-overlay';

const WID = 'w-prefs';
function entry(extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return { id: WID, name: 'P', state: 'local', folder: { handle_key: 'k', folder_name: 'p' }, created_at: '2026-01-01T00:00:00Z', ...extra } as WorldRegistryEntry;
}
const cur = () => getState().registry.worlds.find(w => w.id === WID)!;
async function store(): Promise<MockFolderStore> { const s = new MockFolderStore(); await s.open(null as never); return s; }
const stored = (): WorldsRegistry => JSON.parse(localStorage.getItem(REGISTRY_STORAGE_KEY)!) as WorldsRegistry;

let uninstall: (() => void) | null = null;
beforeEach(() => { localStorage.clear(); __resetWorldPrefsForTests(); __setRegistryTabBaseForTests(null); patchSlice('active', null); vi.useFakeTimers(); });
afterEach(() => { uninstall?.(); uninstall = null; document.body.innerHTML = ''; vi.useRealTimers(); });

async function openWorld(s: MockFolderStore, e: WorldRegistryEntry): Promise<void> {
  setActiveStore(s as unknown as FsFolderStore);
  patchSlice('registry', { ...defaultRegistry(), worlds: [e] });
  await loadWorldPrefs(s, WID);
  uninstall = installWorldPrefsSync();
  patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true } as never);
  await vi.advanceTimersByTimeAsync(10);
}

describe('B1: the notes overlay is open when the write-time merge lands', () => {
  it('the other machine\'s notes survive the user\'s next keystroke in the overlay', async () => {
    const s = await store();
    await openWorld(s, entry({ notes: 'base' }));
    openNotesOverlay();
    const ta = document.querySelector<HTMLTextAreaElement>('[data-modal="notes-overlay"] textarea')!;
    expect(ta.value).toBe('base');
    // Machine B's edit arrives through Dropbox while the overlay is open.
    s.worldPrefs = { ...s.worldPrefs!, notes: 'base\nfrom machine B' };
    // The user types; the overlay saves (600 ms), the prefs write runs (250 ms) and merges.
    ta.value = 'base\nmine'; ta.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.worldPrefs?.notes).toContain('from machine B'); // the merge worked...
    // ...and the user keeps typing in the same overlay.
    ta.value = 'base\nmine, more'; ta.dispatchEvent(new Event('input'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.worldPrefs?.notes).toContain('from machine B');
    expect(cur().notes).toContain('from machine B');
  });
});

describe('the overlay merge keeps typed text verbatim', () => {
  it("notes holding $' or $& survive a merge with notes that moved underneath", async () => {
    const s = await store();
    await openWorld(s, entry({ notes: 'base' }));
    openNotesOverlay();
    const ta = document.querySelector<HTMLTextAreaElement>('[data-modal="notes-overlay"] textarea')!;
    // The user types text that a replacement STRING would expand ($' = the part after the match)...
    ta.value = "base: cloth costs $' a bolt, $& a reel"; ta.dispatchEvent(new Event('input'));
    // ...and another tab changes the notes before the overlay's save lands.
    patchSlice('registry', { ...getState().registry, worlds: [{ ...cur(), notes: 'base\nfrom B' }] });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cur().notes).toBe("base: cloth costs $' a bolt, $& a reel\nfrom B");
  });
});

describe('B2: a write-time merge whose write fails', () => {
  it('notes do not grow with every later pref change while the write keeps failing', async () => {
    const s = await store();
    await openWorld(s, entry({ notes: 'base' }));
    // The file moves (another machine) and then writes start failing (permission dropped, view-only, locked).
    s.worldPrefs = { ...s.worldPrefs!, notes: 'theirs' };
    s.setViewOnly(true);
    patchSlice('registry', { ...getState().registry, worlds: [{ ...cur(), notes: 'mine' }] });
    await vi.advanceTimersByTimeAsync(300);
    const once = cur().notes;
    // Unrelated pref changes follow (pin a protagonist, switch calendar).
    patchSlice('registry', { ...getState().registry, worlds: [{ ...cur(), favorites: { protagonist_id: 'p-1', nexus_id: null } }] });
    await vi.advanceTimersByTimeAsync(300);
    patchSlice('registry', { ...getState().registry, worlds: [{ ...cur(), active_calendar_id: 'cal-2' }] });
    await vi.advanceTimersByTimeAsync(300);
    expect(cur().notes).toBe(once);
  });
});

describe('A2: two tabs on one browser, tab B opens the world tab A is writing notes in', () => {
  it('tab A\'s notes survive in the registry OR the file after tab B opens W', async () => {
    const s = await store();
    const W = entry({ notes: 'old' });
    const V = { ...entry(), id: 'w-other', name: 'V' } as WorldRegistryEntry;
    const reg0 = { ...defaultRegistry(), worlds: [W, V] };
    saveRegistry(reg0);
    const tabB = structuredClone(reg0);
    // Tab A: open W, type notes (overlay saves the registry; prefs write to the file).
    __setRegistryTabBaseForTests(reg0);
    setActiveStore(s as unknown as FsFolderStore);
    patchSlice('registry', reg0);
    await loadWorldPrefs(s, WID);
    uninstall = installWorldPrefsSync();
    patchSlice('active', { worldId: WID, meta: { id: 'w', name: 'P' }, opened: true } as never);
    await vi.advanceTimersByTimeAsync(10);
    const regA = { ...getState().registry, worlds: getState().registry.worlds.map(w => w.id === WID ? { ...w, notes: 'typed in tab A' } : w) };
    saveRegistry(regA);
    patchSlice('registry', regA);
    await vi.advanceTimersByTimeAsync(300);
    expect(s.worldPrefs?.notes).toBe('typed in tab A');
    uninstall(); uninstall = null;

    // Tab B (booted with reg0, own module state) clicks W: activateWorld saves the stamp, then loadWorldPrefs.
    __resetWorldPrefsForTests();
    __setRegistryTabBaseForTests(tabB);
    const activated = setActiveWorld(tabB, WID);
    saveRegistry(activated);
    patchSlice('registry', activated);
    await loadWorldPrefs(s, WID);

    const regNotes = stored().worlds.find(w => w.id === WID)?.notes;
    const fileNotes = s.worldPrefs?.notes;
    expect({ regNotes, fileNotes }).toSatisfy(
      (x: { regNotes?: string; fileNotes?: unknown }) => x.regNotes === 'typed in tab A' || x.fileNotes === 'typed in tab A',
    );
  });
});
