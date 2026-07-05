/**
 * sync-state serialized read-modify-write — lost-update regression.
 *
 * Audit 2026-06-19 (sync-engine findings): resolveConflict / pushPhase /
 * pullPhase computed sync-state patches from snapshots taken BEFORE network
 * I/O, then wrote whole arrays — a concurrent round's conflicts or
 * server-deletes landing in between got clobbered.
 *
 * The boundary fix: `FolderStore.updateSyncState(mutate)` — the mutator
 * receives the CURRENT state inside the store's sync-state chain and returns
 * a partial patch. Every read-modify-write in the engine now goes through it.
 * (FsFolderStore serializes via a store-global promise chain, same pattern as
 * its tombstone chain; the mock is atomic per turn but honors identical
 * mutator semantics, so these tests lock the CONTRACT both impls share.)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { Conflict, ServerDeleteRecord } from '../../src/core/types';

function conflict(id: string): Conflict {
  return {
    element_id: id,
    type: 'character',
    detected_at: '2026-07-03T10:00:00.000Z',
    local_updated_at: '2026-07-03T09:59:00.000Z',
    server_updated_at: '2026-07-03T09:58:00.000Z',
    fields: ['description'],
  };
}

function serverDelete(id: string): ServerDeleteRecord {
  return { id, type: 'location', detected_at: '2026-07-03T10:00:00.000Z', name: `elem ${id}` };
}

describe('updateSyncState (serialized read-modify-write contract)', () => {
  let store: MockFolderStore;

  beforeEach(async () => {
    store = new MockFolderStore();
    await store.open(null);
  });

  it('concurrent mutators both land — no lost update', async () => {
    await Promise.all([
      store.updateSyncState(s => ({ conflicts: [...s.conflicts, conflict('a')] })),
      store.updateSyncState(s => ({
        server_deletes: [...(s.server_deletes ?? []), serverDelete('b')],
      })),
    ]);
    const state = await store.readSyncState();
    expect(state.conflicts.map(c => c.element_id)).toEqual(['a']);
    expect((state.server_deletes ?? []).map(d => d.id)).toEqual(['b']);
  });

  it('each mutator sees the previous mutation (accumulation, not snapshot)', async () => {
    await store.updateSyncState(s => ({ conflicts: [...s.conflicts, conflict('a')] }));
    await store.updateSyncState(s => ({ conflicts: [...s.conflicts, conflict('b')] }));
    await store.updateSyncState(s => ({
      // A filter computed from the current state must see BOTH prior appends.
      conflicts: s.conflicts.filter(c => c.element_id !== 'a'),
    }));
    const state = await store.readSyncState();
    expect(state.conflicts.map(c => c.element_id)).toEqual(['b']);
  });

  it('an empty patch leaves the state untouched', async () => {
    await store.updateSyncState(s => ({ conflicts: [...s.conflicts, conflict('a')] }));
    await store.updateSyncState(() => ({}));
    const state = await store.readSyncState();
    expect(state.conflicts).toHaveLength(1);
  });

  it('writeSyncState (whole-field patch) still merges over current state', async () => {
    await store.updateSyncState(s => ({
      server_deletes: [...(s.server_deletes ?? []), serverDelete('keep-me')],
    }));
    await store.writeSyncState({ conflicts: [] });
    const state = await store.readSyncState();
    expect(state.conflicts).toEqual([]);
    expect((state.server_deletes ?? []).map(d => d.id)).toEqual(['keep-me']);
  });
});
