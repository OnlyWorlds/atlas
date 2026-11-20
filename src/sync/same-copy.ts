/**
 * "Same content" for a copy with no record of what OnlyWorlds held (conv. 192).
 *
 * One comparison for every door that meets such a copy (the single create, the
 * `/bulk` check, the pull, Keep this copy): the type's schema fields and the
 * extension keys either side holds, compared as the folder format reads them,
 * so a sparse file and keel's full body of the same content read the same:
 *   - a text: absent, `null` and `""` are one unset value;
 *   - a number: absent and `null`;
 *   - a link: absent, `null` and `""`, and an id in any letter case;
 *   - a list of links: absent and `[]`, each id once, in any letter case;
 *   - an extension key or any other key: absent and `null`;
 *   - an object's keys in any order.
 * Never compared: the stamps, keel's own bookkeeping (`created_at`,
 * `change_seq`, who wrote it, its marks) and Atlas's local-only fields.
 * keel's create-time writes are no difference when the file lacks them (M1):
 * the review mark keel puts on a seat's new element (`x_review_proposed`), and a
 * Narrative's narrator keel fills for a guest or a held seat.
 *
 * Anything else that differs, a value keel coerced included (`"5"` against 5,
 * a number cut to a whole one), is a difference: when the comparison is unsure
 * it says "differs", and that is a review row, never a quiet write.
 */
import { FIELD_SCHEMA } from '@onlyworlds/sdk';
import type { Element, ElementType } from '../core/types';
import { ATLAS_LOCAL_ONLY_FIELDS, SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS } from '../core/constants';
import { PROPOSED_MARK } from '../core/review-mark';
import { relationFieldsFor } from '../editor/field-schema';

type Kind = 'text' | 'number' | 'link' | 'links' | 'other';

/** Fields no copy is compared on: stamps, keel's bookkeeping, Atlas's own. */
const NOT_COMPARED = new Set<string>([
  'id', 'type', 'local_updated_at', 'server_updated_at', 'updated_at', 'created_at', 'change_seq', 'world',
  ...SERVER_AUTHOR_FIELDS, ...SERVER_MARK_FIELDS, ...ATLAS_LOCAL_ONLY_FIELDS,
]);

const kindsCache = new Map<ElementType, Map<string, Kind>>();

/** Each schema field of a type by its disk name, with its kind. */
function kindsOf(type: ElementType): Map<string, Kind> {
  let m = kindsCache.get(type);
  if (m) return m;
  m = new Map();
  const schema = (FIELD_SCHEMA as Record<string, Record<string, { type?: string }>>)[type] ?? {};
  for (const [name, meta] of Object.entries(schema)) {
    if (meta?.type === 'text') m.set(name, 'text');
    else if (meta?.type === 'integer' || meta?.type === 'number' || meta?.type === 'integer_max') m.set(name, 'number');
  }
  for (const rf of relationFieldsFor(type)) m.set(rf.diskField, rf.kind === 'multi' ? 'links' : 'link');
  kindsCache.set(type, m);
  return m;
}

/** The unset value, whatever form it was written in. */
const UNSET = Symbol('unset');

function fold(kind: Kind, v: unknown): unknown {
  if (v === undefined || v === null) return UNSET;
  switch (kind) {
    case 'text':
      return v === '' ? UNSET : v;
    case 'number':
      return v;
    case 'link':
      if (v === '') return UNSET;
      return typeof v === 'string' ? v.toLowerCase() : v;
    case 'links': {
      if (!Array.isArray(v)) return v;
      const seen: unknown[] = [];
      for (const x of v) {
        const id = typeof x === 'string' ? x.toLowerCase() : x;
        if (!seen.some(s => sameValue(s, id))) seen.push(id);
      }
      return seen.length === 0 ? UNSET : seen;
    }
    default:
      return v;
  }
}

/** Order-free deep equality (an object's keys in any order, a list in its order). */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  }
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  const ak = Object.keys(ar);
  if (ak.length !== Object.keys(br).length) return false;
  return ak.every(k => k in br && sameValue(ar[k], br[k]));
}

export interface CopyFoldOpts {
  /** keel filled this Narrative's narrator on create: the writer is a guest or a held seat (M1). */
  narratorFilled?: boolean;
}

/** Whether keel's create path writes `field` where the file leaves it unset (M1). */
function keelFilled(type: ElementType, field: string, local: unknown, remote: unknown, opts: CopyFoldOpts): boolean {
  if (local !== undefined && local !== null) return false;
  if (remote === undefined || remote === null) return false;
  if (field === PROPOSED_MARK) return true;
  return field === 'narrator' && type === 'narrative' && !!opts.narratorFilled;
}

/**
 * The fields where a copy and keel's body differ under the fold, in a stable
 * order (the file's keys first, then keel's). Empty: the same content.
 */
export function copyDiff(
  local: Element | Record<string, unknown>,
  remote: Record<string, unknown>,
  type: ElementType,
  opts: CopyFoldOpts = {},
): string[] {
  const kinds = kindsOf(type);
  const l = local as Record<string, unknown>;
  const out: string[] = [];
  const keys = [...new Set([...Object.keys(l), ...Object.keys(remote)])];
  for (const k of keys) {
    if (NOT_COMPARED.has(k)) continue;
    if (keelFilled(type, k, l[k], remote[k], opts)) continue;
    const kind = kinds.get(k) ?? 'other';
    if (!sameValue(fold(kind, l[k]), fold(kind, remote[k]))) out.push(k);
  }
  return out;
}

/** The narrator case M1 folds needs the writer's role: only asked when it could matter. */
export function narratorMayBeFilled(local: Element | Record<string, unknown>, remote: Record<string, unknown>, type: ElementType): boolean {
  const l = (local as Record<string, unknown>).narrator;
  const r = remote.narrator;
  return type === 'narrative' && (l === undefined || l === null || l === '') && typeof r === 'string' && r !== '';
}

/** keel's values of the fields that differ, for the review row to show (unset read as null). */
export function theirsOf(remote: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) out[f] = remote[f] === undefined ? null : remote[f];
  return out;
}
