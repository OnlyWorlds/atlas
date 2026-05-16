/**
 * OwClientAdapter — wraps OnlyWorldsClient to satisfy the SyncEngine's
 * OwApiClient interface.
 *
 * Disk shape contract (Phase 3.5):
 *   Folder elements use BARE field names for relations — matches the SDK's
 *   FIELD_SCHEMA. e.g. `birthplace: 'id'` (single_link), `species: ['a','b']`
 *   (multi_link). The UI reads from these bare-named fields.
 *
 * Wire shape contract (what server expects on write):
 *   `_id` / `_ids` suffix per FIELD_SCHEMA. e.g. `birthplace_id`, `species_ids`.
 *
 * Conversion responsibility:
 *   - On READ: `adaptRecord` collapses nested relation objects/arrays into
 *     bare-name fields with string ids. If the server returns `_id` suffix
 *     directly, it's normalized to bare too.
 *   - On WRITE: `OnlyWorldsClient.prepareRelations(body, type)` converts bare
 *     → wire shape per FIELD_SCHEMA. Pins skip this (their fields are already
 *     wire-shape on disk; running prepareRelations on a pin would double-suffix
 *     `element_id` → `element_id_id`).
 *
 * All requests go through `client.request()` directly so we control the wire
 * body exactly. The SDK's resource accessors apply prepareRelations themselves
 * which would conflict with our adapter's contract.
 */

import { OnlyWorldsClient } from '@onlyworlds/sdk';
import { ATLAS_LOCAL_EXTENSION_FIELDS } from '../core/constants';
import type { ElementType } from '../core/types';
import type { OwApiClient } from './sync-engine';

type ServerRecord = { id: string; updated_at: string } & Record<string, unknown>;

export class OwClientAdapter implements OwApiClient {
  /**
   * Types whose most recent listElements() saw a paginated response (server
   * reported `count` greater than the records returned on this page). The
   * sync engine consumes this via `getPaginatedTypes()` to skip server-delete
   * detection for these types — page-2 records would otherwise be falsely
   * flagged as "vanished from server."
   *
   * Cleared per-type at the start of each listElements call so stale state
   * from a prior pull can't poison a fresh one.
   */
  private paginatedTypes = new Set<ElementType>();

  constructor(private client: OnlyWorldsClient) {}

  /** Engine-facing: types whose latest list was paginated. */
  getPaginatedTypes(): ReadonlySet<ElementType> {
    return this.paginatedTypes;
  }

  async createElement(type: ElementType, body: Record<string, unknown>): Promise<ServerRecord> {
    // CREATE keeps `id` (client UUID preserved server-side).
    const wireBody = toWireShape(body, type, /* isUpdate */ false);
    try {
      const response = await this.client.request<unknown>('POST', `/${type}/`, { body: wireBody });
      return adaptRecord(response, type);
    } catch (err) {
      logWireError('POST', type, undefined, wireBody, err);
      throw err;
    }
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    // UPDATE strips `id` (path parameter, not in body).
    const wireBody = toWireShape(body, type, /* isUpdate */ true);
    try {
      const response = await this.client.request<unknown>('PATCH', `/${type}/${id}/`, { body: wireBody });
      return adaptRecord(response, type);
    } catch (err) {
      logWireError('PATCH', type, id, wireBody, err);
      throw err;
    }
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    await this.client.request<void>('DELETE', `/${type}/${id}/`);
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    // Clear prior pagination flag for this type — every listElements call
    // re-decides per-type whether the response was paginated.
    this.paginatedTypes.delete(type);

    const response = await this.client.request<unknown>('GET', `/${type}/`);
    // Backend may return a raw array or paginated { count, results } envelope.
    let records: unknown[] = [];
    if (Array.isArray(response)) {
      records = response;
    } else if (response && typeof response === 'object') {
      const env = response as { results?: unknown[]; count?: number };
      records = env.results ?? [];
      // Pagination detection: if the envelope reports more elements than this
      // page returned, mark the type as paginated. The engine will skip
      // server-delete detection on paginated types to avoid silent data loss
      // on page-2+ elements. A "load more" UX is deferred to 3.6+.
      if (typeof env.count === 'number' && env.count > records.length) {
        this.paginatedTypes.add(type);
        console.warn(
          `[ow-adapter] pagination cap hit on ${type}: server has ${env.count}, page returned ${records.length}. atlas only sees the first page until pagination is wired; server-delete detection suppressed for this type until then.`
        );
      }
    }
    return records.map(r => adaptRecord(r, type));
  }

  async getElement(type: ElementType, id: string): Promise<ServerRecord | null> {
    try {
      const response = await this.client.request<unknown>('GET', `/${type}/${id}/`);
      return adaptRecord(response, type);
    } catch (err) {
      // 404 returned as null — server doesn't have it; sync engine treats this
      // as "server lacks this element" (caller decides what to do).
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

// ---- Adapter helpers ----

/**
 * Convert a server response into our internal disk shape.
 *
 * Three cases per field:
 *   1. Nested relation object `{map: {id, name, ...}}` → unwrap to the id.
 *   2. Nested relation array `{species: [{id, name}, ...]}` → unwrap to array of ids.
 *   3. Wire-shape `_id` / `_ids` from server (e.g. raw `{birthplace_id: 'id'}`)
 *      → re-keyed to bare for non-spatial types so disk matches FIELD_SCHEMA.
 *   4. Everything else (primitives, raw arrays of strings, etc.) passes through.
 *
 * Always stamps the `type` field — server per-type endpoints omit it.
 *
 * **Wire-shape spatial types** (pin + marker): atlas stores these on disk
 * with `_id` / `_ids` suffix on every relation field (matches the obsidian-
 * plugin convention and the Pin / Marker type defs in core/types.ts —
 * `map_id`, `zone_id`, `element_id`). For these types adaptRecord MUST:
 *   - Wrap unwrapped nested relations BACK INTO `_id`/`_ids` form.
 *   - NOT strip an `_id`/`_ids` suffix the server may have returned literally.
 *
 * Session 215 smoke: marker was previously not in the bypass — server-stored
 * markers came back with `map`/`zone` (bare) on disk instead of
 * `map_id`/`zone_id`, so zone-derived helpers couldn't match them to maps
 * and pulled zones never rendered after relink. Symmetric to pin's write
 * convention (#8), this is the read-side counterpart.
 */
export function adaptRecord(raw: unknown, type: ElementType): ServerRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`adaptRecord: expected object response, got ${typeof raw}`);
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { type };
  // Spatial types whose disk shape uses `_id` / `_ids` suffix verbatim.
  // Keep these in sync with the Pin / Marker / (no Zone here — zone's
  // relations are bare-name arrays like content elements) type defs.
  const wireShape = type === 'pin' || type === 'marker';

  for (const [key, value] of Object.entries(src)) {
    if (key === 'type') continue;  // we stamp our own

    const unwrapped = tryUnwrap(value);
    if (unwrapped.unwrapped) {
      // Server gave us a nested relation.
      //   Wire-shape types: add `_id` / `_ids` suffix (wire shape locally).
      //   Other: keep bare field name to match FIELD_SCHEMA + UI.
      const targetKey = wireShape
        ? (unwrapped.kind === 'single' ? `${key}_id` : `${key}_ids`)
        : key;
      // For non-wire-shape: replacing nested object with its id under the
      // same key — always write. For wire-shape: targetKey differs from key,
      // only skip if server also sent the suffix-form key separately.
      if (targetKey === key || !(targetKey in src)) out[targetKey] = unwrapped.value;
      continue;
    }

    // Re-key `_id` / `_ids` → bare for non-wire-shape so disk matches schema.
    // Handles both string ids and explicit nulls (server's way of saying "cleared").
    if (!wireShape && key.endsWith('_id') && key !== 'id' && (typeof value === 'string' || value === null)) {
      const bare = key.slice(0, -3);
      if (!(bare in src)) out[bare] = value;
      continue;
    }
    if (!wireShape && Array.isArray(value) && key.endsWith('_ids')) {
      const bare = key.slice(0, -4);
      if (!(bare in src)) out[bare] = value.filter(v => typeof v === 'string');
      continue;
    }

    out[key] = value;
  }

  // Ensure required shape.
  if (typeof out.id !== 'string') {
    throw new Error('adaptRecord: response missing string id');
  }
  if (typeof out.updated_at !== 'string') {
    throw new Error('adaptRecord: response missing string updated_at');
  }
  return out as ServerRecord;
}

/**
 * Server-managed fields that must NOT appear in any write body (server 422s).
 * Excludes `id`: it's required on CREATE (client UUID), absent on UPDATE.
 */
const SERVER_MANAGED_FIELDS = new Set([
  'type',         // immutable; server infers from endpoint
  'world',        // server-side relation; can't be set by client
  'created_at',   // server-managed
  'updated_at',   // server-managed
]);

/**
 * Atlas-local fields the server doesn't know about — never send.
 * Sync-metadata fields (local_updated_at, server_updated_at) plus the
 * shared ATLAS_LOCAL_EXTENSION_FIELDS list (image_media_id, etc.).
 * Adding a new extension field to ATLAS_LOCAL_EXTENSION_FIELDS in
 * constants.ts also protects it on pull via applyServerRecord.
 */
const ATLAS_LOCAL_FIELDS = new Set<string>([
  'local_updated_at',
  'server_updated_at',
  ...ATLAS_LOCAL_EXTENSION_FIELDS,
]);

/**
 * Per-type fields the SDK FIELD_SCHEMA declares but the live OW server
 * currently rejects on write. Stripped from wire body but preserved on disk
 * so atlas's local behavior keeps working.
 *
 * Currently empty: Anchor deployed a server migration adding `Marker.order`
 * to the write validator on 2026-05-16. The earlier strip (S1) is no longer
 * needed. The hook stays for future server-schema-lag cases.
 */
const SERVER_UNKNOWN_FIELDS_BY_TYPE: Partial<Record<ElementType, ReadonlySet<string>>> = {};

/**
 * Convert a disk-shape body (bare relation names) to wire-shape (_id / _ids
 * suffix) per FIELD_SCHEMA. Uses the SDK's static `prepareRelations` helper.
 *
 * Drops server-managed fields (type, world, created_at, updated_at) and
 * atlas-local fields (local/server_updated_at, image_media_id) — the server
 * 422s on any of these in a write body. `id` is kept on CREATE (client UUID
 * preserved) and stripped on UPDATE (path parameter).
 *
 * Pin bodies skip prepareRelations: pin's FIELD_SCHEMA literally names the
 * relation field `element_id` (single_link), so prepareRelations would
 * double-suffix it to `element_id_id`. The bypass is per-type and is needed
 * iff the schema names a field with an `_id` suffix.
 *
 * Marker is NOT bypassed: marker's FIELD_SCHEMA uses bare relation names
 * (`map`, `zone`); atlas disk shape uses wire-shape (`map_id`, `zone_id`).
 * prepareRelations sees `map_id`/`zone_id` in the body, doesn't find them
 * in the schema (which only knows `map`/`zone`), and leaves them alone —
 * the server receives wire-shape and is happy. Verified by
 * tests/integration/ow-client-adapter.marker.test.ts.
 *
 * Zone is NOT bypassed: all zone relations (phenomena, linked_zones,
 * populations, titles, principles) are bare-name arrays that
 * prepareRelations correctly converts to `_ids` wire shape.
 */
function toWireShape(
  body: Record<string, unknown>,
  type: ElementType,
  isUpdate: boolean
): Record<string, unknown> {
  const perTypeStrips = SERVER_UNKNOWN_FIELDS_BY_TYPE[type];
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'id' && isUpdate) continue;
    if (SERVER_MANAGED_FIELDS.has(k)) continue;
    if (ATLAS_LOCAL_FIELDS.has(k)) continue;
    if (perTypeStrips?.has(k)) continue;
    if (v === undefined) continue;
    clean[k] = v;
  }
  if (type === 'pin') return clean;
  return (OnlyWorldsClient as unknown as {
    prepareRelations: (data: Record<string, unknown>, type: string) => Record<string, unknown>;
  }).prepareRelations(clean, type);
}

type UnwrapResult =
  | { unwrapped: false }
  | { unwrapped: true; kind: 'single'; value: string }
  | { unwrapped: true; kind: 'array'; value: string[] };

function tryUnwrap(value: unknown): UnwrapResult {
  if (Array.isArray(value)) {
    if (value.length === 0) return { unwrapped: false };
    // Treat as relation array only if EVERY item is an object with id.
    if (value.every(v => isObjectWithId(v))) {
      return { unwrapped: true, kind: 'array', value: value.map(v => (v as { id: string }).id) };
    }
    return { unwrapped: false };
  }
  if (isObjectWithId(value)) {
    return { unwrapped: true, kind: 'single', value: (value as { id: string }).id };
  }
  return { unwrapped: false };
}

function isObjectWithId(v: unknown): boolean {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    typeof (v as { id?: unknown }).id === 'string'
  );
}

/**
 * Log a failed write with the wire body so we can diagnose 4xx server errors.
 * Stays as console.warn to avoid throwing during dev — the caller will throw.
 *
 * Pin failures are common enough during smoke (chain-FK, deleted-map refs,
 * missing element_type) that we surface the key pin fields inline rather than
 * making the user expand the body object. Generalizes to any type's FK fields
 * by extracting any `_id` / `_ids` field for quick diagnosis.
 */
function logWireError(
  method: 'POST' | 'PATCH',
  type: ElementType,
  id: string | undefined,
  body: Record<string, unknown>,
  err: unknown
): void {
  const path = id ? `/${type}/${id}/` : `/${type}/`;
  const msg = err instanceof Error ? err.message : String(err);
  // Extract FK-shaped fields for inline visibility (no need to expand {body}).
  const refs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k.endsWith('_id') || k.endsWith('_ids') || k.endsWith('_type')) refs[k] = v;
  }
  const refsBlurb = Object.keys(refs).length > 0 ? ` refs=${JSON.stringify(refs)}` : '';
  console.warn(`[atlas:sync] ${method} ${path} failed — ${msg}${refsBlurb}`, { body });
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // SDK wraps server errors as "API Error NNN: ..."
  return /api error 404/i.test(err.message) || /404/.test(err.message);
}
