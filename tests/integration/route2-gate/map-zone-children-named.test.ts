/**
 * The A4/A5 ruling's children (gate lens B, probes promoted).
 *
 * A map or zone both sides have children on stays unmatched. Its CHILDREN must
 * stay with their side too: converter and Sikelia-style worlds name every
 * marker, and a named marker matched to its server twin moved onto the server
 * id under its LOCAL zone, so policy b stripped the online outline (H1). And a
 * pin that is the same element on both sides (same id) is not "a second set":
 * counting it made a false clash and pulled it off the online map (M1).
 * Plus the A9 edge: a local page the server holds as a scene keeps no page fields (L2).
 */
import { describe, it, expect } from 'vitest';
import { mergeLocalIntoApi } from '../../../src/sync/make-online';
import { SyncEngine } from '../../../src/sync/sync-engine';
import { freshServer, world, putEl, open, srv } from './harness';

console.debug = () => undefined;
console.info = () => undefined;
const u = (n: string) => `00000000-0000-4000-8000-${n.padStart(12, '0')}`;
const LM = u('a1'), SM = u('b1'), LZ = u('a2'), SZ = u('b2'), LA = u('a3'), SA = u('b3');
const sq = [[0, 0], [100, 0], [100, 100], [0, 100]];
const mapOf = (r: Record<string, unknown>) => (r.map_id ?? r.map) as string;
const zoneOf = (r: Record<string, unknown>) => (r.zone_id ?? r.zone) as string;

describe('children of a clashing map or zone stay with their side (lens B H1)', () => {
  for (const policy of ['b', 'c'] as const) {
    it(`named markers on a clashing zone, policy ${policy}: each outline keeps its own markers`, async () => {
      const { server, adapter } = freshServer();
      await adapter.createElement('map', { id: SM, name: 'World' });
      await adapter.createElement('zone', { id: SZ, name: 'Forest' });
      for (let i = 0; i < 4; i++) await adapter.createElement('marker', { id: u('b10' + i), name: `CM-${i}`, map_id: SM, zone_id: SZ, x: sq[i][0], y: sq[i][1], order: i });
      const root = world();
      putEl(root, { id: LM, type: 'map', name: 'World' });
      putEl(root, { id: LZ, type: 'zone', name: 'Forest' });
      for (let i = 0; i < 5; i++) putEl(root, { id: u('a10' + i), type: 'marker', name: `CM-${i}`, map_id: LM, zone_id: LZ, x: 500 + i, y: 500 + i, order: i });
      const s = await open(root);
      const m = await mergeLocalIntoApi(s, adapter, policy, { worldId: 'w1' });
      await new SyncEngine({ folder: s, client: adapter }).syncNow();
      expect(m.childClashes.map(c => c.name)).toEqual(['World', 'Forest']);
      expect(m.rekeyed.size).toBe(0);
      const tally = (rs: Array<Record<string, unknown>>) => ({
        onServerZone: rs.filter(r => zoneOf(r) === SZ).length,
        onLocalZone: rs.filter(r => zoneOf(r) === LZ).length,
      });
      const local = (await s.listElements()).filter(e => e.type === 'marker') as unknown as Array<Record<string, unknown>>;
      const online = [...srv(server, 'marker').values()] as Array<Record<string, unknown>>;
      expect(tally(online)).toEqual({ onServerZone: 4, onLocalZone: 5 });
      expect(tally(local)).toEqual({ onServerZone: 4, onLocalZone: 5 });
    });
  }

  it('a named pin on a clashing map stays on its own map on both sides (policy b)', async () => {
    const { server, adapter } = freshServer();
    await adapter.createElement('map', { id: SM, name: 'World' });
    await adapter.createElement('character', { id: SA, name: 'Alice' });
    await adapter.createElement('pin', { id: u('b9'), name: 'Alice', map_id: SM, element_id: SA, element_type: 'character', x: 1, y: 1 });
    const root = world();
    putEl(root, { id: LM, type: 'map', name: 'World' });
    putEl(root, { id: LA, type: 'character', name: 'Alice' });
    putEl(root, { id: u('a9'), type: 'pin', name: 'Alice', map_id: LM, element_id: LA, element_type: 'character', x: 50, y: 50 });
    const s = await open(root);
    await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    const byId = new Map([...srv(server, 'pin').values()].map(p => [p.id as string, mapOf(p as Record<string, unknown>)]));
    expect(byId.get(u('b9'))).toBe(SM);
    expect(byId.get(u('a9'))).toBe(LM);
  });

  it('a pin with the same id on both sides is not a second set: the maps match (lens B M1)', async () => {
    const P = u('c1');
    const { server, adapter } = freshServer();
    await adapter.createElement('map', { id: SM, name: 'World' });
    await adapter.createElement('character', { id: LA, name: 'Alice' });
    await adapter.createElement('pin', { id: P, name: '', map_id: SM, element_id: LA, element_type: 'character', x: 1, y: 1 });
    const root = world();
    putEl(root, { id: LM, type: 'map', name: 'World' });
    putEl(root, { id: LA, type: 'character', name: 'Alice' });
    putEl(root, { id: P, type: 'pin', name: '', map_id: LM, element_id: LA, element_type: 'character', x: 1, y: 1 });
    const s = await open(root);
    const m = await mergeLocalIntoApi(s, adapter, 'b', { worldId: 'w1' });
    expect(m.childClashes).toEqual([]);
    expect(mapOf(srv(server, 'pin').get(P)! as Record<string, unknown>)).toBe(SM);
    expect(srv(server, 'map').size).toBe(1);
  });
});

describe('A9 when only the local copy is a page (lens B L2)', () => {
  it('a local page the server holds as a scene becomes that scene, with no page blocks', async () => {
    const N = u('f2'), O = u('e2');
    const { adapter } = freshServer();
    await adapter.createElement('narrative', { id: N, name: 'Home', subtype: 'scene', story: 'online scene' });
    const root = world();
    putEl(root, { id: O, type: 'narrative', name: 'Home', subtype: 'page', story: 'local', atlas_page_blocks: [{ id: 'b1', kind: 'prose', markdown: 'local', richtextJson: null }], atlas_page_refs: [] });
    const s = await open(root);
    await mergeLocalIntoApi(s, adapter, 'c', { worldId: 'w1' });
    const el = (await s.getElement(N))! as unknown as Record<string, unknown>;
    expect(el.subtype).toBe('scene');
    expect(el.story).toBe('online scene');
    expect(el.atlas_page_blocks).toBeUndefined();
  });
});
