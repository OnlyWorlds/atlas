/**
 * Where an element LIVES, and how to open it — ONE answer, shared by every
 * surface that offers a jump.
 *
 * WHY THIS IS IN core/ RATHER THAN INLINED TWICE
 *
 * Most element types are edited in the generic element view, but four kinds
 * own a room of their own: knowledge entries, share pages, writing narratives
 * and maps. A surface that navigates with a bare `elementHash` therefore
 * LOOKS right and silently lands the user in the field editor instead of the
 * room the thing belongs to.
 *
 * That is exactly what the command palette did (S306): Cmd+K is the app's only
 * global jump, and searching for the page you are building, the map you drew
 * or the chapter you are writing dropped you in the generic editor — while the
 * world home, twenty lines away, resolved all four correctly. Two surfaces
 * answering the same question differently is a bug that only appears when you
 * use both, which is why it survived so long.
 *
 * Same shape as `core/element-search.ts`, and for the same reason (S258): when
 * surface A hands work to surface B, the language they share moves to core so
 * they CANNOT diverge, rather than being kept in sync by memory.
 */

import { navigate, elementHash, knowledgeHash, shareHash, writingHash, mapHash } from './router';
import { narrativeKindOf } from './narrative-kind';
import { isWritingNarrative } from '../middle/writing-helpers';
import { openMapTab } from '../tabs/right/map-index-tab';
import type { Element, WorldMap } from './types';

/**
 * The room an element lives in: the hash to navigate to, plus a short label
 * for surfaces that show one ('' = the generic element view).
 */
export function roomOf(el: Element, worldId: string): { hash: string; label: string } {
  if (el.type === 'narrative') {
    // A narrative is one of three different things depending on its shape, and
    // each has its own room. `narrativeKindOf` is the seam.
    const kind = narrativeKindOf(el);
    if (kind === 'knowledge') return { hash: knowledgeHash(worldId, el.id), label: 'knowledge' };
    if (kind === 'page') return { hash: shareHash(worldId, el.id), label: 'share' };
    if (isWritingNarrative(el, worldId)) return { hash: writingHash(worldId, el.id), label: 'writing' };
  }
  if (el.type === 'map') return { hash: mapHash(worldId, el.id), label: 'map' };
  return { hash: elementHash(worldId, el.id), label: '' };
}

/**
 * Open an element on whichever surface owns it.
 *
 * A map needs BOTH halves, and each covers a case the other cannot:
 *
 *   - `openMapTab` because `navigate(mapHash)` alone cannot activate an
 *     already-open BACKGROUND tab (the open path early-returns when the tab
 *     exists), which was Captain's "recent map does nothing" (S265);
 *   - `navigate` because `openMapTab` alone only mutates right-pane state and
 *     leaves the URL untouched, so on any surface where the right pane is
 *     hidden — the writing room's focus and reading modes, a tour before the
 *     `rightpane` capability — the click produces NOTHING observable. The home
 *     desk never hit that (home always shows the right pane), but the command
 *     palette is global and fires from inside the writing editor. Confirmed by
 *     a real run, not by reading: with the navigate removed, the map jump
 *     leaves the URL unchanged and the e2e fails on exactly that assertion.
 *
 * The URL scheme documents `#/w/<worldId>/map/<mapId>` as a map's address, so
 * navigating is the truthful half; the tab activation is the part the route
 * cannot express.
 */
export function openElementTarget(
  el: Element,
  worldId: string,
  opts?: { routeToMap?: boolean },
): void {
  if (el.type === 'map') {
    openMapTab(el as WorldMap);
    // Routing is the CALLER's call, and the two surfaces genuinely differ —
    // named here rather than left to drift:
    //
    //   home's desk (default, no route): the desk sits BESIDE the right pane,
    //   which is always visible there, so the tab appearing is feedback enough.
    //   Pinning the URL to the map would also pin the right pane — an existing
    //   spec caught exactly that (clicking the map-index tab afterwards gets
    //   fought back to the map, S265's re-activation test).
    //
    //   the palette (routeToMap): global, and fires from inside the writing
    //   editor where focus/reading mode hides the right pane entirely. Without
    //   a route change the jump is invisible — verified by a real run, not a
    //   source read.
    if (opts?.routeToMap) navigate(mapHash(worldId, el.id));
    return;
  }
  navigate(roomOf(el, worldId).hash);
}
