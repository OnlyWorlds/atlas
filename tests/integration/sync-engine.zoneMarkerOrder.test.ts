/**
 * Reproduces a live error: fresh world, zones + markers
 * created locally, "linked online" → marker push fails with FK constraint
 * pointing at the zone that should have been pushed first.
 *
 * Hypothesis: topo-sort works in isolation, but something in the push flow
 * causes markers to be pushed with stale zone_id (the local v4) when the
 * server has the zone at a different id (server-assigned v7).
 *
 * If this test passes, the bug is elsewhere (e.g. mergeLocalIntoApi path,
 * or stale state from prior session). If it fails, we have a real bug in
 * the engine's push ordering or rewrite propagation.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';

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
  // keel preserves client ids (v2 contract, probed 2026-07-12) — the
  // ordering + FK-resolution intent stands; ids simply never move.
  engine = new SyncEngine({ folder, client });
});

describe('SyncEngine pushPhase: zone+marker CREATE ordering', () => {
  it('marker push succeeds when zone is in the same CREATE batch (ids preserved)', async () => {
    // 1. Build the scenario: fresh local world with one map, one zone,
    //    multiple markers pointing at the zone+map. All never-synced.
    const map = await folder.createElement('map', { name: 'Test map' });
    const zone = await folder.createElement('zone', { name: 'My zone' });
    const m1 = await folder.createElement('marker', {
      name: '',
      map_id: map.id,
      zone_id: zone.id,
      x: 100,
      y: 100,
      order: 0,
    });
    const m2 = await folder.createElement('marker', {
      name: '',
      map_id: map.id,
      zone_id: zone.id,
      x: 200,
      y: 200,
      order: 1,
    });

    // 2. Push. Topo-sort should put map+zone before markers; id-swap should
    //    rewrite marker.{map_id, zone_id} after each parent CREATE.
    const result = await engine.syncNow();

    // 3. All four elements should be on the server, no failures.
    expect(result.failures).toEqual([]);
    expect(result.pushed.creates).toBe(4);

    // 4. Server has zone + map + both markers. Both marker zone_ids point
    //    at the SERVER's zone id (after id-swap), not the original local v4.
    expect(client.__server_count('zone')).toBe(1);
    expect(client.__server_count('map')).toBe(1);
    expect(client.__server_count('marker')).toBe(2);

    // 5. Check the marker bodies that landed server-side. Each must reference
    //    the server-assigned ids (not the original local ones).
    const markerCreateCalls = client.calls.filter(c => c.method === 'create' && c.type === 'marker');
    expect(markerCreateCalls).toHaveLength(2);

    // Get the server's zone + map ids (post-swap).
    const zoneCreateCall = client.calls.find(c => c.method === 'create' && c.type === 'zone');
    const mapCreateCall = client.calls.find(c => c.method === 'create' && c.type === 'map');
    expect(zoneCreateCall).toBeTruthy();
    expect(mapCreateCall).toBeTruthy();

    // Inspect the actual marker bodies sent to the server.
    for (const call of markerCreateCalls) {
      if (call.method !== 'create') continue; // narrow the union
      // After id-swap + rewrite, the body should NOT contain the original
      // v4 zone.id — it should contain the server-assigned v7 id.
      expect(call.body.zone_id).toBe(zone.id); // ids preserved under v2
      expect(call.body.map_id).toBe(map.id);
      // And the ids in the body should be ones the server actually accepted
      // (i.e. exist in the server bucket).
      const zoneRefAlive = client.__server_get('zone', call.body.zone_id as string);
      const mapRefAlive = client.__server_get('map', call.body.map_id as string);
      expect(zoneRefAlive, 'marker.zone_id must reference a zone that exists server-side').toBeDefined();
      expect(mapRefAlive, 'marker.map_id must reference a map that exists server-side').toBeDefined();
    }

    // 6. Local marker files should also have been id-swapped (so the next
    //    push round, or a UI re-render, sees the new ids).
    const localMarkers = await folder.listElements('marker');
    for (const lm of localMarkers) {
      expect((lm as any).zone_id).toBe(zone.id); // ids never move under v2
      expect((lm as any).map_id).toBe(map.id);
    }
    // Original marker ids may have been id-swapped too — find them by name/coords.
    const lm1 = localMarkers.find(m => (m as any).x === 100);
    const lm2 = localMarkers.find(m => (m as any).x === 200);
    expect(lm1).toBeDefined();
    expect(lm2).toBeDefined();
  });

  it('END-TO-END: real SDK + MSW + adapter — zone+marker push (live repro)', async () => {
    // Use the REAL adapter wrapping a real SDK client against MSW. This is
    // the production path Titus's Make-Online Route 1 hits — pushPhase
    // calling adapter.createElement which goes through prepareRelations.
    //
    // The previous tests used FakeOwApiClient directly, bypassing the adapter.
    // If a bug lives in the adapter (e.g. prepareRelations mangling marker
    // FK fields the engine just rewrote), only this test surfaces it.
    const TEST_BASE = 'https://test-ow.local/api/v2';
    const { handlers } = statefulV2Handlers({
      baseUrl: TEST_BASE,
      clock: clock.next,
    });
    mswServer.use(...handlers);

    const adapter = new OwV2ClientAdapter({ apiKey: 'test-key', apiPin: '1234', baseUrl: TEST_BASE });
    const engineE2E = new SyncEngine({ folder, client: adapter });

    // Titus's smoke world shape: a map, a couple of zones, several markers
    // per zone. All never-synced.
    const map = await folder.createElement('map', { name: 'Smoke map' });
    const zoneA = await folder.createElement('zone', { name: 'Zone alpha' });
    const zoneB = await folder.createElement('zone', { name: 'Zone beta' });
    for (let i = 0; i < 3; i++) {
      await folder.createElement('marker', {
        map_id: map.id, zone_id: zoneA.id, x: 100 + i * 10, y: 100, order: i,
      });
    }
    for (let i = 0; i < 2; i++) {
      await folder.createElement('marker', {
        map_id: map.id, zone_id: zoneB.id, x: 200 + i * 10, y: 200, order: i,
      });
    }

    const result = await engineE2E.syncNow();

    // No failures of ANY kind — especially no FK constraint failures.
    expect(result.failures, JSON.stringify(result.failures, null, 2)).toEqual([]);
    expect(result.pushed.creates).toBe(1 + 2 + 5); // map + 2 zones + 5 markers
  });

  it('marker push succeeds even when many zones and markers are interleaved', async () => {
    // Stress the same scenario with multiple zones + markers per zone — what
    // Titus's smoke world looks like after drawing several zones.
    const map = await folder.createElement('map', { name: 'M' });
    const zoneA = await folder.createElement('zone', { name: 'A' });
    const zoneB = await folder.createElement('zone', { name: 'B' });
    const zoneC = await folder.createElement('zone', { name: 'C' });
    for (let i = 0; i < 4; i++) await folder.createElement('marker', { map_id: map.id, zone_id: zoneA.id, x: i, y: 0, order: i });
    for (let i = 0; i < 3; i++) await folder.createElement('marker', { map_id: map.id, zone_id: zoneB.id, x: i, y: 10, order: i });
    for (let i = 0; i < 5; i++) await folder.createElement('marker', { map_id: map.id, zone_id: zoneC.id, x: i, y: 20, order: i });

    const result = await engine.syncNow();
    expect(result.failures, JSON.stringify(result.failures)).toEqual([]);
    expect(client.__server_count('zone')).toBe(3);
    expect(client.__server_count('marker')).toBe(12);
  });
});
