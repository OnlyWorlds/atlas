/**
 * SyncEngine concurrent-syncNow contract.
 *
 * Two parallel syncNow() calls must share the in-flight run rather than racing
 * push/pull side-by-side. Without this, a debounced auto-push firing during a
 * manual pullNow can double-push every dirty element.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let engine: SyncEngine;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
  engine = new SyncEngine({ folder, client });
});

describe('SyncEngine syncNow mutex', () => {
  it('concurrent syncNow() calls return the same in-flight result', async () => {
    await folder.createElement('character', { name: 'Alice' });

    const [a, b] = await Promise.all([engine.syncNow(), engine.syncNow()]);

    expect(a).toBe(b);
    expect(a.pushed.creates).toBe(1);
    // Server got exactly ONE create call, not two.
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
  });

  it('a sequential syncNow after the first completes runs fresh', async () => {
    await folder.createElement('character', { name: 'Alice' });
    await engine.syncNow();

    // Second call (sequential) finds no dirty elements — fresh run, not the
    // cached promise.
    const second = await engine.syncNow();
    expect(second.pushed.creates).toBe(0);
  });

  it('many concurrent callers all resolve once', async () => {
    await folder.createElement('character', { name: 'Alice' });

    const results = await Promise.all([
      engine.syncNow(),
      engine.syncNow(),
      engine.syncNow(),
      engine.syncNow(),
      engine.syncNow(),
    ]);

    // All same reference.
    for (const r of results) expect(r).toBe(results[0]);
    expect(client.calls.filter(c => c.method === 'create')).toHaveLength(1);
  });
});
