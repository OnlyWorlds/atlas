/**
 * SyncEngine pushPhase: FK constraint failure on CREATE → server-delete routing.
 *
 * Real-OW scenario (Captain hit session 221): atlas pushed a zone, server-side
 * action (zoner / web app / admin) deleted that zone. Atlas still has the zone
 * locally with `server_updated_at` set, so the topo-sort doesn't include it in
 * the CREATE batch. New markers drawn locally reference the orphan zone. Push
 * → server returns 500 with MySQL 1452 FK constraint error → infinite retry
 * loop without intervention.
 *
 * Symmetric with the UPDATE-404 routing (Bout 8 → `sync-engine.pushUpdate404.test.ts`):
 * detect "server lost a related element," queue it for review, fail the
 * dependent CREATE non-fatally so the rest of the round continues.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

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

// Real OW returns this exact shape on a FK-violating marker INSERT (MySQL 1452).
const FK_ERROR_MARKER_ZONE = `API Error 500: Failed to create Marker: (1452, 'Cannot add or update a child row: a foreign key constraint fails (\`onlywords$default\`.\`elements_marker\`, CONSTRAINT \`elements_marker_zone_id_dc772129_fk_elements_zone_id\` FOREIGN KEY (\`zone_id\`) REFERENCES \`elements_zone\` (\`id\`))')`;

describe('SyncEngine pushPhase: FK constraint on CREATE routes peer to server_deletes', () => {
  it('routes the orphan zone (with server_updated_at) to server_deletes when marker CREATE FK-fails', async () => {
    // 1. Zone synced server-side (baseline established).
    const zone = await folder.createElement('zone', { name: 'Vanished zone' });
    await engine.syncNow();
    const zoneAfter = await folder.getElement(zone.id);
    expect(zoneAfter?.server_updated_at).toBeTruthy();

    // 2. Map synced too — its baseline must hold for the marker push to even
    // reach the FK check (otherwise marker's map_id would also FK-fail first).
    const map = await folder.createElement('map', { name: 'Test map' });
    await engine.syncNow();

    // 3. New marker locally — references the zone via zone_id + the map via map_id.
    const marker = await folder.createElement('marker', {
      name: 'orphan marker',
      map_id: map.id,
      zone_id: zone.id,
      x: 100,
      y: 100,
    });

    // 4. Inject the real-OW FK error on this marker's CREATE.
    client.__inject_failure('create', marker.id, FK_ERROR_MARKER_ZONE);

    // 5. Push — marker CREATE fails, engine routes the zone to server_deletes.
    const result = await engine.syncNow();

    // Marker failure recorded with the clearer message (mentions the peer).
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(marker.id);
    expect(result.failures[0].operation).toBe('create');
    expect(result.failures[0].message).toMatch(/zone/i);
    expect(result.failures[0].message).toMatch(/server/i);

    // Zone routed to server_deletes (the user will be prompted to keep+re-push
    // or delete-locally via the existing server-delete review modal).
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(1);
    const queued = (state.server_deletes ?? [])[0];
    expect(queued.id).toBe(zone.id);
    expect(queued.type).toBe('zone');
    expect(queued.name).toBe('Vanished zone');

    // Round did not auth-bail — only this one element failed.
    expect(result.auth_blocked ?? false).toBe(false);
  });

  it('does NOT route to server_deletes if the FK target id is not in the local folder', async () => {
    // Edge case: marker FK-fails referencing an id that atlas doesn't have a
    // local file for (e.g., legacy data, or a zone that was both deleted on
    // the server AND already cleaned up locally). Nothing to route — record
    // a clean failure and move on.
    const map = await folder.createElement('map', { name: 'Map' });
    await engine.syncNow();
    const marker = await folder.createElement('marker', {
      name: 'm',
      map_id: map.id,
      zone_id: 'phantom-zone-id-not-in-folder',
      x: 0,
      y: 0,
    });
    client.__inject_failure('create', marker.id, FK_ERROR_MARKER_ZONE);

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    // Message should still mention the missing peer type, but without the
    // "review in sync panel" suffix (since nothing was routed).
    expect(result.failures[0].message).toMatch(/zone/i);
    expect(result.failures[0].message).not.toMatch(/review/i);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });

  it('non-FK 500 errors still land in plain failures (no FK routing)', async () => {
    const map = await folder.createElement('map', { name: 'M' });
    await engine.syncNow();
    const marker = await folder.createElement('marker', {
      name: 'm',
      map_id: map.id,
      x: 0,
      y: 0,
    });
    // Plain server error — no FK pattern.
    client.__inject_failure('create', marker.id, 'API Error 500: Internal server error');

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toMatch(/500/);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });
});
