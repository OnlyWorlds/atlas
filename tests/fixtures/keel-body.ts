/**
 * An element body as keel serves it (keel `elements/serialize.py` and
 * `registry.output_fields`, read 2026-11-20): every schema field of the type,
 * an unset one as keel stores it unset (a text `""`, a number or a link
 * `null`, a list of links `[]`), then `created_at`, `updated_at`, and who
 * wrote it (`created_by`, `changed_by`, `changed_via`, `changed_client`, `null`
 * when unknown), then the extension keys as stored. `doors` only when the
 * fake recorded one (keel stamps a door on every write; a body with none is a
 * fake that turned the trail off). Shared by both fakes of keel (conv. 20):
 * `FakeOwApiClient` speaks Atlas's disk names (`map_id` on a pin), the MSW
 * server the wire's (`map`).
 */
import { FIELD_SCHEMA } from '@onlyworlds/sdk';
import type { ElementType } from '../../src/core/types';
import { relationFieldsFor } from '../../src/editor/field-schema';

type Names = 'disk' | 'wire';

const AUTHOR_FIELDS = ['created_by', 'changed_by', 'changed_via', 'changed_client'] as const;

const emptiesCache = new Map<string, Array<[string, unknown]>>();

/** The type's schema fields with keel's unset value for each, in the schema's order. */
export function keelEmpties(type: ElementType | string, names: Names): Array<[string, unknown]> {
  const key = `${type}:${names}`;
  const hit = emptiesCache.get(key);
  if (hit) return hit;
  const schema = (FIELD_SCHEMA as Record<string, Record<string, { type?: string }>>)[type] ?? {};
  const disk = new Map<string, string>();
  if (names === 'disk') {
    for (const rf of relationFieldsFor(type as ElementType)) disk.set(rf.schemaField, rf.diskField);
  }
  const out: Array<[string, unknown]> = [];
  for (const [name, meta] of Object.entries(schema)) {
    const field = disk.get(name) ?? name;
    if (meta?.type === 'multi_link') out.push([field, []]);
    else if (meta?.type === 'single_link' || meta?.type === 'integer' || meta?.type === 'number') out.push([field, null]);
    else out.push([field, '']);
  }
  emptiesCache.set(key, out);
  return out;
}

/** A stored record served whole, as keel serves it: the unset fields filled, nothing the record holds changed. */
export function keelBody<T extends Record<string, unknown>>(type: ElementType | string, record: T, names: Names): T {
  const out: Record<string, unknown> = {};
  if ('type' in record) out.type = record.type;
  out.id = record.id;
  for (const [field, empty] of keelEmpties(type, names)) {
    out[field] = field in record && record[field] !== undefined ? record[field] : (Array.isArray(empty) ? [] : empty);
  }
  out.created_at = record.created_at ?? record.updated_at ?? null;
  out.updated_at = record.updated_at;
  for (const f of AUTHOR_FIELDS) out[f] = f in record ? record[f] : null;
  for (const [k, v] of Object.entries(record)) {
    if (!(k in out)) out[k] = v;
  }
  return out as T;
}
