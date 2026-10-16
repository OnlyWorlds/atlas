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

import { parseTemporalValue, TEMPORAL_TYPE_FIELDS } from '../visualization/timeline/temporal-fields';

export interface ZoneSpan {
  start: number | null;
  end: number | null;
}

/** A zone's dates as numbers, through the charts' one parse (a numeric string counts; other text reads as no date). */
export function zoneSpan(zone: object): ZoneSpan {
  const z = zone as { start_date?: unknown; end_date?: unknown };
  return { start: parseTemporalValue(z.start_date), end: parseTemporalValue(z.end_date) };
}

/**
 * Any element's span, by the charts' one map of date fields per type
 * (`TEMPORAL_TYPE_FIELDS`): a Character from its birth on, a Location from
 * its founding, an Event from its start to its end, a Title from its grant to
 * its revoke. A type with no date fields has no span, so it always shows (the
 * pins by their element's dates, the Captain's Q11, 2026-10-16).
 */
export function elementSpan(el: object | null | undefined): ZoneSpan {
  const type = (el as { type?: unknown } | null | undefined)?.type;
  // Own keys only: a foreign type named like `toString` is no date mapping.
  const fields = typeof type === 'string' && Object.prototype.hasOwnProperty.call(TEMPORAL_TYPE_FIELDS, type) ? TEMPORAL_TYPE_FIELDS[type] : undefined;
  if (!el || !fields) return { start: null, end: null };
  const raw = el as Record<string, unknown>;
  return {
    start: parseTemporalValue(raw[fields.start]),
    end: fields.end ? parseTemporalValue(raw[fields.end]) : null,
  };
}

export function isDatedSpan(s: ZoneSpan): boolean {
  return s.start !== null || s.end !== null;
}

export function isDatedZone(zone: object): boolean {
  return isDatedSpan(zoneSpan(zone));
}

/**
 * Whether a span shows at `date`, half-open `[start, end)`, the standard's
 * rule for every dated type; a null date (All dates) shows everything.
 */
export function spanShownAt(span: ZoneSpan, date: number | null): boolean {
  if (date === null) return true;
  const { start, end } = span;
  if (start !== null && date < start) return false;
  if (end === null) return true;
  if (date < end) return true;
  return start !== null && end <= start && date === start;
}

/** Whether a zone draws at `date`; a null date (All dates) shows every zone. */
export function zoneShownAt(zone: object, date: number | null): boolean {
  return spanShownAt(zoneSpan(zone), date);
}

/**
 * The slider's reach: every start and end among the zones, widened to the
 * world's now when there is one. Null when no zone is dated.
 */
export function zoneDateRange(zones: readonly object[], now: number | null): { min: number; max: number } | null {
  return spanDateRange(zones.map(zoneSpan), now);
}

/** The reach over any spans (the map's zones and its pins' elements), widened to the now; null when none is dated. */
export function spanDateRange(spans: readonly ZoneSpan[], now: number | null): { min: number; max: number } | null {
  let min = Infinity;
  let max = -Infinity;
  for (const s of spans) {
    const { start, end } = s;
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
