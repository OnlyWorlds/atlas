/**
 * #185, conv. 138: the Web tab reads a pin as the place it marks and a zone's
 * markers as the zone. Moppetopia's Space Map web at depth 2 drew 73 nodes, 67
 * of them pins and markers, 83 node pairs touching. A pin or marker is a link
 * between its two ends, never a node of its own (unless it is the subject).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import {
  buildWebLinks, mountContextGraph, clearContextGraphLayoutMemo,
} from '../../src/tabs/right/context-pane-graph';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

// The graph only follows id-shaped values (looksLikeId).
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mk = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: u(n), type, name, ...extra }) as unknown as Element;

const map = mk(1, 'map', 'Space Map');
const felt = mk(2, 'location', 'Feltropolis');
const crumble = mk(3, 'zone', 'Crumblefields');
const fluff = mk(4, 'character', 'Admiral Fluffington', { location: u(2) });
const pinFelt = mk(10, 'pin', '', { map_id: u(1), element_id: u(2), x: 1, y: 1 });
const pinLost = mk(11, 'pin', '', { map_id: u(1), element_id: u(99), x: 2, y: 2 });
const markers = [20, 21, 22].map(n => mk(n, 'marker', '', { map_id: u(1), zone_id: u(3), x: n, y: n }));
const stray = mk(23, 'marker', '', { map_id: u(1), x: 9, y: 9 });
const world = [map, felt, crumble, fluff, pinFelt, pinLost, ...markers, stray];

describe('buildWebLinks (pure)', () => {
  it('a pin links its map and its place both ways; a zone\'s markers make one link and a count', () => {
    const links = buildWebLinks(world, map.id);
    expect([...links.out.get(map.id)!].sort()).toEqual([u(2), u(3)]);
    expect([...links.out.get(felt.id)!]).toContain(map.id);
    expect([...links.out.get(crumble.id)!]).toEqual([map.id]);
    expect(links.markerCounts.get(`${u(1)}|${u(3)}`)).toBe(3);
  });

  it('no pin or marker appears as an end, and one missing an end links nothing', () => {
    const links = buildWebLinks(world, map.id);
    const ends = new Set<string>();
    for (const [from, tos] of links.out) { ends.add(from); for (const t of tos) ends.add(t); }
    for (const n of [10, 11, 20, 21, 22, 23]) expect(ends.has(u(n))).toBe(false);
    expect(ends.has(u(99))).toBe(false);
  });

  it('a pin that is the subject keeps its own links', () => {
    const links = buildWebLinks(world, pinFelt.id);
    expect([...links.out.get(pinFelt.id)!].sort()).toEqual([u(1), u(2)]);
  });
});

describe("the Web tab's graph", () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver, and its canvas is "not implemented".
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
    HTMLCanvasElement.prototype.getContext = (() => null) as never;
  });
  afterEach(() => { document.body.innerHTML = ''; clearContextGraphLayoutMemo(); });

  const draw = (subject: Element, hopDepth: 1 | 2 = 1) => {
    patchSlice('data', { elements: world });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountContextGraph({ host, subject, onSelect: () => {}, hopDepth });
    const nodes = [...host.querySelectorAll<HTMLElement>('.atlas-context-graph-node')];
    const out = {
      ids: nodes.map(n => n.dataset.elementId!).sort(),
      title: (id: string) => nodes.find(n => n.dataset.elementId === id)?.title ?? '',
      text: host.textContent ?? '',
    };
    h.destroy();
    return out;
  };

  it("a map's web draws its places and zones, never a pin or a marker", () => {
    const web = draw(map);
    expect(web.ids).toEqual([u(1), u(2), u(3)]);
    expect(web.title(u(3)).split('\n')).toContain('3 markers on the map');
    expect(web.text).not.toContain('(unknown)');
  });

  it("a place's web draws the map its pin sits on, and two hops out reach no pin", () => {
    expect(draw(felt).ids).toEqual([u(1), u(2), u(4)].sort());
    expect(draw(fluff, 2).ids).toEqual([u(1), u(2), u(4)].sort());
  });

  it("a zone's web draws the map its markers sit on", () => {
    const web = draw(crumble);
    expect(web.ids).toEqual([u(1), u(3)]);
    expect(web.title(u(1)).split('\n')).toContain('3 markers on the map');
  });
});
