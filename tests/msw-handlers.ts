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
    http.get(`${base}/:type/`, ({ params }) => {
      const type = String(params.type);
      const records = Array.from(bucket(type).values()).map(maybeNestRelations);
      return HttpResponse.json(records);
    }),
    // GET single
    http.get(`${base}/:type/:id/`, ({ params }) => {
      const type = String(params.type);
      const id = String(params.id);
      const r = bucket(type).get(id);
      if (!r) return HttpResponse.json({ error: 'not found' }, { status: 404 });
      return HttpResponse.json(maybeNestRelations(r));
    }),
    // CREATE
    http.post(`${base}/:type/`, async ({ params, request }) => {
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
      const type = String(params.type);
      const id = String(params.id);
      const existing = bucket(type).get(id);
      if (!existing) return HttpResponse.json({ error: 'not found' }, { status: 404 });
      const body = (await request.json()) as Record<string, unknown>;
      const next: ServerRecord = { ...existing, ...body, id, updated_at: clock() };
      bucket(type).set(id, next);
      return HttpResponse.json(maybeNestRelations(next));
    }),
    // DELETE
    http.delete(`${base}/:type/:id/`, ({ params }) => {
      const type = String(params.type);
      const id = String(params.id);
      bucket(type).delete(id);
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
