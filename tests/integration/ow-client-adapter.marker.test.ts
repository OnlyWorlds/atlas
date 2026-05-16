/**
 * Marker write bypass (regression).
 *
 * Markers carry wire-shape relation fields on disk (map_id, zone_id) — same
 * pattern as pin (element_id, map_id). The adapter MUST bypass prepareRelations
 * for marker bodies; without the bypass, prepareRelations re-suffixes the
 * field names → map_id_id, zone_id_id → real OW returns 400.
 *
 * The MSW handlers + FakeOwApiClient encode the rule (Convention #20). This
 * file exercises the rule through the real SDK + adapter path.
 *
 * Zone is intentionally NOT bypassed — Zone has no _id-suffix fields on disk;
 * its relations (phenomena, linked_zones, etc.) are bare-name arrays that
 * prepareRelations correctly converts to phenomena_ids etc.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { mswServer } from '../setup';
import { statefulOwHandlers } from '../msw-handlers';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { OwClientAdapter } from '../../src/sync/ow-client-adapter';

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

describe('OwClientAdapter — marker write bypass', () => {
  it('marker create body preserves map_id + zone_id verbatim (no _id_id mangling)', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('marker', {
      id: 'mk1',
      name: '',
      map_id: 'map-A',
      zone_id: 'zone-1',
      x: 100,
      y: 200,
      order: 0,
    });

    const stored = state.get('marker')!.get('mk1')!;
    expect(stored.map_id).toBe('map-A');
    expect(stored.zone_id).toBe('zone-1');
    expect((stored as Record<string, unknown>).map_id_id).toBeUndefined();
    expect((stored as Record<string, unknown>).zone_id_id).toBeUndefined();
  });

  it('marker update body preserves map_id + zone_id verbatim', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('marker', {
      id: 'mk2',
      name: '',
      map_id: 'map-A',
      zone_id: 'zone-1',
      x: 0,
      y: 0,
      order: 0,
    });

    await adapter.updateElement('marker', 'mk2', {
      x: 500,
      y: 600,
      zone_id: 'zone-2', // re-assign zone
    });

    const stored = state.get('marker')!.get('mk2')!;
    expect(stored.zone_id).toBe('zone-2');
    expect(stored.x).toBe(500);
    expect(stored.y).toBe(600);
    expect((stored as Record<string, unknown>).zone_id_id).toBeUndefined();
  });

  it('marker without zone_id (free marker) creates cleanly', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('marker', {
      id: 'free-mk',
      name: 'standalone',
      map_id: 'map-A',
      x: 0,
      y: 0,
    });

    const stored = state.get('marker')!.get('free-mk')!;
    expect(stored.map_id).toBe('map-A');
    expect((stored as Record<string, unknown>).map_id_id).toBeUndefined();
    expect(stored.zone_id).toBeUndefined();
  });
});

describe('OwClientAdapter — zone write (NOT bypassed)', () => {
  it('zone create converts bare relation arrays to _ids wire shape', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('zone', {
      id: 'z1',
      name: 'Forest',
      supertype: 'polygon',
      // Disk shape uses bare names (per Convention #5 / adapter contract):
      phenomena: ['p1', 'p2'],
      linked_zones: ['z2'],
    });

    const stored = state.get('zone')!.get('z1')!;
    // Server received wire-shape _ids names (prepareRelations did its job).
    expect((stored as Record<string, unknown>).phenomena_ids).toEqual(['p1', 'p2']);
    expect((stored as Record<string, unknown>).linked_zones_ids).toEqual(['z2']);
    // Bare names should NOT have leaked through (prepareRelations strips them).
    expect((stored as Record<string, unknown>).phenomena).toBeUndefined();
    expect((stored as Record<string, unknown>).linked_zones).toBeUndefined();
  });

  it('zone update converts bare relation arrays', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('zone', { id: 'z1', name: 'F', supertype: 'polygon' });
    await adapter.updateElement('zone', 'z1', { populations: ['c1'] });

    const stored = state.get('zone')!.get('z1')!;
    expect((stored as Record<string, unknown>).populations_ids).toEqual(['c1']);
  });
});
