/**
 * OwClientAdapter — wraps OnlyWorldsClient to satisfy the SyncEngine's
 * OwApiClient interface.
 *
 * Design choices:
 * - All requests go through `client.request()` directly, NOT the resource
 *   accessors (`client.characters`, etc.). This sidesteps the SDK's
 *   `prepareRelations` helper which mis-handles pin's `element_id` field
 *   (would convert input `element_id` → `element_id_id`). By going raw,
 *   we control the wire shape end-to-end.
 * - Folder elements are stored in API wire shape (relation fields use
 *   `_id` / `_ids` suffix), so writes need no shape conversion.
 * - Reads need adaptation: the API returns nested relation objects
 *   (`{map: {id, name, ...}}`) instead of flat ids. `adaptRecord` unwraps
 *   these into `_id` / `_ids` form. Also stamps the `type` field (server
 *   per-type endpoints omit it).
 */

import type { OnlyWorldsClient } from '@onlyworlds/sdk';
import type { ElementType } from '../core/types';
import type { OwApiClient } from './sync-engine';

type ServerRecord = { id: string; updated_at: string } & Record<string, unknown>;

export class OwClientAdapter implements OwApiClient {
  constructor(private client: OnlyWorldsClient) {}

  async createElement(type: ElementType, body: Record<string, unknown>): Promise<ServerRecord> {
    const response = await this.client.request<unknown>('POST', `/${type}/`, { body });
    return adaptRecord(response, type);
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    const response = await this.client.request<unknown>('PATCH', `/${type}/${id}/`, { body });
    return adaptRecord(response, type);
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    await this.client.request<void>('DELETE', `/${type}/${id}/`);
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    const response = await this.client.request<unknown>('GET', `/${type}/`);
    // Backend may return a raw array or paginated { count, results } envelope.
    const records: unknown[] = Array.isArray(response)
      ? response
      : (response as { results?: unknown[] })?.results ?? [];
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
 * Convert a server response into our internal record shape:
 * - Stamp the `type` field (server per-type endpoints omit it)
 * - Unwrap nested relation objects: `{map: {id, name}}` → `map_id: "id"`
 * - Unwrap nested relation arrays: `{species: [{id, name}]}` → `species_ids: [...]`
 *
 * The generic scan covers all schema fields without needing a hand-maintained
 * mapping table, which would drift as the SDK evolves. We only ever unwrap
 * objects whose payload has an `id` property — anything else passes through.
 */
export function adaptRecord(raw: unknown, type: ElementType): ServerRecord {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`adaptRecord: expected object response, got ${typeof raw}`);
  }
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = { type };

  for (const [key, value] of Object.entries(src)) {
    if (key === 'type') continue;  // we stamp our own
    const unwrapped = tryUnwrap(value);
    if (unwrapped.unwrapped) {
      // Move to <key>_id / <key>_ids. Avoid clobbering an existing key in src.
      const newKey = unwrapped.kind === 'single' ? `${key}_id` : `${key}_ids`;
      if (!(newKey in src)) out[newKey] = unwrapped.value;
      // Drop the original nested-object field; we have its ids elsewhere.
    } else {
      out[key] = value;
    }
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

function isNotFound(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // SDK wraps server errors as "API Error NNN: ..."
  return /api error 404/i.test(err.message) || /404/.test(err.message);
}
