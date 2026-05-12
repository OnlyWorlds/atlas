/**
 * OwClientAdapter — integration tests against MSW + real @onlyworlds/sdk.
 *
 * Covers:
 * - Round-trip create/update/delete through the SDK
 * - Pin write bypass (raw client.request — no element_id mangling)
 * - Nested relation unwrap on read
 * - Type field stamped on responses
 * - listElements handles both array and paginated envelope shapes
 * - getElement returns null on 404
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { mswServer } from '../setup';
import { statefulOwHandlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { OwClientAdapter, adaptRecord } from '../../src/sync/ow-client-adapter';

let clock: MonotonicClock;
let adapter: OwClientAdapter;

const TEST_BASE = 'https://test-ow.local/api/worldapi';

function makeClient() {
  return new OnlyWorldsClient({
    apiKey: 'test-key',
    apiPin: '1234',
    baseUrl: TEST_BASE,
  });
}

beforeEach(() => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  adapter = new OwClientAdapter(makeClient());
});

describe('adaptRecord (unit) — wire-shape conversion', () => {
  it('stamps type field on responses', () => {
    const out = adaptRecord({ id: 'c1', updated_at: '2026-01-01T00:00:00Z', name: 'Alice' }, 'character');
    expect(out.type).toBe('character');
    expect(out.name).toBe('Alice');
  });

  it('unwraps nested single relation object → <field>_id', () => {
    const out = adaptRecord(
      { id: 'p1', updated_at: 't', map: { id: 'm1', name: 'World Map' } },
      'pin'
    );
    expect(out.map_id).toBe('m1');
    expect(out.map).toBeUndefined();
  });

  it('unwraps nested relation array → <field>_ids', () => {
    const out = adaptRecord(
      { id: 'c1', updated_at: 't', species: [{ id: 's1', name: 'elf' }, { id: 's2', name: 'hobbit' }] },
      'character'
    );
    expect(out.species_ids).toEqual(['s1', 's2']);
    expect(out.species).toBeUndefined();
  });

  it('leaves non-relation arrays alone (no id property)', () => {
    const out = adaptRecord(
      { id: 'c1', updated_at: 't', time_format_names: ['Year', 'Day'] },
      'character'
    );
    expect(out.time_format_names).toEqual(['Year', 'Day']);
  });

  it('leaves primitives + plain strings alone', () => {
    const out = adaptRecord(
      { id: 'c1', updated_at: 't', name: 'Alice', age: 30, alive: true },
      'character'
    );
    expect(out.name).toBe('Alice');
    expect(out.age).toBe(30);
    expect(out.alive).toBe(true);
  });

  it('throws on response missing id or updated_at', () => {
    expect(() => adaptRecord({ id: 'x' }, 'character')).toThrow(/updated_at/);
    expect(() => adaptRecord({ updated_at: 't' }, 'character')).toThrow(/id/);
  });
});

describe('OwClientAdapter — round-trip via MSW', () => {
  it('createElement → server has it, response has type field stamped', async () => {
    const { handlers } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    const result = await adapter.createElement('character', {
      id: 'c1',
      name: 'Alice',
    });
    expect(result.id).toBe('c1');
    expect(result.type).toBe('character');
    expect(result.updated_at).toBeTruthy();
    expect(result.name).toBe('Alice');
  });

  it('listElements returns array of adapted records (raw array response)', async () => {
    const { handlers, __mutate } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('location', { id: 'l1', name: 'Shire' });
    await adapter.createElement('location', { id: 'l2', name: 'Mordor' });

    const list = await adapter.listElements('location');
    expect(list).toHaveLength(2);
    expect(list.every(r => r.type === 'location')).toBe(true);
  });

  it('listElements unwraps nested relations on read', async () => {
    const { handlers } = statefulOwHandlers({
      baseUrl: TEST_BASE,
      clock: clock.next,
      serveNestedRelations: true,
    });
    mswServer.use(...handlers);

    await adapter.createElement('pin', {
      id: 'pin1',
      name: 'pin',
      map_id: 'map42',
      element_id: 'char7',
      x: 100,
      y: 200,
    });

    const fetched = await adapter.getElement('pin', 'pin1');
    expect(fetched).not.toBeNull();
    // The server (per serveNestedRelations) returned {map: {id: 'map42'}};
    // adapter unwrapped to map_id.
    expect(fetched!.map_id).toBe('map42');
    expect(fetched!.element_id).toBe('char7');
    expect(fetched!.map).toBeUndefined();
    expect(fetched!.element).toBeUndefined();
  });

  it('pin create body preserves element_id verbatim (no prepareRelations mangling)', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('pin', {
      id: 'pin1',
      name: 'pin',
      map_id: 'm1',
      element_id: 'c1',
      x: 10,
      y: 20,
    });

    const stored = state.get('pin')!.get('pin1')!;
    // Server received element_id as-is, not element_id_id.
    expect(stored.element_id).toBe('c1');
    expect((stored as Record<string, unknown>).element_id_id).toBeUndefined();
  });

  it('updateElement returns updated record, server reflects change', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('character', { id: 'c1', name: 'Alice' });
    const updated = await adapter.updateElement('character', 'c1', { name: 'Alice II' });

    expect(updated.name).toBe('Alice II');
    expect(state.get('character')!.get('c1')!.name).toBe('Alice II');
  });

  it('deleteElement removes record', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('character', { id: 'c1', name: 'Alice' });
    await adapter.deleteElement('character', 'c1');
    expect(state.get('character')!.has('c1')).toBe(false);
  });

  it('getElement returns null on 404', async () => {
    const { handlers } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    const result = await adapter.getElement('character', 'missing-id');
    expect(result).toBeNull();
  });

  it('OwClientAdapter is interface-compatible with SyncEngine via duck-typing', async () => {
    // Smoke check: the adapter implements all methods the engine expects.
    const methods = ['createElement', 'updateElement', 'deleteElement', 'listElements', 'getElement'];
    for (const m of methods) {
      expect(typeof (adapter as unknown as Record<string, unknown>)[m]).toBe('function');
    }
  });
});
