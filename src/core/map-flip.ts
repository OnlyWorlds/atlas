/**
 * Flip one map's pins and zone points top to bottom.
 *
 * Atlas stored map y top-down until 1.8 while the schema, and every other
 * OnlyWorlds tool, counts from the BOTTOM-left. Titus ruled no migration:
 * old Atlas maps are few. This is the remedy a user reaches for when a map
 * placed in older Atlas shows upside down: `y = height - y` for every pin and
 * marker on the map. It is its own inverse, so pressing it again undoes it.
 *
 * Writes go through the store one element at a time (stamps, per-id chain,
 * sync all apply as for any edit). Pins or markers without a finite y are
 * left alone; the map needs a height (imageless maps carry 2000).
 */

import type { FolderStore } from '../store/folder-store';
import { PlainError } from './plain-error';

export function flippedY(y: number, height: number): number {
  return height - y;
}

export interface MapFlipResult {
  pins: number;
  points: number;
}

export async function flipMapVertically(store: FolderStore, mapId: string): Promise<MapFlipResult> {
  const map = (await store.getElement(mapId)) as unknown as { height?: unknown } | null;
  const height = map && typeof map.height === 'number' ? map.height : NaN;
  if (!Number.isFinite(height) || height <= 0) {
    throw new PlainError('This map has no size yet, so it cannot be flipped. Set an image or reopen it first.');
  }
  const result: MapFlipResult = { pins: 0, points: 0 };
  for (const type of ['pin', 'marker'] as const) {
    const items = await store.listElements(type);
    for (const el of items) {
      const rec = el as unknown as { id: string; map_id?: unknown; y?: unknown };
      if (rec.map_id !== mapId || typeof rec.y !== 'number' || !Number.isFinite(rec.y)) continue;
      await store.updateElement(rec.id, { y: flippedY(rec.y, height) } as never);
      if (type === 'pin') result.pins++; else result.points++;
    }
  }
  return result;
}
