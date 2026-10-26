/**
 * Which pane a tour step points at, so a narrow window can show it.
 *
 * Below 1100px the right pane is a drawer, below 820px the sidebar too
 * (`layout/narrow-layout.ts`). The tour was written for the desktop shell:
 * step 1 says "click the icon in the top left" and the map beats say "the map
 * pane", and in a narrow window both sat in CLOSED drawers, so the tour
 * stopped at step 1 (phones) or at the pin beat (a 1366 laptop at 125%
 * scaling is ~1093px wide). Measured on live 1.11 and on 1.12.
 *
 * Pure: a function of the step and whether its gesture is done. The bar
 * applies the answer only when it CHANGES, so a user who closes a drawer by
 * hand is not fought on every render.
 */
import type { TourStep } from './tour-data';
import { closeDrawers, isNarrow, isNarrowSidebar, openDrawer } from '../layout/narrow-layout';

export type TourPane = 'sidebar' | 'right' | null;

export function tourPaneFor(step: TourStep, handsOnDone: boolean, createsDone: boolean): TourPane {
  // The create beats point at controls in the sidebar: the worlds sidebar's
  // "create local world" icon, the + above the element list.
  if ((step.handsOn === 'create-world' || step.handsOn === 'create-consul') && !handsOnDone) return 'sidebar';
  if (step.creates && !createsDone) return 'sidebar';
  // The pin beat starts at the element's own +pin in the middle pane; arming
  // it opens the map drawer by itself (main.ts placement watcher). Once the
  // pin is down the beat is about the map (the drag onto the swamps).
  if (step.handsOn === 'place-pin') return handsOnDone ? 'right' : null;
  if (step.route?.kind === 'map') return 'right';
  if (step.route?.kind === 'elements') return 'sidebar';
  return null;
}

/** Show `pane` if it is a drawer at this width; otherwise make sure no drawer covers the middle. */
export function showTourPane(pane: TourPane): void {
  if (!isNarrow()) return;
  if (pane === 'right') { openDrawer('right'); return; }
  if (pane === 'sidebar' && isNarrowSidebar()) { openDrawer('sidebar'); return; }
  closeDrawers();
}
