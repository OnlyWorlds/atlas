/**
 * S429, Kael's collaborator walk (h57 #7224, finding 6): a co-builder's edit to
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
