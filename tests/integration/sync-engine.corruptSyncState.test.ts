/**
 * S361 (gate F14): a sync file that exists and will not parse must stop sync
 * LEGIBLY. A corrupt sync-state.json used to make every round replay the
 * whole world, fail at the persist, reset the pill to idle, and say nothing.
 * Now the round pauses the engine and the pill carries the file's message.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('a corrupt sync-state.json', () => {
  it('pauses the engine with the file named, instead of looping silently', async () => {
    const engine = new SyncEngine({ folder, client });
    await folder.createElement('character', { name: 'Rhea' });
    await engine.syncNow();
    folder.syncStateCorrupt = true;
    await folder.createElement('character', { name: 'Ione' });

    await expect(engine.syncNow()).rejects.toThrow(/sync-state\.json/);
    const state = engine.getState();
    expect(state.kind).toBe('error');
    expect(state.kind === 'error' && state.message).toMatch(/sync-state\.json.*fix or remove/);

    // Paused: a push round no longer runs against the broken file.
    const calls = client.calls.length;
    const again = await engine.pushOnce();
    expect(again.pushed).toEqual({ creates: 0, updates: 0, deletes: 0 });
    expect(client.calls.length).toBe(calls);
  });
});
