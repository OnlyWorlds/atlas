/**
 * What a drop between two squares would write (the home that grows), pure.
 *
 *   The pair's field lives on one of the two, `on`, whichever was dragged:
 *   the field decides, never the direction. A pair is no target when its
 *   field already links the two, or when that field is single and holds any
 *   value (never overwrite, never repeat).
 *
 *   Until the SDK's `dragField` ships, only the holding pairs are offered
 *   (`HOLDS`); every other pair answers null.
 */

import { FIELD_SCHEMA } from '@onlyworlds/sdk';
import { HOLDS, type HoldDef } from './home-grid';
import { linkIdsOf } from './link-ids';

export interface PairWrite {
  /** The element whose field is written. */
  on: string;
  field: string;
  /** The id written into it. */
  target: string;
  single: boolean;
}

interface Side { id: string; type: string; record: Record<string, unknown> }

function isSingle(type: string, field: string): boolean {
  const info = (FIELD_SCHEMA as Record<string, Record<string, { type: string }>>)[type]?.[field];
  return info?.type === 'single_link';
}

/** The id a link field holds, read in every shape another tool may write (a string, a list, `{id}`). */
function idsIn(value: unknown): string[] {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const id = (value as { id?: unknown }).id;
    return typeof id === 'string' && id ? [id] : [];
  }
  return linkIdsOf(value);
}

/** The hold def a pair of types takes, and which of the two carries the field. */
function holdFor(a: Side, b: Side, holds: readonly HoldDef[]): { def: HoldDef; on: Side; other: Side } | null {
  for (const def of holds) {
    const target = (FIELD_SCHEMA as Record<string, Record<string, { target?: string }>>)[def.on]?.[def.field]?.target;
    if (def.on === a.type && target === b.type) return { def, on: a, other: b };
    if (def.on === b.type && target === a.type) return { def, on: b, other: a };
  }
  return null;
}

/** What dropping `a` on `b` (or `b` on `a`) would write, or null when the pair is no target. */
export function pairWrite(a: Side, b: Side, holds: readonly HoldDef[] = HOLDS): PairWrite | null {
  if (a.id === b.id) return null;
  const found = holdFor(a, b, holds);
  if (!found) return null;
  const { def, on, other } = found;
  const single = isSingle(on.type, def.field);
  const now = idsIn(on.record[def.field]);
  if (now.includes(other.id)) return null;
  if (single && (now.length > 0 || isFilledValue(on.record[def.field]))) return null;
  return { on: on.id, field: def.field, target: other.id, single };
}

function isFilledValue(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return false;
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/** The patch a write makes on the `on` element as it is now, or null when it would overwrite or repeat. */
export function patchFor(w: PairWrite, current: Record<string, unknown>): Record<string, unknown> | null {
  const value = current[w.field];
  const now = idsIn(value);
  if (now.includes(w.target)) return null;
  if (w.single) return isFilledValue(value) ? null : { [w.field]: w.target };
  return { [w.field]: [...now, w.target] };
}

/** The patch that takes the write back, while the field still holds what it wrote; null otherwise. */
export function undoPatchFor(w: PairWrite, current: Record<string, unknown>): Record<string, unknown> | null {
  const now = idsIn(current[w.field]);
  if (!now.includes(w.target)) return null;
  if (w.single) return now.length === 1 ? { [w.field]: null } : null;
  return { [w.field]: now.filter(id => id !== w.target) };
}
