/**
 * World-meta sync kernel — pure functions for the engine's meta step.
 *
 * The contract: keel `GET|PATCH /api/v2/world`, pinned from source 2026-07-13.
 * Everything here is pure and unit-tested; the engine's executeMetaStep and
 * the adapter's getWorldMeta/patchWorldMeta consume it.
 *
 * Load-bearing rules:
 *  - CANONICAL equality: disk `undefined` ≡ wire empties ('' text, [] list,
 *    null int). Without this every idle world would re-PATCH empties forever
 *    (the oscillation finding) — baselines are STORED canonical.
 *  - The wire encoder emits TYPED empties: a cleared time_current goes out as
 *    an explicit null (`time_range_current: null`), never omitted — omission
 *    means "no change" on a PATCH and the cleared now would resurrect.
 *  - Whitelist: only the 11 synced fields and a profile's `x_` keys ever
 *    reach a PATCH body. Keel aborts the WHOLE PATCH on one stray/unknown
 *    field, so a single leak would poison every meta change each round.
 *  - `name` is deliberately NOT synced (D4): local world name and server
 *    world name are separate identities (api.world_name mirror, settings).
 */

import { metaList, type MetaListItem } from '../core/meta-list';

export type MetaFieldKind = 'text' | 'label' | 'list' | 'int';

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
  // World units (standard 00.31.00): free-text labels, "" clears.
  // Keel trims them, so they compare trimmed ('label'): an untrimmed local
  // value would otherwise never match its echo and re-push every round.
  length_unit: 'label',
  mass_unit: 'label',
  distance_unit: 'label',
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
 * the DB layer. The engine routes overlong fields to per-field
 * failures instead of sending them. (name≤255 listed for completeness even
 * though name isn't synced in v1.)
 */
export const META_FIELD_MAX_LENGTH: Readonly<Record<string, number>> = {
  name: 255,
  image_url: 1024,
  time_basic_unit: 128,
  length_unit: 64,
  mass_unit: 64,
  distance_unit: 64,
};

/**
 * Canonical form per kind: text → string ('' when unset/invalid), label →
 * the same trimmed, list → its strings and whole numbers ([] when unset;
 * `metaList`), int → finite number or null. Canonical values compare with
 * plain === (lists element-wise).
 */
export function canonicalMetaValue(kind: MetaFieldKind, v: unknown): string | MetaListItem[] | number | null {
  switch (kind) {
    case 'text':
      return typeof v === 'string' ? v : '';
    case 'label':
      return typeof v === 'string' ? v.trim() : '';
    case 'list':
      return metaList(v);
    case 'int':
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
}

export function metaEquals(kind: MetaFieldKind, a: unknown, b: unknown): boolean {
  const ca = canonicalMetaValue(kind, a);
  const cb = canonicalMetaValue(kind, b);
  if (kind === 'list') {
    const la = ca as MetaListItem[];
    const lb = cb as MetaListItem[];
    return la.length === lb.length && la.every((x, i) => x === lb[i]);
  }
  return ca === cb;
}

/**
 * Canonical snapshot of the 11 synced fields from any meta-shaped object
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
  if (kind === 'list') return (c as MetaListItem[]).length === 0;
  if (kind === 'text' || kind === 'label') return c === '';
  return c === null;
}

/** Length-guard: returns an error message for an overlong value, else null. */
export function metaFieldLengthError(field: string, v: unknown): string | null {
  const max = META_FIELD_MAX_LENGTH[field];
  if (!max || typeof v !== 'string') return null;
  // A label is measured as keel measures it: after the trim.
  const s = META_SYNC_FIELDS[field] === 'label' ? v.trim() : v;
  if (s.length <= max) return null;
  return `${field} exceeds the server's ${max}-character limit (${s.length})`;
}

export interface MetaThreeWayDiff {
  /** field → canonical local value to PATCH (local changed, server didn't). */
  pushFields: Record<string, unknown>;
  /** field → canonical server value to apply locally (server changed, local didn't). */
  pullFields: Record<string, unknown>;
  /** Both sides changed to DIFFERENT values — policy decides. */
  contested: string[];
  /** Both sides changed to the SAME value — baseline just advances. */
  converged: string[];
}

/**
 * Per-field three-way diff. All comparisons canonical. `baseline`
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

// ---------------------------------------------------------------------------
// A profile's keys on the World (folder spec 0.3.16)
// ---------------------------------------------------------------------------
//
// keel keeps any `x_` key on the World as given and serves it at the top level
// of GET /world (`x_names`, a world's own words for the types, is the first).
// Atlas syncs them like the settings, key by key, but their values are any
// JSON and keel stores them as jsonb, which may hand an object's keys back in
// another order: so a value is compared by its canonical JSON (keys sorted),
// never by its bytes. Absent and null are one state: keel removes a key sent
// as null and never serves one. `atlas_` and `shadow_` keys are not synced.
// Their baseline is its own map in sync-state (`meta_ext_baseline`), so a
// world linked before these keys synced seeds them once, as the settings do.

/** A key Atlas syncs as a profile's key on the World. */
export function isWorldExtensionKey(key: string): boolean {
  return key.startsWith('x_') && key.length > 2;
}

/**
 * Canonical JSON with object keys sorted at every depth; null for absent, and
 * for a value JSON can only write as null (a non-finite number), since that is
 * what keel receives and drops.
 */
export function canonicalExtValue(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = JSON.stringify(sortKeysDeep(v));
  return s === undefined || s === 'null' ? null : s;
}

/** keel's cap on a World's extension keys, as compact UTF-8 JSON. */
export const EXT_MAX_BYTES = 65536;

/** The bytes the server's x_ keys would take after `push` lands (null removes a key). */
export function extBytesAfter(server: Record<string, unknown>, push: Record<string, unknown>): number {
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(server)) if (isWorldExtensionKey(k) && v !== null && v !== undefined) merged[k] = v;
  for (const [k, v] of Object.entries(push)) {
    if (v === null || v === undefined) delete merged[k];
    else merged[k] = v;
  }
  return new TextEncoder().encode(JSON.stringify(merged)).length;
}

function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      out[k] = sortKeysDeep((v as Record<string, unknown>)[k]);
    }
    return out;
  }
  return v;
}

/** The canonical snapshot of a record's profile keys: the shape `meta_ext_baseline` stores. */
export function pickExtensionBaseline(rec: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec)) {
    if (!isWorldExtensionKey(k)) continue;
    const c = canonicalExtValue(v);
    if (c !== null) out[k] = c;
  }
  return out;
}

export interface ExtThreeWayDiff {
  /** key → the local value to send (null removes the key on the server). */
  pushKeys: Record<string, unknown>;
  /** key → the server's value to write locally (undefined removes the key). */
  pullKeys: Record<string, unknown>;
  contested: string[];
  converged: string[];
}

/**
 * Per-key three-way over every profile key on any side. `baseline` holds
 * canonical JSON per key (absent = the key was absent at the last agreement).
 */
export function threeWayExtDiff(
  local: Record<string, unknown>,
  server: Record<string, unknown>,
  baseline: Record<string, string>,
): ExtThreeWayDiff {
  const keys = new Set<string>();
  for (const rec of [local, server, baseline]) {
    for (const k of Object.keys(rec)) if (isWorldExtensionKey(k)) keys.add(k);
  }
  const pushKeys: Record<string, unknown> = {};
  const pullKeys: Record<string, unknown> = {};
  const contested: string[] = [];
  const converged: string[] = [];
  for (const k of [...keys].sort()) {
    const l = canonicalExtValue(local[k]);
    const s = canonicalExtValue(server[k]);
    const b = baseline[k] ?? null;
    const localChanged = l !== b;
    const serverChanged = s !== b;
    if (!localChanged && !serverChanged) continue;
    if (serverChanged && !localChanged) pullKeys[k] = s === null ? undefined : server[k];
    else if (localChanged && !serverChanged) pushKeys[k] = l === null ? null : local[k];
    else if (l === s) converged.push(k);
    else contested.push(k);
  }
  return { pushKeys, pullKeys, contested, converged };
}

/** Record a key's agreed value in an ext baseline (absent when the value is). */
export function setExtBaseline(baseline: Record<string, string>, key: string, value: unknown): void {
  const c = canonicalExtValue(value);
  if (c === null) delete baseline[key];
  else baseline[key] = c;
}

/** The local profile keys differ from the baseline (the push round's precheck). */
export function extDirty(local: Record<string, unknown>, baseline: Record<string, string>): boolean {
  const now = pickExtensionBaseline(local);
  const keys = new Set([...Object.keys(now), ...Object.keys(baseline)]);
  for (const k of keys) if ((now[k] ?? null) !== (baseline[k] ?? null)) return true;
  return false;
}

/**
 * Encode a set of DISK-named fields for the PATCH body: whitelist to the 11,
 * canonicalize to typed empties (explicit null for cleared ints — omission
 * would mean "no change" and a cleared now would resurrect).
 * The RENAME to wire names happens in the adapter, not here — this output is
 * still disk-named so the engine and fakes reason in one vocabulary. A
 * profile's `x_` key passes as given, null removing it.
 */
export function encodeMetaFieldsForPush(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [field, v] of Object.entries(fields)) {
    if (isWorldExtensionKey(field)) { out[field] = v ?? null; continue; }
    const kind = META_SYNC_FIELDS[field];
    if (!kind) continue; // whitelist — one stray field aborts the whole PATCH server-side
    out[field] = canonicalMetaValue(kind, v);
  }
  return out;
}
