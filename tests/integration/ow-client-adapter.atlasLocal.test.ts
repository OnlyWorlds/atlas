/**
 * Atlas-local field stripping (regression — Captain session 221 live bug).
 *
 * Atlas-extension fields like `atlas_shape`, `atlas_color`, `atlas_opacity`,
 * `atlas_label_visible`, `image_media_id` live ONLY on local disk; the OW
 * server rejects unknown fields with 400. The adapter's toWireShape MUST
 * strip these before sending.
 *
 * Captain hit this with `atlas_shape: 'polygon'` on zone CREATE. The zone
 * push 400'd silently, then markers FK-failed against the absent server
 * zone (1452 MySQL constraint error). Fakes had been silently accepting
 * unknown fields — the bug only surfaced against live OW.
 *
 * This test goes through OwClientAdapter + MSW (with strict-unknown-fields
 * enforcement) to catch any future atlas-local field that's forgotten in
 * ATLAS_LOCAL_EXTENSION_FIELDS.
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

describe('OwClientAdapter — strips atlas-local fields before write', () => {
  it('zone CREATE strips atlas_shape (Captain session 221 repro)', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    // Caller passes a zone body the way zone-drawing.ts builds it — with
    // atlas_shape locked in. Adapter must strip it; without the strip, MSW's
    // strict-field check 400s.
    await adapter.createElement('zone', {
      id: 'z1',
      name: 'Polygon zone',
      supertype: 'region',
      atlas_shape: 'polygon',
    });

    // Server stored the zone (atlas_shape NOT present on server-side).
    const stored = state.get('zone')?.get('z1');
    expect(stored).toBeDefined();
    expect((stored as Record<string, unknown>).atlas_shape).toBeUndefined();
    expect(stored!.name).toBe('Polygon zone');
  });

  it('zone CREATE strips all atlas-extension fields together', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('zone', {
      id: 'z2',
      name: 'Decorated zone',
      atlas_shape: 'line',
      atlas_color: '#ff0066',
      atlas_opacity: 0.5,
      atlas_label_visible: true,
    });

    const stored = state.get('zone')?.get('z2') as Record<string, unknown>;
    expect(stored.atlas_shape).toBeUndefined();
    expect(stored.atlas_color).toBeUndefined();
    expect(stored.atlas_opacity).toBeUndefined();
    expect(stored.atlas_label_visible).toBeUndefined();
  });

  it('zone UPDATE strips atlas_shape (won\'t re-emit on PATCH)', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('zone', { id: 'z3', name: 'Z' });
    await adapter.updateElement('zone', 'z3', {
      atlas_shape: 'polygon',
      name: 'Z renamed',
    });

    const stored = state.get('zone')?.get('z3') as Record<string, unknown>;
    expect(stored.atlas_shape).toBeUndefined();
    expect(stored.name).toBe('Z renamed');
  });

  it('map CREATE strips image_media_id', async () => {
    const { handlers, state } = statefulOwHandlers({ baseUrl: TEST_BASE, clock: clock.next });
    mswServer.use(...handlers);

    await adapter.createElement('map', {
      id: 'm1',
      name: 'M',
      image_media_id: 'media-xyz',
    });

    const stored = state.get('map')?.get('m1') as Record<string, unknown>;
    expect(stored.image_media_id).toBeUndefined();
  });
});
