/**
 * Open the right pane's Web on an element (onboarding step 2, #840's C1):
 * the guide's See <name>'s world, and a press on Home's picture.
 *
 *   The Web tab is made the active one (as a press on it would, so it is
 *   remembered with the other tabs), then the element's page opens. On a
 *   narrow window the Web is a drawer: it opens once the page has settled,
 *   since every change of address closes the drawers first.
 *
 *   Nothing is written to the world, and no tab closes.
 *
 *   While the drawer is on its way or open, the guide's `copy` note waits
 *   (`webDrawerHolds`): drawn under a drawer, it would be stamped seen and
 *   never read.
 */

import { getState, patchSlice } from '../core/state';
import { elementHash, navigate } from '../core/router';
import { isDrawerOpen, isNarrow, onNarrowChange, openDrawer } from '../layout/narrow-layout';

let holding: 'opening' | 'open' | null = null;
const released = new Set<() => void>();
let watching = false;
let pendingOnce: ((e: HashChangeEvent) => void) | null = null;

/** The Web's drawer is opening or open on a narrow window, after an `openWebOn`. */
export function webDrawerHolds(): boolean {
  return holding !== null;
}

/** Told when `webDrawerHolds` turns false. */
export function onWebDrawerReleased(fn: () => void): () => void {
  released.add(fn);
  return () => { released.delete(fn); };
}

function release(): void {
  if (holding === null) return;
  holding = null;
  for (const fn of [...released]) fn();
}

function watch(): void {
  if (watching) return;
  watching = true;
  onNarrowChange(() => {
    if (holding === 'open' && !isDrawerOpen('right')) release();
  });
}

export function openWebOn(worldId: string, elementId: string): void {
  const ui = getState().ui;
  const idx = ui.rightTabs.findIndex(t => t.kind === 'context');
  if (idx >= 0 && idx !== ui.rightActiveIndex) patchSlice('ui', { ...ui, rightActiveIndex: idx });
  const target = elementHash(worldId, elementId);
  // A press before the last one's page settled: its listener goes, and its hold with it.
  const owed = pendingOnce !== null;
  if (pendingOnce) { window.removeEventListener('hashchange', pendingOnce); pendingOnce = null; holding = null; }
  if (isNarrow()) {
    watch();
    holding = 'opening';
    // Added before the navigation: `navigate` always fires a hashchange, a
    // synthetic one when the address is already the element's.
    const once = (e: HashChangeEvent): void => {
      window.removeEventListener('hashchange', once);
      pendingOnce = null;
      // A synthetic event (the address did not change) carries no newURL.
      if ((e.newURL || window.location.href).endsWith(target) && isNarrow()) {
        openDrawer('right');
        holding = 'open';
        // The drawer may have been closed again in the same tick.
        if (!isDrawerOpen('right')) release();
      } else {
        release();
      }
    };
    pendingOnce = once;
    window.addEventListener('hashchange', once);
  }
  navigate(target);
  if (owed && holding === null) for (const fn of [...released]) fn();
}

/** Test seam. */
export function resetOpenWebForTests(): void {
  if (pendingOnce) { window.removeEventListener('hashchange', pendingOnce); pendingOnce = null; }
  holding = null;
}
