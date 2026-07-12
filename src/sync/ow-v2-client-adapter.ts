/**
 * OwV2ClientAdapter — thin fetch client for the keel v2 API, implementing the
 * SyncEngine's OwApiClient interface. Replaces the SDK-wrapping OwClientAdapter
 * (v1 dialect) for all element CRUD; the SDK client survives only for
 * `worlds.get()` credential validation (no v2 equivalent yet) and for
 * FIELD_SCHEMA statics.
 *
 * The v2 wire dialect (FROZEN 2026-07-12, Skeld; hand-probed — see
 * Notes/2026-07-12-v2-probed-facts.md for the verified contract):
 *
 *   - Paths: /api/v2/{type} and /api/v2/{type}/{id} — no trailing slash.
 *   - Auth: same API-Key / API-Pin headers as v1. Reads work key-only.
 *   - Relations: BARE schema names both directions ({location: "<id>"},
 *     {friends: ["<id>"]}). No `_id`/`_ids` suffixing, no nested objects.
 *   - Spatial exception is DISK-side, not wire-side: atlas stores pin/marker
 *     with `map_id`/`zone_id` on disk while the schema (and the v2 wire) use
 *     bare `map`/`zone`. The rename table is derived from FIELD_SCHEMA via
 *     `relationFieldsFor` (diskField vs schemaField), never hardcoded.
 *   - Lists: `{data, has_more, next_cursor}` envelope, page size 100, walked
 *     by `?cursor=`.
 *   - Errors: `{error: {type, code, message, param}}` envelope. Surfaced as
 *     typed `OwV2Error`s whose `.message` keeps the legacy "API Error NNN:"
 *     prefix so status-based fallback parsing keeps working.
 *   - Extension passthrough: `atlas_*` / `x_*` / `shadow_*` fields round-trip.
 *     Only ATLAS_LOCAL_ONLY_FIELDS are stripped from write bodies; wire
 *     extensions (zone visual prefs, user custom fields) ride along.
 *   - /bulk: `{atomic?, items: [{type, element}]}` (+ Idempotency-Key header),
 *     fixpoint FK resolution including cycles. Response is HTTP 200 always,
 *     `{errors, items: [{status, id, error?}]}` — no per-item updated_at yet
 *     (backfill until Skeld ships the echo).
 *   - /changes: `{cursor, changes, has_more}`, continuation via `?since=` —
 *     NOT `?cursor=`; unknown params are silently ignored, so walkers must
 *     verify the cursor advances (probed 2026-07-12, the silent-replay trap).
 */

import { ATLAS_LOCAL_ONLY_FIELDS } from '../core/constants';
import { relationFieldsFor } from '../editor/field-schema';
import type { ElementType } from '../core/types';
import type { OwApiClient, BulkItem, BulkResult, ChangesPage } from './sync-engine';

type ServerRecord = { id: string; updated_at: string } & Record<string, unknown>;

export const DEFAULT_V2_BASE = 'https://www.onlyworlds.com/api/v2';

/**
 * Typed error for every non-2xx v2 response. Fields mirror the server's error
 * envelope. `message` is prefixed "API Error <status>:" so legacy substring
 * parsers (isNotFoundError, isAuthError fallback arms) keep matching.
 */
export class OwV2Error extends Error {
  readonly status: number;
  readonly code: string;
  readonly errorType: string;
  readonly param: string | null;

  constructor(status: number, envelope: { type?: string; code?: string; message?: string; param?: string | null } | null, rawBody: string) {
    const serverMsg = envelope?.message ?? (rawBody || 'request failed');
    super(`API Error ${status}: ${serverMsg}`);
    this.name = 'OwV2Error';
    this.status = status;
    this.code = envelope?.code ?? 'unknown';
    this.errorType = envelope?.type ?? 'unknown';
    this.param = envelope?.param ?? null;
  }
}

/** Duck-typed check usable on errors that crossed a module boundary. */
export function isOwV2Error(err: unknown): err is OwV2Error {
  return err instanceof Error
    && typeof (err as OwV2Error).status === 'number'
    && typeof (err as OwV2Error).code === 'string';
}

/**
 * Fields the server manages; rejected in write bodies (422 "read-only").
 * `id` is nuanced: kept on CREATE/PUT (client id preserved), stripped on PATCH.
 */
const SERVER_MANAGED_FIELDS = new Set(['type', 'world', 'created_at', 'updated_at']);

/** Sync metadata + local-only extensions — never on the wire. */
const STRIP_FIELDS = new Set<string>([
  'local_updated_at',
  'server_updated_at',
  ...ATLAS_LOCAL_ONLY_FIELDS,
]);

/**
 * Per-type disk→schema rename map for relation fields whose atlas disk name
 * differs from the schema name (pin/marker `map_id`→`map`, `zone_id`→`zone`;
 * pin's `element_id` IS the schema name so it never appears here). Derived
 * from FIELD_SCHEMA so schema evolution flows through automatically.
 */
const diskToSchemaCache = new Map<ElementType, Map<string, string>>();
function diskToSchema(type: ElementType): Map<string, string> {
  let m = diskToSchemaCache.get(type);
  if (!m) {
    m = new Map();
    for (const rf of relationFieldsFor(type)) {
      if (rf.diskField !== rf.schemaField) m.set(rf.diskField, rf.schemaField);
    }
    diskToSchemaCache.set(type, m);
  }
  return m;
}
const schemaToDiskCache = new Map<ElementType, Map<string, string>>();
function schemaToDisk(type: ElementType): Map<string, string> {
  let m = schemaToDiskCache.get(type);
  if (!m) {
    m = new Map();
    for (const [disk, schema] of diskToSchema(type)) m.set(schema, disk);
    schemaToDiskCache.set(type, m);
  }
  return m;
}

/**
 * Disk shape → v2 wire shape. A strip pass + the spatial rename:
 *   - drop server-managed fields, sync metadata, local-only extensions,
 *     undefined values (JSON.stringify would drop them anyway — dropping here
 *     keeps fakes honest about it);
 *   - `id` dropped for PATCH bodies (path parameter);
 *   - rename disk-suffixed spatial relations to their bare schema names.
 * Wire extensions (atlas_shape etc.) and user custom fields (the x_, shadow_,
 * and non-local atlas_ namespaces) pass through — v2 round-trips them.
 */
export function toV2WireShape(
  body: Record<string, unknown>,
  type: ElementType,
  op: 'create' | 'update'
): Record<string, unknown> {
  const rename = diskToSchema(type);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    if (k === 'id') {
      if (op === 'update') continue;
      out.id = v;
      continue;
    }
    if (SERVER_MANAGED_FIELDS.has(k)) continue;
    if (STRIP_FIELDS.has(k)) continue;
    out[rename.get(k) ?? k] = v;
  }
  return out;
}

/**
 * v2 wire shape → disk shape. The server echoes bare schema names and every
 * extension field verbatim; disk wants pin/marker relations re-suffixed and
 * the `type` stamped (per-type endpoints omit it).
 */
export function adaptV2Record(raw: unknown, type: ElementType): ServerRecord {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`adaptV2Record: expected object response, got ${Array.isArray(raw) ? 'array' : typeof raw}`);
  }
  const src = raw as Record<string, unknown>;
  const rename = schemaToDisk(type);
  const out: Record<string, unknown> = { type };
  for (const [k, v] of Object.entries(src)) {
    if (k === 'type') continue; // we stamp our own
    out[rename.get(k) ?? k] = v;
  }
  if (typeof out.id !== 'string') throw new Error('adaptV2Record: response missing string id');
  if (typeof out.updated_at !== 'string') throw new Error('adaptV2Record: response missing string updated_at');
  return out as ServerRecord;
}

export interface OwV2ClientOptions {
  apiKey: string;
  apiPin: string;
  /** Override the /api/v2 base (dev/staging). Default: production. */
  baseUrl?: string;
}

export class OwV2ClientAdapter implements OwApiClient {
  private readonly base: string;
  private readonly apiKey: string;
  private readonly apiPin: string;

  /**
   * Types whose most recent listElements() walk may be INCOMPLETE (safety cap
   * hit, or a truthy has_more with a dead/non-advancing cursor). The engine
   * consumes this to suppress server-delete detection for those types — an
   * incomplete `seenLocalIds` would falsely flag unfetched elements as
   * "vanished from server" (a destructive prompt). Gate 10.5: the guard STAYS
   * under v2; only its trigger changed from offset pagination to cursor-walk
   * incompleteness.
   */
  private incompleteListTypes = new Set<ElementType>();

  constructor(opts: OwV2ClientOptions) {
    this.base = (opts.baseUrl ?? DEFAULT_V2_BASE).replace(/\/$/, '');
    this.apiKey = opts.apiKey.trim();
    this.apiPin = opts.apiPin.trim();
  }

  /** Engine-facing: types whose latest list walk may be incomplete. */
  getIncompleteListTypes(): ReadonlySet<ElementType> {
    return this.incompleteListTypes;
  }

  private async request(
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<unknown> {
    const headers: Record<string, string> = {
      'API-Key': this.apiKey,
      'API-Pin': this.apiPin,
      ...extraHeaders,
    };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${this.base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!response.ok) {
      let envelope: { type?: string; code?: string; message?: string; param?: string | null } | null = null;
      try {
        const parsed = JSON.parse(text) as { error?: typeof envelope };
        envelope = parsed?.error ?? null;
      } catch { /* non-JSON error body — envelope stays null */ }
      throw new OwV2Error(response.status, envelope, text.slice(0, 300));
    }
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`v2 response was not JSON (${method} ${path}): ${text.slice(0, 120)}`);
    }
  }

  async createElement(type: ElementType, body: Record<string, unknown>): Promise<ServerRecord> {
    const wireBody = toV2WireShape(body, type, 'create');
    try {
      const response = await this.request('POST', `/${type}`, wireBody);
      return adaptV2Record(response, type);
    } catch (err) {
      logWireError('POST', type, undefined, wireBody, err);
      throw err;
    }
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    const wireBody = toV2WireShape(body, type, 'update');
    try {
      const response = await this.request('PATCH', `/${type}/${id}`, wireBody);
      return adaptV2Record(response, type);
    } catch (err) {
      logWireError('PATCH', type, id, wireBody, err);
      throw err;
    }
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    // v2 DELETE is idempotent: missing id → 204, same as success.
    await this.request('DELETE', `/${type}/${id}`);
  }

  async getElement(type: ElementType, id: string): Promise<ServerRecord | null> {
    try {
      const response = await this.request('GET', `/${type}/${id}`);
      return adaptV2Record(response, type);
    } catch (err) {
      if (isOwV2Error(err) && err.status === 404) return null;
      throw err;
    }
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    this.incompleteListTypes.delete(type);

    // Cursor walk until has_more:false. Safety cap far above real worlds; a
    // capped or non-advancing walk marks the type incomplete instead of
    // throwing — partial data is fine for pull-creates/updates, only the
    // server-delete inference must be suppressed (gate 10.5).
    const SAFETY_CAP_PAGES = 500; // 500 × 100 = 50k elements per type
    const all: unknown[] = [];
    let cursor: string | null = null;
    let complete = false;

    for (let page = 0; page < SAFETY_CAP_PAGES; page++) {
      const qs = cursor ? `?cursor=${encodeURIComponent(cursor)}` : '';
      const response = await this.request('GET', `/${type}${qs}`) as {
        data?: unknown[];
        has_more?: boolean;
        next_cursor?: string | null;
      } | unknown[];

      if (Array.isArray(response)) {
        // Defensive: a bare-array response is a complete single page.
        all.push(...response);
        complete = true;
        break;
      }
      const env = response as { data?: unknown[]; has_more?: boolean; next_cursor?: string | null };
      all.push(...(env.data ?? []));
      if (!env.has_more) {
        complete = true;
        break;
      }
      const next = env.next_cursor ?? null;
      if (!next || next === cursor) {
        // has_more claims more but the cursor is dead or not advancing —
        // treat the walk as incomplete rather than looping forever (the
        // silent-param-replay class from the 2026-07-12 probes).
        console.warn(`[ow-v2] list walk on ${type}: has_more with no advancing cursor — marking incomplete`);
        break;
      }
      cursor = next;
    }

    if (!complete) {
      this.incompleteListTypes.add(type);
      console.warn(`[ow-v2] list walk on ${type} INCOMPLETE (${all.length} fetched) — server-delete detection suppressed for this type`);
    }

    // A malformed item (missing id/updated_at) must not abort the whole
    // type's list — skip it AND mark the type incomplete so server-delete
    // detection can't act on the partial view (same hardening the /changes
    // path got against the brick-the-walk class; close-gate finding).
    const adapted: ServerRecord[] = [];
    for (const r of all) {
      try {
        adapted.push(adaptV2Record(r, type));
      } catch (err) {
        this.incompleteListTypes.add(type);
        console.warn(`[ow-v2] skipping malformed ${type} list item — type marked incomplete`, {
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return adapted;
  }

  /**
   * POST /bulk — atomic multi-element create with server-side fixpoint FK
   * resolution (cycles included). Items are DISK-shape elements; wire
   * conversion happens here. Response items are positional with the input.
   *
   * HTTP status is 200 even when items fail — consult `errors` + per-item
   * `status`. Under `atomic: true` and `errors: true`, NOTHING persisted
   * (server rolled back; a per-item 201 means "would have succeeded").
   */
  async bulkCreate(
    items: BulkItem[],
    opts?: { atomic?: boolean; idempotencyKey?: string }
  ): Promise<BulkResult> {
    const wireItems = items.map(it => ({
      type: it.type,
      element: toV2WireShape(it.element, it.type, 'create'),
    }));
    const headers: Record<string, string> = {};
    if (opts?.idempotencyKey) headers['Idempotency-Key'] = opts.idempotencyKey;
    const response = await this.request('POST', '/bulk', {
      atomic: opts?.atomic ?? true,
      items: wireItems,
    }, headers) as {
      errors?: boolean;
      items?: Array<{ status: number; id: string; error?: { code?: string; message?: string; param?: string | null } }>;
    };
    return {
      errors: !!response?.errors,
      items: (response?.items ?? []).map(it => ({
        status: it.status,
        id: it.id,
        error: it.error
          ? { code: it.error.code ?? 'unknown', message: it.error.message ?? '', param: it.error.param ?? null }
          : undefined,
      })),
    };
  }

  /**
   * GET /changes — one page of the per-world change feed. Continuation is
   * `?since=<cursor>` (NOT `?cursor=` — unknown params are silently ignored
   * and the feed replays from the epoch; callers walking multiple pages MUST
   * verify the returned cursor advances).
   *
   * upsert ops carry the full element (adapted to disk shape here); delete
   * ops carry `{type, id, deleted_at}` only.
   */
  async pullChanges(since: string | null, limit = 500): Promise<ChangesPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (since) params.set('since', since);
    const response = await this.request('GET', `/changes?${params.toString()}`) as {
      cursor?: string;
      has_more?: boolean;
      changes?: Array<{
        op: string;
        type: string;
        id: string;
        change_seq: number;
        updated_at?: string;
        deleted_at?: string;
        element?: Record<string, unknown>;
      }>;
    };
    const ops = (response?.changes ?? []).map(op => {
      if (op.op === 'upsert' && op.element) {
        // The embedded element carries its own updated_at (probed byte-equal
        // to the op-level stamp, 2026-07-12) — but synthesize from the op
        // level if a future server ever omits it. Without this, one such op
        // would throw in adaptV2Record and permanently brick the walk at
        // this cursor (gate finding).
        const element = op.element.updated_at === undefined && op.updated_at
          ? { ...op.element, updated_at: op.updated_at }
          : op.element;
        return {
          op: 'upsert' as const,
          type: op.type as ElementType,
          id: op.id,
          changeSeq: op.change_seq,
          updatedAt: op.updated_at ?? '',
          element: adaptV2Record(element, op.type as ElementType),
        };
      }
      return {
        op: 'delete' as const,
        type: op.type as ElementType,
        id: op.id,
        changeSeq: op.change_seq,
        deletedAt: op.deleted_at ?? '',
      };
    });
    return {
      cursor: response?.cursor ?? null,
      hasMore: !!response?.has_more,
      changes: ops,
    };
  }
}

/**
 * Log a failed write with the wire body for 4xx diagnosis. Mirrors the v1
 * adapter's behavior; relation refs are surfaced inline (bare schema names
 * on v2, so extract structured-envelope param instead of suffix-scanning).
 */
function logWireError(
  method: 'POST' | 'PATCH',
  type: ElementType,
  id: string | undefined,
  body: Record<string, unknown>,
  err: unknown
): void {
  const path = id ? `/${type}/${id}` : `/${type}`;
  const msg = err instanceof Error ? err.message : String(err);
  const param = isOwV2Error(err) && err.param ? ` param=${err.param}` : '';
  console.warn(`[atlas:sync] ${method} ${path} failed — ${msg}${param}`, { body });
}
