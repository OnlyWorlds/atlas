/**
 * Per-record normalization + shared identity helpers. Pure.
 *
 * Brings one incoming record toward atlas's disk shape WITHOUT resolving
 * relations yet (that's reconcile, which needs the cross-element lookup):
 *   - strips dangerous/server-managed fields (type/world/created_at/updated_at,
 *     sync timestamps) — these break sync or get re-derived;
 *   - keeps id (identity), known SDK fields, atlas extension fields, and the
 *     spatial coordinate fields; drops + counts genuinely foreign fields;
 *   - coerces numeric strings → numbers (ow.com stringifies every scalar) and
 *     drops empty-string single-link FKs (ow.com emits "" for unset FKs).
 *
 * Relation fields stay under their incoming BARE name here; reconcile renames
 * spatial relations to disk shape (map → map_id) when it resolves them.
 */

import { knownFieldsFor, numberFieldsFor, relationFieldsFor } from '../editor/field-schema';
import { isExtensionField, SERVER_AUTHOR_FIELDS, SERVER_MARK_FIELDS, SPATIAL_TYPES } from '../core/constants';
import type { ElementType } from '../core/types';
import type { RawRecord } from './types';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && UUID_RE.test(v.trim());
}

export function normName(s: string): string {
  // Trim, collapse internal whitespace runs, lowercase. Single normalization
  // point for all (type,name) keys — so "The  Kid" matches "The Kid".
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Lookup key for (type, name) — normalized name, private-use separator.
 *
 * NOT a NUL byte: a NUL makes ripgrep classify this whole file as BINARY, so
 * every content search over it silently returns nothing (while --count still
 * returns a plausible number, which is worse). Same trap as core/calendar.ts,
 * fixed S306. The key is in-memory only (reconcile.ts Map keys), never
 * persisted and never sent over the wire, so the separator is free to change.
 */
export function keyNT(type: ElementType, name: string): string {
  return `${type}\uE000${normName(name)}`;
}

/** Fields that must never reach the folder/server from an import. */
const STRIP_ALWAYS = new Set([
  'type',          // derived from the bucket
  'world',         // server-side relation
  'created_at',
  'updated_at',
  'change_seq',    // keel's server-managed sequence stamp — was only ever
                   // dropped as an unknown field; the §8c keepUnknown path
                   // must not resurrect it onto disk
  ...SERVER_AUTHOR_FIELDS, // who wrote it in the SOURCE world (created_by,
                   // changed_by, changed_via): names nobody in the world
                   // being imported into
  ...SERVER_MARK_FIELDS, // keel's hidden mark, about the source world's reader
  'local_updated_at',
  'server_updated_at',
  // Published-state mirror — meaningless (and misleading: it claims a slug owned
  // by the SOURCE world) once a page is imported into a different world. Strip
  // it; the imported copy is unpublished until the user publishes it here.
  'atlas_page_pub',
]);

/** Spatial fields not always present in FIELD_SCHEMA but essential to keep. */
const SPATIAL_SAFE = new Set(['x', 'y', 'z', 'order', 'element_type']);
const SPATIAL_NUMERIC = new Set(['x', 'y', 'z', 'order']);

export function normalizeRecord(
  raw: RawRecord,
  type: ElementType,
  opts: {
    /**
     * Keep unknown non-extension fields instead of dropping them. Envelope
     * imports set this: spec §8c makes ignoring (= preserving) unknown element
     * fields a reader MUST, so a future additive schema bump survives the
     * round-trip. Server stamps are still stripped either way. Safe on the
     * wire: a genuine keel envelope only carries fields keel accepts.
     */
    keepUnknown?: boolean;
  } = {},
): { record: RawRecord; droppedUnknown: number } {
  const known = knownFieldsFor(type);
  const numbers = numberFieldsFor(type);
  const isSpatial = SPATIAL_TYPES.has(type);
  const singleLinks = new Set(
    relationFieldsFor(type).filter(r => r.kind === 'single').map(r => r.schemaField),
  );

  const record: RawRecord = {};
  let droppedUnknown = 0;

  for (const [k, v] of Object.entries(raw)) {
    if (k === 'type') continue;
    if (STRIP_ALWAYS.has(k)) continue;
    if (k === 'id') {
      if (typeof v === 'string' && v.trim()) record.id = v.trim();
      continue;
    }

    // Extension namespaces (atlas_/x_/shadow_) are first-class data: keel v2
    // round-trips them verbatim, so custom fields survive import instead of
    // being silently dropped (D9 enablement). atlas_page_pub stays stripped
    // via STRIP_ALWAYS above.
    const keep = known.has(k) || isExtensionField(k) || (isSpatial && SPATIAL_SAFE.has(k));
    if (!keep) {
      if (opts.keepUnknown) {
        record[k] = v;
      } else {
        droppedUnknown++;
      }
      continue;
    }

    // Empty single-link FK ("" / null from ow.com) → unset.
    if (singleLinks.has(k) && (v === '' || v === null)) continue;

    // Numeric coercion: ow.com stringifies all scalars ("12", "0").
    const isNumber = numbers.has(k) || (isSpatial && SPATIAL_NUMERIC.has(k));
    if (isNumber) {
      if (v === '' || v === null) continue; // unset numeric → omit
      if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) {
        record[k] = Number(v);
        continue;
      }
    }

    record[k] = v;
  }

  return { record, droppedUnknown };
}
