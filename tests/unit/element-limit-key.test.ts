/**
 * keel names which of its limits a 422 `invalid_request` passed, in the
 * envelope's `limit` (`element_bytes`, `element_link_ids`, `extensions_bytes`,
 * each a key of the API document's `info.x-ow-limits`; an open string), and in
 * a `/bulk` item's slot. Read off the wire into the failure record, so the
 * words choose by the key and keep the sentence only as the fallback.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { SyncEngine } from '../../src/sync/sync-engine';
import { classifyFailure } from '../../src/sync/sync-failure-copy';
import type { PerElementFailure } from '../../src/core/types';

const SENTENCE = 'This location was not saved: an element holds at most 1 MB of text and links. Shorten a text, or split it over more than one element.';

function adapter(): OwV2ClientAdapter {
  return new OwV2ClientAdapter({ apiKey: 'ow_test', apiPin: '', baseUrl: 'https://keel.test/api/v2' });
}

function answer(status: number, body: unknown): void {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));
}

describe('keel\'s limit key, read off the wire', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a refusal carries the envelope\'s limit; absent, it is null', async () => {
    answer(422, { error: { type: 'invalid_request', code: 'invalid_request', message: SENTENCE, param: null, limit: 'element_link_ids' } });
    const err = await adapter().pullChanges('5:x').catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 422, code: 'invalid_request', limit: 'element_link_ids' });

    answer(422, { error: { type: 'invalid_request', code: 'invalid_request', message: SENTENCE, param: null } });
    expect(await adapter().pullChanges('5:x').catch((e: unknown) => e)).toMatchObject({ limit: null });

    answer(422, { error: { type: 'invalid_request', code: 'invalid_request', message: SENTENCE, param: null, limit: 7 } });
    expect(await adapter().pullChanges('5:x').catch((e: unknown) => e)).toMatchObject({ limit: null });
  });

  it('a /bulk slot carries its limit, and a slot without one carries none', async () => {
    // keel answers a /bulk with failed items 200, `errors: true`, each refusal in its slot (core/bulk_api.py).
    answer(200, {
      errors: true,
      items: [
        { status: 422, id: 'a', error: { code: 'invalid_request', message: SENTENCE, param: null, limit: 'element_bytes' } },
        { status: 422, id: 'b', error: { code: 'invalid_request', message: SENTENCE, param: null } },
      ],
    });
    const res = await adapter().bulkCreate([], { createOnly: true });
    expect(res.items[0].error).toMatchObject({ limit: 'element_bytes' });
    expect(res.items[1].error && 'limit' in res.items[1].error).toBe(false);
  });
});

describe('the engine keeps the limit on the failure record', () => {
  it('a refused step\'s record holds the limit, and the words read it', async () => {
    const refusal = Object.assign(new Error(`API Error 422: ${SENTENCE}`), { status: 422, code: 'invalid_request', param: null, limit: 'element_link_ids' });
    let syncState: Record<string, unknown> = { meta_baseline: { description: 'old' } };
    const folder = {
      readSyncState: async () => syncState,
      updateSyncState: async (fn: (s: Record<string, unknown>) => Record<string, unknown>) => { syncState = { ...syncState, ...fn(syncState) }; },
      readWorldMeta: async () => ({ description: 'new' }),
      writeWorldMeta: async () => {},
    };
    const client = {
      getWorldMeta: async () => ({ description: 'old', updated_at: '2026-11-27T00:00:00Z' }),
      patchWorldMeta: async () => { throw refusal; },
    };
    const engine = new SyncEngine({ folder: folder as never, client: client as never });
    const { failures } = await (engine as unknown as { executeMetaStep: () => Promise<{ failures: PerElementFailure[] }> }).executeMetaStep();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ status: 422, code: 'invalid_request', limit: 'element_link_ids' });
    expect(classifyFailure(failures[0])).toBe('over_limit');
  });
});
