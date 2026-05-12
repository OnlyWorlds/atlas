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
}

export function statefulOwHandlers(options: StatefulServerOptions = {}): {
  handlers: HttpHandler[];
  state: Map<string, Map<string, ServerRecord>>;
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

  const handlers: HttpHandler[] = [
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
      const id = (body.id as string) ?? crypto.randomUUID();
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
    __mutate: (type, id, patch) => {
      const existing = bucket(type).get(id);
      if (!existing) throw new Error(`__mutate: ${type}/${id} not found`);
      bucket(type).set(id, { ...existing, ...patch, id, updated_at: clock() });
    },
  };
}
