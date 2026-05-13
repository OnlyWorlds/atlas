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
    this.calls.push({ method: 'create', type, body: { ...body } });
    // Mirror real OW: pin requires element_type whenever element_id is set.
    // Throwing here lets engine/merge tests catch regressions of this rule.
    if (type === 'pin' && body.element_id && !body.element_type) {
      throw new Error('API Error 400: element_type must be provided when element_id is specified');
    }
    // Real OW behavior: ignore client-sent id when assignServerIds=true.
    const id = this.assignServerIds ? cryptoRandomId() : (body.id as string) ?? cryptoRandomId();
    this.throwIfInjected('create', id);
    const record: ServerRecord = { ...body, id, type, updated_at: this.clock() };
    this.bucket(type).set(id, record);
    return { ...record };
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    this.calls.push({ method: 'update', type, id, body: { ...body } });
    this.throwIfInjected('update', id);
    const m = this.bucket(type);
    const existing = m.get(id);
    if (!existing) throw new Error(`update: ${type}/${id} not found`);
    const next: ServerRecord = { ...existing, ...body, id, type, updated_at: this.clock() };
    m.set(id, next);
    return { ...next };
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    this.calls.push({ method: 'delete', type, id });
    this.throwIfInjected('delete', id);
    this.bucket(type).delete(id);
  }

  async listElements(type: ElementType): Promise<ServerRecord[]> {
    this.calls.push({ method: 'list', type });
    return Array.from(this.bucket(type).values()).map(r => ({ ...r }));
  }

  async getElement(type: ElementType, id: string): Promise<ServerRecord | null> {
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
