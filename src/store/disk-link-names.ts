/**
 * Disk link-name spellings for pin and marker files (S354, folder-format §5).
 *
 * The Folder Format writes link fields under their SCHEMA names: a pin's map
 * is `map`, a marker's zone is `zone`. Atlas has always stored them suffixed
 * (`map_id`, `zone_id`) and every consumer in the app keys on that spelling.
 * The gap surfaced the first time a folder written by another tool carried
 * pins: five pins on disk, zero on the map, the map index reading 0, and no
 * warning anywhere. Atlas simply never looked under the other name.
 *
 * The rule here is the same one the union read and the world-meta `now`
 * follow: READ BOTH, WRITE BACK WHATEVER THE FILE ALREADY USED. In memory
 * there is one spelling (atlas's), so nothing above the store changes. On
 * disk each file keeps the spelling it arrived with, so opening a foreign
 * folder never rewrites its keys as a side effect. A NEW file follows its
 * folder: bare unless the folder already speaks atlas's suffix (S359, born
 * bare; an atlas older than 1.3 reads a bare pin as mapless).
 *
 * The rename table is DERIVED from `relationFieldsFor`, the one authority for
 * where disk and schema names differ. It is also why this module exists at
 * all: that helper suffixes EVERY link field on the two wire-shape types, so
 * the day the standard adds one, this file follows without an edit.
 */

import type { Element, ElementType } from '../core/types';
import { relationFieldsFor } from '../editor/field-schema';

/** 'atlas' = suffixed (`map_id`); 'bare' = the schema name (`map`). */
export type LinkSpelling = 'atlas' | 'bare';

interface Rename { schema: string; disk: string }

const RENAMES = new Map<ElementType, Rename[]>();

/** Link fields whose disk name differs from the schema name, for one type. */
export function diskRenamesFor(type: ElementType): Rename[] {
  let out = RENAMES.get(type);
  if (!out) {
    out = relationFieldsFor(type)
      .filter(f => f.diskField !== f.schemaField)
      .map(f => ({ schema: f.schemaField, disk: f.diskField }));
    RENAMES.set(type, out);
  }
  return out;
}

/**
 * Bring a body just read from disk to the in-memory spelling, IN PLACE, and
 * report which spelling the file used. Fill-only: a file carrying `map_id`
 * keeps it and a stray `map` beside it is left alone; a file carrying only
 * `map` has it moved to `map_id`. A file with neither (a mapless pin, or a
 * content type) declares NO spelling and returns null: it casts no vote on
 * the folder's dialect and takes the folder's default if it is ever written.
 */
export function normalizeDiskLinks(body: Element): LinkSpelling | null {
  const renames = diskRenamesFor(body.type);
  if (renames.length === 0) return null;
  const rec = body as unknown as Record<string, unknown>;
  let sawAtlas = false;
  let sawBare = false;
  for (const { schema, disk } of renames) {
    if (disk in rec) { sawAtlas = true; continue; }
    if (schema in rec) {
      rec[disk] = rec[schema];
      delete rec[schema];
      sawBare = true;
    }
  }
  if (!sawAtlas && !sawBare) return null;
  return sawBare && !sawAtlas ? 'bare' : 'atlas';
}

/**
 * The body as it should land on disk under `spelling`. Returns the input
 * untouched for atlas spelling; for bare spelling returns a COPY with each
 * suffixed key moved to its schema name. Never mutates the caller's body,
 * which is also the cache's.
 */
export function denormalizeDiskLinks(body: Element, spelling: LinkSpelling): Element {
  if (spelling === 'atlas') return body;
  const renames = diskRenamesFor(body.type);
  if (renames.length === 0) return body;
  const copy = { ...(body as unknown as Record<string, unknown>) };
  for (const { schema, disk } of renames) {
    if (!(disk in copy)) continue;
    copy[schema] = copy[disk];
    delete copy[disk];
  }
  return copy as unknown as Element;
}
