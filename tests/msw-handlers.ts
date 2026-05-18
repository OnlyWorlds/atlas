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

const DEFAULT_BASE = 'https://www.onlyworlds.com/api/worldapi';

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
    // 200: { success: true, api_key: string }
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
      return HttpResponse.json({ success: true, api_key });
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
      const ATLAS_LOCAL = ['image_media_id', 'atlas_color', 'atlas_opacity', 'atlas_label_visible', 'atlas_shape', 'local_updated_at', 'server_updated_at'];
      const bannedLocal = Object.keys(body).find(k => ATLAS_LOCAL.includes(k));
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
      const ATLAS_LOCAL_UPD = ['image_media_id', 'atlas_color', 'atlas_opacity', 'atlas_label_visible', 'atlas_shape', 'local_updated_at', 'server_updated_at'];
      const bannedLocalUpd = Object.keys(body).find(k => ATLAS_LOCAL_UPD.includes(k));
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
