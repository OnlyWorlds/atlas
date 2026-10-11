/**
 * What the tour has shown you, and what it has not — the exit summary's data.
 *
 * DELIBERATELY STORE-FREE AND DOM-FREE, like `tour-view.ts`: a pure function of
 * the step script and a step index, so the answer can be unit-tested without a
 * browser and the module lifts verbatim.
 *
 * WHY THIS EXISTS (Captain, S301): every beat in the reworked tour is gated on
 * a user action, so nobody can click through any more. That is right for
 * engagement and wrong for the person who has seen enough at minute twelve, so
 * the tour carries a permanently visible exit. His refinement was to make that
 * exit do some work: "a nice small modal that, on exit, shows what you've seen,
 * and what you haven't, a confirm screen, for an impression of the app, clearly
 * scoped to rooms." Leaving early should still leave you with a map of the
 * building.
 *
 * SCOPED TO ROOMS, and specifically to the rooms the app's own nav strip shows
 * (`middle/room-nav.ts`). Maps are deliberately NOT listed even though the tour
 * teaches them at length: a map opens in the right pane rather than being a
 * room you travel to, and mixing the two models is exactly the kind of "clear"
 * this screen is supposed to be.
 */

import { TOUR_STEPS } from './tour-data';

export interface TourRoom {
  /** Matches the nav strip's room id, so the two can never drift apart. */
  id: 'home' | 'writing' | 'knowledge' | 'timeline' | 'share' | 'import';
  label: string;
  icon: string;
  /** One line on what the room is for — the "impression of the app" half. */
  blurb: string;
}

/**
 * The six rooms, in nav-strip order. Labels and icons mirror `room-nav.ts`
 * (Charts is `timeline` internally, Pages is `share`, Data is `import` — the
 * ids are the persisted truth and the labels are what users read).
 */
export const TOUR_ROOMS: readonly TourRoom[] = [
  { id: 'home', label: 'Home', icon: 'home',
    blurb: 'Your world at a glance, and everything you have made recently' },
  { id: 'writing', label: 'Writing', icon: 'menu_book',
    blurb: 'Books, chapters and scenes, with every mention linked into the world' },
  { id: 'knowledge', label: 'Knowledge', icon: 'psychology',
    blurb: 'Who knows what, so the reader and the villain can know different things' },
  { id: 'timeline', label: 'Charts', icon: 'insights',
    blurb: 'Your elements arranged in time, saved and shared as named views' },
  { id: 'share', label: 'Pages', icon: 'wall_art',
    blurb: 'Build a page from your world and publish it as a link' },
  { id: 'import', label: 'Data', icon: 'import_export',
    blurb: 'Bring a world in from a file, or take yours out again' },
];

/**
 * Which room a step's route lands the user in.
 *
 * `element` and `elements` both resolve to Home: the element pages live in the
 * middle pane beside the home room rather than in a room of their own, and a
 * summary that invented an "Elements" room would describe an app that does not
 * exist. `map` resolves to Home for the same reason — the map occupies the
 * right pane while the middle stays where it was.
 */
function roomForStep(index: number): TourRoom['id'] | null {
  const route = TOUR_STEPS[index]?.route;
  if (!route) return null;
  switch (route.kind) {
    case 'home':
    case 'elements':
    case 'element':
    case 'map':
      return 'home';
    case 'writing':
      return 'writing';
    case 'chart':
      return 'timeline';
    default:
      return null;
  }
}

export interface TourExitSummary {
  seen: TourRoom[];
  unseen: TourRoom[];
}

/**
 * The rooms visited at or before `stepIndex`, and the ones still unopened.
 *
 * Counts a room as SEEN only once a step has actually routed there — the tour
 * unlocking a room's icon is a promise, not a visit, and telling someone they
 * have seen the Charts room while they are standing three steps short of it
 * would be the screen lying on the way out.
 */
export function tourExitSummary(stepIndex: number): TourExitSummary {
  const seenIds = new Set<TourRoom['id']>();
  const last = Math.min(Math.max(stepIndex, 0), TOUR_STEPS.length - 1);
  for (let i = 0; i <= last; i++) {
    const room = roomForStep(i);
    if (room) seenIds.add(room);
  }
  return {
    seen: TOUR_ROOMS.filter(r => seenIds.has(r.id)),
    unseen: TOUR_ROOMS.filter(r => !seenIds.has(r.id)),
  };
}
