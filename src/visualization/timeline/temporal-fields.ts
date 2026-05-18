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
