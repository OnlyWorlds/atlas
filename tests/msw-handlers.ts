/**
 * Reusable MSW handlers that simulate the OnlyWorlds API.
 *
 * The "stateful" server holds an in-memory store of elements per type and
 * serves CRUD endpoints. Tests can use it to exercise the OwClientAdapter
 * against realistic wire behavior.
 *
 * Base URL defaults to https://www.onlyworlds.com/api/worldapi but tests
 * may override via `setBaseUrl`.
 */

import { http, HttpResponse, type HttpHandler } from 'msw';
import { ATLAS_LOCAL_EXTENSION_FIELDS, ATLAS_LOCAL_ONLY_FIELDS } from '../src/core/constants';

const DEFAULT_BASE = 'https://www.onlyworlds.com/api/worldapi';
/** Single source of truth list — keep in lockstep with constants.ts. */
const ATLAS_LOCAL_ALL = [
  ...ATLAS_LOCAL_EXTENSION_FIELDS,
  'local_updated_at',
  'server_updated_at',
];

interface ServerRecord {
  id: string;
  updated_at: string;
  [field: string]: unknown;
}

export interface StatefulServerOptions {
  /** Override the base URL. */
  baseUrl?: string;
  /** Inject a deterministic clock for response timestamps. */
  clock?: () => string;
  /** When true, GET returns nested relation objects to exercise the unwrap path. */
  serveNestedRelations?: boolean;
  /**
   * When true, CREATE ignores client-sent `id` and assigns a fresh server-side
   * UUID. Matches real OW behavior in production: even though the API once
   * accepted client UUIDs, the live server now appears to enforce its own
   * id format (UUID v7) and silently overrides client-sent v4 ids.
   *
   * Tests covering the id-swap path on CREATE should enable this.
   */
  assignsServerIds?: boolean;
  /**
   * Mutable holder for "credentials are dead" mode. When `.blocked` is true,
   * every endpoint returns 401. Mirrors real OW when the api_key is revoked
   * or the world is deleted server-side. Object indirection lets tests flip
   * the flag mid-test without rebuilding handlers.
   */
  authState?: { blocked: boolean };
  /**
   * Per-type page size for the LIST handler. When set for a type, the handler
   * returns DRF-style `{ count, next, previous, results }` envelopes instead
   * of raw arrays, honoring `?offset=N` to walk pages. Used by adapter
   * pagination tests; real-OW caps page size at 200.
   *
   * Example: `paginate: { event: 3 }` → LIST /event/ pages of 3.
   */
  paginate?: Partial<Record<string, number>>;
}

export function statefulOwHandlers(options: StatefulServerOptions = {}): {
  handlers: HttpHandler[];
  state: Map<string, Map<string, ServerRecord>>;
  /** Capture of every successful create-world-external call. */
  worldCreations: Array<{ name: string; email: string; api_key: string }>;
  __mutate: (type: string, id: string, patch: Record<string, unknown>) => void;
} {
  const base = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, '');
  const clock = options.clock ?? (() => new Date().toISOString());
  const state = new Map<string, Map<string, ServerRecord>>();

  function bucket(type: string): Map<string, ServerRecord> {
    let m = state.get(type);
    if (!m) {
      m = new Map();
      state.set(type, m);
    }
    return m;
  }

  function maybeNestRelations(record: ServerRecord): ServerRecord {
    if (!options.serveNestedRelations) return { ...record };
    // For any field ending in _id, replace with a nested object (id-only stub).
    // Tests pre-load other-side data into `relatedNames` if they want names too.
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      if (k.endsWith('_id') && typeof v === 'string') {
        const newKey = k.slice(0, -'_id'.length);
        out[newKey] = { id: v };
      } else if (k.endsWith('_ids') && Array.isArray(v)) {
        const newKey = k.slice(0, -'_ids'.length);
        out[newKey] = (v as string[]).map(id => ({ id }));
      } else {
        out[k] = v;
      }
    }
    return out as ServerRecord;
  }

  // The world-creation endpoint lives under /worldsync, not /worldapi.
  // Derive its base from `base` by swapping the suffix.
  const worldsyncBase = base.endsWith('/worldapi') ? base.replace(/\/worldapi$/, '/worldsync') : base;

  /** Track world creations for test assertions: `[name, email, generated api_key]`. */
  const worldCreations: Array<{ name: string; email: string; api_key: string }> = [];

  /** Helper: return a 401 if auth is currently blocked (dead-creds simulation). */
  function authBlocked(): Response | null {
    if (options.authState?.blocked) {
      return HttpResponse.json({ detail: 'Invalid api key or pin.' }, { status: 401 });
    }
    return null;
  }

  const handlers: HttpHandler[] = [
    // CREATE WORLD (external, no auth) — used by Make-Online Route 1.
    // POST /worldsync/create-world-external/
    // body: { name, email, pin }
    // 200 (probed keel shape, 2026-07-12): { success, world_id, name, version, api_key }
    //     — Route 1's PRIMARY branch consumes world_id/name directly and
    //     skips the worlds.get fallback; the fake serves the real shape so
    //     that branch is what tests exercise (close-gate finding).
    // 400: { success: false, message: string }
    http.post(`${worldsyncBase}/create-world-external/`, async ({ request }) => {
      const body = (await request.json()) as { name?: string; email?: string; pin?: string };
      if (!body.name || !body.email || !body.pin) {
        return HttpResponse.json(
          { success: false, message: 'name, email, and pin are required' },
          { status: 400 }
        );
      }
      const api_key = `mock-api-key-${crypto.randomUUID().slice(0, 8)}`;
      worldCreations.push({ name: body.name, email: body.email, api_key });
      return HttpResponse.json({
        success: true,
        world_id: crypto.randomUUID(),
        name: body.name,
        version: '0.30.00',
        api_key,
      });
    }),

    // LIST
    http.get(`${base}/:type/`, ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const allRecords = Array.from(bucket(type).values()).map(maybeNestRelations);

      // If a per-type page size is configured, return a DRF-style envelope
      // honoring `?offset=N`. Lets adapter pagination tests exercise the
      // multi-page walk loop without standing up a real OW dev server.
      const pageSize = options.paginate?.[type];
      if (typeof pageSize === 'number' && pageSize > 0) {
        const url = new URL(request.url);
        const offset = Math.max(0, parseInt(url.searchParams.get('offset') ?? '0', 10) || 0);
        const slice = allRecords.slice(offset, offset + pageSize);
        const nextOffset = offset + slice.length;
        const next = nextOffset < allRecords.length
          ? `${base}/${type}/?offset=${nextOffset}`
          : null;
        return HttpResponse.json({
          count: allRecords.length,
          next,
          previous: offset > 0 ? `${base}/${type}/?offset=${Math.max(0, offset - pageSize)}` : null,
          results: slice,
        });
      }

      return HttpResponse.json(allRecords);
    }),
    // GET single
    http.get(`${base}/:type/:id/`, ({ params }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      const r = bucket(type).get(id);
      if (!r) return HttpResponse.json({ error: 'not found' }, { status: 404 });
      return HttpResponse.json(maybeNestRelations(r));
    }),
    // CREATE
    http.post(`${base}/:type/`, async ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const body = (await request.json()) as Record<string, unknown>;
      // Enforce real-OW invariant: pin requires element_type whenever element_id
      // is specified. The live API responds with 400 in this case; our handler
      // mirrors it so tests catch regressions of this requirement.
      if (type === 'pin' && body.element_id && !body.element_type) {
        return HttpResponse.json(
          { error: 'element_type must be provided when element_id is specified' },
          { status: 400 }
        );
      }
      // Convention #8 + #20: pin/marker bodies are wire-shape on disk; the
      // adapter MUST bypass prepareRelations for them. If a *_id_id /
      // *_ids_ids field shows up, the bypass is broken.
      if (type === 'pin' || type === 'marker') {
        const bad = Object.keys(body).find(k => k.endsWith('_id_id') || k.endsWith('_ids_ids'));
        if (bad) {
          return HttpResponse.json(
            { error: `${type} body contains double-suffixed relation field "${bad}"` },
            { status: 400 },
          );
        }
      }
      // Captain session 221: atlas-local fields (atlas_shape on zone, etc.)
      // were leaking to live OW which rejects unknown fields with 400. Mirror
      // here so tests catch any new field that needs adding to
      // ATLAS_LOCAL_EXTENSION_FIELDS.
      const bannedLocal = Object.keys(body).find(k => ATLAS_LOCAL_ALL.includes(k as any));
      if (bannedLocal) {
        return HttpResponse.json(
          { error: `body contains atlas-local field "${bannedLocal}" which the server rejects` },
          { status: 400 },
        );
      }
      // Marker.order is a valid write field (Anchor migration 2026-05-16).
      // assignsServerIds: ignore client id entirely (real OW behavior with v4 input).
      const id = options.assignsServerIds
        ? crypto.randomUUID()
        : (body.id as string) ?? crypto.randomUUID();
      const record: ServerRecord = { ...body, id, updated_at: clock() };
      bucket(type).set(id, record);
      return HttpResponse.json(maybeNestRelations(record), { status: 201 });
    }),
    // UPDATE
    http.patch(`${base}/:type/:id/`, async ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      const existing = bucket(type).get(id);
      if (!existing) return HttpResponse.json({ error: 'not found' }, { status: 404 });
      const body = (await request.json()) as Record<string, unknown>;
      if (type === 'pin' || type === 'marker') {
        const bad = Object.keys(body).find(k => k.endsWith('_id_id') || k.endsWith('_ids_ids'));
        if (bad) {
          return HttpResponse.json(
            { error: `${type} body contains double-suffixed relation field "${bad}"` },
            { status: 400 },
          );
        }
      }
      const bannedLocalUpd = Object.keys(body).find(k => ATLAS_LOCAL_ALL.includes(k as any));
      if (bannedLocalUpd) {
        return HttpResponse.json(
          { error: `body contains atlas-local field "${bannedLocalUpd}" which the server rejects` },
          { status: 400 },
        );
      }
      // No `order` rejection on PATCH (Anchor migration 2026-05-16).
      const next: ServerRecord = { ...existing, ...body, id, updated_at: clock() };
      bucket(type).set(id, next);
      return HttpResponse.json(maybeNestRelations(next));
    }),
    // DELETE
    http.delete(`${base}/:type/:id/`, ({ params }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      // Mirror real OW (DRF default): unknown id → 404. Engine treats this as
      // "already gone" and clears the tombstone so orphan tombstones don't
      // accumulate forever.
      const m = bucket(type);
      if (!m.has(id)) {
        return HttpResponse.json({ error: 'not found' }, { status: 404 });
      }
      m.delete(id);
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return {
    handlers,
    state,
    worldCreations,
    __mutate: (type, id, patch) => {
      const existing = bucket(type).get(id);
      if (!existing) throw new Error(`__mutate: ${type}/${id} not found`);
      bucket(type).set(id, { ...existing, ...patch, id, updated_at: clock() });
    },
  };
}

// ---------------------------------------------------------------------------
// keel v2 dialect
// ---------------------------------------------------------------------------

/** A single op in the /changes feed (wire shape — bare relation names). */
export type V2ChangeOp =
  | { op: 'upsert'; type: string; id: string; change_seq: number; updated_at: string; element: ServerRecord }
  | { op: 'delete'; type: string; id: string; change_seq: number; deleted_at: string };

const V2_DEFAULT_BASE = 'https://www.onlyworlds.com/api/v2';

/** UUID-shape test (v4 and friends) — the FK heuristic keys on this. */
const V2_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Server-managed fields the wire rejects with 422 "<field> is read-only." */
const V2_READONLY_FIELDS = new Set(['updated_at', 'created_at', 'world', 'type', 'change_seq']);

/**
 * Fields that must NEVER reach the wire — the local-only extension bucket plus
 * sync metadata. Rejected with the 422 unknown-field envelope (they are stripped
 * client-side by toV2WireShape, so a real appearance means the strip pass broke).
 */
const V2_LOCAL_REJECT = new Set<string>([
  ...ATLAS_LOCAL_ONLY_FIELDS,
  'local_updated_at',
  'server_updated_at',
]);

export interface StatefulV2ServerOptions {
  /** Override the base URL. Default: production v2. Routes have NO trailing slash. */
  baseUrl?: string;
  /** GET /world identity (v2 tail). Defaults keep older suites indifferent. */
  worldId?: string;
  worldName?: string;
  /** Deterministic clock for created_at/updated_at + change deleted_at. */
  clock?: () => string;
  /** LIST page size for the cursor walk. Default 100. */
  pageSize?: number;
  /** Dead-creds simulation — every endpoint 401s when `.blocked`. Object indirection lets tests flip mid-run. */
  authState?: { blocked: boolean };
  /**
   * Non-namespaced field names the server treats as unknown → 422. Default
   * `['mood']`. This is the MSW SEAM: the fake can't know the full OW schema,
   * so a field is rejected iff it is in the local-only/sync-metadata reject set
   * OR in this list; everything else (bare schema names, `atlas_*`/`x_*`/
   * `shadow_*` extensions) is accepted and round-tripped verbatim.
   */
  unknownFields?: string[];
  /**
   * Pathological LIST: always serve page 1 and claim `has_more:true` with a
   * NON-ADVANCING cursor. Exercises the adapter's stuck-walk guard (the type
   * must join getIncompleteListTypes()).
   */
  brokenCursor?: boolean;
  /**
   * Simulate a pre-D46 server: /bulk success slots omit the created_at +
   * updated_at echo, forcing the engine's read-back backfill fallback.
   */
  omitBulkTimestamps?: boolean;
  /**
   * Seed initial world-meta values (WIRE names, e.g. `time_range_current`).
   * Overrides individual fields on top of the canonical-empty defaults; id/name
   * still fall back to worldId/worldName when not given here.
   */
  worldMeta?: Record<string, unknown>;
}

/**
 * PATCH /world writable fields (WIRE names) → kind. Anything not here is an
 * unknown field: keel 422s and aborts the WHOLE PATCH (dig 2026-07-13). NOTE
 * `time_range_current` is the wire name — atlas disk calls it `time_current`.
 */
const V2_WORLD_META_WRITABLE: Readonly<Record<string, 'text' | 'list' | 'int'>> = {
  name: 'text',
  description: 'text',
  image_url: 'text',
  time_basic_unit: 'text',
  time_format_names: 'list',
  time_format_equivalents: 'list',
  time_range_min: 'int',
  time_range_max: 'int',
  time_range_current: 'int',
  length_unit: 'text',
  mass_unit: 'text',
  distance_unit: 'text',
};

/** World units (keel core/world_api.py, Keel #146): trimmed, then capped at 64. */
const V2_WORLD_UNIT_FIELDS = new Set(['length_unit', 'mass_unit', 'distance_unit']);

/**
 * Per-field type validation for PATCH /world, WIRE names. Returns the keel
 * message + param for the first problem, or null when the value is valid for
 * its kind. Booleans are explicitly rejected on int fields (keel dig).
 */
function validateWorldMetaField(field: string, v: unknown): { message: string; param: string } | null {
  const kind = V2_WORLD_META_WRITABLE[field];
  if (kind === 'text') {
    if (typeof v !== 'string') return { message: `'${field}' must be a string.`, param: field };
    if (field === 'name' && v.trim() === '') return { message: 'name must be a non-empty string.', param: 'name' };
    if (V2_WORLD_UNIT_FIELDS.has(field) && v.trim().length > 64) {
      return { message: `'${field}' must be 64 characters or fewer.`, param: field };
    }
    return null;
  }
  if (kind === 'list') {
    if (!Array.isArray(v) || !v.every(x => typeof x === 'string')) {
      return { message: `'${field}' must be a list of strings.`, param: field };
    }
    return null;
  }
  // int: integer or null; booleans (a number-ish JS value) explicitly rejected.
  if (v === null) return null;
  if (typeof v === 'boolean' || typeof v !== 'number' || !Number.isInteger(v)) {
    return { message: `'${field}' must be an integer or null.`, param: field };
  }
  return null;
}

/**
 * Stateful MSW server speaking the FROZEN keel v2 dialect (see
 * Notes/2026-07-12-v2-probed-facts.md — the single source of truth for every
 * shape and status code below). Independent from statefulOwHandlers (which
 * stays for the v1 SDK adapter): different envelopes, error shape, pagination,
 * and the /bulk + /changes endpoints v1 never had.
 *
 * Returns `{handlers, state, opLog, __mutate}`. `opLog` is the ordered change
 * feed (dense, gap-free per-instance change_seq); `__mutate` patches a record
 * out-of-band AND logs an upsert op, mirroring a server-side edit.
 */
export function statefulV2Handlers(options: StatefulV2ServerOptions = {}): {
  handlers: HttpHandler[];
  state: Map<string, Map<string, ServerRecord>>;
  opLog: V2ChangeOp[];
  __mutate: (type: string, id: string, patch: Record<string, unknown>) => void;
  /** Out-of-band server-side world-meta edit (WIRE names) — bumps updated_at,
   *  mirrors __mutate for the /world resource. */
  __mutate_world_meta: (patch: Record<string, unknown>) => void;
} {
  const base = (options.baseUrl ?? V2_DEFAULT_BASE).replace(/\/$/, '');
  const clock = options.clock ?? (() => new Date().toISOString());
  const pageSize = options.pageSize ?? 100;
  const unknownFields = options.unknownFields ?? ['mood'];
  const state = new Map<string, Map<string, ServerRecord>>();
  const opLog: V2ChangeOp[] = [];
  const idempotency = new Map<string, { payload: string; response: unknown }>();
  const cursorOffsets = new Map<string, number>();
  let seq = 0;

  // World-meta state (v2 tail, S262). Seeded from worldId/worldName (defaults
  // keep older suites indifferent) + canonical empties ('' text, [] list, null
  // int); options.worldMeta overrides individual WIRE-named fields.
  const worldMeta: Record<string, unknown> = {
    id: options.worldId ?? '00000000-0000-4000-8000-000000w0r1d0',
    name: options.worldName ?? 'fake v2 world',
    description: '',
    image_url: '',
    time_basic_unit: '',
    time_format_names: [] as string[],
    time_format_equivalents: [] as string[],
    time_range_min: null,
    time_range_max: null,
    time_range_current: null,
    length_unit: '',
    mass_unit: '',
    distance_unit: '',
    public_read: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...(options.worldMeta ?? {}),
  };

  /** The full 16-field GET /world body (WIRE names), lists copied out. */
  function worldMetaBody(): Record<string, unknown> {
    return {
      id: worldMeta.id,
      name: worldMeta.name,
      description: worldMeta.description,
      image_url: worldMeta.image_url,
      time_format_names: [...(worldMeta.time_format_names as string[])],
      time_format_equivalents: [...(worldMeta.time_format_equivalents as string[])],
      time_basic_unit: worldMeta.time_basic_unit,
      time_range_min: worldMeta.time_range_min,
      time_range_max: worldMeta.time_range_max,
      time_range_current: worldMeta.time_range_current,
      length_unit: worldMeta.length_unit,
      mass_unit: worldMeta.mass_unit,
      distance_unit: worldMeta.distance_unit,
      public_read: worldMeta.public_read,
      created_at: worldMeta.created_at,
      updated_at: worldMeta.updated_at,
    };
  }

  function bucket(type: string): Map<string, ServerRecord> {
    let m = state.get(type);
    if (!m) {
      m = new Map();
      state.set(type, m);
    }
    return m;
  }

  /** Does `id` exist under ANY type? (FK links are cross-type in v2.) */
  function existsAnywhere(id: string): boolean {
    for (const m of state.values()) if (m.has(id)) return true;
    return false;
  }

  function logUpsert(type: string, record: ServerRecord): void {
    seq += 1;
    opLog.push({ op: 'upsert', type, id: record.id, change_seq: seq, updated_at: record.updated_at, element: { ...record } });
  }
  function logDelete(type: string, id: string, deletedAt: string): void {
    seq += 1;
    opLog.push({ op: 'delete', type, id, change_seq: seq, deleted_at: deletedAt });
  }

  function mintCursor(offset: number): string {
    const token = `cur_${crypto.randomUUID().slice(0, 8)}`;
    cursorOffsets.set(token, offset);
    return token;
  }

  const errTypeFor = (code: string): string => {
    if (code === 'invalid_credentials') return 'authentication_error';
    if (code === 'idempotency_error') return 'idempotency_error';
    return 'invalid_request_error';
  };

  interface ErrDesc { status: number; code: string; message: string; param: string | null }

  function envelope(desc: ErrDesc): Response {
    return HttpResponse.json(
      {
        error: {
          type: errTypeFor(desc.code),
          code: desc.code,
          message: desc.message,
          param: desc.param,
          doc_url: `https://www.onlyworlds.com/docs/errors#${desc.code}`,
        },
      },
      { status: desc.status },
    );
  }

  function authBlocked(): Response | null {
    if (options.authState?.blocked) {
      return envelope({ status: 401, code: 'invalid_credentials', message: 'Incorrect PIN.', param: null });
    }
    return null;
  }

  /**
   * Validate a write body against the v2 dialect. Returns an ErrDesc for the
   * FIRST problem (read-only field, then unknown field, then dangling FK), or
   * null when clean. `hasId` decides FK resolution — for /bulk it also consults
   * the in-batch id set so reference cycles resolve.
   */
  function validateBody(
    body: Record<string, unknown>,
    opts: { requireName: boolean; hasId: (id: string) => boolean; linkSuffix?: string },
  ): ErrDesc | null {
    if (opts.requireName && !('name' in body)) {
      return { status: 422, code: 'invalid_request', message: 'name is required.', param: 'name' };
    }
    for (const [k] of Object.entries(body)) {
      if (k === 'id') continue;
      if (V2_READONLY_FIELDS.has(k)) {
        return { status: 422, code: 'invalid_request', message: `${k} is read-only.`, param: k };
      }
      if (V2_LOCAL_REJECT.has(k) || unknownFields.includes(k)) {
        return { status: 422, code: 'invalid_request', message: `Unknown field: ${k}`, param: k };
      }
    }
    // FK pass: bare single-link string fields + multi-link string arrays whose
    // values look like uuids must resolve. Multi-link reports the FIRST dangling.
    for (const [k, v] of Object.entries(body)) {
      if (k === 'id') continue;
      const refs = typeof v === 'string' && V2_UUID_RE.test(v)
        ? [v]
        : Array.isArray(v)
          ? (v as unknown[]).filter((x): x is string => typeof x === 'string' && V2_UUID_RE.test(x))
          : [];
      for (const ref of refs) {
        if (!opts.hasId(ref)) {
          return {
            status: 400,
            code: 'invalid_link',
            message: `${k} references Element '${ref}' which does not exist.${opts.linkSuffix ?? ''}`,
            param: k,
          };
        }
      }
    }
    return null;
  }

  const handlers: HttpHandler[] = [
    // GET /changes — the per-world change feed. MUST precede GET /:type (a bare
    // /changes would otherwise be captured as type="changes").
    http.get(`${base}/changes`, ({ request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const url = new URL(request.url);
      // v2 tail (2026-07-12): /changes REJECTS unknown query params with a
      // loud 422 naming the param (was: silently ignored — the
      // cursor=-replays-page-1-forever trap, now dead at the root). Encode
      // the real server's rule (convention #20).
      for (const key of url.searchParams.keys()) {
        if (key !== 'limit' && key !== 'since') {
          return envelope({ status: 422, code: 'invalid_request', message: `Unknown query parameter: ${key}`, param: key });
        }
      }
      const limit = Math.max(1, parseInt(url.searchParams.get('limit') ?? '500', 10) || 500);
      const since = url.searchParams.get('since');
      const sinceSeq = since ? (parseInt(since.split(':')[0], 10) || 0) : 0;
      const pending = opLog.filter(op => op.change_seq > sinceSeq);
      const changes = pending.slice(0, limit);
      const hasMore = pending.length > changes.length;
      const last = changes[changes.length - 1];
      const cursor = last ? `${last.change_seq}:${last.id}` : (since ?? null);
      // `head` = the world's current change_seq (v2 tail) — the engine's
      // rewind detector reads it.
      const head = opLog.reduce((m, op) => Math.max(m, op.change_seq), 0);
      return HttpResponse.json({ cursor, has_more: hasMore, head, changes });
    }),

    // GET /world — credential validation + world identity (v2 tail,
    // 2026-07-12; replaced the v1 SDK worlds.get validation lane).
    // MUST precede GET /:type (a bare /world would match type="world").
    http.get(`${base}/world`, () => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      return HttpResponse.json(worldMetaBody());
    }),

    // GET /me — who the key is; the door's PIN check since reads go bare
    // (Atlas 1.79.0). MUST precede GET /:type, as /world does.
    http.get(`${base}/me`, () => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      return HttpResponse.json({ role: 'owner' });
    }),

    // PATCH /world — world-meta partial write (v2 tail, S262). MUST precede
    // PATCH /:type (a bare /world would match type="world"). Contract (keel dig
    // 2026-07-13): unknown-field check across ALL keys first — one stray field
    // aborts the whole PATCH — then per-field type validation, then apply +
    // bump. Only present fields change; keel does NOT diff, so a present field
    // equal to its current value still bumps updated_at. Empty body {} → no
    // save, no bump, returns the current body.
    http.patch(`${base}/world`, async ({ request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const body = (await request.json()) as Record<string, unknown>;
      const keys = Object.keys(body);
      if (keys.length === 0) return HttpResponse.json(worldMetaBody());
      for (const k of keys) {
        if (!(k in V2_WORLD_META_WRITABLE)) {
          return envelope({ status: 422, code: 'invalid_request', message: `Unknown field '${k}'.`, param: k });
        }
      }
      for (const k of keys) {
        const err = validateWorldMetaField(k, body[k]);
        if (err) return envelope({ status: 422, code: 'invalid_request', message: err.message, param: err.param });
      }
      for (const k of keys) {
        worldMeta[k] = V2_WORLD_UNIT_FIELDS.has(k) ? (body[k] as string).trim() : body[k];
      }
      worldMeta.updated_at = clock();
      return HttpResponse.json(worldMetaBody());
    }),

    // POST /bulk — atomic/non-atomic multi-create with fixpoint FK resolution.
    // MUST precede POST /:type (a bare /bulk would match type="bulk").
    http.post(`${base}/bulk`, async ({ request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const idemKey = request.headers.get('Idempotency-Key');
      const body = (await request.json()) as { atomic?: boolean; items?: Array<{ type: string; element: Record<string, unknown> }> };
      const payloadStr = JSON.stringify(body);
      if (idemKey) {
        const seen = idempotency.get(idemKey);
        if (seen) {
          if (seen.payload !== payloadStr) {
            return envelope({ status: 409, code: 'idempotency_error', message: 'Idempotency-Key reused with a different payload.', param: null });
          }
          return HttpResponse.json(seen.response as Record<string, unknown>); // exact replay
        }
      }
      const atomic = body.atomic ?? true;
      const items = Array.isArray(body.items) ? body.items : [];
      // Fixpoint seam: a link resolves if the id is already stored OR appears
      // anywhere in this batch (so reference cycles land together).
      const batchIds = new Set(items.map(it => it?.element?.id).filter(Boolean) as string[]);
      const hasId = (id: string): boolean => existsAnywhere(id) || batchIds.has(id);

      const evaluated = items.map(it => {
        // Probed fact (2026-07-12 note §/bulk): ONLY the non-atomic variant
        // appends " in this world." to the invalid_link message; atomic /bulk
        // (and single POST) use the bare form. The engine parser is
        // suffix-tolerant either way, but the fake reproduces the distinction.
        const err = validateBody(it.element, { requireName: true, hasId, linkSuffix: atomic ? '' : ' in this world.' });
        const id = (it.element?.id as string | undefined) ?? '';
        if (err) {
          return { ok: false as const, status: err.status, id, error: { code: err.code, message: err.message, param: err.param } };
        }
        return { ok: true as const, status: 201, id, item: it };
      });
      const anyError = evaluated.some(r => !r.ok);

      // atomic + any failure → persist NOTHING (rollback). Otherwise persist the
      // good items. Per-item statuses are reported either way.
      const stampById = new Map<string, { created_at: string; updated_at: string }>();
      if (!(atomic && anyError)) {
        for (const r of evaluated) {
          if (r.ok) {
            const ts = clock();
            const existing = bucket(r.item.type).get(r.id);
            const record: ServerRecord = { ...r.item.element, id: r.id, created_at: existing?.created_at ?? ts, updated_at: ts };
            bucket(r.item.type).set(r.id, record);
            logUpsert(r.item.type, record);
            stampById.set(r.id, { created_at: record.created_at as string, updated_at: ts });
          }
        }
      }

      // keel D46 (deployed 2026-07-12): success slots echo created_at +
      // updated_at (read-serialization format). Error slots carry none.
      // `options.omitBulkTimestamps` simulates a pre-D46 server so the
      // engine's read-back backfill fallback stays covered.
      const response = {
        errors: anyError,
        items: evaluated.map(r => {
          if (!r.ok) return { status: r.status, id: r.id, error: r.error };
          const stamp = options.omitBulkTimestamps ? undefined : stampById.get(r.id);
          return stamp
            ? { status: r.status, id: r.id, created_at: stamp.created_at, updated_at: stamp.updated_at }
            : { status: r.status, id: r.id };
        }),
      };
      if (idemKey) idempotency.set(idemKey, { payload: payloadStr, response });
      return HttpResponse.json(response);
    }),

    // GET single
    http.get(`${base}/:type/:id`, ({ params }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      const r = bucket(type).get(id);
      if (!r) return envelope({ status: 404, code: 'not_found', message: `${type} '${id}' not found.`, param: null });
      return HttpResponse.json({ ...r });
    }),

    // LIST — cursor-paginated `{data, has_more, next_cursor}` envelope.
    http.get(`${base}/:type`, ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const all = Array.from(bucket(type).values());
      if (options.brokenCursor) {
        // Always page 1, always "more", never a new cursor → the adapter's
        // non-advancing-cursor guard must abort the walk as incomplete.
        return HttpResponse.json({ data: all.slice(0, pageSize), has_more: true, next_cursor: 'STUCK' });
      }
      const cursorParam = new URL(request.url).searchParams.get('cursor');
      const offset = cursorParam ? (cursorOffsets.get(cursorParam) ?? 0) : 0;
      const slice = all.slice(offset, offset + pageSize);
      const nextOffset = offset + slice.length;
      const hasMore = nextOffset < all.length;
      return HttpResponse.json({ data: slice, has_more: hasMore, next_cursor: hasMore ? mintCursor(nextOffset) : null });
    }),

    // CREATE — 201, preserves client id, echoes full element + timestamps.
    http.post(`${base}/:type`, async ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const body = (await request.json()) as Record<string, unknown>;
      const err = validateBody(body, { requireName: true, hasId: existsAnywhere });
      if (err) return envelope(err);
      const id = (body.id as string | undefined) ?? crypto.randomUUID();
      if (bucket(type).has(id)) {
        return envelope({ status: 409, code: 'id_conflict', message: `${type} '${id}' already exists.`, param: null });
      }
      const ts = clock();
      const record: ServerRecord = { ...body, id, created_at: ts, updated_at: ts };
      bucket(type).set(id, record);
      logUpsert(type, record);
      return HttpResponse.json({ ...record }, { status: 201 });
    }),

    // UPDATE — 200 full-element echo (partial merge; name not required).
    http.patch(`${base}/:type/:id`, async ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      const existing = bucket(type).get(id);
      if (!existing) return envelope({ status: 404, code: 'not_found', message: `${type} '${id}' not found.`, param: null });
      const body = (await request.json()) as Record<string, unknown>;
      const err = validateBody(body, { requireName: false, hasId: existsAnywhere });
      if (err) return envelope(err);
      const ts = clock();
      const record: ServerRecord = { ...existing, ...body, id, created_at: existing.created_at, updated_at: ts };
      bucket(type).set(id, record);
      logUpsert(type, record);
      return HttpResponse.json({ ...record });
    }),

    // PUT — upsert: 201 when fresh, 200 replace when existing.
    http.put(`${base}/:type/:id`, async ({ params, request }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      const body = (await request.json()) as Record<string, unknown>;
      const err = validateBody(body, { requireName: true, hasId: existsAnywhere });
      if (err) return envelope(err);
      const existing = bucket(type).get(id);
      const ts = clock();
      const record: ServerRecord = { ...body, id, created_at: existing?.created_at ?? ts, updated_at: ts };
      bucket(type).set(id, record);
      logUpsert(type, record);
      return HttpResponse.json({ ...record }, { status: existing ? 200 : 201 });
    }),

    // DELETE — idempotent: 204 whether or not the id existed. Only a real
    // removal logs a delete op.
    http.delete(`${base}/:type/:id`, ({ params }) => {
      const blocked = authBlocked();
      if (blocked) return blocked;
      const type = String(params.type);
      const id = String(params.id);
      const m = bucket(type);
      if (m.has(id)) {
        m.delete(id);
        logDelete(type, id, clock());
      }
      return new HttpResponse(null, { status: 204 });
    }),
  ];

  return {
    handlers,
    state,
    opLog,
    __mutate: (type, id, patch) => {
      const existing = bucket(type).get(id);
      if (!existing) throw new Error(`__mutate: ${type}/${id} not found`);
      const record: ServerRecord = { ...existing, ...patch, id, updated_at: clock() };
      bucket(type).set(id, record);
      logUpsert(type, record);
    },
    __mutate_world_meta: (patch) => {
      for (const [k, v] of Object.entries(patch)) worldMeta[k] = v;
      worldMeta.updated_at = clock();
    },
  };
}

// ---------------------------------------------------------------------------
// The join door (#104, conv. 20): keel's /join and /join/preview as built
// (accounts/join_api.py, keel #119). No API-Key: the code is the credential.
// Every bad code (unknown, used, expired) answers the SAME 404; the preview
// never spends a code; a redeem spends it once; agent_name is required.
// ---------------------------------------------------------------------------

export interface FakePass {
  code: string;
  world: { id: string; name: string; description?: string };
  /** keel #212/#353. Left out, the preview sends no `reader` (a keel before #212: an agent code). */
  reader?: 'agent' | 'person' | 'player';
  /** A player code's picked Character; left out, the redeem makes one named for the player. */
  character?: { id: string; name: string };
  role?: 'contributor' | 'co_builder' | 'guest';
  invitedBy?: string | null;
  ownerCharacter?: string | null;
  withCharacter?: boolean;
  /** ISO; default an hour from now. A past value makes the pass expired. */
  expiresAt?: string;
  /**
   * A party link (keel #422 PR 2, PR 110's `table_preview` and `_table_pick`):
   * a player pass with `maxUses` 2 or more. `characters` is the owner's list
   * (empty: each player names a fresh Character); `taken` holds the ids a live
   * seat plays (the fake adds each pick); `hidden` ones leave the preview and
   * are refused at the pick; `worldFull` answers keel's cap (422 world_full).
   */
  maxUses?: number;
  characters?: Array<{ id: string; name: string }>;
  taken?: string[];
  hidden?: string[];
  worldFull?: boolean;
}

export function joinV2Handlers(opts: { baseUrl: string; passes: FakePass[] }): {
  handlers: HttpHandler[];
  redeemed: Array<{ code: string; agent_name: string; key: string; secret: string }>;
} {
  const base = opts.baseUrl.replace(/\/$/, '');
  const used = new Set<string>();
  const redeemed: Array<{ code: string; agent_name: string; key: string; secret: string }> = [];
  const notFound = () => HttpResponse.json(
    { error: { type: 'not_found', code: 'not_found', message: 'This join code is not valid.', param: null } },
    { status: 404 },
  );
  const seats = new Map<string, number>();
  const isTable = (p: FakePass) => p.reader === 'player' && (p.maxUses ?? 1) > 1;
  const live = (code: unknown): FakePass | null => {
    const p = opts.passes.find(x => x.code === code);
    if (!p || used.has(p.code)) return null;
    if (p.expiresAt && Date.parse(p.expiresAt) <= Date.now()) return null;
    if (isTable(p) && (seats.get(p.code) ?? 0) >= p.maxUses!) return null;
    return p;
  };
  const invalid = (message: string, param: string | null, code = 'invalid_request') => HttpResponse.json(
    { error: { type: 'invalid_request', code, message, param } },
    { status: 422 },
  );
  const expires = (p: FakePass) => p.expiresAt ?? new Date(Date.now() + 3_600_000).toISOString();
  const handlers: HttpHandler[] = [
    http.post(`${base}/join/preview`, async ({ request }) => {
      const body = await request.json().catch(() => null) as { code?: unknown } | null;
      const p = live(body?.code);
      if (!p) return notFound();
      return HttpResponse.json({
        ...(p.reader ? { reader: p.reader } : {}),
        world: { name: p.world.name, description: p.world.description ?? '' },
        invited_by: p.invitedBy ?? null,
        owner_character: p.ownerCharacter ?? null,
        role: p.reader === 'player' ? 'guest' : p.role ?? 'contributor',
        with_character: p.reader === 'player' ? true : p.withCharacter ?? false,
        expires_at: expires(p),
        ...(isTable(p) ? {
          max_uses: p.maxUses,
          uses_left: p.maxUses! - (seats.get(p.code) ?? 0),
          name_required: !(p.characters?.length),
          characters: (p.characters ?? []).filter(c => !p.hidden?.includes(c.id))
            .map(c => ({ id: c.id, name: c.name, image_url: null, taken: !!p.taken?.includes(c.id) })),
        } : {}),
      });
    }),
    http.post(`${base}/join`, async ({ request }) => {
      const body = await request.json().catch(() => null) as { code?: unknown; agent_name?: unknown; name?: unknown } | null;
      // keel #353 (join_api.py `_player_join`, agents.redeem_player): a player
      // code takes an optional `name` (checked before the code is touched) and
      // no agent_name, and answers a read key and the Character it reads as.
      const asPlayer = opts.passes.find(x => x.code === body?.code)?.reader === 'player';
      if (asPlayer) {
        if (body!.name !== undefined && body!.name !== null && (typeof body!.name !== 'string' || body!.name.trim().length > 80)) {
          return HttpResponse.json(
            { error: { type: 'invalid_request', code: 'invalid_request', message: 'name must be 80 characters or fewer.', param: 'name' } },
            { status: 422 },
          );
        }
        const p = live(body!.code);
        if (!p) return notFound();
        const n = redeemed.length + 1;
        const name = typeof body!.name === 'string' && body!.name.trim() ? body!.name.trim() : '';
        let character = p.character ?? { id: `char-${n}`, name: name || 'Player' };
        if (isTable(p)) {
          // `_table_pick`: the pick (or the name, on a table with no list), then the world's cap; a refusal spends nothing.
          const pick = (body as { character?: unknown }).character;
          const listed = p.characters ?? [];
          if (!listed.length) {
            if (pick !== undefined && pick !== null && pick !== '') return invalid('This link has no list: send name, not character.', 'character');
            if (!name) return invalid('name is required: your name, as the game master sees it.', 'name');
            character = { id: `char-${n}`, name };
          } else {
            const ch = listed.find(c => c.id === pick && !p.hidden?.includes(c.id));
            if (!ch) return invalid("Pick a Character from this link's list.", 'character');
            if (p.taken?.includes(ch.id)) return invalid('That Character is taken: pick another from the list.', 'character', 'character_taken');
            character = ch;
          }
        }
        if (p.worldFull) return invalid('This world is full: it can have at most 50 players.', null, 'world_full');
        if (isTable(p)) {
          seats.set(p.code, (seats.get(p.code) ?? 0) + 1);
          if (p.characters?.length) (p.taken ??= []).push(character.id);
        } else {
          used.add(p.code);
        }
        const key = `ow_r_playerkey${n}`.padEnd(37, 'r');
        redeemed.push({ code: p.code, agent_name: name, key, secret: '' });
        return HttpResponse.json({
          kind: 'player',
          key,
          world: { id: p.world.id, name: p.world.name, description: p.world.description ?? '' },
          character,
          role: 'guest',
        }, { status: 201 });
      }
      if (typeof body?.agent_name !== 'string' || !body.agent_name.trim() || body.agent_name.length > 80) {
        return HttpResponse.json(
          { error: { type: 'invalid_request', code: 'invalid_request', message: 'agent_name is required.', param: 'agent_name' } },
          { status: 422 },
        );
      }
      const p = live(body.code);
      if (!p) return notFound();
      used.add(p.code);
      const n = redeemed.length + 1;
      const key = `ow_w_seatkey${n}`.padEnd(37, 'k');
      const secret = `ow_s_seatsecret${n}`.padEnd(37, 's');
      redeemed.push({ code: p.code, agent_name: body.agent_name, key, secret });
      return HttpResponse.json({
        world: { id: p.world.id, name: p.world.name, description: p.world.description ?? '' },
        seat: { id: `seat-${n}`, role: p.role ?? 'contributor', agent_name: body.agent_name },
        with_character: p.withCharacter ?? false,
        character: p.withCharacter ? { id: `char-${n}`, name: body.agent_name } : null,
        key,
        pin: secret,
        env: '',
        next: [],
        members: [],
      }, { status: 201 });
    }),
  ];
  return { handlers, redeemed };
}
