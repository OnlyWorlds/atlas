/**
 * Promoted from the S367 composition gate (lens A, probe f), after the
 * Captain's ruling A4/A5 (2026-10-04).
 *
 * The finding: a local map or zone that name-matches a server one was moved
 * onto the server's id by the kernel, and its children with it. When both
 * sides already had children on it, the result showed both sets: one element
 * with two pins on one map, or a zone outline drawn from two marker sets
 * interleaved by `order`.
 *
 * The ruling: name-match a map or zone as before UNLESS both sides have
 * children on it (pins or markers on the map, markers on the zone); then it
 * is not matched, stays its own element under its own id, and is reported in
 * `childClashes` (the toast names it). Children on one side only, or none,
 * still match. Other types are untouched: the doubled pin needs both sides'
 * pins on ONE map, so the map rule alone covers the character in that case.
 */
import { describe, it, expect } from 'vitest';
import { planMerge, type ServerRec } from '../../../src/sync/plan-merge';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import type { Element, ElementType } from '../../../src/core/types';
import { freshServer, world, putEl, open, srv, LOCAL_T } from './harness';

console.debug = () => undefined;
console.info = () => undefined;

const el = (id: string, type: ElementType, name: unknown, extra: Record<string, unknown> = {}): Element =>
  ({ id, type, name, local_updated_at: 'x', ...extra } as unknown as Element);
const rec = (id: string, name: unknown, extra: Record<string, unknown> = {}): ServerRec =>
  ({ id, name, updated_at: 'x', ...extra } as ServerRec);
const ON = { matchByName: true };

describe('planMerge: a map or zone both sides have children on is not matched (A4/A5)', () => {
  it('a map with pins on both sides: no pair, reported, local created and server downloaded', () => {
    const p = planMerge(
      [el('LM', 'map', 'World'), el('LP', 'pin', '', { map_id: 'LM', element_id: 'LA' }), el('LA', 'character', 'Alice')],
      new Map<ElementType, ServerRec[]>([
        ['map', [rec('SM', 'World')]],
        ['pin', [rec('SP', '', { map_id: 'SM', element_id: 'SA' })]],
        ['character', [rec('SA', 'Alice')]],
      ]),
      ON,
    );
    expect([...p.pairs]).toEqual([['LA', 'SA']]); // the character still matches
    expect(p.childClashes).toEqual([{ type: 'map', name: 'World' }]);
    expect(p.ambiguous).toEqual([]);
    expect(p.creates.map(c => c.local.id)).toEqual(['LM', 'LP']);
    expect(p.downloads.map(d => d.server.id)).toEqual(['SM', 'SP']);
  });

  it('a marker counts as a child of its map too, and a server record spelling the link `map` is read', () => {
    const p = planMerge(
      [el('LM', 'map', 'World'), el('LK', 'marker', '', { map_id: 'LM' })],
      new Map<ElementType, ServerRec[]>([['map', [rec('SM', 'World')]], ['pin', [rec('SP', '', { map: 'SM' })]]]),
      ON,
    );
    expect(p.pairs.size).toBe(0);
    expect(p.childClashes).toEqual([{ type: 'map', name: 'World' }]);
  });

  it('a map with children on one side only, or none, still matches', () => {
    const localOnly = planMerge(
      [el('LM', 'map', 'World'), el('LP', 'pin', '', { map_id: 'LM' })],
      new Map<ElementType, ServerRec[]>([['map', [rec('SM', 'World')]]]),
      ON,
    );
    expect([...localOnly.pairs]).toEqual([['LM', 'SM']]);
    expect(localOnly.childClashes).toEqual([]);

    const serverOnly = planMerge(
      [el('LM', 'map', 'World')],
      new Map<ElementType, ServerRec[]>([['map', [rec('SM', 'World')]], ['marker', [rec('SK', '', { map_id: 'SM' })]]]),
      ON,
    );
    expect([...serverOnly.pairs]).toEqual([['LM', 'SM']]);
    expect(serverOnly.childClashes).toEqual([]);

    // A child on the server that sits on ANOTHER map does not count for this one.
    const elsewhere = planMerge(
      [el('LM', 'map', 'World'), el('LP', 'pin', '', { map_id: 'LM' })],
      new Map<ElementType, ServerRec[]>([['map', [rec('SM', 'World'), rec('SO', 'Other')]], ['pin', [rec('SP', '', { map_id: 'SO' })]]]),
      ON,
    );
    expect([...elsewhere.pairs]).toEqual([['LM', 'SM']]);
  });

  it('a zone with markers on both sides: no pair, reported; on one side only: matched', () => {
    const both = planMerge(
      [el('LZ', 'zone', 'Forest'), el('LK', 'marker', '', { map_id: 'LM', zone_id: 'LZ' })],
      new Map<ElementType, ServerRec[]>([['zone', [rec('SZ', 'Forest')]], ['marker', [rec('SK', '', { map_id: 'SM', zone: 'SZ' })]]]),
      ON,
    );
    expect(both.pairs.size).toBe(0);
    expect(both.childClashes).toEqual([{ type: 'zone', name: 'Forest' }]);

    const one = planMerge(
      [el('LZ', 'zone', 'Forest'), el('LK', 'marker', '', { map_id: 'LM', zone_id: 'LZ' })],
      new Map<ElementType, ServerRec[]>([['zone', [rec('SZ', 'Forest')]]]),
      ON,
    );
    expect([...one.pairs]).toEqual([['LZ', 'SZ']]);
    expect(one.childClashes).toEqual([]);
  });

  it('a map and a zone in one plan are reported in type order; an id match is never a clash', () => {
    const p = planMerge(
      [
        el('LZ', 'zone', 'Forest'), el('LM', 'map', 'World'), el('ID', 'map', 'Same'),
        el('LK', 'marker', '', { map_id: 'LM', zone_id: 'LZ' }), el('LK2', 'marker', '', { map_id: 'ID' }),
      ],
      new Map<ElementType, ServerRec[]>([
        ['map', [rec('SM', 'World'), rec('ID', 'Same')]],
        ['zone', [rec('SZ', 'Forest')]],
        ['marker', [rec('SK', '', { map_id: 'SM', zone_id: 'SZ' }), rec('SK2', '', { map_id: 'ID' })]],
      ]),
      ON,
    );
    expect(p.childClashes).toEqual([{ type: 'map', name: 'World' }, { type: 'zone', name: 'Forest' }]);
    expect(p.sameId.map(s => s.local.id)).toEqual(['ID']);
  });
});

describe('Route 2 on the real store: a name-matched map both sides have pins on (A4)', () => {
  const Om = '00000000-0000-4000-8000-00000000aa01';
  const Nm = '00000000-0000-4000-8000-00000000bb01';
  const Oa = '00000000-0000-4000-8000-00000000aa02';
  const Na = '00000000-0000-4000-8000-00000000bb02';
  const P1 = '00000000-0000-4000-8000-00000000aa03';
  const P2 = '00000000-0000-4000-8000-00000000bb03';

  for (const policy of ['b', 'c'] as const) {
    it(`policy ${policy}: Alice keeps one pin per map, the local map stays its own, and the toast field names it`, async () => {
      const { server, adapter } = freshServer();
      await adapter.createElement('map', { id: Nm, name: 'World' });
      await adapter.createElement('character', { id: Na, name: 'Alice' });
      await adapter.createElement('pin', { id: P2, name: '', map_id: Nm, element_id: Na, element_type: 'character', x: 10, y: 10 });

      const root = world();
      putEl(root, { id: Om, type: 'map', name: 'World' });
      putEl(root, { id: Oa, type: 'character', name: 'Alice' });
      putEl(root, { id: P1, type: 'pin', name: '', map_id: Om, element_id: Oa, element_type: 'character', x: 50, y: 50 });
      const s = await open(root);
      const m = await mergeLocalIntoApi(s, adapter, policy, { worldId: 'w1' });
      expect(m.failures).toEqual([]);
      expect(m.childClashes).toEqual([{ type: 'map', name: 'World' }]);
      expect([...m.rekeyed]).toEqual([[Oa, Na]]); // the character still matches
      await new SyncEngine({ folder: s, client: adapter }).syncNow();

      const localPins = (await s.listElements()).filter(e => e.type === 'pin') as Array<Record<string, unknown>>;
      const onWorld = localPins.filter(p => p.map_id === Nm && p.element_id === Na).map(p => p.id);
      const serverPins = [...srv(server, 'pin').values()].filter(p => (p.map === Nm || p.map_id === Nm) && p.element_id === Na).map(p => p.id);
      expect(onWorld, 'local: one element, one pin, one map').toEqual([P2]);
      expect(serverPins, 'server: one element, one pin, one map').toEqual([P2]);
      // The local map went up as its own element, its pin with it.
      expect((await s.getElement(Om))?.name).toBe('World');
      expect(srv(server, 'map').has(Om)).toBe(true);
      expect((localPins.find(p => p.id === P1) as Record<string, unknown>).map_id).toBe(Om);
    });
  }

  it('pins on the local side only: the map still matches and its pin moves onto the server map', async () => {
    const { adapter } = freshServer();
    await adapter.createElement('map', { id: Nm, name: 'World' });
    const root = world();
    putEl(root, { id: Om, type: 'map', name: 'World' });
    putEl(root, { id: Oa, type: 'character', name: 'Alice' });
    putEl(root, { id: P1, type: 'pin', name: '', map_id: Om, element_id: Oa, element_type: 'character', x: 50, y: 50 });
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    expect(m.childClashes).toEqual([]);
    expect(m.rekeyed.get(Om)).toBe(Nm);
    expect(((await s.getElement(P1)) as unknown as Record<string, unknown>).map_id).toBe(Nm);
  });
});

describe('Route 2 on the real store: a name-matched zone and map both sides have markers on (A5)', () => {
  const Om = '00000000-0000-4000-8000-00000000ac01';
  const Nm = '00000000-0000-4000-8000-00000000bc01';
  const Oz = '00000000-0000-4000-8000-00000000ac02';
  const Nz = '00000000-0000-4000-8000-00000000bc02';
  const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];

  it('policy b: each outline is drawn from one side\'s markers, never both interleaved', async () => {
    const { adapter } = freshServer();
    await adapter.createElement('map', { id: Nm, name: 'World' });
    await adapter.createElement('zone', { id: Nz, name: 'Forest' });
    for (let i = 0; i < 4; i++) {
      await adapter.createElement('marker', { id: `00000000-0000-4000-8000-00000000bd0${i}`, name: '', map_id: Nm, zone_id: Nz, x: sq[i][0], y: sq[i][1], order: i });
    }
    const root = world();
    putEl(root, { id: Om, type: 'map', name: 'World' });
    putEl(root, { id: Oz, type: 'zone', name: 'Forest' });
    for (let i = 0; i < 4; i++) {
      root.put(`spatial/marker/m${i}--${i}.json`, JSON.stringify({ id: `00000000-0000-4000-8000-00000000ad0${i}`, type: 'marker', name: '', map_id: Om, zone_id: Oz, x: 500 + sq[i][0], y: 500 + sq[i][1], order: i, local_updated_at: LOCAL_T }));
    }
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.failures).toEqual([]);
    expect(m.childClashes).toEqual([{ type: 'map', name: 'World' }, { type: 'zone', name: 'Forest' }]);
    expect(m.rekeyed.size).toBe(0);

    const markers = ((await s.listElements()).filter(e => e.type === 'marker') as Array<Record<string, unknown>>)
      .sort((a, b) => (a.order as number) - (b.order as number));
    const serverOutline = markers.filter(mk => mk.map_id === Nm && mk.zone_id === Nz);
    const localOutline = markers.filter(mk => mk.map_id === Om && mk.zone_id === Oz);
    expect(serverOutline.map(o => [o.x, o.y]), 'the server outline, its own four corners').toEqual(sq);
    expect(localOutline.map(o => [o.x, o.y]), 'the local outline, its own four corners').toEqual(sq.map(([x, y]) => [500 + x, 500 + y]));
  });
});
