/**
 * Kael's collaborator walk (2026-10-18, finding 6): a co-builder's edit to
 * the world's own details is refused by keel (403 `owner_only`), stays in the
 * browser, and was re-sent and re-told on every sync round. The engine now
 * remembers the refusal for exactly those fields: the same dirty fields are
 * not PATCHed again and report the SAME failure object, so the toast says it
 * once; a new edit tries again. Any other failure still retries as before.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { SyncEngine } from '../../src/sync/sync-engine';
import { failureToastOnce, __resetFailureToasts } from '../../src/sync/sync-failure-copy';

function apiError(status: number, code: string): Error {
  return Object.assign(new Error(`API Error ${status}`), { status, code, param: null });
}

function harness(refuseWith: () => Error) {
  let local: Record<string, unknown> = { description: 'new' };
  let syncState: Record<string, unknown> = { meta_baseline: { description: 'old' } };
  const patches: Array<Record<string, unknown>> = [];
  const folder = {
    readSyncState: async () => syncState,
    updateSyncState: async (fn: (s: Record<string, unknown>) => Record<string, unknown>) => { syncState = { ...syncState, ...fn(syncState) }; },
    readWorldMeta: async () => local,
    writeWorldMeta: async () => {},
  };
  const client = {
    getWorldMeta: async () => ({ description: 'old', updated_at: '2026-10-18T00:00:00Z' }),
    patchWorldMeta: async (body: Record<string, unknown>) => { patches.push(body); throw refuseWith(); },
  };
  const engine = new SyncEngine({ folder: folder as never, client: client as never });
  const step = () => (engine as unknown as { executeMetaStep: () => Promise<{ failures: never[] }> }).executeMetaStep();
  return { step, patches, edit: (d: string) => { local = { description: d }; } };
}

describe('a refused world-details change is sent and told once', () => {
  beforeEach(() => __resetFailureToasts());

  it('owner_only: the same fields are not PATCHed again and the toast is said once; a new edit tries again', async () => {
    const h = harness(() => apiError(403, 'owner_only'));

    const first = await h.step();
    expect(h.patches).toHaveLength(1);
    expect(first.failures).toHaveLength(1);
    expect(failureToastOnce(first.failures, 'browser')).toMatch(/only its owner can change them/);

    const second = await h.step();
    expect(h.patches).toHaveLength(1);                  // not re-sent
    expect(second.failures).toHaveLength(1);            // still honest: not synced
    expect(second.failures[0]).toBe(first.failures[0]); // the same failure...
    expect(failureToastOnce(second.failures, 'browser')).toBeNull(); // ...told once

    h.edit('newer');
    await h.step();
    expect(h.patches).toHaveLength(2);                  // a new edit tries again
  });

  it('control: any other failure still retries every round', async () => {
    const h = harness(() => apiError(500, 'server_error'));
    await h.step();
    await h.step();
    expect(h.patches).toHaveLength(2);
  });
});

/**
 * Kael 2026-10-19: keel lets a co-builder send the world's now alone (keel #240,
 * core/world_api.py patch_world) and refuses any other body whole. A round that
 * changed the description and the now together lost the now too. The fake
 * keel below holds keel's own rule for a member key.
 */
function coBuilderHarness(role: 'co_builder' | 'guest') {
  let local: Record<string, unknown> = { description: 'new', time_current: 7 };
  let syncState: Record<string, unknown> = { meta_baseline: { description: 'old', time_current: 3 } };
  const server: Record<string, unknown> = { description: 'old', time_range_current: 3, updated_at: '2026-10-19T00:00:00Z' };
  const patches: Array<Record<string, unknown>> = [];
  const folder = {
    readSyncState: async () => syncState,
    updateSyncState: async (fn: (s: Record<string, unknown>) => Record<string, unknown>) => { syncState = { ...syncState, ...fn(syncState) }; },
    readWorldMeta: async () => local,
    writeWorldMeta: async () => {},
  };
  const client = {
    getWorldMeta: async () => ({ description: server.description, time_current: server.time_range_current, updated_at: server.updated_at }),
    patchWorldMeta: async (body: Record<string, unknown>) => {
      patches.push(body);
      const keys = Object.keys(body);
      // The client speaks disk names; the adapter renames time_current on the wire.
      if (role !== 'co_builder' || keys.length !== 1 || keys[0] !== 'time_current') throw apiError(403, 'owner_only');
      server.time_range_current = body.time_current;
      return { description: server.description, time_current: server.time_range_current, updated_at: server.updated_at };
    },
  };
  const engine = new SyncEngine({ folder: folder as never, client: client as never });
  const step = () => (engine as unknown as { executeMetaStep: () => Promise<{ meta_pushed: string[]; failures: never[] }> }).executeMetaStep();
  return { step, patches, server, edit: (d: string) => { local = { ...local, description: d }; } };
}

describe('a co-builder\'s now goes through when the round also changed owner-only details', () => {
  beforeEach(() => __resetFailureToasts());

  it('co-builder: the now lands alone, the description stays refused and is told once', async () => {
    const h = coBuilderHarness('co_builder');

    const first = await h.step();
    expect(h.patches).toEqual([
      { description: 'new', time_current: 7 },
      { time_current: 7 },
    ]);
    expect(h.server.time_range_current).toBe(7);
    expect(first.meta_pushed).toEqual(['time_current']);
    expect(first.failures).toHaveLength(1);
    expect(failureToastOnce(first.failures, 'browser')).toMatch(/only its owner can change them/);

    const second = await h.step();
    expect(h.patches).toHaveLength(2);                  // the description is not re-sent
    expect(second.failures[0]).toBe(first.failures[0]);
    expect(failureToastOnce(second.failures, 'browser')).toBeNull();

    h.edit('newer');
    await h.step();
    expect(h.patches).toHaveLength(3);                  // a new edit tries again
  });

  it('control: a guest\'s now is refused too, and the pair is not sent again', async () => {
    const h = coBuilderHarness('guest');
    await h.step();
    expect(h.patches).toHaveLength(2);
    expect(h.server.time_range_current).toBe(3);
    await h.step();
    expect(h.patches).toHaveLength(2);
  });
});
