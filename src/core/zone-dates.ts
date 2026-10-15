/**
 * Date-keyed zones (#280): which zones a map shows as of a chosen date.
 *
 * A Zone's `start_date` and `end_date` are its validity. A border with eras is
 * several Zones, one per era, chained by `linked_zones`; moving the date swaps
 * which era draws. The span is half-open, `[start, end)`, the standard's rule
 * (Skeld ruled it for every dated type, h57 #5063; Windrose reads it the
 * same), so two eras that meet at a date never both draw there. (The charts'
 * `rangeVsNow` agrees at the end, a span ending AT the now is past, but calls a
 * span starting AT the now future: a seam for its forward half, not a
 * question of whether the thing exists.) A missing date is an open side; a zone with
 * neither always shows. A zone whose end is not after its start shows at its
 * start date only, so a dated zone is never invisible at every date.
 *
 * Pure: the map tab reads the chosen date and the world's now, this decides.
 */

import { parseTemporalValue } from '../visualization/timeline/temporal-fields';

export interface ZoneSpan {
  start: number | null;
  end: number | null;
}

/** A zone's dates as numbers, through the charts' one parse (a numeric string counts; other text reads as no date). */
export function zoneSpan(zone: object): ZoneSpan {
  const z = zone as { start_date?: unknown; end_date?: unknown };
  return { start: parseTemporalValue(z.start_date), end: parseTemporalValue(z.end_date) };
}

export function isDatedZone(zone: object): boolean {
  const s = zoneSpan(zone);
  return s.start !== null || s.end !== null;
}

/** Whether a zone draws at `date`; a null date (All dates) shows every zone. */
export function zoneShownAt(zone: object, date: number | null): boolean {
  if (date === null) return true;
  const { start, end } = zoneSpan(zone);
  if (start !== null && date < start) return false;
  if (end === null) return true;
  if (date < end) return true;
  return start !== null && end <= start && date === start;
}

/**
 * The slider's reach: every start and end among the zones, widened to the
 * world's now when there is one. Null when no zone is dated.
 */
export function zoneDateRange(zones: readonly object[], now: number | null): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const z of zones) {
    const { start, end } = zoneSpan(z);
    for (const d of [start, end]) {
      if (d === null) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
  }
  if (min === Infinity) return null;
  if (now !== null && Number.isFinite(now)) {
    min = Math.min(min, now);
    max = Math.max(max, now);
  }
  return { min: Math.floor(min), max: Math.ceil(max) };
}

/**
 * What the map's date bar is set to: the world's now (the default, which
 * follows the now when it moves), a date the slider chose, or every date.
 */
export type ZoneDateChoice = { kind: 'now' } | { kind: 'date'; value: number } | { kind: 'all' };

/** The date zones are filtered by; null = every zone shows (All dates, or "now" with no now set). */
export function effectiveZoneDate(choice: ZoneDateChoice, now: number | null): number | null {
  if (choice.kind === 'all') return null;
  if (choice.kind === 'date') return choice.value;
  return now !== null && Number.isFinite(now) ? now : null;
}
