/**
 * A map's written size is answered as written, whatever the number (the map-space reading, 0 included): a first
 * open measures a picture or takes the flat square only for a size that is missing, and draws a size of 0 or below
 * in the picture's measure or the square without writing over it. Each write case is red on 1.124.9's code, which
 * read any size not above 0 as no size and wrote the picture's measure over it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const updateMap = vi.fn(async () => {});
const storeMock = { updateMap, getMediaBlob: async () => null, listElements: async () => [] };
vi.mock('../../src/core/active-store', () => ({ getActiveStore: () => storeMock }));
vi.mock('../../src/core/view-only', () => ({ worldIsViewOnly: () => false }));
vi.mock('../../src/registry/registry', async (orig) => ({ ...(await orig<object>()), findWorld: () => ({ id: 'w' }) }));

// The picture decodes to 40 by 30.
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 40;
  naturalHeight = 30;
  set src(_v: string) { queueMicrotask(() => this.onload?.()); }
}
vi.stubGlobal('Image', FakeImage);

import { applyMapBackground } from '../../src/tabs/right/map-tab-backgrounds';
import { drawnFrame, missingSize, _resetMeasuredForTests } from '../../src/tabs/right/map-frame';
import { mapTabCache } from '../../src/tabs/right/map-tab-cache';
import { patchSlice, getState } from '../../src/core/state';
import type { WorldMap } from '../../src/core/types';
import type { MapTabCacheEntry } from '../../src/tabs/right/map-tab-cache';

const pic = 'https://media.example/p.png';
const map = (extra: Record<string, unknown>) => ({ id: 'm', type: 'map', name: 'M', ...extra }) as unknown as WorldMap;

/** The map as the state holds it (the apply re-reads it after the decode). */
function stage(m: WorldMap): WorldMap {
  patchSlice('data', { ...getState().data, elements: [m] } as never);
  return m;
}

function entryFor(w: number, h: number) {
  const manager = {
    setBackgroundFlat: vi.fn(),
    setBackgroundImage: vi.fn(),
    addBackgroundUnderlay: vi.fn(),
    addBackgroundUnderlayShapes: vi.fn(),
    getMap: () => null,
    getConfig: () => ({ canvasWidth: w, canvasHeight: h }),
  };
  const entry = { worldId: 'w', manager, container: document.createElement('div'), objectUrls: [] as string[], lastBg: '', ready: Promise.resolve() } as unknown as MapTabCacheEntry;
  mapTabCache.set('m', entry);
  return { entry, manager };
}

beforeEach(() => {
  updateMap.mockClear();
  mapTabCache.clear();
  _resetMeasuredForTests();
  patchSlice('active', { ...(getState().active ?? {}), worldId: 'w' } as never);
  patchSlice('data', { elements: [] } as never);
});

describe('the frame a map is drawn in', () => {
  it('a written size above 0 is the frame; otherwise the square per axis', () => {
    expect(drawnFrame(map({ width: 800, height: 600 }))).toEqual({ w: 800, h: 600 });
    expect(drawnFrame(map({ width: -100, height: 500 }))).toEqual({ w: 2000, h: 500 });
    expect(drawnFrame(map({ width: 0, height: 0 }))).toEqual({ w: 2000, h: 2000 });
    expect(drawnFrame(map({}))).toEqual({ w: 2000, h: 2000 });
  });

  it('only a missing size may be filled', () => {
    expect(missingSize(map({ width: -100, height: 500 }), { w: 40, h: 30 })).toEqual({});
    expect(missingSize(map({ width: 0, height: null }), { w: 40, h: 30 })).toEqual({ height: 30 });
    expect(missingSize(map({}), { w: 40, h: 30 })).toEqual({ width: 40, height: 30 });
  });
});

describe('a first open with a picture', () => {
  for (const width of [-100, 0]) {
    it(`width ${width}: the picture draws at its measure and nothing is written`, async () => {
      const m = map({ width, height: 500, image_url: pic });
      const { entry, manager } = entryFor(2000, 500);
      await applyMapBackground(entry, m, 2000, 500);
      expect(manager.setBackgroundImage).toHaveBeenCalledWith(pic, 40, 30, expect.any(Function));
      expect(updateMap).not.toHaveBeenCalled();
      // The measure is the frame from now on, for this session.
      expect(drawnFrame(m)).toEqual({ w: 40, h: 30 });
    });
  }

  it('a missing size takes the picture\'s measure, as before', async () => {
    const m = stage(map({ image_url: pic }));
    const { entry } = entryFor(2000, 2000);
    await applyMapBackground(entry, m, 2000, 2000);
    expect(updateMap).toHaveBeenCalledWith('m', { width: 40, height: 30 });
  });

  it('a written width of 0 beside a missing height: only the height is filled', async () => {
    const m = stage(map({ width: 0, image_url: pic }));
    const { entry } = entryFor(2000, 2000);
    await applyMapBackground(entry, m, 2000, 2000);
    expect(updateMap).toHaveBeenCalledWith('m', { height: 30 });
  });

  it('a size written during the decode is not written over', async () => {
    const m = stage(map({ image_url: pic }));
    const { entry } = entryFor(2000, 2000);
    const opening = applyMapBackground(entry, m, 2000, 2000);
    stage(map({ image_url: pic, width: 800, height: 600 }));
    await opening;
    expect(updateMap).not.toHaveBeenCalled();
  });

  it('a tab disposed during the decode writes nothing', async () => {
    const m = stage(map({ image_url: pic }));
    const { entry } = entryFor(2000, 2000);
    const opening = applyMapBackground(entry, m, 2000, 2000);
    mapTabCache.delete('m');
    await opening;
    expect(updateMap).not.toHaveBeenCalled();
  });
});

describe('what a measure may not do', () => {
  it('a world switched during the decode takes no write meant for the tab\'s own world', async () => {
    const { entry } = entryFor(2000, 2000);
    const opening = applyMapBackground(entry, map({ image_url: pic }), 2000, 2000);
    patchSlice('active', { ...(getState().active ?? {}), worldId: 'other' } as never);
    await opening;
    expect(updateMap).not.toHaveBeenCalled();
  });

  it('a picture that decodes to 0 is no measure: nothing written, the frame unchanged', async () => {
    class ZeroImage extends FakeImage { naturalWidth = 0; naturalHeight = 0; }
    vi.stubGlobal('Image', ZeroImage);
    try {
      const m = map({ image_url: pic });
      const { entry } = entryFor(2000, 2000);
      await applyMapBackground(entry, m, 2000, 2000);
      expect(updateMap).not.toHaveBeenCalled();
      expect(drawnFrame(m)).toEqual({ w: 2000, h: 2000 });
    } finally {
      vi.stubGlobal('Image', FakeImage);
    }
  });
});

describe('a first open with no picture', () => {
  it('a written width of -100 is not written over', async () => {
    const { entry } = entryFor(2000, 500);
    await applyMapBackground(entry, map({ width: -100, height: 500 }), 2000, 500);
    expect(updateMap).not.toHaveBeenCalled();
  });

  it('a missing size takes the square, as before', async () => {
    const { entry } = entryFor(2000, 2000);
    await applyMapBackground(entry, stage(map({})), 2000, 2000);
    expect(updateMap).toHaveBeenCalledWith('m', { width: 2000, height: 2000 });
  });
});
