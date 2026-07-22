/**
 * The store-level wall for ONE ELEMENT, ONE PIN, ONE MAP (S307).
 *
 * Guarded at `createElement`, NOT at `createPin`: four UI paths funnel
 * through `createPin`, but the import applier calls `createElement('pin', …)`
 * directly, so a guard in the wrapper would have looked correct and silently
 * let import duplicate pins. The test below drives BOTH doors for that
 * reason — it is the whole point of where the guard lives.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let folder: MockFolderStore;

beforeEach(async () => {
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null);
  await folder.createElement('character', { id: 'char-1', name: 'Alice' });
  await folder.createMap({ id: 'map-1', name: 'Atlas' });
  await folder.createMap({ id: 'map-2', name: 'The Inn' });
});

describe('pin uniqueness at the store boundary', () => {
  it('rejects a second pin for the same element on the same map', async () => {
    await folder.createPin({ element_id: 'char-1', map_id: 'map-1', x: 0, y: 0 });
    await expect(
      folder.createPin({ element_id: 'char-1', map_id: 'map-1', x: 50, y: 50 }),
    ).rejects.toThrow(/already has a pin on this map/);
  });

  it('rejects the duplicate through the IMPORT door too (createElement directly)', async () => {
    // The path that bypasses `createPin`. If the guard ever moves into the
    // wrapper, this is the test that fails.
    await folder.createElement('pin', { element_id: 'char-1', map_id: 'map-1', x: 0, y: 0 });
    await expect(
      folder.createElement('pin', { element_id: 'char-1', map_id: 'map-1', x: 9, y: 9 }),
    ).rejects.toThrow(/already has a pin on this map/);
  });

  it('allows the same element on a second map', async () => {
    await folder.createPin({ element_id: 'char-1', map_id: 'map-1', x: 0, y: 0 });
    const second = await folder.createPin({ element_id: 'char-1', map_id: 'map-2', x: 0, y: 0 });
    expect(second.id).toBeTruthy();
    const all = await folder.listElements();
    expect(all.filter(e => e.type === 'pin')).toHaveLength(2);
  });

  it('leaves the first pin intact when the duplicate is refused', async () => {
    const first = await folder.createPin({ element_id: 'char-1', map_id: 'map-1', x: 7, y: 7 });
    await folder.createPin({ element_id: 'char-1', map_id: 'map-1', x: 99, y: 99 }).catch(() => {});
    const kept = await folder.getElement(first.id);
    expect(kept).toMatchObject({ x: 7, y: 7 });
  });
});
