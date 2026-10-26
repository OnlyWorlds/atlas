/**
 * Pull-time conflict handling under both policies (Phase 3.5+).
 *
 * Pull conflict = server moved AND local moved since baseline.
 * - `local-wins`: skip applying server (local stays), DON'T persist conflict
 *   to sync-state. Toast count surfaced via `onSyncResult` callback.
 * - `pause-and-review`: skip applying server, persist conflict to sync-state.
 *   Badge fires; modal handles resolution.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { SyncResult } from '../../src/core/types';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

async function seedDualEdit(elementId: string): Promise<void> {
  // Pull baseline once so both sides agree on initial state.
  const baselineEngine = new SyncEngine({ folder, client });
  await client.createElement('character', { id: elementId, name: 'Alice', description: 'orig', type: 'character' });
  await baselineEngine.syncNow();
  // Both sides diverge AFTER baseline.
  await folder.updateElement(elementId, { description: 'local-edit' });
  await client.updateElement('character', elementId, { description: 'server-edit', name: 'Alice', type: 'character' });
}

describe('pull-time conflict — local-wins policy', () => {
  it('skips applying server, does NOT persist conflict to sync-state, fires onSyncResult', async () => {
    await seedDualEdit('c1');

    const seenResults: Array<{ phase: string; conflicts: number }> = [];
    const engine = new SyncEngine({
      folder,
      client,
      policy: 'local-wins',
      onSyncResult: (phase, r) => seenResults.push({ phase, conflicts: r.conflicts.length }),
    });
    const result = await engine.pullNow();

    // Conflict detected and surfaced in result.
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].element_id).toBe('c1');
    // BUT not persisted to sync-state under local-wins.
    const syncState = await folder.readSyncState();
    expect(syncState.conflicts).toEqual([]);
    // Local content preserved (NOT overwritten by server).
    const local = await folder.getElement('c1');
    expect(local!.description).toBe('local-edit');
    // onSyncResult fired with the pull phase and conflict count.
    expect(seenResults).toEqual([{ phase: 'pull', conflicts: 1 }]);
  });

  it('legacy `drain-blind` policy maps to local-wins behavior', async () => {
    await seedDualEdit('c1');
    const engine = new SyncEngine({ folder, client, policy: 'drain-blind' });
    await engine.pullNow();
    const syncState = await folder.readSyncState();
    expect(syncState.conflicts).toEqual([]);
  });
});

describe('pull-time conflict — pause-and-review policy', () => {
  it('skips applying server AND persists conflict to sync-state', async () => {
    await seedDualEdit('c1');
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    const result = await engine.pullNow();

    expect(result.conflicts.length).toBe(1);
    // Persisted — badge will fire downstream.
    const syncState = await folder.readSyncState();
    expect(syncState.conflicts).toHaveLength(1);
    expect(syncState.conflicts[0].element_id).toBe('c1');
    // Local content preserved (not overwritten).
    const local = await folder.getElement('c1');
    expect(local!.description).toBe('local-edit');
  });

  it('repeated pull does NOT duplicate the same conflict in sync-state (full-list re-detect)', async () => {
    // The dedupe guards a pull that re-detects the same conflict: the full
    // list does, the /changes cursor moves past it, so this case runs on the
    // full-list path on purpose.
    client.__enable_changes(false);
    // Regression for the bug Titus caught: refreshing 3 times showed 3 of
    // the same conflict. persistConflicts deduped on push-phase but pullPhase
    // wrote `[...currentState.conflicts, ...conflicts]` without dedup.
    await seedDualEdit('c1');
    const engine = new SyncEngine({ folder, client, policy: 'pause-and-review' });
    await engine.pullNow();
    await engine.pullNow();
    await engine.pullNow();
    const syncState = await folder.readSyncState();
    expect(syncState.conflicts).toHaveLength(1);
  });

  it('legacy `pause-on-conflict` and `ask` map to pause-and-review behavior', async () => {
    // pause-on-conflict
    await seedDualEdit('c1');
    let engine = new SyncEngine({ folder, client, policy: 'pause-on-conflict' });
    await engine.pullNow();
    let syncState = await folder.readSyncState();
    expect(syncState.conflicts).toHaveLength(1);

    // ask — reset folder, reseed, run with 'ask'
    folder = new MockFolderStore();
    folder.setClock(clock.next);
    await folder.open(null);
    client = new FakeOwApiClient();
    client.setClock(clock.next);
    await seedDualEdit('c2');
    engine = new SyncEngine({ folder, client, policy: 'ask' });
    await engine.pullNow();
    syncState = await folder.readSyncState();
    expect(syncState.conflicts).toHaveLength(1);
  });
});

describe('push-time conflict — local-wins policy persistence', () => {
  it('does NOT persist push conflicts to sync-state under local-wins', async () => {
    await seedDualEdit('c1');
    const engine = new SyncEngine({ folder, client, policy: 'local-wins' });
    const result: SyncResult = await engine.syncNow();
    // Server overwritten under local-wins → push ran.
    expect(result.pushed.updates).toBeGreaterThan(0);
    // Conflicts surfaced in result but NOT persisted.
    const syncState = await folder.readSyncState();
    expect(syncState.conflicts).toEqual([]);
  });
});
