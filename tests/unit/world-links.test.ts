/**
 * One reading of a world's links for every surface that counts them (core/world-links.ts, conv. 185):
 * the graph reader's links plus Atlas's named own (map space as Atlas keeps it, a page's bound elements).
 * The references, Home's loose threads and the writing pane's lists read it; nothing else is a link.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { atlasAdditionsOf, incomingOf, readerEdgesOf } from '../../src/core/world-links';
import { readerLinksOf } from '../../src/tabs/right/context-pane-graph';
import { collectReferencedIds } from '../../src/middle/element-detail-refs';
import { mountContextLists } from '../../src/tabs/right/context-pane-lists';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

const R = (n: number) => `0698cccc-0000-7000-8000-${String(n).padStart(12, '0')}`;
const mk = (id: string, type: string, extra: Record<string, unknown> = {}): Element =>
  ({ id, type, name: `${type} ${id.slice(-2)}`, ...extra }) as unknown as Element;

afterEach(() => { document.body.innerHTML = ''; });

describe('the shared reading', () => {
  it('is one reading per elements array, and the Web derives from it', () => {
    const world = [mk(R(1), 'location'), mk(R(2), 'character', { birthplace: R(1) })];
    expect(readerEdgesOf(world)).toBe(readerEdgesOf(world));
    expect(readerEdgesOf(world).get(R(2))).toEqual([{ target: R(1), field: 'birthplace' }]);
    expect(readerLinksOf(world).get(R(2))).toEqual([R(1)]);
    expect(incomingOf(world)).toBe(incomingOf(world));
  });

  it('keeps the writing tree for the references, though the Web leaves it undrawn', () => {
    const world = [mk(R(1), 'narrative'), mk(R(2), 'narrative', { parent_narrative: R(1) })];
    expect(incomingOf(world).get(R(1))?.get(R(2))).toEqual(['parent_narrative']);
    expect(readerLinksOf(world).get(R(2))).toBeUndefined();
  });

  it('names Atlas\'s own links and nothing else: map space in either spelling, a page\'s bound elements', () => {
    expect(atlasAdditionsOf(mk(R(3), 'pin', { element_id: R(1), map_id: R(5) }))).toEqual([
      { target: R(5), field: 'map_id' }, { target: R(1), field: 'element_id' }]);
    expect(atlasAdditionsOf(mk(R(4), 'marker', { map: R(5), zone_id: '', zone: R(6) }))).toEqual([
      { target: R(5), field: 'map' }, { target: R(6), field: 'zone' }]);
    expect(atlasAdditionsOf(mk(R(7), 'narrative', { atlas_page_refs: [R(1)], atlas_dismissed_suggestions: [R(2)], x_survey_ref: R(1) }))).toEqual([
      { target: R(1), field: 'atlas_page_refs' }]);
  });

  it('Home\'s loose threads: a dismissed suggestion or an undeclared x_ key references nothing', () => {
    const world = [
      mk(R(1), 'location'),
      mk(R(2), 'character'),
      mk(R(3), 'narrative', { atlas_dismissed_suggestions: [R(1)], x_survey_ref: R(2) }),
      mk(R(4), 'character', { location: R(1) }),
    ];
    const referenced = collectReferencedIds(world);
    expect(referenced.has(R(1))).toBe(true);
    expect(referenced.has(R(2))).toBe(false);
    const quiet = [mk(R(1), 'location'), mk(R(3), 'narrative', { atlas_dismissed_suggestions: [R(1)] })];
    expect(collectReferencedIds(quiet).has(R(1))).toBe(false);
  });
});

describe('the writing pane\'s Cast', () => {
  const castIds = (host: HTMLElement) =>
    [...host.querySelectorAll<HTMLElement>('.atlas-context-pane-list-cast .atlas-context-pane-row')].map(r => r.dataset.elementId).sort();

  it('holds every typed link of the scene (protagonist, narrator, zones), never its chapter, never a wrong type', () => {
    const chapter = mk(R(10), 'narrative', { supertype: 'Chapter' });
    const hero = mk(R(11), 'character');
    const teller = mk(R(12), 'character');
    const marsh = mk(R(13), 'zone');
    const keep = mk(R(14), 'location');
    const scene = mk(R(15), 'narrative', {
      supertype: 'Scene', parent_narrative: R(10), protagonist: R(11), narrator: R(12), zones: [R(13)],
      locations: [R(14), R(11)], atlas_dismissed_suggestions: [R(14)],
    });
    patchSlice('data', { elements: [chapter, hero, teller, marsh, keep, scene] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountContextLists({ host, narrative: scene, onSelect: () => {} });
    expect(castIds(host)).toEqual([R(11), R(12), R(13), R(14)].sort());
    h.destroy();
  });
});
