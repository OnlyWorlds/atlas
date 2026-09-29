/**
 * Per-world @ picker recents — last N element ids the user picked via the
 * mention suggestion. Stored in localStorage keyed by worldId; survives
 * reloads but not lost across world switches.
 *
 * The picker surfaces recents first on empty query so the most-frequently
 * referenced elements bubble up without typing. Once the user types a query,
 * fuzzy match takes over.
 */

const MAX_RECENTS = 8;

function storageKey(worldId: string): string {
  return `atlas_picker_recents_${worldId}`;
}

export function getRecents(worldId: string): string[] {
  if (!worldId) return [];
  try {
    const raw = localStorage.getItem(storageKey(worldId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((s): s is string => typeof s === 'string').slice(0, MAX_RECENTS);
  } catch {
    return [];
  }
}

/** The re-key (S363) moves ids; stored state follows. Order kept, dupes dropped. */
export function remapRecents(worldId: string, map: ReadonlyMap<string, string>): void {
  if (!worldId) return;
  try {
    const current = getRecents(worldId);
    if (!current.some(id => map.has(id))) return;
    const next = [...new Set(current.map(id => map.get(id) ?? id))];
    localStorage.setItem(storageKey(worldId), JSON.stringify(next));
  } catch {
    /* private mode / quota — silently ignore */
  }
}

export function pushRecent(worldId: string, elementId: string): void {
  if (!worldId || !elementId) return;
  try {
    const current = getRecents(worldId);
    const filtered = current.filter(id => id !== elementId);
    const next = [elementId, ...filtered].slice(0, MAX_RECENTS);
    localStorage.setItem(storageKey(worldId), JSON.stringify(next));
  } catch {
    /* private mode / quota — silently ignore */
  }
}
