/**
 * Right-pane tab persistence — localStorage mirror of `ui.rightTabs` and
 * `ui.rightActiveIndex`. Survives page reloads (DESIGN_MAPS.md §5).
 *
 * Save: invoked from a state subscriber on every change to either field.
 *       Debounced via a microtask to coalesce bursts.
 * Load: invoked once on app boot, returns the persisted snapshot or null.
 *
 * Cleanup: tabs whose mapId no longer exists in any world's data render as
 * stale via the existing right-pane stale-tab treatment — no eager pruning
 * here.
 */

import { RIGHT_TABS_STORAGE_KEY } from '../../core/constants';
import type { RightTabRef } from '../../core/types';

export interface PersistedRightTabs {
  tabs: RightTabRef[];
  activeIndex: number;
}

/** Load the persisted snapshot. Defensive against corrupted localStorage. */
export function loadPersistedRightTabs(): PersistedRightTabs | null {
  try {
    const raw = localStorage.getItem(RIGHT_TABS_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedRightTabs>;
    if (!parsed || !Array.isArray(parsed.tabs)) return null;
    if (typeof parsed.activeIndex !== 'number') return null;
    // Filter malformed tab entries — single tab dropping shouldn't break boot.
    const tabs = parsed.tabs.filter((t): t is RightTabRef => {
      if (!t || typeof t !== 'object') return false;
      if (t.kind === 'map-index') return true;
      return (
        t.kind === 'map' &&
        typeof (t as { mapId?: unknown }).mapId === 'string' &&
        typeof (t as { label?: unknown }).label === 'string'
      );
    });
    if (tabs.length === 0) return null;
    // Ensure map-index is first (invariant: always present). If missing,
    // prepend; if elsewhere, leave alone (legacy data).
    if (!tabs.some(t => t.kind === 'map-index')) {
      tabs.unshift({ kind: 'map-index' });
    }
    const activeIndex = Math.max(0, Math.min(parsed.activeIndex, tabs.length - 1));
    return { tabs, activeIndex };
  } catch (err) {
    console.warn('[right-tabs-persistence] load failed:', err);
    return null;
  }
}

/** Save the snapshot to localStorage. Idempotent; safe to spam. */
export function savePersistedRightTabs(tabs: readonly RightTabRef[], activeIndex: number): void {
  try {
    // Writing-context tabs are ephemeral — never persisted. Strip before save
    // so a reload comes back without a stale context tab. Active index adjusts
    // accordingly to avoid pointing past the end.
    const filtered = tabs.filter(t => t.kind !== 'writing-context');
    let adjustedIndex = activeIndex;
    if (filtered.length !== tabs.length) {
      // Count writing-context tabs at or before the active index so we shift
      // the active index left by that many.
      const droppedBeforeActive = tabs
        .slice(0, activeIndex + 1)
        .filter(t => t.kind === 'writing-context').length;
      adjustedIndex = Math.max(0, Math.min(activeIndex - droppedBeforeActive, filtered.length - 1));
    }
    const payload: PersistedRightTabs = {
      tabs: filtered,
      activeIndex: adjustedIndex,
    };
    localStorage.setItem(RIGHT_TABS_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[right-tabs-persistence] save failed:', err);
  }
}
