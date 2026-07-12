/**
 * Push-order contract: CREATEs go in FK dependency order.
 *
 * The scenario from Bout-T smoke: a local Character has `birthplace` pointing
 * at a local Location. Before this bout, pushPhase iterated CREATEs in
 * arbitrary order — sometimes Character first, which produced a server
 * `400 Invalid FK: birthplace_id — referenced Location with id ... does
 * not exist`. The chain self-healed via the next round's rewriteIdReferences,
 * but the console noise was alarming and the round took 5s+ to settle.
 *
 * Fix: topo-sort the CREATE batch by FK dependency. Dependencies push first;
 * references resolve within the same round.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import type { ElementType } from '../../src/core/types';

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

describe('SyncEngine CREATE ordering (topo-sort by FK)', () => {
  it('pushes Location before Character when Character.birthplace references Location', async () => {
    // Important: create Character FIRST locally so insertion order is
    // [character, location]. Without the topo-sort, pushPhase would
    // iterate in this order and Character would 400 server-side. The sort
    // must flip them.
    // (Note: we need the character's id ready before creating it so we can
    //  reference an as-yet-uncreated location id. Use newId for both up front.)
    const character = await folder.createElement('character', { name: 'Alice' });
    const location = await folder.createElement('location', { name: 'Riverdale' });
    // Now wire the FK: character.birthplace → location.id.
    await folder.updateElement(character.id, { birthplace: location.id });

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(2);
    expect(result.failures).toHaveLength(0);

    // Verify call order: location create came before character create.
    const createCalls = client.calls.filter((c) => c.method === 'create');
    expect(createCalls).toHaveLength(2);
    expect(createCalls[0].method).toBe('create');
    if (createCalls[0].method !== 'create') throw new Error('expected create');
    expect(createCalls[0].type).toBe('location');
    expect(createCalls[1].method).toBe('create');
    if (createCalls[1].method !== 'create') throw new Error('expected create');
    expect(createCalls[1].type).toBe('character');

    // Server's character should reference the location's id.
    const serverChar = client.__server_get('character', character.id);
    expect(serverChar?.birthplace).toBe(location.id);
  });

  it('handles a longer chain: Map → Location, Pin → Map AND element', async () => {
    // Create in REVERSE topo order so insertion order is wrong:
    // Pin → Map → Location → Character. The sort must produce a valid order:
    // location + character (zero deps) before map, map before pin.
    const pin = await folder.createElement('pin', {
      x: 100, y: 200, element_type: 'character',
    });
    const map = await folder.createElement('map', { name: 'Region Map' });
    const location = await folder.createElement('location', { name: 'Bay' });
    const character = await folder.createElement('character', { name: 'Bob' });
    // Wire the chain after creation so insertion order doesn't reflect deps.
    await folder.updateElement(map.id, { location: location.id });
    await folder.updateElement(pin.id, { map_id: map.id, element_id: character.id });

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(4);
    expect(result.failures).toHaveLength(0);

    // Verify partial order constraints: location before map; map before pin;
    // character before pin.
    const createCalls = client.calls.filter(
      (c): c is { method: 'create'; type: ElementType; body: Record<string, unknown> } =>
        c.method === 'create'
    );
    const typeOrder = createCalls.map((c) => c.type);
    expect(typeOrder.indexOf('location')).toBeLessThan(typeOrder.indexOf('map'));
    expect(typeOrder.indexOf('map')).toBeLessThan(typeOrder.indexOf('pin'));
    expect(typeOrder.indexOf('character')).toBeLessThan(typeOrder.indexOf('pin'));
    void pin;
  });

  it('id reassignment on CREATE = loud per-element failure, nothing swapped (v2 contract)', async () => {
    // keel PRESERVES client ids (probed 2026-07-12); the create-path id-swap
    // machinery was excised with the v1 adapter. If a server ever reassigns
    // again, the engine must fail that element loudly instead of silently
    // re-keying the world: no baseline stamped, local file untouched at its
    // original id, element retried next round.
    client.assignServerIds = true; // simulate a contract-violating server
    const character = await folder.createElement('character', { name: 'Carol' });

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(character.id);
    expect(result.failures[0].message).toMatch(/contract violation/i);
    // Local file untouched: same id, no server baseline.
    const local = await folder.getElement(character.id);
    expect(local).not.toBeNull();
    expect(local!.server_updated_at).toBeUndefined();
  });

  it('falls back to input order on cycles (no infinite loop / crash)', async () => {
    // A → B (via `friends` multi-link) AND B → A. Genuine cycle. The sort
    // can't fully resolve; falls back to input order. ONE side still 400s
    // on first push, then self-heals via rewriteIdReferences.
    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('character', { name: 'B' });
    // Wire the cycle locally.
    await folder.updateElement(a.id, { friends: [b.id] });
    await folder.updateElement(b.id, { friends: [a.id] });

    // Should NOT throw or infinite-loop — even in cycle case the engine
    // attempts both. The fake's PATCH-after-CREATE behavior doesn't enforce
    // FK so it succeeds; in production the first one would 400 and the
    // second pass would heal it. We're testing the safety of the sort here.
    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(2);
    expect(result.failures).toHaveLength(0);
  });

  it('elements with no inter-dependencies keep stable processing', async () => {
    // Three independent characters. No FK refs between them. Sort is a no-op.
    await folder.createElement('character', { name: 'A' });
    await folder.createElement('character', { name: 'B' });
    await folder.createElement('character', { name: 'C' });

    const result = await engine.pushOnce();

    expect(result.pushed.creates).toBe(3);
    expect(result.failures).toHaveLength(0);
  });
});
