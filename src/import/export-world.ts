/**
 * Build a full-world (or by-type subset) export from a FolderStore — the inverse
 * of Mode A import. Produces the ow.com-compatible shape: a `World` block + one
 * PascalCase array per element type (DESIGN_IMPORT.md "Export design").
 *
 * - Strips atlas-internal machinery + sync fields (LOCAL_ONLY list: page
 *   blocks, richtext, media bindings — meaningless outside this atlas).
 *   WIRE extension fields (zone visuals) and custom namespace fields
 *   (atlas_/x_/shadow_) are KEPT: keel v2 round-trips them, so dropping them
 *   here would lose user data on every export→import cycle (D9 enablement).
 * - Converts spatial disk shape back to bare names (map_id → map, zone_id → zone)
 *   so pin/marker round-trip through ow.com's `/store/` and atlas's own import.
 * - Keeps the world id (the envelope); includes api_key only on request, and
 *   the export room never requests it.
 */

import { ALL_ELEMENT_TYPES, type ElementType } from '../core/types';
import { ATLAS_LOCAL_ONLY_FIELDS, SERVER_AUTHOR_FIELDS } from '../core/constants';
import { relationFieldsFor } from '../editor/field-schema';
import { ONLYWORLDS_VERSION } from '@onlyworlds/sdk';
import type { FolderStore } from '../store/folder-store';
import type { RawRecord } from './types';

// Who and which tool wrote it (`created_by`, `changed_by`, `changed_via`, `changed_client`, `doors`)
// describe the server's record for its members, and a membership id means nothing to whoever
// receives the world: an export carries what a non-member reader is served (folder spec guidance,
// 2026-10-29). The folder keeps them as served.
const STRIP_EXPORT = new Set<string>([
  'type',
  'local_updated_at',
  'server_updated_at',
  ...ATLAS_LOCAL_ONLY_FIELDS,
  ...SERVER_AUTHOR_FIELDS,
]);

export interface ExportOptions {
  /** Subset of types to emit. Undefined = all 22 (full world, ow.com parity). */
  types?: ReadonlySet<ElementType>;
  /** Include the world's api_key in the World block (for re-upload to onlyworlds.com). */
  includeCredentials?: boolean;
}

function toExportRecord(el: Record<string, unknown>, type: ElementType): RawRecord {
  const diskToSchema = new Map<string, string>();
  for (const rel of relationFieldsFor(type)) {
    if (rel.diskField !== rel.schemaField) diskToSchema.set(rel.diskField, rel.schemaField);
  }
  const out: RawRecord = {};
  for (const [k, v] of Object.entries(el)) {
    if (STRIP_EXPORT.has(k)) continue;
    out[diskToSchema.get(k) ?? k] = v;
  }
  return out;
}

export async function buildWorldExport(
  store: FolderStore,
  opts: ExportOptions = {},
): Promise<Record<string, unknown>> {
  const meta = await store.readWorldMeta();

  const world: RawRecord = {};
  if (opts.includeCredentials && meta.api?.api_key) world.api_key = meta.api.api_key;
  world.name = meta.name ?? '';
  world.description = meta.description ?? '';
  world.version = meta.version ?? '';
  world.image_url = meta.image_url ?? '';
  if (meta.time_format_names) world.time_format_names = meta.time_format_names;
  if (meta.time_format_equivalents) world.time_format_equivalents = meta.time_format_equivalents;
  if (meta.time_basic_unit !== undefined) world.time_basic_unit = meta.time_basic_unit;
  if (meta.time_current !== undefined) world.time_current = meta.time_current;
  if (meta.time_range_min !== undefined) world.time_range_min = meta.time_range_min;
  if (meta.time_range_max !== undefined) world.time_range_max = meta.time_range_max;
  if (meta.length_unit) world.length_unit = meta.length_unit;
  if (meta.mass_unit) world.mass_unit = meta.mass_unit;
  if (meta.distance_unit) world.distance_unit = meta.distance_unit;
  // Where a copy came from and which slice it is travel with it (folder spec
  // §4.2): a Character's view exported as JSON stays one.
  const lines = meta as unknown as Record<string, unknown>;
  if (lines.source && typeof lines.source === 'object') world.source = lines.source;
  if (lines.exported_as && typeof lines.exported_as === 'object') world.exported_as = lines.exported_as;
  if (lines.producer && typeof lines.producer === 'object') world.producer = lines.producer;

  // THE ENVELOPE (converging on keel's `onlyworlds-world-export`, owed
  // to Skeld). One shape both ways now: keel exports it, atlas
  // imports it (parse.ts), and atlas exports it. The world keeps its id: the
  // envelope's whole point is a lossless round-trip (id-is-identity), and
  // atlas's import already offers merge-or-copy when the id is known. The
  // legacy `World` + PascalCase shape is still READ by parse.ts and is no
  // longer written.
  if (meta.id) world.id = meta.id;
  const elements: Record<string, RawRecord[]> = {};
  const types = opts.types ? ALL_ELEMENT_TYPES.filter(t => opts.types!.has(t)) : ALL_ELEMENT_TYPES;
  for (const type of types) {
    const els = await store.listElements(type);
    elements[type] = els.map(el => toExportRecord(el as Record<string, unknown>, type));
  }
  return {
    format: EXPORT_FORMAT,
    schema_version: ONLYWORLDS_VERSION,
    exported_at: new Date().toISOString(),
    exporter: 'atlas',
    world,
    elements,
  };
}

/** The self-describing tag keel writes and `parse.ts` keys on. */
export const EXPORT_FORMAT = 'onlyworlds-world-export';
