/**
 * Onboarding step 2 (#840): one count, the Web's own (C0); the reward carried
 * on its note through a dialog's wait, and a note left on a page that has
 * gone giving way to the next (C2); Home's picture centred on what the Web
 * draws, ranked once per what the world says (C3).
 */
import { describe, it, expect, afterEach, beforeAll, beforeEach } from 'vitest';
import {
  mountContextGraph, clearContextGraphLayoutMemo, contextGraphLastLayout, contextGraphLiveCount, webRingOne,
} from '../../src/tabs/right/context-pane-graph';
import { getState, patchSlice } from '../../src/core/state';
import { openWebOn, resetOpenWebForTests, webDrawerHolds } from '../../src/ui/open-web';
import { reportGesture, resetGuideNoteForTests } from '../../src/ui/guide-note';
import { homeCentre, homePictureRanks, resetHomePictureForTests, buildHomePicture } from '../../src/middle/home-picture';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const E = (n: number, type: string, name: string, extra: Record<string, unknown> = {}) =>
  ({ id: uuid(n), type, name, ...extra }) as unknown as Element;

function world(elements: Element[], entry: Partial<WorldRegistryEntry> = {}): void {
  const e = { id: 'w', name: 'W', where: 'folder', state: 'local-only', ...entry } as unknown as WorldRegistryEntry;
  patchSlice('registry', { worlds: [e] } as never);
  patchSlice('active', { worldId: 'w', meta: { name: 'W' } } as never);
  patchSlice('data', { elements } as never);
}

afterEach(() => {
  document.body.innerHTML = '';
  resetGuideNoteForTests();
  patchSlice('active', null);
  try { localStorage.clear(); } catch { /* */ }
});

describe('C0: the reward and Home count what the Web draws at depth 1', () => {
  beforeEach(() => clearContextGraphLayoutMemo());

  it('a pin, a marker, a proposed element and a switched-off type: the same set as the Web\'s layout', () => {
    const ada = E(1, 'character', 'Ada', { location: uuid(2), objects: [uuid(5)] });
    const keep = E(2, 'location', 'Hollow Keep');
    const map = E(3, 'map', 'The Map');
    const pin = E(4, 'pin', 'pin', { map_id: uuid(3), element_id: uuid(1) });
    const sword = E(5, 'object', 'Sword');
    const doubt = E(6, 'event', 'A doubt', { characters: [uuid(1)], x_review_proposed: { by: 'm2' } });
    const zone = E(7, 'zone', 'North');
    const marker = E(8, 'marker', 'marker', { map_id: uuid(3), zone_id: uuid(7) });
    const fam = E(9, 'family', 'House', { characters: [uuid(1)] });
    const all = [ada, keep, map, pin, sword, doubt, zone, marker, fam];
    for (const hidden of [new Set<string>(), new Set(['object'])]) {
      world(all, { context_filters_off: [...hidden] } as never);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const g = mountContextGraph({ host, subject: ada, onSelect: () => {}, hopDepth: 1, hiddenTypes: hidden as never });
      const drawn = contextGraphLastLayout().filter(n => !n.isCenter).map(n => n.id).sort();
      expect(webRingOne(ada, hidden).sort()).toEqual(drawn);
      g.destroy();
    }
  });

  it('the Web\'s ring cap and centre press are options; a graph destroyed twice counts once', () => {
    const hub = E(1, 'location', 'Hub');
    const many = Array.from({ length: 20 }, (_, i) => E(10 + i, 'character', `C${i}`, { location: uuid(1) }));
    world([hub, ...many]);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const before = contextGraphLiveCount();
    let pressed = '';
    const g = mountContextGraph({ host, subject: hub, onSelect: () => {}, hopDepth: 1, ringCap: 12, onCenterPress: id => { pressed = id; } });
    expect(contextGraphLastLayout().filter(n => !n.isCenter)).toHaveLength(12);
    expect(host.textContent).toContain('+8 more not shown');
    host.querySelector<HTMLElement>(`.atlas-context-graph-node.is-center`)!.click();
    expect(pressed).toBe(hub.id);
    expect(contextGraphLiveCount()).toBe(before + 1);
    g.destroy();
    g.destroy();
    expect(contextGraphLiveCount()).toBe(before);
  });
});

/** Ada placed at the Keep, in The Founding at no year yet; the slot on the page. */
function adaReady(entry: Partial<WorldRegistryEntry> = {}): { ada: Element; keep: Element; ev: Element } {
  const keep = E(2, 'location', 'Hollow Keep');
  const ada = E(1, 'character', 'Ada', { location: keep.id });
  const ev = E(3, 'event', 'The Founding', { characters: [ada.id], locations: [keep.id], start_date: 120 });
  world([ada, keep, ev], entry);
  const slot = document.createElement('div');
  slot.className = 'atlas-guide-slot';
  document.body.appendChild(slot);
  return { ada, keep, ev };
}
const shown = () => document.querySelector<HTMLElement>('[data-role="guide-note"]');

describe('C2: the reward on its note', () => {
  it('carried through a dialog: the year\'s note drawn when the dialog closes still has See Ada\'s world', () => {
    const { ev } = adaReady();
    const overlay = document.createElement('div');
    overlay.className = 'atlas-modal-overlay';
    document.body.appendChild(overlay);
    reportGesture({ kind: 'date-set', event: ev.id });
    expect(shown()).toBeNull();
    overlay.remove();
    document.dispatchEvent(new CustomEvent('atlas:modal-closed'));
    expect(shown()?.dataset.note).toBe('dated');
    expect(shown()?.querySelector('[data-note-action="see-world"]')?.textContent).toBe("See Ada's world");
  });

  it('its twin: an Event that adds a third link to Ada earns nothing, though its year lit the dot', () => {
    const { ada, keep } = adaReady();
    const sword = E(4, 'object', 'Sword');
    const ev = E(3, 'event', 'The Founding', { characters: [ada.id], locations: [keep.id], start_date: 120 });
    patchSlice('data', { elements: [{ ...ada, objects: [sword.id] } as Element, keep, ev, sword] } as never);
    reportGesture({ kind: 'date-set', event: ev.id });
    expect(shown()?.dataset.note).toBe('dated');
    expect(shown()?.querySelector('[data-note-action="see-world"]')).toBeNull();
  });

  it('counted as the Web draws it: with Objects switched off in the Web, Ada\'s Sword is not a link, and the reward speaks', () => {
    const { ada, keep } = adaReady({ context_filters_off: ['object'] } as never);
    const sword = E(4, 'object', 'Sword');
    const ev = E(3, 'event', 'The Founding', { characters: [ada.id], locations: [keep.id], start_date: 120 });
    patchSlice('data', { elements: [{ ...ada, objects: [sword.id] } as Element, keep, ev, sword] } as never);
    reportGesture({ kind: 'date-set', event: ev.id });
    expect(shown()?.querySelector('[data-note-action="see-world"]')?.textContent).toBe("See Ada's world");
  });

  it('the button leaves when Ada is no longer placed; the note stays', () => {
    const { ada, keep, ev } = adaReady();
    reportGesture({ kind: 'date-set', event: ev.id });
    expect(shown()?.querySelector('[data-note-action="see-world"]')).not.toBeNull();
    patchSlice('data', { elements: [{ ...ada, location: null } as unknown as Element, keep, ev] } as never);
    expect(shown()?.dataset.note).toBe('dated');
    expect(shown()?.querySelector('[data-note-action="see-world"]')).toBeNull();
  });

  it('a note on a page the person has left gives way to the next gesture\'s, in a world where the copy is due', () => {
    const { ada, keep } = adaReady({ where: 'browser' } as never);
    patchSlice('data', { elements: [{ ...ada, location: null } as unknown as Element, keep] } as never);
    window.location.hash = '#/w/w/home';
    patchSlice('data', { elements: [ada, keep] } as never);
    reportGesture({ kind: 'location-set', character: ada.id });
    expect(shown()?.dataset.note).toBe('placed');
    // A create that moved to its element: the address changed, its hashchange not yet run.
    const ev = E(5, 'event', 'The Siege');
    patchSlice('data', { elements: [ada, keep, ev] } as never);
    window.location.hash = `#/w/w/element/${ev.id}`;
    reportGesture({ kind: 'created', id: ev.id });
    expect(shown()?.dataset.note).toBe('event');
  });
});

describe('C1: openWebOn', () => {
  const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, value: w });
  afterEach(() => { setWidth(1024); document.body.className = ''; resetOpenWebForTests(); });

  it('the Web tab made active; on a narrow window, the drawer opens even when the address is already the element\'s', () => {
    world([E(1, 'character', 'Ada')]);
    patchSlice('ui', { ...getState().ui, rightTabs: [{ kind: 'map-index' }, { kind: 'context' }], rightActiveIndex: 0 } as never);
    setWidth(390);
    window.location.hash = `#/w/w/element/${uuid(1)}`;
    openWebOn('w', uuid(1));
    expect(getState().ui.rightActiveIndex).toBe(1);
    expect(document.body.classList.contains('atlas-drawer-right-open')).toBe(true);
    expect(webDrawerHolds()).toBe(true);
  });

  it('on a wide window: no drawer, and nothing held', () => {
    world([E(1, 'character', 'Ada')]);
    setWidth(1440);
    window.location.hash = `#/w/w/element/${uuid(1)}`;
    openWebOn('w', uuid(1));
    expect(document.body.classList.contains('atlas-drawer-right-open')).toBe(false);
    expect(webDrawerHolds()).toBe(false);
  });
});

describe('C3: Home\'s centre', () => {
  beforeEach(() => resetHomePictureForTests());

  it('a Book with five chapters is not it: the Web draws no ring for it; the Keep with three is', () => {
    const book = E(1, 'narrative', 'The Book', { supertype: 'Book' });
    const chapters = Array.from({ length: 5 }, (_, i) => E(10 + i, 'narrative', `Ch ${i}`, { parent_narrative: book.id }));
    const keep = E(2, 'location', 'Hollow Keep');
    const folk = ['Ada', 'Bram', 'Cole'].map((n, i) => E(20 + i, 'character', n, { location: keep.id }));
    world([book, ...chapters, keep, ...folk]);
    expect(homeCentre('w', 'a')).toBe(keep.id);
  });

  it('none with three around it: no centre, and no picture', () => {
    const keep = E(2, 'location', 'Hollow Keep');
    world([keep, E(20, 'character', 'Ada', { location: keep.id }), E(21, 'character', 'Bram', { location: keep.id })]);
    expect(homeCentre('w', 'b')).toBeNull();
    expect(buildHomePicture('w', 'b')).toBeNull();
  });

  it('ranked once per what the world says and the Web\'s switches; a switched-off type moves it', () => {
    const keep = E(2, 'location', 'Hollow Keep');
    world([keep, ...['Ada', 'Bram', 'Cole'].map((n, i) => E(20 + i, 'character', n, { location: keep.id }))]);
    expect(homeCentre('w', 'c')).toBe(keep.id);
    expect(homeCentre('w', 'c')).toBe(keep.id);
    expect(homePictureRanks()).toBe(1);
    patchSlice('registry', { worlds: [{ id: 'w', name: 'W', context_filters_off: ['character'] }] } as never);
    expect(homeCentre('w', 'c')).toBeNull();
    expect(homePictureRanks()).toBe(2);
  });
});
