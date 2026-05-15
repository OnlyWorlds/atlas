/**
 * Pin-drag autosave regression test (H1).
 *
 * `enablePinDrag` must call `requestPushIfLinked()` after a successful pin
 * update, otherwise dragged pins never reach api-linked servers until some
 * OTHER folder write triggers a debounce push. Parity with map-click + the
 * contextual-create handler in map-tab.ts.
 *
 * Approach: vi.mock the modules map-tab.ts imports for I/O (state, sync-attach,
 * store-getter, manager, etc.) and exercise enablePinDrag with a synthetic
 * marker that captures the `dragend` callback. Invoking the callback proves
 * the wiring; no DOM / Leaflet needed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted; shared spy refs must be declared via vi.hoisted to be
// available inside the mock factories.
const spies = vi.hoisted(() => ({
  requestPushIfLinked: vi.fn(),
  updatePin: vi.fn().mockResolvedValue({}),
  listElements: vi.fn().mockResolvedValue([]),
  patchSlice: vi.fn(),
}));

vi.mock('../../src/sync/sync-attach', () => ({
  requestPushIfLinked: spies.requestPushIfLinked,
  getCurrentSyncEngine: () => null,
  getCurrentSyncWorldId: () => null,
  getCurrentSyncFolder: () => null,
  attachSyncEngine: () => null,
  detachSyncEngine: () => {},
  pullNowAndRefresh: async () => null,
  refreshConflictsCount: async () => {},
}));

vi.mock('../../src/ui/create-world-modal', () => ({
  getActiveStore: () => ({ updatePin: spies.updatePin, listElements: spies.listElements }),
}));

vi.mock('../../src/core/state', () => ({
  getState: () => ({ data: { elements: [] }, ui: {}, active: null }),
  patchSlice: spies.patchSlice,
  subscribe: () => () => {},
}));

vi.mock('../../src/visualization/leaflet-2d/CoordinateUtils', () => ({
  // Mirror real impl: flip y around canvasHeight.
  leafletToStorage: (latlng: { lat: number; lng: number }, h: number) => ({
    x: Math.round(latlng.lng),
    y: Math.round(h - latlng.lat),
  }),
}));

vi.mock('../../src/visualization/leaflet-2d/Leaflet2DManager', () => ({
  Leaflet2DManager: class {},
}));

vi.mock('../../src/tabs/right/pin-visuals', () => ({
  pinVisualFor: () => ({ iconUrl: '' }),
  onPinVisualsReady: () => () => {},
}));

vi.mock('../../src/tabs/right/edge-color', () => ({
  extractEdgeColor: async () => null,
}));

vi.mock('../../src/ui/element-create-modal', () => ({
  ElementCreateModal: class {},
}));

vi.mock('../../src/core/router', () => ({
  navigate: () => {},
  elementHash: () => '',
  onHashChange: () => () => {},
}));

import { enablePinDrag } from '../../src/tabs/right/map-tab';

function makeMarker() {
  const handlers: Record<string, (...args: any[]) => void> = {};
  return {
    handlers,
    dragging: { enable: () => {} },
    options: {},
    on(event: string, cb: (...args: any[]) => void) { handlers[event] = cb; },
    getLatLng() { return { lat: 200, lng: 300 }; },
  };
}

function makeEntry() {
  return {
    mapId: 'm1',
    worldId: 'w1',
    container: document.createElement('div'),
    manager: {
      getConfig: () => ({ canvasHeight: 1000, canvasWidth: 1000 }),
      // Drag handler reads getMap() to compute screen point for the
      // trash-zone hit-test. Returning null short-circuits the check; the
      // drag path falls through to the existing update behavior.
      getMap: () => null,
    } as any,
    objectUrls: [],
    ready: Promise.resolve(),
    tooltip: document.createElement('div'),
    // New: trash drop-zone div the handler toggles via data-active. Not a
    // real Leaflet target for these tests; just satisfies setAttribute calls.
    trashZone: document.createElement('div'),
    lastBg: '',
  };
}

describe('enablePinDrag', () => {
  beforeEach(() => {
    spies.requestPushIfLinked.mockClear();
    spies.updatePin.mockClear();
    spies.listElements.mockClear();
    spies.patchSlice.mockClear();
    spies.updatePin.mockResolvedValue({});
    spies.listElements.mockResolvedValue([]);
  });

  it('calls requestPushIfLinked() after a successful pin drag persist', async () => {
    const marker = makeMarker();
    enablePinDrag(makeEntry() as any, marker, 'pin-1');

    await marker.handlers.dragend({});
    await Promise.resolve();

    expect(spies.updatePin).toHaveBeenCalledWith('pin-1', { x: 300, y: 1000 - 200 });
    expect(spies.patchSlice).toHaveBeenCalledWith('data', expect.objectContaining({ elements: [] }));
    expect(spies.requestPushIfLinked).toHaveBeenCalledTimes(1);
  });

  it('does not call requestPushIfLinked() if updatePin throws', async () => {
    spies.updatePin.mockRejectedValueOnce(new Error('write failed'));
    const marker = makeMarker();
    enablePinDrag(makeEntry() as any, marker, 'pin-2');

    await marker.handlers.dragend({});
    await Promise.resolve();

    expect(spies.updatePin).toHaveBeenCalled();
    expect(spies.requestPushIfLinked).not.toHaveBeenCalled();
  });
});
