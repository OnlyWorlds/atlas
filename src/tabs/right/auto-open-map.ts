/**
 * Auto-open map behavior on element selection.
 *
 * DESIGN_MAPS.md §3.6 — when an element is selected (by sidebar or pin click),
 * decide whether to also open one of its maps on the right pane:
 *
 *   - 0 associated maps → no-op (element-detail shows in middle pane)
 *   - 1 associated map → auto-open it
 *   - ≥2 associated maps → small picker overlay
 *
 * "Associated maps" rules:
 *   - Location element  → maps where `map.location === element.id`
 *   - Other element     → distinct maps that have a pin with
 *                         `pin.element_id === element.id`
 *
 * Lock gate (§3.4): if the currently-active right tab is a locked map tab,
 * auto-open is suppressed entirely. The user-facing behavior is "I'm pinning
 * this map, stop changing it on me." Other map tabs can still be open; only
 * the active one's lock matters here (the user's current focus).
 *
 * For the ≥2 picker default-highlight, sort by descending hierarchy: the
 * highest-numbered (deepest / most-specific) map gets the default focus,
 * matching the "top of stack" mental model.
 */

import type { Element, Pin, WorldMap } from '../../core/types';
import { getState } from '../../core/state';

export interface AssociatedMapsResult {
  /** Maps associated with the element, sorted by hierarchy DESC (highest first). */
  maps: WorldMap[];
  /** True if the active right tab is a locked map (auto-open is suppressed). */
  lockedActive: boolean;
}

/**
 * Pure function: compute the associated maps for an element, plus whether
 * lock blocks auto-open. Doesn't touch state or DOM.
 *
 * `forceUnlock` is for tests that want to ignore the lock-gate while still
 * exercising the association rules.
 */
export function getAssociatedMaps(
  elementId: string,
  elements: readonly Element[],
  activeTabIsLockedMap: boolean,
): AssociatedMapsResult {
  const el = elements.find(e => e.id === elementId);
  if (!el) return { maps: [], lockedActive: activeTabIsLockedMap };

  let candidates: WorldMap[] = [];
  if (el.type === 'location') {
    candidates = elements.filter(
      (m): m is WorldMap => m.type === 'map' && m.location === elementId,
    );
  } else {
    // Find pins for this element; collect their distinct map ids.
    const targetedMapIds = new Set<string>();
    for (const p of elements) {
      if (p.type !== 'pin') continue;
      const pin = p as Pin;
      if (pin.element_id === elementId) targetedMapIds.add(pin.map_id);
    }
    candidates = elements.filter(
      (m): m is WorldMap => m.type === 'map' && targetedMapIds.has(m.id),
    );
  }

  // Sort by hierarchy DESC (highest first) for the picker default-highlight.
  // Tie-break alphabetically for determinism.
  candidates.sort((a, b) => {
    const aH = typeof a.hierarchy === 'number' ? a.hierarchy : 0;
    const bH = typeof b.hierarchy === 'number' ? b.hierarchy : 0;
    if (aH !== bH) return bH - aH; // descending
    return (a.name ?? '').localeCompare(b.name ?? '');
  });

  return { maps: candidates, lockedActive: activeTabIsLockedMap };
}

/**
 * Read live state to determine whether the currently-active right tab is a
 * locked map. Helper for code paths that want to invoke `getAssociatedMaps`
 * from state directly.
 */
export function isActiveMapTabLocked(): boolean {
  const ui = getState().ui;
  const active = ui.rightTabs[ui.rightActiveIndex];
  return !!(active && active.kind === 'map' && active.locked === true);
}

/**
 * For a Location element, gather both direct maps (anchored to this
 * location) and descendant maps (anchored to any location in this
 * location's subtree). Walks `parent_location` chains transitively.
 *
 * Used by the inline element-detail map-presence widget (DESIGN_MAPS.md §3.5).
 *
 * Pure function. Returns two lists, each sorted by hierarchy DESC then alpha.
 */
export interface LocationMapPresence {
  direct: WorldMap[];
  descendants: WorldMap[];
}

export function getLocationMapPresence(
  locationId: string,
  elements: readonly Element[],
): LocationMapPresence {
  // Build a parent → children map for locations.
  const childrenByParent = new Map<string, string[]>();
  for (const e of elements) {
    if (e.type !== 'location') continue;
    const parent = e['parent_location'];
    if (typeof parent === 'string' && parent) {
      const arr = childrenByParent.get(parent) ?? [];
      arr.push(e.id);
      childrenByParent.set(parent, arr);
    }
  }

  // BFS to find descendant location ids. Bounded by visited-set so any
  // pathological cycle in parent_location doesn't infinite-loop.
  const descendantLocIds = new Set<string>();
  const queue: string[] = [...(childrenByParent.get(locationId) ?? [])];
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (descendantLocIds.has(id)) continue;
    descendantLocIds.add(id);
    for (const childId of childrenByParent.get(id) ?? []) {
      queue.push(childId);
    }
  }

  const sortMaps = (arr: WorldMap[]): WorldMap[] => {
    return arr.sort((a, b) => {
      const aH = typeof a.hierarchy === 'number' ? a.hierarchy : 0;
      const bH = typeof b.hierarchy === 'number' ? b.hierarchy : 0;
      if (aH !== bH) return bH - aH; // hierarchy DESC
      return (a.name ?? '').localeCompare(b.name ?? '');
    });
  };

  const direct = sortMaps(
    elements.filter((m): m is WorldMap => m.type === 'map' && m.location === locationId),
  );
  const descendants = sortMaps(
    elements.filter(
      (m): m is WorldMap =>
        m.type === 'map' &&
        typeof m.location === 'string' &&
        descendantLocIds.has(m.location),
    ),
  );

  return { direct, descendants };
}

/**
 * Apply the §3.6 click-through rule against live state. Call this from both
 * pin-click and sidebar-element-click sites after setting selectedElementId.
 *
 *   - active tab is a locked map → no-op
 *   - 0 maps → no-op
 *   - 1 map  → openMapTab
 *   - ≥2 maps → opens MapPickerModal; on pick, openMapTab; on cancel, no-op
 *
 * Caller doesn't need to await. The function is fire-and-forget; map opening
 * is itself a synchronous state patch.
 */
export async function maybeAutoOpenMapFor(elementId: string): Promise<void> {
  if (isActiveMapTabLocked()) return;
  const state = getState();
  const { maps } = getAssociatedMaps(elementId, state.data.elements, false);
  if (maps.length === 0) return;

  // Dynamic imports — avoid cycle with map-index-tab (which itself imports
  // navigate from router) and avoid pulling the picker modal into hot paths
  // that don't need it.
  const { openMapTab } = await import('./map-index-tab');
  if (maps.length === 1) {
    openMapTab(maps[0]);
    return;
  }
  const { pickMapForElement } = await import('../../ui/map-picker-modal');
  const el = state.data.elements.find(e => e.id === elementId);
  const result = await pickMapForElement(maps, el?.name ?? '(this element)');
  if (result) openMapTab(result.map);
}
