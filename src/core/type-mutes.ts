/**
 * Muted element types: the sidebar's third filter state.
 *
 * A filter button is off (show all), on (show only these), or MUTED: not
 * shown when showing all, still one click away. Born on Sikelia, where
 * 3,143 markers and 196 pins would otherwise swamp the list of 257 places;
 * pins and markers are muted by default everywhere, since they are map
 * artefacts reached from their map, and they sit in the strip's last two
 * slots so the mute reads as a convention rather than a loss.
 *
 * Per world, in localStorage (a browsing preference, not the world's).
 */

import type { ElementType } from './types';

const KEY = 'atlas_muted_types';

export const DEFAULT_MUTED_TYPES: readonly ElementType[] = ['pin', 'marker'];

/** The strip's tail: always last, in this order. */
export const MUTED_TAIL_TYPES: readonly ElementType[] = ['pin', 'marker'];

function readAll(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) as unknown : null;
    return parsed && typeof parsed === 'object' ? parsed as Record<string, string[]> : {};
  } catch {
    return {};
  }
}

export function loadMutedTypes(worldId: string): Set<ElementType> {
  const all = readAll();
  const saved = all[worldId];
  if (Array.isArray(saved)) return new Set(saved as ElementType[]);
  return new Set(DEFAULT_MUTED_TYPES);
}

export function saveMutedTypes(worldId: string, muted: ReadonlySet<ElementType>): void {
  try {
    const all = readAll();
    all[worldId] = [...muted];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch { /* a blocked localStorage loses the preference, never the world */ }
}
