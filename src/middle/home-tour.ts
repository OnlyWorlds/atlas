/**
 * The home's onboarding kernel, pure: the core pair, then one next-steps list.
 * Design: `Forge/Notes/2026-10-09-s383-newcomer-flow-design.md` (#127);
 * the core pair since S264 (`Forge/Notes/2026-07-13-s264-tour-design.md`).
 *
 *   The core pair: while a character or a location is missing, their create
 *   cards show highlighted (the only highlighted cards, ever).
 *
 *   The next steps (#127, the Captain's Q2): the home's room cards and the
 *   waypoints were two checklists that did not know each other. Now the
 *   waypoints are the one track, and the home shows the next few, in the
 *   order a world grows. A step is done on this home when its waypoint is
 *   completed (a gesture, once, anywhere) OR this world already holds what
 *   it asks for (a world that came with stories is not asked for one).
 *
 * No step counters, no stored progress: imports, deletes and sync just
 * recompute the truth.
 */

import type { Element, WorldRegistryEntry } from '../core/types';
import type { WaypointId } from '../core/waypoints';
import { isKnowledgeNarrative } from '../core/knowledge';
import { isPageNarrative } from '../core/sharing';
import { isStoryNarrative } from '../core/narrative-kind';

export type CoreType = 'character' | 'location';

/** The core pair's missing members, in order. Empty once both exist. */
export function coreCards(counts: ReadonlyMap<string, number>): CoreType[] {
  return (['character', 'location'] as const).filter(t => (counts.get(t) ?? 0) === 0);
}

/**
 * The order a world grows in, for the home list (first-world and
 * first-element are behind the user by then: the core pair covers them).
 */
export const HOME_STEPS: readonly WaypointId[] = [
  'links',
  'taxonomy',
  'time',
  'story',
  'maps',
  'knowledge',
  'share',
  'keep-copy',
  'ecosystem',
  'import',
  'council',
];

/** How many undone steps the home shows at once. */
export const HOME_STEPS_SHOWN = 3;

/**
 * The steps this world already holds, read from its contents and its entry:
 * a story, a pin, a knowledge entry, a page; a copy outside this browser
 * (a folder world, or a linked one); a world online.
 */
export function worldHolds(
  elements: readonly Element[],
  entry: Pick<WorldRegistryEntry, 'where' | 'api'> | undefined,
): Set<WaypointId> {
  const holds = new Set<WaypointId>();
  for (const el of elements) {
    if (el.type === 'pin') holds.add('maps');
    else if (el.type === 'narrative') {
      if (isKnowledgeNarrative(el)) holds.add('knowledge');
      else if (isPageNarrative(el)) holds.add('share');
      else if (isStoryNarrative(el)) holds.add('story');
    }
  }
  if (entry?.api) holds.add('ecosystem');
  if (entry && (entry.where !== 'browser' || entry.api)) holds.add('keep-copy');
  return holds;
}

/** The next undone steps, in order, at most `limit`. */
export function computeNextSteps(
  completed: ReadonlySet<WaypointId>,
  holds: ReadonlySet<WaypointId>,
  limit = HOME_STEPS_SHOWN,
): WaypointId[] {
  return HOME_STEPS.filter(id => !completed.has(id) && !holds.has(id)).slice(0, limit);
}
