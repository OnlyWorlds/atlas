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
 * - Drops the world id (ow.com keeps none); includes api_key only on request.
 */

import { ALL_ELEMENT_TYPES, type ElementType } from '../core/types';
import { ATLAS_LOCAL_ONLY_FIELDS } from '../core/constants';
import { relationFieldsFor } from '../editor/field-schema';
import type { FolderStore } from '../store/folder-store';
import type { RawRecord } from './types';

const STRIP_EXPORT = new Set<string>([
  'type',
  'local_updated_at',
  'server_updated_at',
  ...ATLAS_LOCAL_ONLY_FIELDS,
]);

export interface ExportOptions {
  /** Subset of types to emit. Undefined = all 22 (full world, ow.com parity). */
  types?: ReadonlySet<ElementType>;
  /** Include the world's api_key in the World block (for re-upload to onlyworlds.com). */
  includeCredentials?: boolean;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
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

  const out: Record<string, unknown> = { World: world };
  const types = opts.types ? ALL_ELEMENT_TYPES.filter(t => opts.types!.has(t)) : ALL_ELEMENT_TYPES;
  for (const type of types) {
    const els = await store.listElements(type);
    out[cap(type)] = els.map(el => toExportRecord(el as Record<string, unknown>, type));
  }
  return out;
}
