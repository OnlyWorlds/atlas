/**
 * One reading of a world's links for every surface that counts them (core/world-links.ts, conv. 185):
 * the graph reader's links plus Atlas's named own (map space as Atlas keeps it, a page's bound elements).
 * The references, Home's loose threads and the writing pane's lists read it; nothing else is a link.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { atlasAdditionsOf, incomingOf, readerEdgesOf } from '../../src/core/world-links';
import { readerLinksOf } from '../../src/tabs/right/context-pane-graph';
import { collectReferencedIds, findIncomingReferences } from '../../src/middle/element-detail-refs';
import { mountContextLists } from '../../src/tabs/right/context-pane-lists';
import { looseIds } from '../../src/middle/home-grid-picture';
import { getState, patchSlice } from '../../src/core/state';
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

describe('Home\'s grid: loose means linked to nothing either way', () => {
  it('a Character with one friend is not loose, nor is the friend; an element with no link is', () => {
    const ada = mk(R(30), 'character', { friends: [R(31)] });
    const bo = mk(R(31), 'character');
    const cy = mk(R(32), 'character');
    const keep = mk(R(33), 'location');
    const dee = mk(R(34), 'character', { birthplace: R(33), atlas_dismissed_suggestions: [R(32)] });
    expect([...looseIds([ada, bo, cy, keep, dee])]).toEqual([R(32)]);
  });
});

describe('the room stays out of a lore page\'s references (pageLore)', () => {
  afterEach(() => patchSlice('ui', { ...getState().ui, hideRoom: true }));

  it('a hidden room\'s Take is not listed under a Character, and is once the room shows', () => {
    const ada = mk(R(40), 'character');
    const take = mk(R(41), 'relation', { supertype: 'Take', x_room_of: R(49), characters: [R(40)] });
    const story = mk(R(42), 'narrative', { characters: [R(40)] });
    patchSlice('data', { elements: [ada, take, story] });
    patchSlice('ui', { ...getState().ui, hideRoom: true });
    expect(findIncomingReferences(R(40)).map(e => e.id)).toEqual([R(42)]);
    patchSlice('ui', { ...getState().ui, hideRoom: false });
    expect(findIncomingReferences(R(40)).map(e => e.id).sort()).toEqual([R(41), R(42)].sort());
  });
});

describe('the writing pane\'s Suggested', () => {
  it('follows each cast member\'s typed links (via the member), never an id in another key', () => {
    const keep = mk(R(50), 'location');
    const bo = mk(R(51), 'character');
    const stray = mk(R(52), 'character');
    const hero = mk(R(53), 'character', { birthplace: R(50), friends: [R(51)], x_note_ref: R(52) });
    const scene = mk(R(54), 'narrative', { supertype: 'Scene', protagonist: R(53) });
    patchSlice('data', { elements: [keep, bo, stray, hero, scene] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountContextLists({ host, narrative: scene, onSelect: () => {} });
    const rows = [...host.querySelectorAll<HTMLElement>('.atlas-context-pane-list-suggested .atlas-context-pane-row')]
      .map(r => `${r.dataset.elementId}|${r.querySelector('.atlas-context-pane-row-reason')?.textContent ?? ''}`).sort();
    expect(rows).toEqual([`${R(50)}|via ${hero.name}`, `${R(51)}|via ${hero.name}`].sort());
    h.destroy();
  });
});

describe('the writing pane\'s Cast', () => {
  afterEach(() => patchSlice('ui', { ...getState().ui, hideRoom: true }));

  it('reads the page\'s world: a hidden room\'s Take is not cast, as the Web above leaves it out', () => {
    const take = mk(R(60), 'relation', { supertype: 'Take', x_room_of: R(69) });
    const hero = mk(R(61), 'character');
    const scene = mk(R(62), 'narrative', { supertype: 'Scene', relations: [R(60)], characters: [R(61)] });
    patchSlice('data', { elements: [take, hero, scene] });
    patchSlice('ui', { ...getState().ui, hideRoom: true });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const h = mountContextLists({ host, narrative: scene, onSelect: () => {} });
    const cast = [...host.querySelectorAll<HTMLElement>('.atlas-context-pane-list-cast .atlas-context-pane-row')].map(r => r.dataset.elementId);
    expect(cast).toEqual([R(61)]);
    h.destroy();
  });

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
