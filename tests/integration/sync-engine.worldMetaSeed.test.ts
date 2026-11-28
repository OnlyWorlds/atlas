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

function makeEngine(policy?: 'local-wins' | 'pause-and-review', readOnly = false): SyncEngine {
  return new SyncEngine({ folder, client, policy, readOnly });
}

/** Folder and world hold different descriptions; the first round has run under the policy. */
async function linkedHeld(policy: 'local-wins' | 'pause-and-review' = 'pause-and-review', readOnly = false): Promise<SyncEngine> {
  await folder.writeWorldMeta({ description: 'mine' } as never);
  client.__server_mutate_world_meta({ description: 'theirs' });
  const engine = makeEngine(policy, readOnly);
  await engine.syncNow();
  return engine;
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

  it('a world that clears its held description online sends nothing and keeps the review (gate C1)', async () => {
    const engine = await linkedHeld();
    client.__server_mutate_world_meta({ description: '' });
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(await engine.listMetaConflicts()).toEqual(['description']);
    expect((await localMeta()).description).toBe('mine');
  });

  it('a folder that clears its held description takes nothing from the world and keeps the review (gate S2)', async () => {
    const engine = await linkedHeld();
    await folder.writeWorldMeta({ description: '' } as never);
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect((await localMeta()).description).toBe('');
    expect(await engine.listMetaConflicts()).toEqual(['description']);
  });

  it('both sides coming to the same value settle it: no review, and later edits go as usual', async () => {
    const engine = await linkedHeld();
    await folder.writeWorldMeta({ description: 'theirs' } as never);
    await engine.syncNow();
    expect(await engine.listMetaConflicts()).toEqual([]);
    expect(patchBodies()).toEqual([]);
    await folder.writeWorldMeta({ description: 'later' } as never);
    await engine.syncNow();
    expect((await serverMeta()).description).toBe('later');
  });

  it('under local-wins the folder’s value is sent once, then settled: no repeat, and a later online edit comes down', async () => {
    const engine = await linkedHeld('local-wins');
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ description: 'mine' }]);
    client.__server_mutate_world_meta({ description: 'edited online' });
    await engine.syncNow();
    expect((await localMeta()).description).toBe('edited online');
    expect(patchBodies().length).toBe(1);
  });

  it('under local-wins a send refused for the key keeps the setting unsettled, so a later clear pulls nothing (gate 2 S1)', async () => {
    const engine = await linkedHeld('local-wins');
    const real = client.patchWorldMeta.bind(client);
    client.patchWorldMeta = (async () => { throw Object.assign(new Error('Unauthorized'), { status: 401 }); }) as never;
    await engine.syncNow();
    client.patchWorldMeta = real;
    const st = await folder.readSyncState();
    expect(st.meta_unsettled).toEqual(['description']);
    await folder.writeWorldMeta({ description: '' } as never);
    await makeEngine('pause-and-review').syncNow();
    expect((await localMeta()).description).toBe('');
  });

  it('a view-only world seeds as before: no review row, nothing sent (gate S1)', async () => {
    const engine = await linkedHeld('pause-and-review', true);
    await engine.syncNow();
    expect(await engine.listMetaConflicts()).toEqual([]);
    expect(patchBodies()).toEqual([]);
    await expect(engine.resolveMetaConflict('description', 'mine')).rejects.toThrow(/view-only/);
    expect(patchBodies()).toEqual([]);
  });

  it('an x_ key the world clears after a held seed is not sent either', async () => {
    await folder.writeWorldMeta({ x_names: { character: { singular: 'Mine' } } } as never);
    client.__server_mutate_world_meta({ x_names: { character: { singular: 'Theirs' } } });
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    client.__server_mutate_world_meta({ x_names: null } as never);
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(await engine.listMetaConflicts()).toEqual(['x_names']);
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

describe('a setting of another kind, held at the seed', () => {
  it('under local-wins it is never pushed as a clear or a refused value, and Mine says so', async () => {
    await folder.writeWorldMeta({ time_current: 5, description: 'Warm.' } as never);
    client.__server_mutate_world_meta({ time_current: 7, description: 'Cold.' });
    const engine = makeEngine('local-wins');
    await engine.syncNow();
    client.calls.length = 0;
    await folder.writeWorldMeta({ time_current: '9', description: 12 } as never);
    await engine.syncNow();
    await engine.syncNow();
    for (const b of patchBodies()) {
      expect(b).not.toHaveProperty('time_current');
      expect(b).not.toHaveProperty('description');
    }
    const server = await serverMeta();
    expect(server.time_current === null || server.description === '').toBe(false);
    await expect(engine.resolveMetaConflict('time_current', 'mine')).rejects.toThrow(/another kind than it takes, so it was not sent/);
  });

  it('at the seed it reads as unset: the file takes OnlyWorlds\' value and nothing is sent', async () => {
    await folder.writeWorldMeta({ description: 12, time_current: '7', time_format_names: 'Year' } as never);
    client.__server_mutate_world_meta({ description: 'Cold.', time_current: 7, time_format_names: ['Year'] });
    await makeEngine('local-wins').syncNow();
    expect(patchBodies()).toEqual([]);
    const local = await localMeta();
    expect([local.description, local.time_current, local.time_format_names]).toEqual(['Cold.', 7, ['Year']]);
  });
});
