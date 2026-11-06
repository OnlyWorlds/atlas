/**
 * The public reader (1.123): keel's keyless door, through the SDK's keyless
 * client. Every request it makes is a GET that names the world (`world=`)
 * and carries no key, no PIN and no bearer; a 429 pauses on its
 * `Retry-After` and sends the same page again, at most three times in one
 * reader's life, and the fourth is a stop; a private world is keel's one 404;
 * the writes refuse before sending. The fake answers as keel's public reader
 * does (api-v2-spec §3b): `counts` on GET /world, `no-store`, 404 for a
 * world the public cannot read, 401 on a keyless /changes.
 */
import { describe, it, expect, vi } from 'vitest';
import { PublicWorldReader, PublicWaitsSpent, isPublicNotFound, PUBLIC_PAGE_SIZE } from '../../src/sync/public-reader';
import { ALL_ELEMENT_TYPES } from '../../src/core/types';

const W = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e';
const PRIVATE = '00000000-0000-4000-8000-000000000000';
const T = '2026-11-06T10:00:00.000Z';

interface Seen { method: string; url: URL; headers: Headers }

/** keel's keyless door, played: 2 pages of markers, one character. */
function keel(opts: { tooMany?: number; retryAfter?: string | null } = {}) {
  const seen: Seen[] = [];
  let tooMany = opts.tooMany ?? 0;
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
  const markers = Array.from({ length: 3 }, (_, i) => ({ id: `0000000${i}-0000-4000-8000-000000000001`, type: 'marker', name: `M${i}`, updated_at: T, map: null, zone: null }));
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    seen.push({ method: init?.method ?? 'GET', url, headers });
    const world = url.searchParams.get('world');
    const keyless = !headers.has('API-Key') && !headers.has('Authorization');
    if (keyless && !world) return json(401, { error: { type: 'authentication_error', code: 'missing_credentials', message: 'No key.' } });
    const path = url.pathname.replace('/api/v2', '').replace(/\/$/, '');
    if (path === '/changes') return json(401, { error: { type: 'authentication_error', code: 'missing_credentials', message: 'No key.' } });
    if (world !== W) return json(404, { error: { type: 'not_found', code: 'not_found', message: 'World not found.' } });
    if (tooMany > 0) {
      tooMany--;
      return json(429, { error: { type: 'rate_limit_error', code: 'rate_limited', message: 'Slow down.' } },
        opts.retryAfter === null ? {} : { 'Retry-After': opts.retryAfter ?? '7' });
    }
    if (path === '/world') return json(200, { id: W, name: 'Blood Meridian', updated_at: T, counts: { total: 4, types: { marker: 3, character: 1 } } });
    if (path === '/marker') {
      const cursor = url.searchParams.get('cursor');
      return cursor === 'p2'
        ? json(200, { data: markers.slice(2), has_more: false, next_cursor: null })
        : json(200, { data: markers.slice(0, 2), has_more: true, next_cursor: 'p2' });
    }
    if (path === '/character') return json(200, { data: [{ id: 'c0000000-0000-4000-8000-000000000001', type: 'character', name: 'The kid', updated_at: T }], has_more: false, next_cursor: null });
    if (path.startsWith('/character/')) return json(200, { id: 'c0000000-0000-4000-8000-000000000001', type: 'character', name: 'The kid', updated_at: T });
    if (path.split('/').length === 3) return json(404, { error: { type: 'not_found', code: 'not_found', message: 'Not found.' } });
    return json(200, { data: [], has_more: false, next_cursor: null });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
}

describe('the public reader sends nothing but keyless GETs that name the world', () => {
  it('a whole walk, every type: GET, world=<id>, no API-Key, no API-Pin, no bearer', async () => {
    const k = keel();
    const reader = new PublicWorldReader(W, { fetch: k.fetch });
    const world = await reader.readWorld();
    expect(world.meta.id).toBe(W);
    expect(world.counts).toEqual({ total: 4, types: { marker: 3, character: 1 } });
    for (const type of ALL_ELEMENT_TYPES) await reader.listElements(type);
    expect((await reader.listElements('marker')).map(m => m.name)).toEqual(['M0', 'M1', 'M2']);
    expect(await reader.getElement('character', 'c0000000-0000-4000-8000-000000000001')).toMatchObject({ name: 'The kid' });
    expect(k.seen.length).toBeGreaterThan(ALL_ELEMENT_TYPES.length);
    for (const s of k.seen) {
      expect(s.method).toBe('GET');
      expect(s.url.searchParams.get('world')).toBe(W);
      expect(s.headers.has('API-Key')).toBe(false);
      expect(s.headers.has('API-Pin')).toBe(false);
      expect(s.headers.has('Authorization')).toBe(false);
      expect(s.url.pathname).not.toMatch(/changes|members|files|\/me\b/);
    }
    // Pages of keel's cap: the budget is requests.
    expect(k.seen.find(s => s.url.pathname.includes('/marker'))!.url.searchParams.get('limit')).toBe(String(PUBLIC_PAGE_SIZE));
  });

  it('its writes refuse before anything is sent', async () => {
    const k = keel();
    const reader = new PublicWorldReader(W, { fetch: k.fetch });
    await expect(reader.createElement()).rejects.toThrow(TypeError);
    await expect(reader.updateElement()).rejects.toThrow(TypeError);
    await expect(reader.deleteElement()).rejects.toThrow(TypeError);
    await expect(reader.patchWorldMeta()).rejects.toThrow(TypeError);
    expect((reader as unknown as Record<string, unknown>).pullChanges).toBeUndefined();
    expect(k.seen).toHaveLength(0);
  });

  it('a world the public cannot read is keel\'s one 404', async () => {
    const k = keel();
    const err = await new PublicWorldReader(PRIVATE, { fetch: k.fetch }).readWorld().catch(e => e);
    expect(isPublicNotFound(err)).toBe(true);
  });
});

describe('a 429 paces the walk', () => {
  it('pauses on Retry-After, says so, and sends the same page again', async () => {
    const k = keel({ tooMany: 2, retryAfter: '7' });
    const waits: number[] = [];
    const sleep = vi.fn(async () => {});
    const reader = new PublicWorldReader(W, { fetch: k.fetch, sleep, onWait: s => waits.push(s) });
    const markers = await reader.listElements('marker');
    expect(markers).toHaveLength(3);
    expect(waits).toEqual([7, 7]);
    expect(sleep).toHaveBeenCalledWith(7000);
    // The first page three times (two 429s, then the page), then the second.
    expect(k.seen.map(s => s.url.searchParams.get('cursor'))).toEqual([null, null, null, 'p2']);
    expect(reader.waitsTaken).toBe(2);
  });

  it('waits 30 seconds when keel names no wait', async () => {
    const k = keel({ tooMany: 1, retryAfter: null });
    const waits: number[] = [];
    await new PublicWorldReader(W, { fetch: k.fetch, sleep: async () => {}, onWait: s => waits.push(s) }).readWorld();
    expect(waits).toEqual([30]);
  });

  it('three pauses in one open, and the fourth 429 is a stop', async () => {
    const k = keel({ tooMany: 4 });
    const waits: number[] = [];
    const reader = new PublicWorldReader(W, { fetch: k.fetch, sleep: async () => {}, onWait: s => waits.push(s) });
    await expect(reader.listElements('marker')).rejects.toBeInstanceOf(PublicWaitsSpent);
    expect(waits).toHaveLength(3);
    expect(k.seen).toHaveLength(4);
  });

  it('the pauses count across the whole open, not per request', async () => {
    const k = keel({ tooMany: 2 });
    const reader = new PublicWorldReader(W, { fetch: k.fetch, sleep: async () => {} });
    await reader.readWorld();
    expect(reader.waitsTaken).toBe(2);
    const again = keel({ tooMany: 2 });
    const r2 = new PublicWorldReader(W, { fetch: again.fetch, sleep: async () => {}, maxWaits: 1 });
    await expect(r2.readWorld()).rejects.toBeInstanceOf(PublicWaitsSpent);
  });

  it('with no pauses allowed, a 429 is a stop at once (the door\'s single reads)', async () => {
    const k = keel({ tooMany: 1 });
    await expect(new PublicWorldReader(W, { fetch: k.fetch, maxWaits: 0 }).readWorld()).rejects.toBeInstanceOf(PublicWaitsSpent);
    expect(k.seen).toHaveLength(1);
  });
});
