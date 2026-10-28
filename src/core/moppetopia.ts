/**
 * Moppetopia, the demo world: one test for "is the open world Moppetopia?",
 * read by Home and by the guide's notes, so the two never disagree.
 *
 * The registry's `demo` flag is the tour's sandbox, never Moppetopia's copy
 * (1.98.0 read the flag alone, so the demo line never showed on Moppetopia,
 * and the notes spoke there until #840's contract gate found it, G2).
 */

import { getState } from './state';

/**
 * Moppetopia's world id on onlyworlds.com (measured 2026-10-09), so a copy
 * already here opens with no connection. Should the demo world ever be
 * remade under a new id, the id the server answers is checked as well.
 */
export const DEMO_WORLD_ID = '0695db52-5433-7332-8000-db7fe10da375';

/** The open world is Moppetopia: its world.json id is the demo world's. */
export function isMoppetopiaOpen(worldId: string): boolean {
  const s = getState();
  return s.active?.worldId === worldId && s.active.meta?.id === DEMO_WORLD_ID;
}
