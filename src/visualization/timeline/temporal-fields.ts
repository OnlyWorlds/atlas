/**
 * Temporal field mapping — which date fields each OW element type uses.
 *
 * Verified against `@onlyworlds/sdk` FIELD_SCHEMA (session 223 scout). All
 * fields are stored as `number` widgets on disk; null/undefined → no temporal
 * data for that element.
 *
 * Adapted from `tools/little-element-viewer/src/timeline/temporal-fields.ts`.
 */

export interface TemporalFieldMapping {
  start: string;
  end?: string;
}

/**
 * Coerce a raw temporal field value to a finite number, or null if it isn't a
 * usable date. The SINGLE parse used by BOTH the normalizer and the recipe's
 * `hasStartDate`, so "is this dated?" can never disagree between them (gate
 * finding). Rejects: null/'' · non-number/non-string types (arrays, booleans,
 * objects) · NaN · ±Infinity (an Infinity date would blow out the axis scale).
 * Non-numeric strings ('that winter') → null today → the element is dropped;
 * the future fuzzy bout re-reads the raw field to parse felt dates (a conscious,
 * tested transition — see DESIGN_CHARTS).
 */
export function parseTemporalValue(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** Maps element type keys to their date field names on raw data. */
export const TEMPORAL_TYPE_FIELDS: Record<string, TemporalFieldMapping> = {
  character:   { start: 'birth_date' },
  creature:    { start: 'birth_date' },
  collective:  { start: 'formation_date' },
  construct:   { start: 'start_date', end: 'end_date' },
  event:       { start: 'start_date', end: 'end_date' },
  institution: { start: 'founding_date' },
  location:    { start: 'founding_date' },
  narrative:   { start: 'start_date', end: 'end_date' },
  relation:    { start: 'start_date', end: 'end_date' },
  title:       { start: 'grant_date', end: 'revoke_date' },
  law:         { start: 'date' },
  zone:        { start: 'start_date', end: 'end_date' },
};
