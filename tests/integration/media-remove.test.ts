/**
 * Removing an uploaded picture (Boss's removal contract, 2026-10-10;
 * Skeld 2026-10-10): a removal ticket from keel with the world's own
 * PIN and `{key}`, then the edge's /v1/remove with only the ticket. keel
 * (`media/api.py` remove_ticket) and the edge (the upload worker's removal)
 * are stood in for with their real shapes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { isPlainError } from '../../src/core/plain-error';

const TEST_BASE = 'https://test-ow.local/api/v2';
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  buildV2Adapter: (apiKey: string, apiPin: string) => new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: TEST_BASE }),
}));
import { removePicture, uploadedPictureKey, setEdgeOriginsForTests } from '../../src/sync/media-upload';
import { elementsShowing } from '../../src/middle/element-detail-picture';

const KEY = 'u/w1/01a12531-f898-7eb3-9048-28f63d4d5773.webp';

interface Seen { tickets: Array<{ key: string | null; pin: string | null; body: unknown }>; edge: Array<{ auth: string | null; key: string | null }> }
type Reply = { status: number; body: unknown; retryAfter?: string };
function serve(opts: { ticketReplies?: Reply[]; edgeReply?: Reply } = {}): Seen {
  const seen: Seen = { tickets: [], edge: [] };
  const ticketReplies = [...(opts.ticketReplies ?? [])];
  mswServer.use(
    http.post(`${TEST_BASE}/media/remove-ticket`, async ({ request }) => {
      seen.tickets.push({ key: request.headers.get('API-Key'), pin: request.headers.get('API-Pin'), body: await request.json() });
      const r = ticketReplies.shift();
      if (r) return HttpResponse.json(r.body as object, { status: r.status, headers: r.retryAfter ? { 'Retry-After': r.retryAfter } : {} });
      return HttpResponse.json({ ticket: 'd1.abc', exp: '2026-10-10T13:00:00Z', key: KEY, referenced: 1 });
    }),
    http.post('https://edge.test/v1/remove', ({ request }) => {
      seen.edge.push({ auth: request.headers.get('Authorization'), key: request.headers.get('API-Key') });
      const r = opts.edgeReply;
      if (r) return HttpResponse.json(r.body as object, { status: r.status });
      return HttpResponse.json({ removed: KEY, bytes: 109850, cache: 'may_linger' });
    }),
  );
  return seen;
}
const keelError = (status: number, code: string) => ({ error: { type: 'invalid_request', code, message: code, param: null } });

const world = (): WorldRegistryEntry => ({
  id: 'w-local', name: 'The Manifest', state: 'api-linked', api: { world_id: 'w1', api_key: 'ow_w_owner' },
  folder: { handle_key: 'k', folder_name: 'manifest' }, created_at: '2026-01-01T00:00:00.000Z',
} as WorldRegistryEntry);
const reg = (pin?: string): WorldsRegistry => ({ ...defaultRegistry(), worlds: [], ...(pin ? { pin } : {}) });
const sentenceOf = async (p: Promise<unknown>): Promise<string> => {
  const err = await p.then(() => null, e => e);
  expect(isPlainError(err)).toBe(true);
  return (err as Error).message;
};

beforeEach(() => { setEdgeOriginsForTests(['https://edge.test']); });
afterEach(() => { setEdgeOriginsForTests(null); mswServer.resetHandlers(); });

describe('uploadedPictureKey', () => {
  it('a picture uploaded into this world names its key', () => {
    expect(uploadedPictureKey(`https://media.onlyworlds.com/${KEY}`, 'w1')).toBe(KEY);
    expect(uploadedPictureKey(`https://media.onlyworlds.com/${KEY}?v=2`, 'w1')).toBe(KEY);
  });
  it('anything else names none: another world, the crew\'s uploads, another host, no URL', () => {
    expect(uploadedPictureKey(`https://media.onlyworlds.com/${KEY}`, 'w2')).toBeNull();
    expect(uploadedPictureKey('https://media.onlyworlds.com/worlds/moppetopia/maps/space.webp', 'w1')).toBeNull();
    expect(uploadedPictureKey(`https://example.com/${KEY}`, 'w1')).toBeNull();
    expect(uploadedPictureKey('https://media.onlyworlds.com/u/w1/', 'w1')).toBeNull();
    expect(uploadedPictureKey(undefined, 'w1')).toBeNull();
  });
});

describe('elementsShowing', () => {
  it('counts every element whose image URL is the picture, and no other', () => {
    const els = [
      { id: 'a', image_url: `https://media.onlyworlds.com/${KEY}` },
      { id: 'b', image_url: `https://media.onlyworlds.com/${KEY}?x=1` },
      { id: 'c', image_url: 'https://media.onlyworlds.com/u/w1/other.webp' },
      { id: 'd' },
    ] as never[];
    expect(elementsShowing(KEY, els).map((e: { id: string }) => e.id)).toEqual(['a', 'b']);
  });
});

describe('removePicture', () => {
  it('asks keel with the key and the PIN, sends the edge only the ticket, and says what keel counted', async () => {
    const seen = serve();
    expect(await removePicture(world(), reg('1234'), KEY)).toEqual({ referenced: 1, cacheMayLinger: true });
    expect(seen.tickets).toEqual([{ key: 'ow_w_owner', pin: '1234', body: { key: KEY } }]);
    expect(seen.edge).toEqual([{ auth: 'Bearer d1.abc', key: null }]);
  });

  it('a removal asked as the upload reports in: one retry after keel\'s 404, then done', async () => {
    const seen = serve({ ticketReplies: [{ status: 404, body: keelError(404, 'not_found') }] });
    await removePicture(world(), reg('1234'), KEY);
    expect(seen.tickets).toHaveLength(2);
    expect(seen.edge).toHaveLength(1);
  });

  it('a second 404 is said: nothing removable at that address', async () => {
    const seen = serve({ ticketReplies: [1, 2].map(() => ({ status: 404, body: keelError(404, 'not_found') })) });
    expect(await sentenceOf(removePicture(world(), reg('1234'), KEY))).toMatch(/no picture at this address that can be removed/);
    expect(seen.tickets).toHaveLength(2);
    expect(seen.edge).toHaveLength(0);
  });

  it('a removal still in flight says when to try again, with no quiet retry', async () => {
    const seen = serve({ ticketReplies: [{ status: 409, body: keelError(409, 'removal_in_flight'), retryAfter: '240' }] });
    expect(await sentenceOf(removePicture(world(), reg('1234'), KEY))).toMatch(/Try again in 4 minutes/);
    expect(seen.tickets).toHaveLength(1);
  });

  it('someone who is neither uploader nor owner is told who may remove it', async () => {
    serve({ ticketReplies: [{ status: 403, body: { error: { type: 'permission_error', code: 'permission_error', message: 'x', param: null } } }] });
    expect(await sentenceOf(removePicture(world(), reg('1234'), KEY))).toMatch(/uploaded this picture, or the world's owner/);
  });

  it('nothing stored under the key at the edge is the end state asked for', async () => {
    serve({ edgeReply: { status: 404, body: { error: 'not_found', key: KEY } } });
    expect(await removePicture(world(), reg('1234'), KEY)).toEqual({ referenced: 1, cacheMayLinger: false });
  });

  it('a purge configured at the edge means the link stops at once', async () => {
    serve();
    mswServer.use(http.post('https://edge.test/v1/remove', () => HttpResponse.json({ removed: KEY, bytes: 1, cache: 'purging' })));
    expect((await removePicture(world(), reg('1234'), KEY)).cacheMayLinger).toBe(false);
  });

  it('the edge\'s failed delete and a spent ticket are said, nothing claimed removed', async () => {
    serve({ edgeReply: { status: 502, body: { error: 'remove_failed' } } });
    expect(await sentenceOf(removePicture(world(), reg('1234'), KEY))).toMatch(/could not remove the picture just now/);
    mswServer.resetHandlers();
    serve({ edgeReply: { status: 401, body: { error: 'ticket_expired' } } });
    expect(await sentenceOf(removePicture(world(), reg('1234'), KEY))).toMatch(/try again in ten minutes/);
  });

  it('no PIN, a view-only world or an offline one: refused before any call', async () => {
    const seen = serve();
    expect(await sentenceOf(removePicture(world(), reg(), KEY))).toMatch(/needs your OnlyWorlds PIN/);
    const viewOnly = { ...world(), api: { world_id: 'w1', api_key: 'r', read_only: true } } as WorldRegistryEntry;
    expect(await sentenceOf(removePicture(viewOnly, reg('1234'), KEY))).toMatch(/view-only/);
    expect(seen.tickets).toHaveLength(0);
  });
});
