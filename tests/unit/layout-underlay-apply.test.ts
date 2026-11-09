/**
 * The canvas seam of the layout underlay: a pictureless laid-out Map's background is the flat backdrop and then
 * its ground (the picture at the recipe's rectangle, the zones on it), and its diff key moves when the ground's
 * zones move, so the open tab redraws. A Map with its own picture never gets the underlay.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const storeMock: { getMediaBlob: (id: string) => Promise<Blob | null> } = { getMediaBlob: async () => null };
vi.mock('../../src/core/active-store', () => ({ getActiveStore: () => storeMock }));
vi.stubGlobal('URL', Object.assign(globalThis.URL, { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} }));
import { applyMapBackground, sourceKey } from '../../src/tabs/right/map-tab-backgrounds';
import { patchSlice } from '../../src/core/state';
import type { Element, WorldMap } from '../../src/core/types';
import type { MapTabCacheEntry } from '../../src/tabs/right/map-tab-cache';

const recipe = { method: 'trail-by-place', settings: { ground: { map: 'g', width: 100, height: 50 }, margin: 10 } };
const layout = { id: 'm', type: 'map', name: 'Layout', width: 120, height: 70, x_layout: recipe } as unknown as WorldMap;
const ground = { id: 'g', type: 'map', name: 'Ground', width: 100, height: 50, image_url: 'https://media.example/g.webp' } as unknown as WorldMap;
const river = { id: 'z', type: 'zone', name: 'River', shape: 'line' } as unknown as Element;
const mk = (order: number, x: number, y: number) => ({ id: `k${order}`, type: 'marker', map_id: 'g', zone_id: 'z', order, x, y } as unknown as Element);

function entryWith() {
  const calls: string[] = [];
  const manager = {
    setBackgroundFlat: vi.fn(() => calls.push('flat')),
    setBackgroundImage: vi.fn(() => calls.push('image')),
    addBackgroundUnderlay: vi.fn((..._args: unknown[]) => calls.push('underlay')),
    addBackgroundUnderlayShapes: vi.fn((_shapes: unknown, _color: string) => calls.push('shapes')),
    getMap: () => null,
  };
  const container = document.createElement('div');
  const entry = { manager, container, objectUrls: [] as string[], lastBg: '' } as unknown as MapTabCacheEntry;
  return { entry, manager, calls };
}

describe('the layout underlay on the canvas', () => {
  beforeEach(() => { patchSlice('data', { elements: [layout, ground, river, mk(0, 0, 0), mk(1, 100, 50)] } as never); });

  it('backdrop, then the ground picture at the recipe\'s rectangle, then its zones moved by the margin', async () => {
    const { entry, manager, calls } = entryWith();
    await applyMapBackground(entry, layout, 2000, 2000);
    expect(calls).toEqual(['flat', 'underlay', 'shapes']);
    expect(manager.addBackgroundUnderlay).toHaveBeenCalledWith('https://media.example/g.webp', { x: 10, y: 10 }, { x: 110, y: 60 }, expect.any(Function));
    expect(manager.addBackgroundUnderlayShapes.mock.calls[0][0]).toEqual([{ line: true, points: [{ x: 10, y: 10 }, { x: 110, y: 60 }] }]);
  });

  it('a Map with its own picture keeps it, with no underlay', async () => {
    const { entry, calls } = entryWith();
    await applyMapBackground(entry, { ...layout, image_url: 'https://own.example/a.png' } as WorldMap, 2000, 2000);
    expect(calls).toEqual(['image']);
  });

  it('a slow local ground picture lands nothing once a newer apply began', async () => {
    let release!: (b: Blob) => void;
    const slow = new Promise<Blob>((r) => { release = r; });
    storeMock.getMediaBlob = vi.fn(() => slow);
    const localGround = { ...ground, image_url: '', image_media_id: 'med-1' } as WorldMap;
    patchSlice('data', { elements: [layout, localGround, river, mk(0, 0, 0), mk(1, 100, 50)] } as never);
    const { entry, calls } = entryWith();
    const a = applyMapBackground(entry, layout, 2000, 2000);
    patchSlice('data', { elements: [layout, ground, river, mk(0, 0, 0), mk(1, 100, 50)] } as never);
    await applyMapBackground(entry, layout, 2000, 2000);
    release(new Blob(['x']));
    await a;
    expect(calls).toEqual(['flat', 'flat', 'underlay', 'shapes']);
  });

  it('the key moves when the ground\'s river moves', () => {
    const before = sourceKey(layout);
    patchSlice('data', { elements: [layout, ground, river, mk(0, 0, 0), mk(1, 99, 50)] } as never);
    expect(sourceKey(layout)).not.toBe(before);
  });
});
