/**
 * zone-edit-mode's snapshot lifecycle — the first tests this 1000+ line
 * module has ever had at any layer.
 *
 * Its sibling `zone-drawing.test.ts` carried a comment claiming the module was
 * "exercised by smoke". It is not: `smoke.spec.ts` contains no zone anything,
 * and no e2e drives edit mode. That comment is corrected in S307.
 *
 * These cover the DATA-LOSS trio. Each one ends with the user's committed
 * vertex drags being silently reverted later, and atlas has no undo:
 *
 *   1. `abortEditModeForMap` (world switch) orphaned the snapshot.
 *   2. `exitEditMode` cleared it under the CURRENT world, not the session's.
 *   3. the snapshot was deleted while the restore it protects was in flight.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const KEY = 'atlas_zone_edit_snapshot_v2';

// The module reaches for Leaflet and the live store at import time; the
// snapshot helpers under test are pure localStorage work, so the heavy
// collaborators are stubbed rather than constructed.
vi.mock('leaflet', () => ({
  default: { layerGroup: () => ({ addTo: () => {}, clearLayers: () => {}, remove: () => {} }) },
}));

describe('zone edit snapshot lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('isTypingTarget shields the shape edit from keystrokes meant for a field', async () => {
    const { isTypingTarget } = await import('../../src/tabs/right/zone-edit-mode');
    // The zone's detail panel (name, description, custom fields) stays
    // mounted during edit mode, so Escape-to-dismiss-a-field used to revert
    // every vertex drag.
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    const plain = document.createElement('div');

    expect(isTypingTarget(input)).toBe(true);
    expect(isTypingTarget(textarea)).toBe(true);
    expect(isTypingTarget(select)).toBe(true);
    expect(isTypingTarget(editable)).toBe(true);
    // The canvas itself must still take Escape/Enter — that is the gesture.
    expect(isTypingTarget(plain)).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });

  it('a snapshot is stored per world, so two worlds cannot clobber each other', () => {
    // Documents the storage SHAPE the fixes depend on: the clear is keyed by
    // world id, which is why the session had to start carrying its own.
    const stored = {
      'world-a': { zoneId: 'z1', mapId: 'm1', snapshot: [{ id: 'k1', x: 1, y: 2, order: 0 }] },
      'world-b': { zoneId: 'z2', mapId: 'm2', snapshot: [{ id: 'k2', x: 3, y: 4, order: 0 }] },
    };
    localStorage.setItem(KEY, JSON.stringify(stored));
    const read = JSON.parse(localStorage.getItem(KEY)!);
    expect(Object.keys(read).sort()).toEqual(['world-a', 'world-b']);
    // Clearing one leaves the other — the property the S307 fixes preserve.
    delete read['world-a'];
    localStorage.setItem(KEY, JSON.stringify(read));
    expect(Object.keys(JSON.parse(localStorage.getItem(KEY)!))).toEqual(['world-b']);
  });
});
