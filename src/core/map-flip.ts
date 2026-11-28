/**
 * Flip one map's pins and zone points top to bottom.
 *
 * Atlas stored map y top-down until 1.8 while the schema, and every other
 * OnlyWorlds tool, counts from the BOTTOM-left. Titus ruled no migration:
 * old Atlas maps are few. This is the remedy a user reaches for when a map
 * placed in older Atlas shows upside down: `y = height - y` for every pin and
 * marker on the map. It is its own inverse for whole positions, so pressing it again undoes it;
 * a position that was not whole is rounded (counted, and the words say so).
 *
 * Writes go through the store one element at a time (stamps, per-id chain,
 * sync all apply as for any edit). Pins or markers without a finite y are
 * left alone; the map needs a height (imageless maps carry 2000).
 */

import type { FolderStore } from '../store/folder-store';
import { PlainError } from './plain-error';

/**
 * Rounded: y is an integer field, and a fractional height or y (another tool's file) would otherwise
 * write a fraction OnlyWorlds stores cut. Whole inputs stay exactly their own inverse.
 */
export function flippedY(y: number, height: number): number {
  return Math.round(height - y);
}

export interface MapFlipResult {
  pins: number;
  points: number;
  /** Positions whose y was not whole: rounded, so a second flip does not bring them back exactly. */
  rounded: number;
}

export async function flipMapVertically(store: FolderStore, mapId: string): Promise<MapFlipResult> {
  const map = (await store.getElement(mapId)) as unknown as { height?: unknown } | null;
  const height = map && typeof map.height === 'number' ? map.height : NaN;
  if (!Number.isFinite(height) || height <= 0) {
    throw new PlainError('This map has no height above 0, so it cannot be flipped. Give it a height on its page first.');
  }
  const result: MapFlipResult = { pins: 0, points: 0, rounded: 0 };
  for (const type of ['pin', 'marker'] as const) {
    const items = await store.listElements(type);
    for (const el of items) {
      const rec = el as unknown as { id: string; map_id?: unknown; y?: unknown };
      if (rec.map_id !== mapId || typeof rec.y !== 'number' || !Number.isFinite(rec.y)) continue;
      // A whole y always comes back whole on a second flip, whatever the height; one that was not never does.
      if (!Number.isInteger(rec.y)) result.rounded++;
      await store.updateElement(rec.id, { y: flippedY(rec.y, height) } as never);
      if (type === 'pin') result.pins++; else result.points++;
    }
  }
  return result;
}
