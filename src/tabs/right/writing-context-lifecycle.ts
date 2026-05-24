/**
 * Writing-context tab lifecycle.
 *
 * The writing-context tab is ephemeral chrome that only exists while the user
 * is in the writing room. It's anchored leftmost in the right-pane tab bar
 * (just after `map-index`, which is index 0) and tracks whichever narrative
 * the user is currently writing.
 *
 * Lifecycle rules:
 *   - On entering writing mode AND a narrative is selected → insert the tab
 *     at index 1 (right after map-index). If `writing_context_auto_open` is
 *     true (the default), activate the tab on FIRST insertion per session.
 *   - On navigating between narratives within writing mode → update the
 *     existing tab's narrativeId. Don't re-activate (preserve user's tab
 *     choice).
 *   - On leaving writing mode → remove the tab from `rightTabs`. Adjust
 *     activeIndex if the user was viewing it.
 *
 * The tab is never persisted across reloads — handled by
 * right-tabs-persistence (filtered out on save) and registry (filtered on
 * load).
 */

import { getState, patchSlice, type RightTabRef } from '../../core/state';
import { onHashChange, parseHash } from '../../core/router';

let lastSeenInWritingMode = false;

/**
 * Resolve the writing_context_auto_open setting for the active world.
 * Defaults to TRUE when missing — existing worlds get the helpful behavior.
 */
function getAutoOpenSetting(): boolean {
  const state = getState();
  const active = state.active;
  if (!active) return true;
  const entry = state.registry.worlds.find(w => w.id === active.worldId);
  // Explicit false opts out; absent or true → auto-open.
  return entry?.writing_context_auto_open !== false;
}

/** Sync the tab to the current route. Idempotent. */
function syncContextTabToRoute(): void {
  const ui = getState().ui;
  const route = parseHash(window.location.hash);
  const inWriting = route.mode === 'writing';
  const narrativeId = inWriting ? route.narrativeId ?? null : null;
  const existingIndex = ui.rightTabs.findIndex(t => t.kind === 'writing-context');

  if (inWriting && narrativeId) {
    // Need the tab present + pointing at the right narrative.
    if (existingIndex === -1) {
      // Insert at index 1 (after map-index, which is always index 0 by invariant).
      const insertAt = 1;
      const newTab: RightTabRef = { kind: 'writing-context', narrativeId };
      const nextTabs = [...ui.rightTabs];
      nextTabs.splice(insertAt, 0, newTab);
      // Shift activeIndex if it was at or after the insertion point.
      let nextActive = ui.rightActiveIndex;
      if (nextActive >= insertAt) nextActive += 1;
      // Auto-activate on FIRST insertion per writing-mode session.
      const justEnteredWriting = !lastSeenInWritingMode;
      if (justEnteredWriting && getAutoOpenSetting()) {
        nextActive = insertAt;
      }
      patchSlice('ui', {
        ...getState().ui,
        rightTabs: nextTabs,
        rightActiveIndex: nextActive,
      });
    } else {
      // Tab exists. Update its narrativeId if it changed; preserve active index.
      const current = ui.rightTabs[existingIndex];
      if (current.kind === 'writing-context' && current.narrativeId !== narrativeId) {
        const nextTabs = [...ui.rightTabs];
        nextTabs[existingIndex] = { kind: 'writing-context', narrativeId };
        patchSlice('ui', { ...getState().ui, rightTabs: nextTabs });
      }
    }
    lastSeenInWritingMode = true;
  } else {
    // Not in writing mode — remove the tab if present.
    if (existingIndex !== -1) {
      const nextTabs = ui.rightTabs.filter((_t, i) => i !== existingIndex);
      let nextActive = ui.rightActiveIndex;
      if (nextActive === existingIndex) {
        // User was on the context tab — fall back to map-index (index 0
        // post-removal, since context-tab was at index 1).
        nextActive = 0;
      } else if (nextActive > existingIndex) {
        nextActive -= 1;
      }
      patchSlice('ui', {
        ...getState().ui,
        rightTabs: nextTabs,
        rightActiveIndex: Math.max(0, Math.min(nextActive, nextTabs.length - 1)),
      });
    }
    lastSeenInWritingMode = false;
  }
}

/**
 * Install the lifecycle. Listens on hash changes (route in/out of writing
 * mode, narrative switch within writing) and runs an initial sync on boot.
 * Returns a teardown that removes the listener.
 */
export function installWritingContextLifecycle(): () => void {
  const unsubHash = onHashChange(syncContextTabToRoute);
  // Run once on install so the boot route is honored.
  syncContextTabToRoute();
  return unsubHash;
}
