/**
 * A re-key keeps arrival (contract H3): the new id is a v7 minted at the old
 * element's arrival, so giving a copied world new ids moves no square in the
 * home's grid. An element with no arrival mints as new; a given id (Route 2's
 * merge onto a server twin) is kept as given.
 */
import { describe, it, expect } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { startRekey } from '../../src/store/rekey';
import { arrivalOf, gridOf } from '../../src/core/home-grid';
import type { Element } from '../../src/core/types';

const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const msOf = (id: string) => parseInt(id.slice(0, 8) + id.slice(9, 13), 16);

// A v4 id with a stamp, an RFC v7 id, a v1 server draft id (36-bit seconds, `06…`), and a v4 with no stamp.
const V4_STAMPED = '00000000-0000-4000-8000-000000000001';
const RFC = '018f2a3b-4c5d-7e6f-8a7b-0c1d2e3f4a5b';
const V1_DRAFT = '068e92f5-24b4-7123-8abc-0123456789ab';
const V4_BARE = '00000000-0000-4000-8000-000000000002';
const STAMP = '2025-03-04T05:06:07.089Z';

function freshStore(): MockFolderStore {
  const s = new MockFolderStore();
  s.setClock(new MonotonicClock('2026-02-01T00:00:00.000Z').next);
  return s;
}

async function seed(s: MockFolderStore): Promise<void> {
  await s.createElement('location', { id: V4_STAMPED, name: 'Harbour', created_at: STAMP } as Partial<Element>);
  await s.createElement('character', { id: RFC, name: 'Mira', location: V4_STAMPED } as Partial<Element>);
  await s.createElement('event', { id: V1_DRAFT, name: 'Founding', created_at: '2199-01-01T00:00:00.000Z' } as Partial<Element>);
}

describe('re-key keeps arrival', () => {
  it('each new id is a v7 at its old element\'s arrival', async () => {
    const s = freshStore();
    await seed(s);
    const before = new Map((await s.listElements()).map(e => [e.id, arrivalOf(e)] as const));
    const { map } = await startRekey(s, { worldId: 'w', ids: [V4_STAMPED, RFC, V1_DRAFT] });
    for (const [o, n] of map) {
      expect(n).toMatch(V7);
      expect(n).not.toBe(o);
      expect(msOf(n)).toBe(before.get(o));
      const el = await s.getElement(n);
      expect(el && arrivalOf(el)).toBe(before.get(o));
    }
    expect(msOf(map.get(V4_STAMPED)!)).toBe(Date.parse(STAMP));
    expect(msOf(map.get(RFC)!)).toBe(msOf(RFC));
    // The v1 draft's first 36 bits are seconds, not the year 2199.
    expect(msOf(map.get(V1_DRAFT)!)).toBe(parseInt('068e92f52', 16) * 1000);
  });

  it('the grid stands as it stood: every square keeps its column', async () => {
    const s = freshStore();
    await seed(s);
    await s.createElement('object', { id: '00000000-0000-4000-8000-000000000003', name: 'Not re-keyed', created_at: '2025-06-01T00:00:00.000Z' } as Partial<Element>);
    const cells = async (rename: (id: string) => string) => {
      const els = await s.listElements();
      const g = gridOf(els.map(e => ({ id: e.id, type: e.type, created_at: e.created_at })), [], 10);
      return new Map(g.cells.map(c => [rename(c.id), c.col] as const));
    };
    const was = await cells(id => id);
    const { map } = await startRekey(s, { worldId: 'w', ids: [V1_DRAFT, RFC, V4_STAMPED] });
    const back = new Map([...map].map(([o, n]) => [n, o] as const));
    expect(await cells(id => back.get(id) ?? id)).toEqual(was);
  });

  it('an element with no arrival mints as new, after the rest', async () => {
    const s = freshStore();
    await s.createElementVerbatim('character', { id: V4_BARE, type: 'character', name: 'Bare', local_updated_at: 'x' } as Element);
    // The mock stamps created_at on a verbatim write with none: take it off, so the element has no arrival.
    const el = await s.getElement(V4_BARE);
    delete (el as Record<string, unknown>).created_at;
    (s as unknown as { elements: Map<string, Element> }).elements.set(V4_BARE, el!);
    expect(arrivalOf((await s.getElement(V4_BARE))!)).toBe(-Infinity);
    const t0 = Date.now();
    const { map } = await startRekey(s, { worldId: 'w', ids: [V4_BARE] });
    const n = map.get(V4_BARE)!;
    expect(n).toMatch(V7);
    expect(msOf(n)).toBeGreaterThanOrEqual(t0);
  });

  it('the test seam is handed the arrival; a given id is taken as given', async () => {
    const s = freshStore();
    await seed(s);
    const seen: Array<number | undefined> = [];
    await startRekey(s, { worldId: 'w', ids: [V4_STAMPED], mintId: at => { seen.push(at); return '00000000-0000-4000-8000-0000000000aa'; } });
    expect(seen).toEqual([Date.parse(STAMP)]);
    const twin = '00000000-0000-4000-8000-0000000000bb';
    const { map } = await startRekey(s, { worldId: 'w', pairs: new Map([[RFC, twin]]), mintId: () => { throw new Error('minted for a given id'); } });
    expect(map.get(RFC)).toBe(twin);
  });
});
