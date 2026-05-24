/**
 * Context tab lifecycle.
 *
 * The context tab is **permanent** — exactly one always exists at index 0 of
 * the right-pane tab list. Anchored leftmost; never auto-activated; never
 * removed by user action (no close button on it).
 *
 * Responsibilities:
 *   - On install, ensure exactly one `context` tab exists at index 0,
 *     prepending it if missing. Shift `rightActiveIndex` accordingly so the
 *     previously-active tab stays visually selected.
 *   - Subscribe to state for defensive re-application: if some other code
 *     path produces a rightTabs array without a context entry, prepend one.
 *     Cheap idempotent check — no thrash since prepending only happens when
 *     the invariant is broken.
 *
 * Behavior changes vs. v1 (writing-context-lifecycle):
 *   - NO auto-open. Right pane preserves whatever tab the user last had.
 *   - NO writing-mode dependency. Tab exists regardless of route.
 *   - NO narrativeId tracking. Subject is derived from the URL by the
 *     orchestrator (context-tab.ts) at render time.
 */

import { getState, patchSlice, subscribe } from '../../core/state';

/** Ensure context is at index 0 in the current rightTabs. Idempotent. */
function ensureContextAtIndexZero(): void {
  const ui = getState().ui;
  const tabs = ui.rightTabs;
  const idx = tabs.findIndex(t => t.kind === 'context');
  if (idx === 0) return; // already correct
  if (idx > 0) {
    // Context exists but not at index 0 — rare (defensive). Move it.
    const next = [...tabs];
    const [ctx] = next.splice(idx, 1);
    next.unshift(ctx);
    let active = ui.rightActiveIndex;
    if (active === idx) active = 0;
    else if (active < idx) active += 1;
    patchSlice('ui', { ...getState().ui, rightTabs: next, rightActiveIndex: active });
    return;
  }
  // Not present — prepend.
  const next = [{ kind: 'context' as const }, ...tabs];
  const active = ui.rightActiveIndex + 1; // everything shifted right by 1
  patchSlice('ui', { ...getState().ui, rightTabs: next, rightActiveIndex: active });
}

/**
 * Install the lifecycle. Runs the invariant once immediately and subscribes
 * to state for defensive re-application. Returns a teardown.
 */
export function installContextTabLifecycle(): () => void {
  ensureContextAtIndexZero();
  const unsub = subscribe(() => {
    const tabs = getState().ui.rightTabs;
    // Cheap pre-check: only run the maintenance if the invariant is broken.
    if (tabs[0]?.kind !== 'context') ensureContextAtIndexZero();
  });
  return unsub;
}
