/**
 * FakeOwApiClient — in-memory adapter that satisfies the OwApiClient interface
 * the SyncEngine expects. Tests can either use this directly (clean assertions
 * on captured calls) or route to MSW handlers via a real SDK client (more
 * faithful but heavier).
 *
 * For Phase 0 / 1 unit tests, this is enough.
 */

import type { OwApiClient } from '../../src/sync/sync-engine';
import type { ElementType } from '../../src/core/types';

interface ServerRecord {
  id: string;
  type: ElementType;
  updated_at: string;
  [field: string]: unknown;
}

export class FakeOwApiClient implements OwApiClient {
  private clock = () => new Date().toISOString();
  private byType = new Map<ElementType, Map<string, ServerRecord>>();
  /** Test seam: per-id-and-operation error injection. */
  private injectedFailures = new Map<string, { msg: string }>();
  /**
   * Test seam: when true, CREATE ignores client-sent `id` and assigns a fresh
   * uuid (simulating real OW server behavior that enforces v7 format).
   * Tests covering the id-swap path on CREATE should enable this.
   */
  assignServerIds = false;
  /**
   * Test seam: types reported as paginated via getPaginatedTypes(). Lets
   * server-delete tests simulate "server has more elements than our first
   * page returned" without actually paginating responses.
   */
  private forcedPaginatedTypes = new Set<ElementType>();
  /**
   * Test seam: when true, EVERY CRUD operation throws 401. Mirrors real-OW
   * behavior when credentials go dead — bad PIN, revoked api_key, or world
   * deleted server-side (which invalidates the api_key). Engine should
   * detect via isAuthError and transition to error state.
   */
  private authBlocked = false;

  // Capture of every call for assertion.
  calls: Array<
    | { method: 'create'; type: ElementType; body: Record<string, unknown> }
    | { method: 'update'; type: ElementType; id: string; body: Record<string, unknown> }
    | { method: 'delete'; type: ElementType; id: string }
    | { method: 'list'; type: ElementType }
    | { method: 'get'; type: ElementType; id: string }
  > = [];

  setClock(fn: () => string): void { this.clock = fn; }

  private bucket(type: ElementType): Map<string, ServerRecord> {
    let m = this.byType.get(type);
    if (!m) { m = new Map(); this.byType.set(type, m); }
    return m;
  }

  async createElement(type: ElementType, body: Record<string, unknown>): Promise<ServerRecord> {
    this.throwIfAuthBlocked();
    // Mirror real-OW wire semantics: JSON.stringify drops undefined values,
    // so any field set to `undefined` in the body never reaches the server.
    // Without this, FakeOwApiClient would mask UI bugs that pass `undefined`
    // for "clear this field" (real OW would interpret the missing key as
    // "no change", FakeOwApiClient would otherwise apply it as "clear").
    const wireBody = stripUndefined(body);
    this.calls.push({ method: 'create', type, body: { ...wireBody } });
    // Mirror real OW: pin requires element_type whenever element_id is set.
    // Throwing here lets engine/merge tests catch regressions of this rule.
    if (type === 'pin' && wireBody.element_id && !wireBody.element_type) {
      throw new Error('API Error 400: element_type must be provided when element_id is specified');
    }
    // Convention #8 invariant: spatial element bodies (pin, marker) carry
    // wire-shape relation fields directly (map_id, zone_id, element_id).
    // Running them through prepareRelations double-suffixes the field to
    // map_id_id / zone_id_id / element_id_id — the server then 4xx's. The
    // fake encodes the invariant so any code path violating it fails its
    // tests immediately (Convention #20). The fix is to bypass
    // prepareRelations in the adapter for these types.
    rejectDoubleSuffix(type, wireBody, 'create');
    // Real OW behavior: ignore client-sent id when assignServerIds=true.
    const id = this.assignServerIds ? cryptoRandomId() : (wireBody.id as string) ?? cryptoRandomId();
    this.throwIfInjected('create', id);
    const record: ServerRecord = { ...wireBody, id, type, updated_at: this.clock() };
    this.bucket(type).set(id, record);
    return { ...record };
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    this.throwIfAuthBlocked();
    // Same wire-semantics rule as createElement: drop undefined before the
    // spread-merge. Real PATCH treats a missing key as "no change"; only an
    // explicit `null` (or a new value) overwrites the field.
    const wireBody = stripUndefined(body);
    this.calls.push({ method: 'update', type, id, body: { ...wireBody } });
    this.throwIfInjected('update', id);
    rejectDoubleSuffix(type, wireBody, 'update');
    const m = this.bucket(type);
    const existing = m.get(id);
    // Mirror real OW: PATCH on a deleted/unknown id returns 404 with the
    // "X not found in this world" body. The engine treats this as a
    // server-side delete and routes via the same review modal as pull-time
    // detection — see pushPhase / resolveConflict.
    if (!existing) throw new Error(`API Error 404: ${id} not found in this world.`);
    const next: ServerRecord = { ...existing, ...wireBody, id, type, updated_at: this.clock() };
    m.set(id, next);
    return { ...next };
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    this.throwIfAuthBlocked();
    this.calls.push({ method: 'delete', type, id });
    this.throwIfInjected('delete', id);
    // Mirror real OW (DRF default): DELETE of an unknown id returns 404.
    // The engine treats this as "already gone" and clears the tombstone, so
    // unknown-id tombstones (never-synced local deletes) don't accumulate.
    // Tests verifying that recovery path rely on this rule being enforced.
    const m = this.bucket(type);
    if (!m.has(id)) {
      throw new Error(`API Error 404: Not found.`);
    }
    m.delete(id);
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    this.throwIfAuthBlocked();
    this.calls.push({ method: 'list', type });
    return Array.from(this.bucket(type).values()).map(r => ({ ...r }));
  }

  async getElement(type: ElementType, id: string): Promise<ServerRecord | null> {
    this.throwIfAuthBlocked();
    this.calls.push({ method: 'get', type, id });
    const r = this.bucket(type).get(id);
    return r ? { ...r } : null;
  }

  /** Engine reads this to learn which types are paginated. */
  getPaginatedTypes(): ReadonlySet<ElementType> {
    return this.forcedPaginatedTypes;
  }

  /** Test seam: mark a type as paginated for the engine's safety check. */
  __force_paginated(type: ElementType, enabled = true): void {
    if (enabled) this.forcedPaginatedTypes.add(type);
    else this.forcedPaginatedTypes.delete(type);
  }

  /**
   * Test seam: simulate dead credentials. When enabled, ALL CRUD ops throw
   * 401. Toggle off to simulate "PIN was fixed in settings" (which in
   * production triggers attachSyncEngine to spin up a fresh engine with new
   * creds — engine error state clears on the new instance).
   */
  __inject_auth_failure(enabled = true): void {
    this.authBlocked = enabled;
  }

  private throwIfAuthBlocked(): void {
    if (this.authBlocked) {
      throw new Error('API Error 401: Unauthorized');
    }
  }

  /** Server-side mutation that doesn't show up in `calls` — for setting up
   *  conflict scenarios in tests without polluting the call log. */
  __server_mutate(type: ElementType, id: string, patch: Record<string, unknown>): void {
    const m = this.bucket(type);
    const existing = m.get(id);
    if (!existing) throw new Error(`__server_mutate: ${type}/${id} not found`);
    m.set(id, { ...existing, ...patch, id, type, updated_at: this.clock() });
  }

  /**
   * Inject a failure for a specific (operation, id). The next call to that
   * operation on that id will throw with the given message instead of
   * succeeding. Used to verify the engine tolerates per-element errors.
   */
  __inject_failure(op: 'create' | 'update' | 'delete', id: string, msg = 'injected failure'): void {
    this.injectedFailures.set(`${op}:${id}`, { msg });
  }

  private throwIfInjected(op: 'create' | 'update' | 'delete', id: string): void {
    const key = `${op}:${id}`;
    const f = this.injectedFailures.get(key);
    if (f) {
      this.injectedFailures.delete(key); // one-shot
      throw new Error(f.msg);
    }
  }

  // Test introspection
  __server_count(type: ElementType): number { return this.bucket(type).size; }
  __server_get(type: ElementType, id: string): ServerRecord | undefined { return this.bucket(type).get(id); }
}

function cryptoRandomId(): string {
  // Mirror the engine's behavior. In tests we expect callers to provide ids.
  return crypto.randomUUID();
}

/**
 * Strip keys with `undefined` value. Mirrors what JSON.stringify does to a
 * request body on the way out of fetch — undefined fields don't cross the
 * network, so the server never sees them. Real PATCH treats a missing key
 * as "no change to this field"; an explicit `null` is "clear this field".
 *
 * Without this stripping, FakeOwApiClient would silently apply
 * `{ field: undefined }` via spread-merge — masking UI bugs that pass
 * undefined when they mean "clear" (those bugs would surface only against
 * MSW or real OW).
 */
function stripUndefined(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return out;
}

/**
 * Throw on double-suffixed relation fields for pin/marker bodies. These
 * spatial types carry wire-shape relation names (map_id, zone_id, element_id)
 * on disk; the adapter must bypass prepareRelations for them. If any
 * `*_id_id` or `*_ids_ids` key appears, the bypass is broken — reject so the
 * regression is caught in tests rather than only at runtime against real OW.
 *
 * See ow-client-adapter.ts:244 (bypass set) and DESIGN_ZONES.md §8.1.
 */
function rejectDoubleSuffix(
  type: ElementType,
  body: Record<string, unknown>,
  op: 'create' | 'update',
): void {
  if (type !== 'pin' && type !== 'marker') return;
  for (const k of Object.keys(body)) {
    if (k.endsWith('_id_id') || k.endsWith('_ids_ids')) {
      throw new Error(
        `API Error 400: ${op} ${type} body contains double-suffixed relation field "${k}". ` +
          `The adapter must bypass prepareRelations for ${type}; see ow-client-adapter.ts:244.`,
      );
    }
  }
  // Marker.order is write-allowed as of 2026-05-16 (Anchor migration).
  // No rejection rule here.
}
