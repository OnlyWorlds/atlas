/**
 * SyncEngine.resolveConflict — per-row resolution actions for the conflict
 * review modal (Phase 3.5+).
 *
 * Three actions: skip / overwrite-mine / pull-theirs.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { Conflict } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let clock: MonotonicClock;

async function seedConflict(elementId: string, localName: string, serverName: string): Promise<Conflict> {
  // Pre-arrange: server has an element with a baseline; local has the same id
  // with a divergent name AND a stale server_updated_at (forcing a conflict).
  await client.createElement('character', { id: elementId, name: serverName, type: 'character' });
  // Sync once so local has a baseline.
  await engine.syncNow();
  // Now mutate both sides.
  await folder.updateElement(elementId, { name: localName });
  await client.updateElement('character', elementId, { name: serverName + ' (server-edit)', type: 'character' });
  // Trigger a pause-on-conflict push so a conflict is recorded.
  engine = new SyncEngine({ folder, client, policy: 'pause-on-conflict' });
  await engine.syncNow();
  const state = await folder.readSyncState();
  const c = state.conflicts.find(c => c.element_id === elementId);
  if (!c) throw new Error('test setup failed: no conflict recorded');
  return c;
}

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client });
});

describe('SyncEngine.resolveConflict', () => {
  // 'skip' was removed in 3.5 — closing the modal without picking is the
  // "decide later" path now. Badge stays as a reminder.

  it('overwrite-mine re-pushes local content to server and clears conflict', async () => {
    await seedConflict('c1', 'LocalWins', 'ServerWasHere');
    const callsBefore = client.calls.length;
    await engine.resolveConflict('c1', 'overwrite-mine');

    // Server now has local's content.
    const remote = await client.getElement('character', 'c1');
    expect(remote!.name).toBe('LocalWins');
    // Conflict cleared.
    const state = await folder.readSyncState();
    expect(state.conflicts).toEqual([]);
    // A new update call was made.
    const newCalls = client.calls.slice(callsBefore);
    expect(newCalls.some(c => c.method === 'update' && c.id === 'c1')).toBe(true);
  });

  it('pull-theirs overwrites local with server content and clears conflict', async () => {
    await seedConflict('c1', 'LocalLoses', 'ServerWins');
    await engine.resolveConflict('c1', 'pull-theirs');

    const local = await folder.getElement('c1');
    expect(local!.name).toBe('ServerWins (server-edit)');
    const state = await folder.readSyncState();
    expect(state.conflicts).toEqual([]);
  });

  it('no-op when conflict id does not exist', async () => {
    await seedConflict('c1', 'L', 'S');
    // Resolving an unknown id is a no-op (doesn't throw).
    await engine.resolveConflict('does-not-exist', 'overwrite-mine');
    // Original conflict still present.
    const state = await folder.readSyncState();
    expect(state.conflicts.find(c => c.element_id === 'c1')).toBeDefined();
  });

  it('listConflicts returns the recorded conflicts', async () => {
    await seedConflict('c1', 'L', 'S');
    const list = await engine.listConflicts();
    expect(list).toHaveLength(1);
    expect(list[0].element_id).toBe('c1');
  });
});
