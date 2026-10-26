/**
 * Two rows for a view-only world (built for 1.18):
 * - opening one never tries to write its prefs file (the store refuses every
 *   write, so the try only logged "[world-prefs] not written" at every open);
 * - the element header offers no Delete (the store refused it after the confirm).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import { loadWorldPrefs, __resetWorldPrefsForTests } from '../../src/core/world-prefs';
import { renderHeader } from '../../src/middle/element-detail-header';

function entry(id: string, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return { id, name: id, state: 'local', folder: { handle_key: id, folder_name: id }, created_at: '2026-01-01T00:00:00Z', ...extra } as WorldRegistryEntry;
}
const linked = (readOnly: boolean): Partial<WorldRegistryEntry> => ({
  state: 'api-linked',
  api: { world_id: 'srv-1', api_key: '0000000001', ...(readOnly ? { read_only: true } : {}) },
} as Partial<WorldRegistryEntry>);

beforeEach(() => {
  localStorage.clear();
  __resetWorldPrefsForTests();
  patchSlice('active', null);
  document.body.innerHTML = '';
});
afterEach(() => { vi.restoreAllMocks(); });

describe('a view-only world', () => {
  it.each([[true, 0], [false, 1]])('read_only=%s: opening it writes its prefs file %i time(s)', async (readOnly, writes) => {
    const s = new MockFolderStore();
    await s.open(null as never);
    const write = vi.spyOn(s, 'writeWorldPrefs');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('w1', { notes: 'kept on the entry', ...linked(readOnly) })] });
    await loadWorldPrefs(s, 'w1');
    expect(write).toHaveBeenCalledTimes(writes);
    expect(warn.mock.calls.filter(c => String(c[0]).includes('[world-prefs]'))).toEqual([]);
    expect(getState().registry.worlds[0].notes).toBe('kept on the entry');
  });

  it.each([[true, 0], [false, 1]])('read_only=%s: the element header offers %i Delete', (readOnly, deletes) => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [entry('w1', linked(readOnly))] });
    patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true });
    const el = { id: 'e1', name: 'Ada', type: 'character' } as Element;
    const header = renderHeader(el);
    expect(header.querySelectorAll('[data-action="delete-element"]').length).toBe(deletes);
  });
});
