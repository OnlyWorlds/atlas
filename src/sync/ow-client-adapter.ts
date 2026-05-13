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
import type { ElementType } from '../core/types';
import type { OwApiClient } from './sync-engine';

type ServerRecord = { id: string; updated_at: string } & Record<string, unknown>;

export class OwClientAdapter implements OwApiClient {
  constructor(private client: OnlyWorldsClient) {}

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
    const response = await this.client.request<unknown>('GET', `/${type}/`);
    // Backend may return a raw array or paginated { count, results } envelope.
    let records: unknown[] = [];
    if (Array.isArray(response)) {
      records = response;
    } else if (response && typeof response === 'object') {
      const env = response as { results?: unknown[]; count?: number };
      records = env.results ?? [];
      // Pagination warning: if the envelope reports more elements than this
      // page returned, surface a console warning. Phase 3.5+ ceiling note —
      // a "load more" UX is deferred. The smoke test catches the visible cap.
      if (typeof env.count === 'number' && env.count > records.length) {
        console.warn(
          `[ow-adapter] pagination cap hit on ${type}: server has ${env.count}, page returned ${records.length}. atlas only sees the first page until pagination is wired.`
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
 * Convert a server response into our internal disk shape (bare relation names).
 *
 * Three cases per field:
 *   1. Nested relation object `{map: {id, name, ...}}` → `{map: 'id'}` (bare).
 *   2. Nested relation array `{species: [{id, name}, ...]}` → `{species: ['id', ...]}`.
 *   3. Wire-shape `_id` / `_ids` from server (e.g. raw `{birthplace_id: 'id'}`)
 *      → re-keyed to bare `{birthplace: 'id'}` so disk shape matches FIELD_SCHEMA.
 *   4. Everything else (primitives, raw arrays of strings, etc.) passes through.
 *
 * Always stamps the `type` field — server per-type endpoints omit it.
 *
 * Pin is special: its FIELD_SCHEMA fields `map` (single_link) and `element_id`
 * (single_link, literally suffixed) need different handling. We keep pin's
 * `element_id` literal AND its `map_id` literal (matching the Pin type def in
 * core/types.ts which uses `_id` suffix). For pin we DO NOT collapse `_id`
 * suffix back to bare.
 */
export function adaptRecord(raw: unknown, type: ElementType): ServerRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`adaptRecord: expected object response, got ${typeof raw}`);
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { type };
  const isPin = type === 'pin';

  for (const [key, value] of Object.entries(src)) {
    if (key === 'type') continue;  // we stamp our own

    const unwrapped = tryUnwrap(value);
    if (unwrapped.unwrapped) {
      // Server gave us a nested relation.
      //   Pin: always add `_id` / `_ids` suffix (wire shape locally).
      //   Other: keep bare field name to match FIELD_SCHEMA + UI.
      const targetKey = isPin
        ? (unwrapped.kind === 'single' ? `${key}_id` : `${key}_ids`)
        : key;
      // For non-pin: we're replacing the nested object with its id under the
      // same key — always write. For pin: targetKey differs from key, only
      // skip if server also sent the suffix-form key separately.
      if (targetKey === key || !(targetKey in src)) out[targetKey] = unwrapped.value;
      continue;
    }

    // Re-key `_id` / `_ids` → bare for non-pin so disk shape matches FIELD_SCHEMA.
    // Handles both string ids and explicit nulls (server's way of saying "cleared").
    if (!isPin && key.endsWith('_id') && key !== 'id' && (typeof value === 'string' || value === null)) {
      const bare = key.slice(0, -3);
      if (!(bare in src)) out[bare] = value;
      continue;
    }
    if (!isPin && Array.isArray(value) && key.endsWith('_ids')) {
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

/** Atlas-local fields the server doesn't know about — never send. */
const ATLAS_LOCAL_FIELDS = new Set([
  'local_updated_at',
  'server_updated_at',
  'image_media_id', // atlas extension for local image binding
]);

/**
 * Convert a disk-shape body (bare relation names) to wire-shape (_id / _ids
 * suffix) per FIELD_SCHEMA. Uses the SDK's static `prepareRelations` helper.
 *
 * Drops server-managed fields (type, world, created_at, updated_at) and
 * atlas-local fields (local/server_updated_at, image_media_id) — the server
 * 422s on any of these in a write body. `id` is kept on CREATE (client UUID
 * preserved) and stripped on UPDATE (path parameter).
 *
 * Pin bodies skip prepareRelations: pin's local representation already uses
 * `element_id` and `map_id` (wire shape). Running prepareRelations on pin
 * would double-suffix `element_id` → `element_id_id`.
 */
function toWireShape(
  body: Record<string, unknown>,
  type: ElementType,
  isUpdate: boolean
): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === 'id' && isUpdate) continue;
    if (SERVER_MANAGED_FIELDS.has(k)) continue;
    if (ATLAS_LOCAL_FIELDS.has(k)) continue;
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
  console.warn(`[atlas:sync] ${method} ${path} failed — ${msg}`, { body });
}

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // SDK wraps server errors as "API Error NNN: ..."
  return /api error 404/i.test(err.message) || /404/.test(err.message);
}
