/**
 * Engine pin push — regression coverage.
 *
 * Titus's smoke against `5474990854` surfaced pins not reaching the API
 * after fresh placement. The engine path is verified here: given a pin in the
 * folder with no server baseline, `pushOnce` MUST send it via
 * `adapter.createElement('pin', body)` with wire-shape FKs intact
 * (`map_id`, `element_id`, no `_id_id` mangling).
 *
 * If this test passes but real-world pin push fails, the failure lives
 * upstream (UI requestPushIfLinked, engine attach/pause state) or downstream
 * (server-side rejection on a body field the fake doesn't validate).
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

describe('engine.pushOnce — pin push', () => {
  it('pushes a freshly-placed pin to the server with wire-shape FKs', async () => {
    await client.createElement('map', { id: 'map1', name: 'TestMap', type: 'map' });
    await folder.applyServerRecord('map', { id: 'map1', name: 'TestMap', type: 'map' }, '2026-01-01T00:00:00.001Z');
    await client.createElement('character', { id: 'char1', name: 'Alice', type: 'character' });
    await folder.applyServerRecord('character', { id: 'char1', name: 'Alice', type: 'character' }, '2026-01-01T00:00:00.002Z');

    const pin = await folder.createPin({
      map_id: 'map1',
      element_id: 'char1',
      element_type: 'character',
      x: 100,
      y: 200,
    });
    expect(pin.server_updated_at).toBeUndefined();

    const changed = await folder.listLocallyChangedSince(null);
    expect(changed.find(e => e.id === pin.id)).toBeDefined();

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBeGreaterThanOrEqual(1);
    expect(result.failures).toEqual([]);

    const serverPin = client.__server_get('pin', pin.id);
    expect(serverPin).toBeDefined();
    expect(serverPin!.map_id).toBe('map1');
    expect(serverPin!.element_id).toBe('char1');
    expect(serverPin!.x).toBe(100);
    expect(serverPin!.y).toBe(200);

    const localAfter = await folder.getElement(pin.id);
    expect(localAfter?.server_updated_at).toBeTruthy();
    const stillChanged = await folder.listLocallyChangedSince(null);
    expect(stillChanged.find(e => e.id === pin.id)).toBeUndefined();
  });

  it('pushes new map + new pin in same push with FK chain resolved', async () => {
    await client.createElement('character', { id: 'char1', name: 'Alice', type: 'character' });
    await folder.applyServerRecord('character', { id: 'char1', name: 'Alice', type: 'character' }, '2026-01-01T00:00:00.001Z');

    const map = await folder.createMap({ name: 'FreshMap' });
    const pin = await folder.createPin({
      map_id: map.id,
      element_id: 'char1',
      element_type: 'character',
      x: 50,
      y: 60,
    });

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(2);
    expect(result.failures).toEqual([]);

    const serverPin = client.__server_get('pin', pin.id);
    expect(serverPin).toBeDefined();
    expect(serverPin!.map_id).toBe(map.id);
    expect(serverPin!.element_id).toBe('char1');
  });

  it('self-heals a legacy pin missing element_type on first push', async () => {
    // Legacy pins (placed by older code) live on disk without
    // element_type. The engine resolves it from the referenced element's
    // type, writes it back, then pushes successfully — so users don't have
    // to re-place every pin to recover sync.
    await client.createElement('character', { id: 'char1', name: 'Alice', type: 'character' });
    await folder.applyServerRecord('character', { id: 'char1', name: 'Alice', type: 'character' }, '2026-01-01T00:00:00.001Z');
    await client.createElement('map', { id: 'map1', name: 'TestMap', type: 'map' });
    await folder.applyServerRecord('map', { id: 'map1', name: 'TestMap', type: 'map' }, '2026-01-01T00:00:00.002Z');

    // Pin created the old way — no element_type.
    const pin = await folder.createPin({
      map_id: 'map1',
      element_id: 'char1',
      x: 0,
      y: 0,
    });
    expect(pin.element_type).toBeUndefined();

    const result = await engine.pushOnce();
    // Self-heal kicks in: pushed successfully, no failure.
    expect(result.pushed.creates).toBe(1);
    expect(result.failures).toEqual([]);

    // Local pin now has element_type written back.
    const localAfter = await folder.getElement(pin.id);
    expect(localAfter?.element_type).toBe('character');
    expect(localAfter?.server_updated_at).toBeTruthy();

    // Server has the pin with element_type set.
    const serverPin = client.__server_get('pin', pin.id);
    expect(serverPin?.element_type).toBe('character');
  });

  it('records a failure when pin element_id points at a missing element (cannot heal)', async () => {
    // Defense: if the referenced element has been deleted locally, self-heal
    // can't resolve element_type. Push fails per-element, leaving the bad
    // pin in place for user cleanup. Better than silently corrupting the
    // server with an unsynced ghost pin.
    await client.createElement('map', { id: 'map1', name: 'TestMap', type: 'map' });
    await folder.applyServerRecord('map', { id: 'map1', name: 'TestMap', type: 'map' }, '2026-01-01T00:00:00.001Z');

    const pin = await folder.createPin({
      map_id: 'map1',
      element_id: 'ghost-element',
      x: 0,
      y: 0,
    });

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].element_id).toBe(pin.id);
    expect(result.failures[0].message).toMatch(/element_type/i);
  });

  it('pushes new pin alongside its map in one batch (ids preserved, FK intact)', async () => {
    await client.createElement('character', { id: 'char1', name: 'Alice', type: 'character' });
    await folder.applyServerRecord('character', { id: 'char1', name: 'Alice', type: 'character' }, '2026-01-01T00:00:00.001Z');

    const localMap = await folder.createMap({ name: 'AssignedIdMap' });
    const localMapId = localMap.id;
    await folder.createPin({
      map_id: localMapId,
      element_id: 'char1',
      element_type: 'character',
      x: 10,
      y: 10,
    });

    const result = await engine.pushOnce();
    expect(result.pushed.creates).toBe(2);
    expect(result.failures).toEqual([]);

    const newMapEntry = (await folder.listElements()).find(e => e.name === 'AssignedIdMap')!;
    expect(newMapEntry.id).toBe(localMapId); // ids preserved under v2

    const newPinEntry = (await folder.listElements()).find(e => e.type === 'pin')!;
    expect(newPinEntry.map_id).toBe(localMapId);

    const serverPin = client.__server_get('pin', newPinEntry.id);
    expect(serverPin!.map_id).toBe(localMapId);
  });
});
