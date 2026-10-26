/**
 * A profile's x_ keys on the World, synced (Atlas 1.83.0).
 *
 * keel keeps any x_ key as given and serves it at the top level of GET /world;
 * Atlas syncs them key by key beside the settings, with their own baseline
 * (`meta_ext_baseline`), compared by canonical JSON because keel's jsonb hands
 * an object back with its keys in another order (the fake plays that order on
 * purpose). And the world's `origin`, served by keel, is kept in the folder.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

// Keys in the order a person writes them; keel's jsonb gives "Team" first back.
const NAMES = { character: { singular: 'Employee', plural: 'Employees' }, institution: { singular: 'Team', plural: 'Teams' } };

function makeEngine(policy?: 'local-wins' | 'pause-and-review'): SyncEngine {
  return new SyncEngine({ folder, client, policy });
}

function patchBodies(): Array<Record<string, unknown>> {
  return client.calls
    .filter((c): c is { method: 'patchWorldMeta'; body: Record<string, unknown> } =>
      (c as { method: string }).method === 'patchWorldMeta')
    .map(c => c.body);
}

async function localMeta(): Promise<Record<string, unknown>> {
  return await folder.readWorldMeta() as unknown as Record<string, unknown>;
}

async function serverMeta(): Promise<Record<string, unknown>> {
  return await client.getWorldMeta() as unknown as Record<string, unknown>;
}

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('a linked world reads its own words from onlyworlds.com', () => {
  it('the seed round brings x_names down and sends nothing', async () => {
    client.__server_mutate_world_meta({ x_names: NAMES });
    const result = await makeEngine().syncNow();
    expect(patchBodies()).toEqual([]);
    expect((await localMeta()).x_names).toEqual(NAMES);
    expect(result.meta_pulled).toContain('x_names');
  });

  it('a later change on the server comes down, and its removal removes it', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    client.__server_mutate_world_meta({ x_names: NAMES });
    await engine.syncNow();
    expect((await localMeta()).x_names).toEqual(NAMES);
    client.__server_mutate_world_meta({ x_names: null });
    await engine.syncNow();
    expect((await localMeta()).x_names).toBeUndefined();
    expect(patchBodies()).toEqual([]);
  });

  it('a world linked before these keys synced (a settings baseline, no ext baseline) seeds them once', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    await folder.updateSyncState(() => ({ meta_ext_baseline: undefined }));
    client.__server_mutate_world_meta({ x_names: NAMES });
    await folder.writeWorldMeta({ x_checks: { on: true } } as never);
    await engine.syncNow();
    expect(patchBodies()).toEqual([]); // a seed sends nothing
    expect((await localMeta()).x_names).toEqual(NAMES);
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ x_checks: { on: true } }]); // the folder's own key, next round
  });
});

describe('a linked world sends its own words up', () => {
  it('a folder key goes up once, then the world stays idle though keel hands it back reordered', async () => {
    const engine = makeEngine();
    await engine.syncNow(); // seed
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    await engine.syncNow();
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ x_names: NAMES }]);
    // The fake stores it as jsonb would: not the bytes Atlas sent.
    expect(JSON.stringify((await serverMeta()).x_names)).not.toBe(JSON.stringify(NAMES));
    expect((await serverMeta()).x_names).toEqual(NAMES);
  });

  it('a key removed from the folder is sent as null, and keel drops it', async () => {
    client.__server_mutate_world_meta({ x_names: NAMES });
    const engine = makeEngine();
    await engine.syncNow(); // seed: it comes down
    await folder.writeWorldMeta({ x_names: undefined } as never);
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ x_names: null }]);
    expect((await serverMeta()).x_names).toBeUndefined();
  });

  it('a push round (pushOnce) carries a local key without a pull', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    await engine.pushOnce();
    expect(patchBodies()).toEqual([{ x_names: NAMES }]);
  });

  it('a view-only world never sends one', async () => {
    const engine = new SyncEngine({ folder, client, readOnly: true } as never);
    await engine.syncNow();
    await folder.writeWorldMeta({ x_names: NAMES } as never, { fromSync: true });
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
  });
});

describe('both sides changed one key', () => {
  async function contested(policy: 'local-wins' | 'pause-and-review'): Promise<SyncEngine> {
    const engine = makeEngine(policy);
    await engine.syncNow();
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    client.__server_mutate_world_meta({ x_names: { character: { singular: 'Agent', plural: 'Agents' } } });
    return engine;
  }

  it('local-wins sends the folder\'s value', async () => {
    const engine = await contested('local-wins');
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ x_names: NAMES }]);
    expect((await serverMeta()).x_names).toEqual(NAMES);
  });

  it('pause-and-review holds it as a world setting to review, and either answer settles it', async () => {
    const engine = await contested('pause-and-review');
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(await engine.listMetaConflicts()).toEqual(['x_names']);
    expect((await localMeta()).x_names).toEqual(NAMES);

    await engine.resolveMetaConflict('x_names', 'theirs');
    expect((await localMeta()).x_names).toEqual({ character: { singular: 'Agent', plural: 'Agents' } });
    expect(await engine.listMetaConflicts()).toEqual([]);
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
  });

  it('mine sends the folder\'s value and the next round is idle', async () => {
    const engine = await contested('pause-and-review');
    await engine.syncNow();
    await engine.resolveMetaConflict('x_names', 'mine');
    expect((await serverMeta()).x_names).toEqual(NAMES);
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ x_names: NAMES }]);
    expect(await engine.listMetaConflicts()).toEqual([]);
  });

  it('the same value on both sides converges without a send', async () => {
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    client.__server_mutate_world_meta({ x_names: NAMES });
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(await engine.listMetaConflicts()).toEqual([]);
  });
});

describe("the gate's cases", () => {
  it('G1: a key past the 64 KB line is never sent, and the settings still land', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    await folder.writeWorldMeta({ x_big: 'a'.repeat(70000) } as never);
    const r = await engine.syncNow();
    expect(r.failures.length).toBe(1);
    await engine.syncNow();
    await folder.writeWorldMeta({ description: 'new words' });
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ description: 'new words' }]);
    expect((await serverMeta()).description).toBe('new words');
  });

  it('G1: a body keel refuses is not sent again until the folder changes it', async () => {
    const engine = makeEngine();
    // keel counts every prefixed key; Atlas sees only the x_ ones, so this 422 is keel's.
    client.__server_mutate_world_meta({ atlas_other: 'b'.repeat(60000) });
    await engine.syncNow();
    await folder.writeWorldMeta({ x_names: { note: 'c'.repeat(10000) } } as never);
    await engine.syncNow();
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies().filter(b => 'x_names' in b)).toHaveLength(1);
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    await engine.syncNow();
    expect((await serverMeta()).x_names).toEqual(NAMES);
  });

  it('G6: with the server near the line, a world\'s now still goes up beside a refused key', async () => {
    const engine = makeEngine();
    client.__server_mutate_world_meta({ x_other: 'b'.repeat(65000) });
    await engine.syncNow();
    await folder.writeWorldMeta({ x_names: { note: 'E'.repeat(1000) }, time_current: 7 } as never);
    await engine.syncNow();
    expect((await serverMeta()).time_current).toBe(7);
  });

  it('G2: a key both sides hold differently at its seed is held under pause-and-review, never sent', async () => {
    const engine = makeEngine('pause-and-review');
    await engine.syncNow();
    await folder.updateSyncState(() => ({ meta_ext_baseline: undefined }));
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    client.__server_mutate_world_meta({ x_names: { character: { singular: 'Theirs' } } });
    await engine.syncNow();
    // Held in the seed round itself: a review-first world ends its review after
    // the first round that compared and found nothing (sync-attach).
    expect(await engine.listMetaConflicts()).toEqual(['x_names']);
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(await engine.listMetaConflicts()).toEqual(['x_names']);
    expect((await serverMeta()).x_names).toEqual({ character: { singular: 'Theirs' } });
  });

  it('G2: under local-wins the same seed lets the folder win on the next round, by the policy', async () => {
    const engine = makeEngine('local-wins');
    await engine.syncNow();
    await folder.updateSyncState(() => ({ meta_ext_baseline: undefined }));
    await folder.writeWorldMeta({ x_names: NAMES } as never);
    client.__server_mutate_world_meta({ x_names: { character: { singular: 'Theirs' } } });
    await engine.syncNow();
    await engine.syncNow();
    expect((await serverMeta()).x_names).toEqual(NAMES);
  });

  it('G5: a value JSON can only write as null is absent, so nothing oscillates', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    await folder.writeWorldMeta({ x_n: JSON.parse('1e400') } as never);
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
  });
});

describe('what is not a profile key stays out', () => {
  it('atlas_ and shadow_ keys in the folder are never sent', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    await folder.writeWorldMeta({ atlas_local: 1, shadow_x: 2 } as never);
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
  });
});

describe('the world\'s first import (origin), as keel serves it', () => {
  it('is written into the folder, nulls and all, and never sent', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    expect((await localMeta()).origin).toEqual({ source: null, producer: null });
    const producer = { tool: 'azgaar-converter', version: '2.1', input: 'azgaar-map' };
    client.__server_mutate_world_meta({ origin: { source: null, producer } });
    await engine.syncNow();
    expect((await localMeta()).origin).toEqual({ source: null, producer });
    expect(patchBodies()).toEqual([]);
  });
});
