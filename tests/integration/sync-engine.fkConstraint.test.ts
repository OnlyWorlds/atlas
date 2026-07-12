/**
 * SyncEngine pushPhase: dangling-link failure → server-delete routing.
 *
 * Scenario (Captain hit the v1 ancestor in session 221): atlas pushed a zone,
 * server-side action (web app / admin / another atlas) deleted that zone.
 * Atlas still has the zone locally with `server_updated_at` set, so it isn't
 * in the CREATE batch. New markers drawn locally reference the orphan zone.
 * Push → keel returns an honest 400 `invalid_link` → without routing, an
 * infinite retry loop.
 *
 * Keel v2 error shape (probed live 2026-07-12, Notes/2026-07-12-v2-probed-facts.md):
 *   400 {error:{code:"invalid_link", param:"<field>",
 *        message:"<field> references <Type> '<id>' which does not exist."}}
 * The dangling id comes from the MESSAGE (gate 10.4) — no body lookup. The
 * legacy-fallback parse path (plain Error, message-only) is what the fakes
 * exercise here.
 *
 * Symmetric with the UPDATE-404 routing (`sync-engine.pushUpdate404.test.ts`):
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

/** Keel v2 dangling-link message for a marker whose zone vanished server-side. */
const fkErrorForZone = (zoneId: string) =>
  `API Error 400: zone references Zone '${zoneId}' which does not exist.`;

describe('SyncEngine pushPhase: dangling link on CREATE routes peer to server_deletes', () => {
  it('routes the orphan zone (with server_updated_at) to server_deletes when marker CREATE fails invalid_link', async () => {
    // 1. Zone synced server-side (baseline established).
    const zone = await folder.createElement('zone', { name: 'Vanished zone' });
    await engine.syncNow();
    const zoneAfter = await folder.getElement(zone.id);
    expect(zoneAfter?.server_updated_at).toBeTruthy();

    // 2. Map synced too — its baseline must hold for the marker push to even
    // reach the link check (otherwise marker's map_id would also fail first).
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

    // 4. Inject the keel invalid_link error on this marker's CREATE.
    client.__inject_failure('create', marker.id, fkErrorForZone(zone.id));

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

  it('routes the orphan peer on UPDATE dangling-link failures too (keel enforces links on every write)', async () => {
    // A character AND its friend are both synced; the friend is then deleted
    // server-side; a local edit to the character (whose body still carries the
    // friend link) PATCHes and keel rejects with invalid_link. v1 silently
    // dropped dangling multi-links so this class was CREATE-only historically.
    const friend = await folder.createElement('character', { name: 'Vanished friend' });
    const hero = await folder.createElement('character', { name: 'Hero', friends: [friend.id] });
    await engine.syncNow();

    await folder.updateElement(hero.id, { description: 'edited locally' });
    client.__inject_failure('update', hero.id, `API Error 400: friends references Character '${friend.id}' which does not exist.`);

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(hero.id);
    expect(result.failures[0].operation).toBe('update');
    expect(result.failures[0].message).toMatch(/review in sync panel/i);

    const state = await folder.readSyncState();
    expect((state.server_deletes ?? []).map(d => d.id)).toContain(friend.id);
  });

  it('does NOT route to server_deletes if the dangling id is not in the local folder', async () => {
    // Edge case: marker fails referencing an id that atlas doesn't have a
    // local file for (e.g., legacy data, or a zone that was both deleted on
    // the server AND already cleaned up locally). Nothing to route — record
    // a clean failure and move on.
    const phantomId = '00000000-0000-4000-8000-00000000dead';
    const map = await folder.createElement('map', { name: 'Map' });
    await engine.syncNow();
    const marker = await folder.createElement('marker', {
      name: 'm',
      map_id: map.id,
      zone_id: phantomId,
      x: 0,
      y: 0,
    });
    client.__inject_failure('create', marker.id, fkErrorForZone(phantomId));

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    // Message should still mention the missing peer type, but without the
    // "review in sync panel" suffix (since nothing was routed).
    expect(result.failures[0].message).toMatch(/zone/i);
    expect(result.failures[0].message).not.toMatch(/review/i);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });

  it('non-link 500 errors still land in plain failures (no routing)', async () => {
    const map = await folder.createElement('map', { name: 'M' });
    await engine.syncNow();
    const marker = await folder.createElement('marker', {
      name: 'm',
      map_id: map.id,
      x: 0,
      y: 0,
    });
    // Plain server error — no invalid_link pattern.
    client.__inject_failure('create', marker.id, 'API Error 500: Internal server error');

    const result = await engine.syncNow();
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].message).toMatch(/500/);
    const state = await folder.readSyncState();
    expect(state.server_deletes ?? []).toHaveLength(0);
  });
});
