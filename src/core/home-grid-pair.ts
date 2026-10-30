/**
 * What a drop between two squares would write (the home that grows), pure.
 *
 *   The pair's field comes from the SDK's `dragField` (the distribution's
 *   pairs table): it names the type that carries the field, `on`, whichever
 *   was dragged: the field decides, never the direction. A pair the table
 *   leaves out is no target. A pair is no target either when its field
 *   already links the two, or when that field is single and holds any value
 *   (never overwrite, never repeat).
 *
 *   A list write adds the target at the end of the value as it is, every
 *   other entry kept as written; Undo removes only the entry it wrote.
 */

import { FIELD_SCHEMA, dragField } from '@onlyworlds/sdk';
import { linkIdsOf } from './link-ids';

export interface PairWrite {
  /** The element whose field is written. */
  on: string;
  field: string;
  /** The id written into it. */
  target: string;
  single: boolean;
  /** One square stands under the other (the table's `holds`); else the write draws a line. */
  holds: boolean;
}

interface Side { id: string; type: string; record: Record<string, unknown> }

/** A link field's kind from the schema: `single_link`, `multi_link`, or undefined. */
export function linkKind(type: string, field: string): string | undefined {
  return (FIELD_SCHEMA as Record<string, Record<string, { type: string }>>)[type]?.[field]?.type;
}

/** The id a link field holds, read in every shape another tool may write (a string, a list, `{id}`). */
function idsIn(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && id ? [id] : [];
  }
  return linkIdsOf(value);
}

/** What dropping `a` on `b` (or `b` on `a`) would write, or null when the pair is no target. */
export function pairWrite(a: Side, b: Side): PairWrite | null {
  if (a.id === b.id) return null;
  const row = dragField(a.type, b.type);
  if (!row) return null;
  const on = row.on === a.type ? a : row.on === b.type ? b : null;
  if (!on) return null;
  const other = on === a ? b : a;
  const kind = linkKind(on.type, row.field);
  if (kind !== 'single_link' && kind !== 'multi_link') return null;
  const single = kind === 'single_link';
  const now = idsIn(on.record[row.field]);
  if (now.includes(other.id)) return null;
  if (single && (now.length > 0 || isFilledValue(on.record[row.field]))) return null;
  return { on: on.id, field: row.field, target: other.id, single, holds: row.holds };
}

function isFilledValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** The patch a write makes on the `on` element as it is now, or null when it would overwrite or repeat. */
export function patchFor(w: PairWrite, current: Record<string, unknown>): Record<string, unknown> | null {
  const value = current[w.field];
  if (idsIn(value).includes(w.target)) return null;
  if (w.single) return isFilledValue(value) ? null : { [w.field]: w.target };
  // The list as it is, the target added at its end: an `{id, name}` entry stays one.
  return { [w.field]: Array.isArray(value) ? [...value, w.target] : [...idsIn(value), w.target] };
}

/** The patch that takes the write back, while the field still holds what it wrote; null otherwise. */
export function undoPatchFor(w: PairWrite, current: Record<string, unknown>): Record<string, unknown> | null {
  const value = current[w.field];
  if (w.single) return idsIn(value).length === 1 && idsIn(value)[0] === w.target ? { [w.field]: null } : null;
  // Only the entry the write added: the bare id. Every other entry stays as it is.
  if (!Array.isArray(value) || !value.includes(w.target)) return null;
  return { [w.field]: value.filter(e => e !== w.target) };
}
