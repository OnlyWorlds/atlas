/**
 * #171: pins and markers do not vote in a backlink list. A map's page and its
 * Web tab card listed every pin and marker as "(unnamed)" (the live demo's
 * Space Map: "Linked from (118)", 7 of 16 pins and 131 markers unnamed).
 * The pure fold, then both surfaces that read it.
 */

import { describe, it, expect } from 'vitest';
import { foldBacklinks, markerFoldLabel, pinBacklink } from '../../src/core/spatial-backlinks';
import { renderReferencedBy } from '../../src/middle/element-detail-refs';
import { mountContextPreview } from '../../src/tabs/right/context-pane-preview';
import { patchSlice } from '../../src/core/state';
import type { Element, Pin } from '../../src/core/types';

const mk = (id: string, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id, type, name, ...extra }) as unknown as Element;

// A small Space Map: two places with pins (one pin unnamed, as on the live
// demo), a third pin pointing at nothing, two zones drawn by unnamed markers,
// one stray marker with no zone, and two story links (a zone, a narrative).
const map = mk('map1', 'map', 'Space Map');
const felt = mk('loc1', 'location', 'Feltropolis');
const sog = mk('loc2', 'location', 'Soggia');
const crumble = mk('z1', 'zone', 'Crumblefields', { map: 'map1' });
const border = mk('z2', 'zone', 'Naval Patrol Border');
const tale = mk('n1', 'narrative', 'The Voyage', { maps: ['map1'] });
const pinFelt = mk('p1', 'pin', '', { map_id: 'map1', element_id: 'loc1', x: 1, y: 1 });
const pinSog = mk('p2', 'pin', 'Soggia pin', { map_id: 'map1', element_id: 'loc2', x: 2, y: 2 });
const pinLost = mk('p3', 'pin', '', { map_id: 'map1', element_id: 'gone', x: 3, y: 3 });
const markers = [
  ...[1, 2, 3].map(i => mk(`m-c${i}`, 'marker', '', { map_id: 'map1', zone_id: 'z1', x: i, y: i })),
  ...[1, 2].map(i => mk(`m-b${i}`, 'marker', '', { map_id: 'map1', zone_id: 'z2', x: i, y: i })),
  mk('m-x', 'marker', '', { map_id: 'map1', x: 9, y: 9 }),
];
const world = [map, felt, sog, crumble, border, tale, pinFelt, pinSog, pinLost, ...markers];
const byId = new Map(world.map(e => [e.id, e] as const));

describe('foldBacklinks (pure)', () => {
  it("on a map: pins read as their element, markers fold per zone, the rest is the story's", () => {
    const sources = world.filter(e => e.id !== 'map1' && e.id !== 'loc1' && e.id !== 'loc2' && e.id !== 'z2');
    const f = foldBacklinks(sources, 'map1', byId);
    expect(f.story.map(e => e.id).sort()).toEqual(['n1', 'z1']);
    expect(f.pins.map(p => p.label)).toEqual(['Feltropolis', 'Soggia', 'unnamed pin']);
    expect(f.pins.map(p => p.navId)).toEqual(['loc1', 'loc2', null]);
    expect(f.markerCount).toBe(6);
    expect(f.markers.map(markerFoldLabel)).toEqual([
      'Crumblefields: 3 markers', 'Naval Patrol Border: 2 markers', '1 marker with no zone',
    ]);
    expect(f.markers.map(m => m.navId)).toEqual(['z1', 'z2', null]);
  });

  it("on the pinned element: the pin reads as the map it sits on", () => {
    const p = pinBacklink(pinFelt as Pin, 'loc1', byId);
    expect(p.label).toBe('on Space Map');
    expect(p.navId).toBe('map1');
  });

  it('seen from neither end: element and map both', () => {
    expect(pinBacklink(pinFelt as Pin, 'elsewhere', byId).label).toBe('Feltropolis, on Space Map');
  });

  it("on a zone: its own markers are only a count", () => {
    const f = foldBacklinks(markers.filter(m => m.zone_id === 'z1'), 'z1', byId);
    expect(f.markers).toHaveLength(1);
    expect(f.markers[0]!.zoneName).toBeNull();
    expect(f.markers[0]!.navId).toBeNull();
    expect(markerFoldLabel(f.markers[0]!)).toBe('3 markers');
  });
});

describe("the map's element page (Referenced by)", () => {
  it('prints no "(unnamed)", one chip per pin by its element, one per zone', () => {
    patchSlice('data', { elements: world });
    const wrap = renderReferencedBy(map)!;
    const refby = wrap.querySelector('[data-section="Linked from"]')!;
    expect(refby).toBeTruthy();
    expect(refby.textContent).not.toContain('(unnamed)');
    const group = (label: string) => [...refby.querySelectorAll('.atlas-field')]
      .find(g => g.querySelector('.atlas-field-label')?.textContent === label);
    const chipsOf = (label: string) => [...(group(label)?.querySelectorAll('.atlas-link-chip') ?? [])]
      .map(c => c.querySelector('span:not(.atlas-link-chip-icon)')?.textContent);
    expect(chipsOf('Pins')).toEqual(['Feltropolis', 'Soggia', 'unnamed pin']);
    expect(chipsOf('Markers')).toEqual([
      'Crumblefields: 3 markers', 'Naval Patrol Border: 2 markers', '1 marker with no zone',
    ]);
    // The story's links keep their type groups; pins and markers close the section.
    const labels = [...refby.querySelectorAll('.atlas-field-label')].map(l => l.textContent);
    expect(labels.slice(-2)).toEqual(['Pins', 'Markers']);
    expect(labels).toContain('Zones');
  });
});

describe("the Web tab's card (Linked from)", () => {
  it('counts only the story, then a Pins line and a Markers line', () => {
    patchSlice('data', { elements: world });
    const host = document.createElement('div');
    const handle = mountContextPreview({ host, subject: map, mode: 'element', onClose: () => {} });
    handle.show(map);
    const lines = [...host.querySelectorAll('.atlas-context-preview-backlinks')].map(l => l.textContent);
    expect(lines).toEqual([
      'Linked from (2): The Voyage, Crumblefields',
      'Pins (3): Feltropolis, Soggia, unnamed pin',
      'Markers (6): Crumblefields (3), Naval Patrol Border (2), no zone (1)',
    ]);
    expect(host.textContent).not.toContain('(unnamed)');
    handle.destroy();
  });

  it("a zone's card says its markers as a count alone", () => {
    patchSlice('data', { elements: world });
    const host = document.createElement('div');
    const handle = mountContextPreview({ host, subject: crumble, mode: 'element', onClose: () => {} });
    handle.show(crumble);
    const lines = [...host.querySelectorAll('.atlas-context-preview-backlinks')].map(l => l.textContent);
    expect(lines).toEqual(['Markers (3)']);
    handle.destroy();
  });
});
