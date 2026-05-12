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
    const id = (body.id as string) ?? cryptoRandomId();
    const record: ServerRecord = { ...body, id, type, updated_at: this.clock() };
    this.bucket(type).set(id, record);
    return { ...record };
  }

  async updateElement(type: ElementType, id: string, body: Record<string, unknown>): Promise<ServerRecord> {
    this.calls.push({ method: 'update', type, id, body: { ...body } });
    const m = this.bucket(type);
    const existing = m.get(id);
    if (!existing) throw new Error(`update: ${type}/${id} not found`);
    const next: ServerRecord = { ...existing, ...body, id, type, updated_at: this.clock() };
    m.set(id, next);
    return { ...next };
  }

  async deleteElement(type: ElementType, id: string): Promise<void> {
    this.calls.push({ method: 'delete', type, id });
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

  /** Server-side mutation that doesn't show up in `calls` — for setting up
   *  conflict scenarios in tests without polluting the call log. */
  __server_mutate(type: ElementType, id: string, patch: Record<string, unknown>): void {
    const m = this.bucket(type);
    const existing = m.get(id);
    if (!existing) throw new Error(`__server_mutate: ${type}/${id} not found`);
    m.set(id, { ...existing, ...patch, id, type, updated_at: this.clock() });
  }

  // Test introspection
  __server_count(type: ElementType): number { return this.bucket(type).size; }
  __server_get(type: ElementType, id: string): ServerRecord | undefined { return this.bucket(type).get(id); }
}

function cryptoRandomId(): string {
  // Mirror the engine's behavior. In tests we expect callers to provide ids.
  return crypto.randomUUID();
}
