/**
 * A stored date as the active world's calendar says it: the active lens, as
 * the charts, the element page and home resolve it (one calendar in the world
 * speaks without being chosen). Bare numbers with no calendar, or for a date
 * that is not a whole number. Used by the map's date bar (#280) and Home's
 * dates to check (#281).
 */

import { formatStep } from '@onlyworlds/sdk';
import { getState } from './state';
import { resolveCalendarLens } from './calendar-lens';

/**
 * A formatter with the lens resolved once (resolving scans every element), for
 * a surface that prints many dates at a time.
 */
export function worldDateFormatter(): (n: number) => string {
  const s = getState();
  const worldId = s.active?.worldId;
  const reg = worldId ? s.registry.worlds.find(w => w.id === worldId) : undefined;
  const lens = resolveCalendarLens(s.data.elements, reg?.active_calendar_id, { fallbackToOnly: true });
  return n => (lens && Number.isInteger(n) ? formatStep(lens.config, n) : String(n));
}

export function worldDateText(n: number): string {
  return worldDateFormatter()(n);
}
