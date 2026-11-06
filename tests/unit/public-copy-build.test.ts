/**
 * The public world's file (1.123, `buildWorldFile` over the keyless reader):
 * whole by keel's own counts (a type short by one opens nothing), the
 * public slice's mark and where it came from in world.json, the list walk
 * one type at a time that stops at the first failed type, and keel's 429
 * paced inside the build. keel is played as its public reader answers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildWorldFile, matchesCounts, notWholeLine } from '../../src/setup/demo-copy';
import { PublicWorldReader, PublicWaitsSpent } from '../../src/sync/public-reader';
import { setOpfsRootForTests } from '../../src/core/browser-worlds';
import { memoryDirectory } from '../../src/store/memory-dir';
import { readWorldZip } from '../../src/store/world-file';
import { ALL_ELEMENT_TYPES } from '../../src/core/types';
import { PlainError } from '../../src/core/plain-error';

const W = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e';
const T = '2026-11-06T10:00:00.000Z';
const BOOK = '01a13c6f-8806-7cb5-b60e-b2e8c5787b33';
const CH1 = '01a1b17c-f4a2-7537-ba96-b51d6eb4cc6c';

interface KeelOpts { counts?: Record<string, number>; total?: number; failType?: string; tooMany?: number }

function keel(o: KeelOpts = {}) {
  const lists: string[] = [];
  let tooMany = o.tooMany ?? 0;
  const rows: Record<string, Record<string, unknown>[]> = {
    narrative: [
      { id: BOOK, type: 'narrative', name: 'Blood Meridian (the novel)', supertype: 'Book', parent_narrative: null, updated_at: T },
      { id: CH1, type: 'narrative', name: 'Chapter I', supertype: 'Chapter', parent_narrative: BOOK, order: 1, updated_at: T },
    ],
    character: [{ id: 'c0000000-0000-4000-8000-000000000001', type: 'character', name: 'The kid', updated_at: T }],
  };
  const counts = o.counts ?? { narrative: 2, character: 1 };
  const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...extra } });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.searchParams.get('world') !== W) return json(404, { error: { type: 'not_found', code: 'not_found', message: 'World not found.' } });
    if (tooMany > 0) { tooMany--; return json(429, { error: { type: 'rate_limit_error', code: 'rate_limited', message: 'Slow down.' } }, { 'Retry-After': '2' }); }
    const path = url.pathname.replace('/api/v2', '').replace(/\/$/, '');
    if (path === '/world') {
      const total = o.total ?? Object.values(counts).reduce((a, b) => a + b, 0);
      return json(200, { id: W, name: 'Blood Meridian', description: 'The scalp country.', time_basic_unit: 'Year', time_range_current: 1850, updated_at: T, counts: { total, types: counts } });
    }
    const type = path.slice(1);
    lists.push(type);
    if (type === o.failType) return json(500, { error: { type: 'api_error', code: 'server_error', message: 'Boom.' } });
    return json(200, { data: rows[type] ?? [], has_more: false, next_cursor: null });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, lists };
}

function sourceFor(k: ReturnType<typeof keel>, extra: Partial<Parameters<typeof buildWorldFile>[0]> = {}) {
  const reader = new PublicWorldReader(W, { fetch: k.fetch, sleep: async () => {} });
  return {
    worldId: W, client: reader, fallbackName: 'this world', read: () => reader.readWorld(),
    exportedAs: { kind: 'public', role: null, character: null }, requireCounts: true, listConcurrency: 1, ...extra,
  };
}

beforeEach(() => { setOpfsRootForTests(async () => memoryDirectory('fake-opfs')); });
afterEach(() => { setOpfsRootForTests(null); });

describe('a public world comes down whole, or not at all', () => {
  it('whole: the file holds the world under its own id, marked as the public slice, and where it came from', async () => {
    const built = await buildWorldFile(sourceFor(keel()));
    expect(built.kind).toBe('file');
    if (built.kind !== 'file') return;
    const read = readWorldZip(built.bytes);
    expect(read.worldId).toBe(W);
    const meta = JSON.parse(new TextDecoder().decode(read.files.find(f => f.path === 'world.json')!.data));
    expect(meta.exported_as).toEqual({ kind: 'public', role: null, character: null });
    expect(meta.source.world).toBe(W);
    expect(Number.isFinite(Date.parse(meta.source.at))).toBe(true);
    expect(meta.api).toBeUndefined();
    expect(meta.time_current).toBe(1850);
    expect(read.files.filter(f => f.path.startsWith('elements/')).length).toBe(3);
  });

  it('a type short by one against keel\'s counts opens nothing, in the not-whole words', async () => {
    const err = await buildWorldFile(sourceFor(keel({ counts: { narrative: 3, character: 1 } }))).catch(e => e);
    expect(err).toBeInstanceOf(PlainError);
    expect(err.message).toBe(notWholeLine('Blood Meridian'));
  });

  it('a total that does not add up is short too; no counts at all is no proof of whole', async () => {
    expect(matchesCounts({ narrative: 2, character: 1 }, { total: 4, types: { narrative: 2, character: 1 } })).toBe(false);
    expect(matchesCounts({ narrative: 2, character: 1 }, { total: 3, types: { narrative: 2, character: 1 } })).toBe(true);
    expect(matchesCounts({ narrative: 2 }, { total: 3, types: { narrative: 2, ghost: 1 } })).toBe(false);
    const k = keel();
    const reader = new PublicWorldReader(W, { fetch: k.fetch });
    const noCounts = sourceFor(k, { read: async () => ({ meta: (await reader.readWorld()).meta, counts: null }) });
    await expect(buildWorldFile(noCounts)).rejects.toThrow(notWholeLine('Blood Meridian'));
  });

  it('the walk lists one type at a time and stops at the first failed type', async () => {
    const failType = ALL_ELEMENT_TYPES[2];
    const k = keel({ failType });
    await expect(buildWorldFile(sourceFor(k))).rejects.toBeTruthy();
    expect(k.lists).toEqual(ALL_ELEMENT_TYPES.slice(0, 3));
  });

  it('the fourth 429 in one open is a stop, and three are waited out', async () => {
    await expect(buildWorldFile(sourceFor(keel({ tooMany: 4 })))).rejects.toBeInstanceOf(PublicWaitsSpent);
    const ok = await buildWorldFile(sourceFor(keel({ tooMany: 3 })));
    expect(ok.kind).toBe('file');
  });

  it('the answer must name the world asked for', async () => {
    const k = keel();
    const reader = new PublicWorldReader(W, { fetch: k.fetch });
    const other = sourceFor(k, { worldId: '44444444-5555-4666-8777-888888888888', read: () => reader.readWorld() });
    await expect(buildWorldFile(other)).rejects.toThrow(/did not send/);
  });
});
