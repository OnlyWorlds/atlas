/**
 * World-meta sync kernel — pure functions for the engine's meta step (S262).
 *
 * The contract: keel `GET|PATCH /api/v2/world`, pinned from source 2026-07-13
 * (design + gate record: Forge/Notes/2026-07-13-worldmeta-sync-design.md).
 * Everything here is pure and unit-tested; the engine's executeMetaStep and
 * the adapter's getWorldMeta/patchWorldMeta consume it.
 *
 * Load-bearing rules (gate R2/R3/R5):
 *  - CANONICAL equality: disk `undefined` ≡ wire empties ('' text, [] list,
 *    null int). Without this every idle world would re-PATCH empties forever
 *    (the oscillation finding) — baselines are STORED canonical.
 *  - The wire encoder emits TYPED empties: a cleared time_current goes out as
 *    an explicit null (`time_range_current: null`), never omitted — omission
 *    means "no change" on a PATCH and the cleared now would resurrect.
 *  - Whitelist: only the 8 synced fields ever reach a PATCH body. Keel aborts
 *    the WHOLE PATCH on one stray/unknown field, so a single leak would
 *    poison every meta change each round.
 *  - `name` is deliberately NOT synced (D4): local world name and server
 *    world name are separate identities (api.world_name mirror, settings).
 */

export type MetaFieldKind = 'text' | 'list' | 'int';

/**
 * The synced world-meta fields, DISK names → kind. Disk `time_current` rides
 * the wire as `time_range_current` (the one rename; adapter owns it).
 */
export const META_SYNC_FIELDS: Readonly<Record<string, MetaFieldKind>> = {
  description: 'text',
  image_url: 'text',
  time_basic_unit: 'text',
  time_format_names: 'list',
  time_format_equivalents: 'list',
  time_range_min: 'int',
  time_range_max: 'int',
  time_current: 'int',
};

export const META_SYNC_FIELD_NAMES: readonly string[] = Object.keys(META_SYNC_FIELDS);

/**
 * The one disk↔wire rename, and the direction matters (ruled 2026-07-28,
 * folder-format v0.3.5).
 *
 * **`time_current` is the CANONICAL SCHEMA's name** (`schema/world.yaml:59`,
 * public GitHub and keel's copy alike). Atlas's disk name is the standard's
 * name; keel renamed the column in its v1→v2 migration
 * (`rehearsal/transform.py:249`, `# RENAME (R5)`) and never updated the
 * standard, so the WIRE carries the deviation. This table translates the
 * server's dialect back to the standard on the way in, rather than being an
 * atlas-ism on the way out.
 *
 * Do not "fix" this by adopting the wire spelling on disk. A capture written
 * straight from the wire is handled by the read-tolerance in
 * `FsFolderStore.readWorldMeta`, which fills the canonical key and never
 * rewrites the foreign one.
 */
export const META_WIRE_RENAME: Readonly<Record<string, string>> = {
  time_current: 'time_range_current',
};

/**
 * Keel validates types but never lengths — an overflowing value raw-500s at
 * the DB layer (dig Q9). The engine routes overlong fields to per-field
 * failures instead of sending them. (name≤255 listed for completeness even
 * though name isn't synced in v1.)
 */
export const META_FIELD_MAX_LENGTH: Readonly<Record<string, number>> = {
  name: 255,
  image_url: 1024,
  time_basic_unit: 128,
};

/**
 * Canonical form per kind: text → string ('' when unset/invalid), list →
 * string[] ([] when unset), int → finite number or null. Canonical values
 * compare with plain === (lists element-wise).
 */
export function canonicalMetaValue(kind: MetaFieldKind, v: unknown): string | string[] | number | null {
  switch (kind) {
    case 'text':
      return typeof v === 'string' ? v : '';
    case 'list':
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    case 'int':
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
}

export function metaEquals(kind: MetaFieldKind, a: unknown, b: unknown): boolean {
  const ca = canonicalMetaValue(kind, a);
  const cb = canonicalMetaValue(kind, b);
  if (kind === 'list') {
    const la = ca as string[];
    const lb = cb as string[];
    return la.length === lb.length && la.every((x, i) => x === lb[i]);
  }
  return ca === cb;
}

/**
 * Canonical snapshot of the 8 synced fields from any meta-shaped object
 * (disk WorldMeta or an adapter-returned wire body in disk names). This is
 * the shape meta_baseline stores.
 */
export function pickSyncedMeta(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, kind] of Object.entries(META_SYNC_FIELDS)) {
    out[field] = canonicalMetaValue(kind, meta[field]);
  }
  return out;
}

/** True when the field holds its canonical empty ('' / [] / null). */
export function isMetaEmpty(field: string, v: unknown): boolean {
  const kind = META_SYNC_FIELDS[field];
  if (!kind) return true;
  const c = canonicalMetaValue(kind, v);
  if (kind === 'list') return (c as string[]).length === 0;
  if (kind === 'text') return c === '';
  return c === null;
}

/** Length-guard: returns an error message for an overlong value, else null. */
export function metaFieldLengthError(field: string, v: unknown): string | null {
  const max = META_FIELD_MAX_LENGTH[field];
  if (!max || typeof v !== 'string') return null;
  if (v.length <= max) return null;
  return `${field} exceeds the server's ${max}-character limit (${v.length})`;
}

export interface MetaThreeWayDiff {
  /** field → canonical local value to PATCH (local changed, server didn't). */
  pushFields: Record<string, unknown>;
  /** field → canonical server value to apply locally (server changed, local didn't). */
  pullFields: Record<string, unknown>;
  /** Both sides changed to DIFFERENT values — policy decides (gate R9). */
  contested: string[];
  /** Both sides changed to the SAME value — baseline just advances. */
  converged: string[];
}

/**
 * Per-field three-way diff (gate R2). All comparisons canonical. `baseline`
 * is a canonical snapshot (pickSyncedMeta output); local/server are raw
 * meta-shaped objects in disk names.
 */
export function threeWayMetaDiff(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  baseline: Record<string, unknown>,
): MetaThreeWayDiff {
  const pushFields: Record<string, unknown> = {};
  const pullFields: Record<string, unknown> = {};
  const contested: string[] = [];
  const converged: string[] = [];
  for (const [field, kind] of Object.entries(META_SYNC_FIELDS)) {
    const localChanged = !metaEquals(kind, local[field], baseline[field]);
    const serverChanged = !metaEquals(kind, server[field], baseline[field]);
    if (!localChanged && !serverChanged) continue;
    if (serverChanged && !localChanged) {
      pullFields[field] = canonicalMetaValue(kind, server[field]);
    } else if (localChanged && !serverChanged) {
      pushFields[field] = canonicalMetaValue(kind, local[field]);
    } else if (metaEquals(kind, local[field], server[field])) {
      converged.push(field);
    } else {
      contested.push(field);
    }
  }
  return { pushFields, pullFields, contested, converged };
}

/**
 * Encode a set of DISK-named fields for the PATCH body: whitelist to the 8,
 * canonicalize to typed empties (explicit null for cleared ints — omission
 * would mean "no change" and a cleared now would resurrect, gate finding).
 * The RENAME to wire names happens in the adapter, not here — this output is
 * still disk-named so the engine and fakes reason in one vocabulary.
 */
export function encodeMetaFieldsForPush(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, v] of Object.entries(fields)) {
    const kind = META_SYNC_FIELDS[field];
    if (!kind) continue; // whitelist — one stray field aborts the whole PATCH server-side
    out[field] = canonicalMetaValue(kind, v);
  }
  return out;
}
