/**
 * Right-pane tab persistence — localStorage mirror of `ui.rightTabs` and
 * `ui.rightActiveIndex`. Survives page reloads (DESIGN_MAPS.md §5).
 *
 * Save: invoked from a state subscriber on every change to either field.
 *       Debounced via a microtask to coalesce bursts.
 * Load: invoked once on app boot, returns the persisted snapshot or null.
 *
 * Invariants enforced on load:
 *   - At most one `context` tab; if missing, prepended at index 0.
 *   - Legacy `writing-context` entries (ephemeral before session 231) are
 *     dropped silently — context is now permanent and route-driven, so any
 *     persisted narrativeId is meaningless.
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
    // Filter to known kinds. Legacy 'writing-context' entries are dropped:
    // the new context tab is permanent + route-driven, narrativeId on the
    // ref is no longer meaningful.
    const tabs = parsed.tabs.filter((t): t is RightTabRef => {
      if (!t || typeof t !== 'object') return false;
      if (t.kind === 'context') return true;
      if (t.kind === 'map-index') return true;
      return (
        t.kind === 'map' &&
        typeof (t as { mapId?: unknown }).mapId === 'string' &&
        typeof (t as { label?: unknown }).label === 'string'
      );
    });
    // Track how many entries were dropped at or before the active index so
    // we can shift it left accordingly.
    let droppedBeforeActive = 0;
    for (let i = 0; i <= parsed.activeIndex && i < parsed.tabs.length; i++) {
      const t = parsed.tabs[i];
      if (!t || typeof t !== 'object') { droppedBeforeActive++; continue; }
      if (t.kind === 'context' || t.kind === 'map-index') continue;
      if (t.kind === 'map' && typeof (t as { mapId?: unknown }).mapId === 'string') continue;
      droppedBeforeActive++;
    }

    // Ensure invariants: map-index present, context at index 0.
    let next = tabs;
    if (!next.some(t => t.kind === 'map-index')) {
      next = [{ kind: 'map-index' }, ...next];
    }
    const ctxIdx = next.findIndex(t => t.kind === 'context');
    if (ctxIdx === -1) {
      next = [{ kind: 'context' }, ...next];
    } else if (ctxIdx !== 0) {
      // Move context to index 0.
      const ctx = next[ctxIdx];
      next = [ctx, ...next.filter((_, i) => i !== ctxIdx)];
    }
    if (next.length === 0) return null;

    // Adjust activeIndex through (a) the drop-shift then (b) any context
    // prepend. The prepend always shifts everything right by 1 unless the
    // context tab existed already.
    let activeIndex = parsed.activeIndex - droppedBeforeActive;
    const prepended = ctxIdx === -1;
    if (prepended) activeIndex += 1;
    activeIndex = Math.max(0, Math.min(activeIndex, next.length - 1));
    return { tabs: next, activeIndex };
  } catch (err) {
    console.warn('[right-tabs-persistence] load failed:', err);
    return null;
  }
}

/**
 * Drop every persisted map tab belonging to one world, adjusting the active
 * index for what was removed. Idempotent.
 *
 * For worlds that are DELETED rather than switched away from (the guided
 * tour's teardown — the residue contract): a tab pointing at a world that no
 * longer exists renders as the stale-map pane on the next world the user
 * opens, which for a tour-finisher is a ghost "Hyperion" tab on the first
 * world they make. Ordinary world switches must NOT use this — tabs persist
 * across switches by design (DESIGN_MAPS.md §5).
 *
 * Writes localStorage directly rather than leaning on the render-time
 * persist: right-pane returns early when there is no active world, which is
 * exactly the state teardown leaves behind, so the subscriber never fires.
 */
export function dropPersistedTabsForWorld(worldId: string): void {
  try {
    const snapshot = loadPersistedRightTabs();
    if (!snapshot) return;
    const doomed = (t: RightTabRef): boolean =>
      t.kind === 'map' && t.worldId === worldId;
    if (!snapshot.tabs.some(doomed)) return;
    let droppedBeforeActive = 0;
    for (let i = 0; i <= snapshot.activeIndex && i < snapshot.tabs.length; i++) {
      if (doomed(snapshot.tabs[i])) droppedBeforeActive++;
    }
    const tabs = snapshot.tabs.filter(t => !doomed(t));
    const activeIndex = Math.max(0, Math.min(
      snapshot.activeIndex - droppedBeforeActive,
      tabs.length - 1,
    ));
    savePersistedRightTabs(tabs, activeIndex);
  } catch (err) {
    console.warn('[right-tabs-persistence] world prune failed:', err);
  }
}

/**
 * The re-key (S363) moves ids; stored state follows. Rewrites the `mapId` of
 * persisted map tabs of one world (a tab with no worldId is legacy and
 * follows too; map ids are uuids). Raw read/write so nothing else in the
 * snapshot is normalised. No-op when nothing matches.
 */
export function remapPersistedTabs(worldId: string, map: ReadonlyMap<string, string>): void {
  try {
    const raw = localStorage.getItem(RIGHT_TABS_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PersistedRightTabs> | null;
    if (!parsed || !Array.isArray(parsed.tabs)) return;
    let changed = false;
    const tabs = parsed.tabs.map(t => {
      if (!t || typeof t !== 'object' || t.kind !== 'map') return t;
      if (t.worldId !== undefined && t.worldId !== worldId) return t;
      const next = typeof t.mapId === 'string' ? map.get(t.mapId) : undefined;
      if (next === undefined) return t;
      changed = true;
      return { ...t, mapId: next };
    });
    if (!changed) return;
    localStorage.setItem(RIGHT_TABS_STORAGE_KEY, JSON.stringify({ ...parsed, tabs }));
  } catch (err) {
    console.warn('[right-tabs-persistence] remap failed:', err);
  }
}

/** Save the snapshot to localStorage. Idempotent; safe to spam. */
export function savePersistedRightTabs(tabs: readonly RightTabRef[], activeIndex: number): void {
  try {
    // Context is permanent now — persist as-is. No more stripping.
    const payload: PersistedRightTabs = {
      tabs: [...tabs],
      activeIndex,
    };
    localStorage.setItem(RIGHT_TABS_STORAGE_KEY, JSON.stringify(payload));
  } catch (err) {
    console.warn('[right-tabs-persistence] save failed:', err);
  }
}
