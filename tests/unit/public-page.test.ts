/**
 * A read key's world: is its public page on? keel's whole switch is
 * `public_read` and `public_page.on` on GET /world; read once per world per
 * session, never on a member's world, and "not known" after a failed read.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readPublicPageOn, publicPageOnNow, resetPublicPageForTests } from '../../src/sync/public-page';
import type { WorldRegistryEntry } from '../../src/core/types';

const WID = '0195a3c0-0000-7000-8000-000000000001';
const readKey = (id = WID): WorldRegistryEntry =>
  ({ id: 'f', name: 'W', state: 'api-linked', api: { world_id: id, api_key: 'ow_r_test', read_only: true } }) as WorldRegistryEntry;

const body = (extra: Record<string, unknown>) => ({
  id: WID, name: 'W', description: '', image_url: '', time_basic_unit: '', time_format_names: [], time_format_equivalents: [],
  time_range_min: null, time_range_max: null, time_range_current: null, length_unit: '', mass_unit: '', distance_unit: '',
  updated_at: '2026-10-30T10:00:00Z', ...extra,
});

let fetchMock: ReturnType<typeof vi.fn>;
const answer = (extra: Record<string, unknown>) =>
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body(extra)), { status: 200, headers: { 'Content-Type': 'application/json' } }));

beforeEach(() => {
  resetPublicPageForTests();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('the public page switch', () => {
  it('on only when public_read and public_page.on are both true', async () => {
    const cases: Array<[Record<string, unknown>, boolean]> = [
      [{ public_read: true, public_page: { on: true } }, true],
      [{ public_read: true, public_page: { on: false } }, false],
      [{ public_read: false, public_page: { on: true } }, false],
      [{ public_read: true }, false],
      [{ public_read: true, public_page: null }, false],
      [{}, false],
    ];
    for (const [extra, on] of cases) {
      resetPublicPageForTests();
      answer(extra);
      expect(await readPublicPageOn(readKey())).toBe(on);
      expect(publicPageOnNow(readKey())).toBe(on);
    }
  });

  it('read once per world per session, bare (no PIN) on the read key', async () => {
    answer({ public_read: true, public_page: { on: true } });
    await Promise.all([readPublicPageOn(readKey()), readPublicPageOn(readKey())]);
    await readPublicPageOn(readKey());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = new Headers(init?.headers);
    expect(headers.get('API-Pin') ?? '').toBe('');
  });

  it('an answer older than five minutes is read again, so a page switched off is known off', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    answer({ public_read: true, public_page: { on: true } });
    expect(await readPublicPageOn(readKey())).toBe(true);
    answer({ public_read: true, public_page: { on: false } });
    now.mockReturnValue(1_000_000 + 4 * 60_000);
    expect(await readPublicPageOn(readKey())).toBe(true);
    now.mockReturnValue(1_000_000 + 6 * 60_000);
    expect(await readPublicPageOn(readKey())).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockRestore();
  });

  it('a failed refresh drops the stale answer (no mark on an old yes), and waits a minute before asking again', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    answer({ public_read: true, public_page: { on: true } });
    expect(await readPublicPageOn(readKey())).toBe(true);
    now.mockReturnValue(2_000_000 + 6 * 60_000);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'x', type: 'authentication_error' } }), { status: 401, headers: { 'Content-Type': 'application/json' } }));
    expect(await readPublicPageOn(readKey())).toBeNull();
    expect(publicPageOnNow(readKey())).toBeNull();
    now.mockReturnValue(2_000_000 + 6 * 60_000 + 30_000);
    expect(await readPublicPageOn(readKey())).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    now.mockReturnValue(2_000_000 + 8 * 60_000);
    answer({ public_read: true, public_page: { on: false } });
    expect(await readPublicPageOn(readKey())).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    now.mockRestore();
    warn.mockRestore();
  });

  it('a seat\'s world is read too (an agent seat reaches the site only through the public page)', async () => {
    answer({ public_read: true, public_page: { on: true } });
    const seat = { ...readKey(), api: { world_id: WID, api_key: 'ow_w_seat', seat: { role: 'contributor' }, seat_secret: 'ow_s_secret' } } as WorldRegistryEntry;
    expect(await readPublicPageOn(seat)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never read for a member\'s world; not known before a read and after a failed one', async () => {
    const member = { ...readKey(), api: { world_id: WID, api_key: 'k' } } as WorldRegistryEntry;
    expect(await readPublicPageOn(member)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(publicPageOnNow(readKey())).toBeNull();
    fetchMock.mockRejectedValue(new TypeError('offline'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await readPublicPageOn(readKey())).toBeNull();
    expect(publicPageOnNow(readKey())).toBeNull();
    warn.mockRestore();
  });
});
