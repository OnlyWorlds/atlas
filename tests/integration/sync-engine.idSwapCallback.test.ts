/**
 * SyncEngine onIdSwap callback (Bout 9).
 *
 * When push CREATE produces a server-assigned id that differs from the local
 * one (id-swap path — server enforcing UUID v7 format), the engine fires an
 * onIdSwap callback so the UI can migrate `state.ui.selectedElementId` and
 * the URL hash if they currently point at the pre-swap id. Without this, the
 * user sees "element <old-id> not found in this world" in the middle pane
 * after a successful sync, because the elements cache has been re-keyed but
 * the route still references the old id.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { SyncEngine } from '../../src/sync/sync-engine';

let folder: MockFolderStore;
let client: FakeOwApiClient;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  client = new FakeOwApiClient();
  client.setClock(clock.next);
});

describe('SyncEngine onIdSwap callback', () => {
  it('fires when push CREATE receives a server-assigned id', async () => {
    client.assignServerIds = true; // Simulate real OW UUID v7 enforcement.
    const onIdSwap = vi.fn();
    const engine = new SyncEngine({ folder, client, onIdSwap });

    const local = await folder.createElement('character', { name: 'Reborn' });
    await engine.syncNow();

    expect(onIdSwap).toHaveBeenCalledTimes(1);
    const swap = onIdSwap.mock.calls[0][0];
    expect(swap.old_id).toBe(local.id);
    expect(swap.new_id).not.toBe(local.id);
    expect(swap.type).toBe('character');

    // Verify the local file was actually moved.
    const oldFile = await folder.getElement(local.id);
    expect(oldFile).toBeNull();
    const newFile = await folder.getElement(swap.new_id);
    expect(newFile).not.toBeNull();
    expect(newFile!.name).toBe('Reborn');
  });

  it('does not fire when server keeps the client-provided id', async () => {
    client.assignServerIds = false; // Server preserves client id.
    const onIdSwap = vi.fn();
    const engine = new SyncEngine({ folder, client, onIdSwap });

    await folder.createElement('character', { name: 'KeepMyId' });
    await engine.syncNow();

    expect(onIdSwap).not.toHaveBeenCalled();
  });

  it('does not fire for UPDATEs (id never changes on PATCH)', async () => {
    const onIdSwap = vi.fn();
    const engine = new SyncEngine({ folder, client, onIdSwap });

    // Create + sync — first CREATE keeps the client id (assignServerIds=false).
    const local = await folder.createElement('character', { name: 'Stable' });
    await engine.syncNow();
    expect(onIdSwap).not.toHaveBeenCalled();

    // Local edit + sync — UPDATE doesn't change ids.
    await folder.updateElement(local.id, { description: 'edited' });
    await engine.syncNow();
    expect(onIdSwap).not.toHaveBeenCalled();
  });

  it('fires once per swapped element when many are CREATE-pushed in one round', async () => {
    client.assignServerIds = true;
    const onIdSwap = vi.fn();
    const engine = new SyncEngine({ folder, client, onIdSwap });

    const a = await folder.createElement('character', { name: 'A' });
    const b = await folder.createElement('location', { name: 'B' });
    const c = await folder.createElement('object', { name: 'C' });
    await engine.syncNow();

    expect(onIdSwap).toHaveBeenCalledTimes(3);
    const oldIds = onIdSwap.mock.calls.map((call) => call[0].old_id).sort();
    expect(oldIds).toEqual([a.id, b.id, c.id].sort());
  });
});
