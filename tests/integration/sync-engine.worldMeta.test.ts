/**
 * SyncEngine world-meta step (S262 — design + gate record:
 * Forge/Notes/2026-07-13-worldmeta-sync-design.md).
 *
 * Locks every gate resolution that is testable at the engine seam:
 *  R2 seed rule (absent baseline → adopt server, fill empties, NEVER PATCH)
 *  R2 three-way (push / pull / contested per field; per-field baseline advance)
 *  R3 zero-PATCH idle (canonical equality — the oscillation lock)
 *  R3 cleared now → explicit null on the wire, and a server clear applies
 *  R1 403 permission_error → auth-bail with auth_reason 'read_only_key'
 *  R6 stopped latch (an in-flight round persists nothing after stop())
 *  R9 contested fields per policy + resolveMetaConflict
 *  R10 overlong field → per-field failure, never sent
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

/** The patchWorldMeta bodies the fake captured, in order. */
function patchBodies(): Array<Record<string, unknown>> {
  return client.calls
    .filter((c): c is { method: 'patchWorldMeta'; body: Record<string, unknown> } =>
      (c as { method: string }).method === 'patchWorldMeta')
    .map(c => c.body);
}

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('seed round (absent baseline — the 3-lens convergent blocker)', () => {
  it('adopts the server as baseline, fills locally-empty fields, and NEVER PATCHes', async () => {
    // Link-existing shape: server has real meta, local world.json is bare.
    client.__server_mutate_world_meta({ description: 'server desc', time_current: 42 });
    const engine = makeEngine();

    const result = await engine.syncNow();

    expect(patchBodies()).toEqual([]); // the blank-blast that the gate killed
    const meta = await folder.readWorldMeta();
    expect(meta.description).toBe('server desc');
    expect(meta.time_current).toBe(42);
    expect(result.meta_pulled).toEqual(expect.arrayContaining(['description', 'time_current']));
    const s = await folder.readSyncState();
    expect(s.meta_baseline).toBeTruthy();
    expect((s.meta_baseline as Record<string, unknown>).description).toBe('server desc');
  });

  it('keeps locally-set values on seed (they push on the NEXT round, local-first)', async () => {
    client.__server_mutate_world_meta({ description: 'server desc' });
    await folder.writeWorldMeta({ description: 'local desc' });
    const engine = makeEngine();

    await engine.syncNow();
    // Seed round: no PATCH, local value untouched.
    expect(patchBodies()).toEqual([]);
    expect((await folder.readWorldMeta()).description).toBe('local desc');

    // Next round: local differs from the seeded baseline → pushes.
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ description: 'local desc' }]);
  });
});

describe('zero-PATCH idle (the oscillation lock, gate HIGH)', () => {
  it('a fresh linked world with unset fields produces ZERO meta PATCHes across rounds', async () => {
    const engine = makeEngine();
    await engine.syncNow();
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
  });

  it('a hand-typed unit with spaces pushes once, trimmed, then stays idle (keel trims units, #149)', async () => {
    const engine = makeEngine();
    await engine.syncNow(); // seed
    await folder.writeWorldMeta({ length_unit: ' cm ', distance_unit: 'leagues' });
    await engine.syncNow();
    await engine.syncNow();
    await engine.syncNow();
    expect(patchBodies()).toEqual([{ length_unit: 'cm', distance_unit: 'leagues' }]);
    const server = await client.getWorldMeta();
    expect(server.length_unit).toBe('cm');
    expect(server.distance_unit).toBe('leagues');
  });

  it('a unit set on the server pulls into world.json (#149)', async () => {
    const engine = makeEngine();
    await engine.syncNow(); // seed
    client.__server_mutate_world_meta({ mass_unit: 'stone' });
    const result = await engine.syncNow();
    expect((await folder.readWorldMeta()).mass_unit).toBe('stone');
    expect(result.meta_pulled).toEqual(['mass_unit']);
    expect(patchBodies()).toEqual([]);
  });
});

describe('three-way rounds', () => {
  async function seeded(policy?: 'local-wins' | 'pause-and-review'): Promise<SyncEngine> {
    const engine = makeEngine(policy);
    await engine.syncNow(); // seed baseline
    client.calls.length = 0;
    return engine;
  }

  it('local-only change → ONE partial PATCH of exactly the changed field', async () => {
    const engine = await seeded();
    await folder.writeWorldMeta({ time_current: 38 });

    const result = await engine.syncNow();

    expect(patchBodies()).toEqual([{ time_current: 38 }]);
    expect(result.meta_pushed).toEqual(['time_current']);
    // Baseline advanced from the echo → next round is quiet.
    client.calls.length = 0;
    await engine.syncNow();
    expect(patchBodies()).toEqual([]);
  });

  it('a cleared now goes out as EXPLICIT null (never omitted — the resurrect fix)', async () => {
    client.__server_mutate_world_meta({ time_current: 42 });
    const engine = await seeded();
    expect((await folder.readWorldMeta()).time_current).toBe(42);

    // setNow(null) shape: undefined on disk.
    await folder.writeWorldMeta({ time_current: undefined });
    await engine.syncNow();

    expect(patchBodies()).toEqual([{ time_current: null }]);
    expect(client.__get_world_meta_state().time_current).toBeNull();
  });

  it('server-only change → applied locally + meta_pulled + baseline advances', async () => {
    const engine = await seeded();
    client.__server_mutate_world_meta({ description: 'from device B', time_range_min: 0 });

    const result = await engine.syncNow();

    const meta = await folder.readWorldMeta();
    expect(meta.description).toBe('from device B');
    expect(meta.time_range_min).toBe(0);
    expect(result.meta_pulled).toEqual(expect.arrayContaining(['description', 'time_range_min']));
    expect(patchBodies()).toEqual([]);
  });

  it('per-field independence: a push and a concurrent server change on ANOTHER field both land (the partial-baseline swallow, gate HIGH)', async () => {
    const engine = await seeded();
    await folder.writeWorldMeta({ time_current: 5 });          // device A edit
    client.__server_mutate_world_meta({ time_range_min: 200 }); // device B landed first

    await engine.syncNow();

    // A's push carried ONLY time_current; B's min was pull-applied, not clobbered.
    expect(patchBodies()).toEqual([{ time_current: 5 }]);
    const meta = await folder.readWorldMeta();
    expect(meta.time_range_min).toBe(200);
    expect(client.__get_world_meta_state().time_range_min).toBe(200);
    expect(client.__get_world_meta_state().time_current).toBe(5);
  });

  it('contested under local-wins → local pushes, nothing persisted', async () => {
    const engine = await seeded('local-wins');
    await folder.writeWorldMeta({ description: 'mine' });
    client.__server_mutate_world_meta({ description: 'theirs' });

    await engine.syncNow();

    expect(patchBodies()).toEqual([{ description: 'mine' }]);
    expect(client.__get_world_meta_state().description).toBe('mine');
    expect((await folder.readSyncState()).meta_conflicts ?? []).toEqual([]);
  });

  it('contested under pause-and-review → skipped both ways + persisted; resolveMetaConflict clears it', async () => {
    const engine = await seeded('pause-and-review');
    await folder.writeWorldMeta({ description: 'mine' });
    client.__server_mutate_world_meta({ description: 'theirs' });

    await engine.syncNow();

    // Neither side overwritten.
    expect(patchBodies()).toEqual([]);
    expect((await folder.readWorldMeta()).description).toBe('mine');
    expect(client.__get_world_meta_state().description).toBe('theirs');
    expect((await folder.readSyncState()).meta_conflicts).toEqual(['description']);
    expect(await engine.listMetaConflicts()).toEqual(['description']);

    // theirs: server value applies locally, conflict clears, baseline advances.
    await engine.resolveMetaConflict('description', 'theirs');
    expect((await folder.readWorldMeta()).description).toBe('theirs');
    expect(await engine.listMetaConflicts()).toEqual([]);
    client.calls.length = 0;
    await engine.syncNow();
    expect(patchBodies()).toEqual([]); // fully converged
  });

  it("resolveMetaConflict 'mine' force-pushes the local value", async () => {
    const engine = await seeded('pause-and-review');
    await folder.writeWorldMeta({ description: 'mine' });
    client.__server_mutate_world_meta({ description: 'theirs' });
    await engine.syncNow();

    await engine.resolveMetaConflict('description', 'mine');
    expect(client.__get_world_meta_state().description).toBe('mine');
    expect(await engine.listMetaConflicts()).toEqual([]);
  });
});

describe('failure routing', () => {
  it('403 permission_error auth-bails with auth_reason read_only_key (gate R1)', async () => {
    const engine = makeEngine();
    await engine.syncNow(); // seed
    await folder.writeWorldMeta({ description: 'edit' });
    client.__inject_write_permission_error();

    const result = await engine.syncNow();

    expect(result.auth_blocked).toBe(true);
    expect(result.auth_reason).toBe('read_only_key');
    const state = engine.getState();
    expect(state.kind).toBe('error');
    expect((state as { message: string }).message).toMatch(/read-only/i);
  });

  it('an overlong field becomes a per-field failure and is NEVER sent (dig Q9)', async () => {
    const engine = makeEngine();
    await engine.syncNow(); // seed
    await folder.writeWorldMeta({ image_url: 'https://x/' + 'a'.repeat(1100), time_current: 7 });

    const result = await engine.syncNow();

    // The valid field still pushed; the overlong one failed honestly.
    expect(patchBodies()).toEqual([{ time_current: 7 }]);
    expect(result.failures.some(f => f.type === 'world' && /1024/.test(f.message))).toBe(true);
  });

  it('a GET /world failure skips meta for the round without killing element sync', async () => {
    const engine = makeEngine();
    await engine.syncNow(); // seed
    await folder.createElement('character', { name: 'Alice' });
    const original = client.getWorldMeta.bind(client);
    client.getWorldMeta = async () => { throw new Error('network hiccup'); };

    const result = await engine.syncNow();

    expect(result.pushed.creates).toBe(1); // elements still synced
    expect(result.failures.some(f => f.type === 'world' && f.operation === 'read')).toBe(true);
    client.getWorldMeta = original;
  });
});

describe('stopped latch (gate R6 — unlink must not be resurrected)', () => {
  it('a round in flight when stop() lands persists NO meta baseline', async () => {
    const engine = makeEngine();
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const original = client.getWorldMeta.bind(client);
    client.getWorldMeta = async () => { await gate; return original(); };

    const round = engine.syncNow();
    engine.stop();          // unlink races the in-flight round
    release();
    await round;

    const s = await folder.readSyncState();
    expect(s.meta_baseline ?? null).toBeNull();
    expect((await folder.readWorldMeta()).description ?? '').toBe('');
  });
});

describe('a world.json that will not parse (S361, gate F2)', () => {
  async function establishedBaseline(): Promise<SyncEngine> {
    client.__server_mutate_world_meta({ description: 'server desc', time_basic_unit: 'Year', time_current: 42 });
    const engine = makeEngine();
    await engine.syncNow(); // seed round: baseline adopted
    expect((await folder.readSyncState()).meta_baseline).toBeTruthy();
    folder.worldMetaCorrupt = true; // e.g. git conflict markers after a pull
    return engine;
  }

  it('a sync round skips meta with a failure and never PATCHes blanks', async () => {
    const engine = await establishedBaseline();
    const result = await engine.syncNow();
    expect(patchBodies()).toEqual([]);
    expect(result.failures.some(f => f.type === 'world' && /world\.json/.test(f.message))).toBe(true);
    const server = await client.getWorldMeta();
    expect(server.description).toBe('server desc');
    expect(server.time_current).toBe(42);
  });

  it('a push round (the precheck path) never PATCHes blanks either', async () => {
    const engine = await establishedBaseline();
    await engine.pushOnce();
    expect(patchBodies()).toEqual([]);
  });
});
