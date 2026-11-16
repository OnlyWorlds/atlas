/**
 * A folder linked to a world that already has its own settings: the seed round
 * takes no baseline for a setting both sides hold differently, so the folder's
 * value is never sent unasked (the x_ keys' rule since 1.83, applied to the
 * settings). Under pause-and-review it is held for review; under local-wins
 * the folder's value goes up by the policy, as any contested setting.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

function makeEngine(policy?: 'local-wins' | 'pause-and-review'): SyncEngine {
  return new SyncEngine({ folder, client, policy });
}

function patchBodies(): Array<Record<string, unknown>> {
  return client.calls
    .filter((c): c is { method: 'patchWorldMeta'; body: Record<string, unknown> } =>
      (c as { method: string }).method === 'patchWorldMeta')
    .map(c => c.body);
}

async function serverMeta(): Promise<Record<string, unknown>> {
  return await client.getWorldMeta() as unknown as Record<string, unknown>;
}

async function localMeta(): Promise<Record<string, unknown>> {
  return await folder.readWorldMeta() as unknown as Record<string, unknown>;
}

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('a folder linked to a world with its own settings', () => {
  it('under pause-and-review a description both sides hold differently is held at the seed and never sent', async () => {
    await folder.writeWorldMeta({ description: 'The folder’s own words' } as never);
    client.__server_mutate_world_meta({ description: 'The world’s own words' });
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    expect(await engine.listMetaConflicts()).toEqual(['description']);
    // The open's settings check, then two more rounds: still nothing sent.
    if (await engine.claimWorldSettingsAtOpen()) await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(await engine.listMetaConflicts()).toEqual(['description']);
    expect((await serverMeta()).description).toBe('The world’s own words');
    expect((await localMeta()).description).toBe('The folder’s own words');
  });

  it('the held description is settled by the review: keep mine sends it once, take theirs writes the folder', async () => {
    await folder.writeWorldMeta({ description: 'Mine' } as never);
    client.__server_mutate_world_meta({ description: 'Theirs' });
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    await engine.resolveMetaConflict('description', 'mine');
    expect((await serverMeta()).description).toBe('Mine');
    expect(await engine.listMetaConflicts()).toEqual([]);
    const sent = patchBodies().length;
    await engine.syncNow();
    expect(patchBodies().length).toBe(sent);

    // A second link of the same folder: the seed runs again on a world now holding other words.
    await folder.updateSyncState(() => ({ meta_baseline: undefined, meta_conflicts: [] }));
    client.__server_mutate_world_meta({ description: 'Theirs again' });
    await engine.syncNow();
    expect(await engine.listMetaConflicts()).toEqual(['description']);
    await engine.resolveMetaConflict('description', 'theirs');
    expect((await localMeta()).description).toBe('Theirs again');
    await engine.syncNow();
    expect(patchBodies().length).toBe(sent);
    expect(await engine.listMetaConflicts()).toEqual([]);
  });

  it('under local-wins the folder’s description goes up on the next round, by the policy', async () => {
    await folder.writeWorldMeta({ description: 'The folder’s own words' } as never);
    client.__server_mutate_world_meta({ description: 'The world’s own words' });
    const engine = makeEngine('local-wins');
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    await engine.syncNow();
    expect((await serverMeta()).description).toBe('The folder’s own words');
  });

  it('the same description on both sides is no conflict, and nothing is sent', async () => {
    await folder.writeWorldMeta({ description: 'Shared words' } as never);
    client.__server_mutate_world_meta({ description: 'Shared words' });
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    await engine.syncNow();
    expect(await engine.listMetaConflicts()).toEqual([]);
    expect(patchBodies()).toEqual([]);
  });

  it('a setting only the world holds still comes down at the seed', async () => {
    client.__server_mutate_world_meta({ description: 'The world’s own words' });
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    expect((await localMeta()).description).toBe('The world’s own words');
    expect(await engine.listMetaConflicts()).toEqual([]);
    expect(patchBodies()).toEqual([]);
  });

  it('a later edit in the folder, after the seed agreed, is sent as before', async () => {
    await folder.writeWorldMeta({ description: 'Shared words' } as never);
    client.__server_mutate_world_meta({ description: 'Shared words' });
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    await folder.writeWorldMeta({ description: 'New words' } as never);
    await engine.syncNow();
    expect((await serverMeta()).description).toBe('New words');
  });
});
