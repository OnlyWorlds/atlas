/**
 * SyncEngine.pullNow() — pull-only path used by manual "Refresh from API"
 * button and periodic auto-pull (Phase 3.5+).
 *
 * Covers:
 * - Pulls server-only elements without pushing local edits
 * - No-op while paused
 * - Concurrent calls dedupe via inFlight promise
 * - State transitions through `syncing → idle`
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

describe('SyncEngine.pullNow', () => {
  it('pulls server-only elements without pushing local edits', async () => {
    // Local: one element with no server baseline (would push under syncNow).
    await folder.createElement('character', { name: 'LocalOnly' });
    // Server: a different element.
    await client.createElement('character', { id: 'srv-1', name: 'ServerOnly', type: 'character' });

    const callsBefore = client.calls.length;
    const result = await engine.pullNow();

    // Pulled the server element.
    expect(result.pulled.creates).toBe(1);
    expect(await folder.getElement('srv-1')).not.toBeNull();
    // Did NOT push the local element.
    expect(result.pushed.creates).toBe(0);
    const newCalls = client.calls.slice(callsBefore);
    // Only reads (list + the S262 world-meta GET), no create/update.
    expect(newCalls.every(c => c.method === 'list' || c.method === 'getWorldMeta')).toBe(true);
  });

  it('no-op while paused', async () => {
    await client.createElement('character', { id: 'srv-1', name: 'Alice', type: 'character' });

    engine.pause('manual');
    const result = await engine.pullNow();

    expect(result.pulled.creates).toBe(0);
    expect(await folder.getElement('srv-1')).toBeNull();
  });

  it('concurrent calls share the in-flight promise', async () => {
    await client.createElement('character', { id: 'srv-1', name: 'Alice', type: 'character' });

    const p1 = engine.pullNow();
    const p2 = engine.pullNow();
    const [r1, r2] = await Promise.all([p1, p2]);

    // Both promises resolve to the same result object.
    expect(r1).toBe(r2);
    expect(r1.pulled.creates).toBe(1);
  });

  it('reports server-newer updates without bumping pushed counts', async () => {
    // Set baseline: pull an existing element so local has server_updated_at.
    await client.createElement('character', { id: 'c1', name: 'Bob', type: 'character' });
    await engine.syncNow();
    // Reset call log to isolate the next pull.
    client.calls.length = 0;

    // Someone else edits on the server.
    await client.updateElement('character', 'c1', { name: 'Robert', type: 'character' });

    const result = await engine.pullNow();
    expect(result.pulled.updates).toBe(1);
    expect(result.pushed.creates + result.pushed.updates + result.pushed.deletes).toBe(0);
    const updated = await folder.getElement('c1');
    expect(updated!.name).toBe('Robert');
  });

  it('returns an empty result on empty-on-both-sides', async () => {
    const result = await engine.pullNow();
    expect(result.pulled.creates).toBe(0);
    expect(result.pulled.updates).toBe(0);
    expect(result.pushed.creates).toBe(0);
    expect(result.conflicts).toEqual([]);
  });

  it('transitions state idle → syncing → idle', async () => {
    await client.createElement('character', { id: 'srv-1', name: 'Alice', type: 'character' });

    const seen: string[] = [];
    const engineWithStates = new SyncEngine({
      folder,
      client,
      onStateChange: (s) => seen.push(s.kind),
    });
    await engineWithStates.pullNow();

    expect(seen).toContain('syncing');
    expect(seen[seen.length - 1]).toBe('idle');
  });
});
