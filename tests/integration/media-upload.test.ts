/**
 * The picture upload (Atlas #154): a ticket from keel
 * with the world's own PIN, the bytes to the edge with only the ticket, one
 * retry on a spent ticket, and keel's and the edge's refusals worded. keel
 * (`media/api.py`) and the edge (the upload worker) are
 * stood in for by MSW with their real shapes: keel's error envelope, the
 * edge's `{ error: "<code>" }`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { isPlainError } from '../../src/core/plain-error';

const TEST_BASE = 'https://test-ow.local/api/v2';
const EDGE = 'https://edge.test/v1/upload';
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  buildV2Adapter: (apiKey: string, apiPin: string) => new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: TEST_BASE }),
}));
import { uploadPicture, setEdgeOriginsForTests } from '../../src/sync/media-upload';

const SECRET = 'ow_s_' + 'S'.repeat(32);
const png = (bytes = 64) => new Blob([new Uint8Array(bytes)], { type: 'image/png' });

interface Seen { tickets: Array<Record<string, string | null>>; edge: Array<Record<string, string | null>> }
function serve(opts: { ticketError?: { status: number; code: string }; edgeErrors?: Array<{ status: number; error: string }>; maxBytes?: number; uploadUrl?: string } = {}): Seen {
  const seen: Seen = { tickets: [], edge: [] };
  const edgeErrors = [...(opts.edgeErrors ?? [])];
  let n = 0;
  mswServer.use(
    http.post(`${TEST_BASE}/media/ticket`, ({ request }) => {
      seen.tickets.push({ key: request.headers.get('API-Key'), pin: request.headers.get('API-Pin') });
      if (opts.ticketError) {
        return HttpResponse.json({ error: { type: 'permission_error', code: opts.ticketError.code, message: 'refused', param: null } }, { status: opts.ticketError.status });
      }
      n++;
      return HttpResponse.json({ ticket: `t${n}`, upload_url: opts.uploadUrl ?? EDGE, prefix: 'u/w1/', max_bytes: opts.maxBytes ?? 15 * 1024 * 1024, exp: 0, uses: 1 }, { status: 201 });
    }),
    http.post(EDGE, async ({ request }) => {
      seen.edge.push({ auth: request.headers.get('Authorization'), key: request.headers.get('API-Key'), pin: request.headers.get('API-Pin') });
      const e = edgeErrors.shift();
      if (e) return HttpResponse.json({ error: e.error }, { status: e.status });
      return HttpResponse.json({ url: 'https://media.onlyworlds.com/u/w1/abc.png', key: 'u/w1/abc.png', bytes: 64, type: 'image/png', etag: 'x' }, { status: 201 });
    }),
  );
  return seen;
}

const world = (api: WorldRegistryEntry['api'], state: WorldRegistryEntry['state'] = 'api-linked'): WorldRegistryEntry => ({
  id: 'w-local', name: 'Moppetopia', state, ...(api ? { api } : {}),
  folder: { handle_key: 'k', folder_name: 'moppetopia' }, created_at: '2026-01-01T00:00:00.000Z',
} as WorldRegistryEntry);
const reg = (pin?: string): WorldsRegistry => ({ ...defaultRegistry(), worlds: [], ...(pin ? { pin } : {}) });
const sentenceOf = async (p: Promise<unknown>): Promise<string> => {
  const err = await p.then(() => null, e => e);
  expect(isPlainError(err)).toBe(true);
  return (err as Error).message;
};

beforeEach(() => { setEdgeOriginsForTests(['https://edge.test']); });
afterEach(() => { setEdgeOriginsForTests(null); mswServer.resetHandlers(); });

describe('uploadPicture', () => {
  it('asks keel with the world key and PIN, sends the edge only the ticket, and answers the picture address', async () => {
    const seen = serve();
    const url = await uploadPicture(world({ world_id: 'w1', api_key: 'ow_w_owner' }), reg('1234'), png());
    expect(url).toBe('https://media.onlyworlds.com/u/w1/abc.png');
    expect(seen.tickets).toEqual([{ key: 'ow_w_owner', pin: '1234' }]);
    expect(seen.edge).toEqual([{ auth: 'Bearer t1', key: null, pin: null }]);
  });

  it('a seat world asks with its own secret, never the account PIN (conv. 132)', async () => {
    const seen = serve();
    await uploadPicture(world({ world_id: 'w1', api_key: 'ow_w_seat', seat: { role: 'contributor' }, seat_secret: SECRET }), reg('1234'), png());
    expect(seen.tickets).toEqual([{ key: 'ow_w_seat', pin: SECRET }]);
  });

  it('a spent ticket is replaced once; a second refusal is not retried', async () => {
    const seen = serve({ edgeErrors: [{ status: 401, error: 'ticket_expired' }] });
    expect(await uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png())).toMatch(/^https:/);
    expect(seen.edge.map(e => e.auth)).toEqual(['Bearer t1', 'Bearer t2']);

    const again = serve({ edgeErrors: [{ status: 401, error: 'ticket_used' }, { status: 401, error: 'ticket_used' }] });
    await expect(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png())).rejects.toBeTruthy();
    expect(again.edge).toHaveLength(2);
  });

  it('keel\'s refusals with their own sentence', async () => {
    serve({ ticketError: { status: 403, code: 'storage_full' } });
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png()))).toMatch(/used all of its picture storage/);
    serve({ ticketError: { status: 429, code: 'quota_exceeded' } });
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png()))).toMatch(/limit of picture uploads/);
  });

  it('too large is caught before the edge, against the ticket\'s own limit', async () => {
    const seen = serve({ maxBytes: 1000 });
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png(5000)))).toMatch(/OnlyWorlds takes pictures up to/);
    expect(seen.edge).toHaveLength(0);
  });

  it('a type the edge refuses: a GIF never asks, and the edge\'s own refusal is worded', async () => {
    const seen = serve({ edgeErrors: [{ status: 415, error: 'unsupported_type' }] });
    const gif = new Blob([new Uint8Array(8)], { type: 'image/gif' });
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), gif))).toMatch(/WebP, PNG, JPEG or AVIF\. This file is GIF/);
    expect(seen.tickets).toHaveLength(0);
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png()))).toMatch(/This file is none of those/);
  });

  it('a ticket naming an upload address Atlas does not know is never sent there', async () => {
    const seen = serve({ uploadUrl: 'https://elsewhere.test/v1/upload' });
    await expect(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg('1234'), png())).rejects.toThrow(/upload address Atlas does not know/);
    expect(seen.edge).toHaveLength(0);
  });

  it('a world that cannot take a picture says why and asks nothing', async () => {
    const seen = serve();
    expect(await sentenceOf(uploadPicture(world(undefined, 'local-only'), reg('1234'), png()))).toMatch(/use Make online first/);
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k', read_only: true }), reg('1234'), png()))).toMatch(/view-only/);
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k', seat: {} }), reg('1234'), png()))).toMatch(/opened on a seat/);
    expect(await sentenceOf(uploadPicture(world({ world_id: 'w1', api_key: 'k' }), reg(), png()))).toMatch(/needs your OnlyWorlds PIN/);
    expect(seen.tickets).toHaveLength(0);
  });
});
