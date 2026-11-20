/**
 * The stand-ins for a missing name (1.124.29). A delete question quotes a
 * name and its note after does not ("Delete map "Harbour"?", "Deleted
 * Harbour"); a nameless one is asked and told in the unnamed form, never in
 * quotes and never as empty quotes ("Delete the unnamed map?"). "this
 * character", "this <type>", "this element", "(unknown)" and "(home)" for an
 * element that is there say the unnamed form, in the room's own word, with
 * the capital where they start a line; an element that is not in the world at
 * all keeps words that say it is missing. The census of the bare forms is in
 * `unnamed-words.test.ts`.
 */
import { describe, it, expect, afterEach, beforeAll, vi } from 'vitest';
import { missingWords, quotedName } from '../../src/core/type-words';
import { patchSlice, getState } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import type { Element, WorldRegistryEntry, Zone } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import type { ToastManager } from '../../src/ui/toast-manager';
import { mountMapIndexTab } from '../../src/tabs/right/map-index-tab';
import { wireChipStrip } from '../../src/tabs/right/map-tab-zones';
import type { MapTabCacheEntry } from '../../src/tabs/right/map-tab-cache';
import { buildZoneSections } from '../../src/middle/element-detail-zone-sections';
import { renderHeader } from '../../src/middle/element-detail-header';
import { mountWritingBody } from '../../src/sidebar/writing-sidebar';
import { writingHash } from '../../src/core/router';
import { buildGuideBlock } from '../../src/middle/home-guide';
import { buildGrowBlock } from '../../src/middle/home-grow';
import { promiseFor, sentenceFor } from '../../src/ui/home-grid-place';
import { buildHomePicture, resetHomePictureForTests } from '../../src/middle/home-picture';
import { mountContextGraph, clearContextGraphLayoutMemo } from '../../src/tabs/right/context-pane-graph';
import { buildCharterMarkOffer } from '../../src/middle/element-detail-charter-mark';

const W = 'w-stand';
const MAP = '00000000-0000-4000-8000-0000000000a1';
const MAP2 = '00000000-0000-4000-8000-0000000000a2';

function el(type: string, id: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name: id, local_updated_at: '2026-11-19T10:00:00.000Z', ...extra } as unknown as Element;
}

function openWorld(elements: Element[]): void {
  const entry = { id: W, name: 'Stand', state: 'local-only' } as unknown as WorldRegistryEntry;
  patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
  patchSlice('active', { worldId: W, meta: { name: 'Stand' } } as never);
  patchSlice('data', { ...getState().data, elements });
}

function fakeToasts(): ToastManager & { success: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> } {
  return { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn(), show: vi.fn() } as never;
}

/** A store that deletes by id and lists what is left of the world on screen, and asks nothing else. */
function fakeStore() {
  const gone = new Set<string>();
  const drop = async (id: string) => { gone.add(id); };
  const store = {
    findDependents: vi.fn(async () => [] as Element[]),
    deleteElement: vi.fn(drop),
    deleteMap: vi.fn(drop),
    deleteZone: vi.fn(drop),
    listElements: vi.fn(async () => getState().data.elements.filter(e => !gone.has(e.id))),
  };
  setActiveStore(store as never);
  return store;
}

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} };
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});

afterEach(() => {
  vi.restoreAllMocks();
  setActiveStore(null);
  document.body.innerHTML = '';
  window.location.hash = '';
  patchSlice('ui', { ...getState().ui, selectedElementId: null });
  patchSlice('data', { ...getState().data, elements: [] });
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
});

describe('the builders', () => {
  it('quotedName quotes a name, trimmed, after its type word when asked; a missing name is the unnamed form, never quoted', () => {
    expect(quotedName({ name: ' Harbour ', type: 'map' })).toBe('"Harbour"');
    expect(quotedName({ name: 'Harbour', type: 'map' }, { typed: true })).toBe('map "Harbour"');
    expect(quotedName({ name: '', type: 'map' }, { typed: true })).toBe('the unnamed map');
    expect(quotedName({ name: '  ', type: 'narrative' }, { word: 'chapter' })).toBe('the unnamed chapter');
    expect(quotedName({ type: 'zone' }, { typed: true })).not.toContain('"');
  });

  it('missingWords says the element is missing, never an unnamed form', () => {
    expect(missingWords('location')).toBe('a missing location');
    expect(missingWords('narrative', { start: true, word: 'story' })).toBe('A missing story');
    expect(missingWords('character')).not.toContain('unnamed');
  });
});

describe('a delete asks with the name in quotes and tells it plainly', () => {
  it('the map index: a named map, a nameless one never as empty quotes', async () => {
    const named = el('map', MAP, { name: 'Harbour' });
    const nameless = el('map', MAP2, { name: '' });
    openWorld([named, nameless]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toasts = fakeToasts();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mountMapIndexTab(target, toasts);
    target.querySelector<HTMLElement>('[aria-label="Delete the unnamed map"]')!.click();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(asked.mock.calls[0][0]).toBe('Delete the unnamed map? This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted the unnamed map');
    target.querySelector<HTMLElement>('[aria-label="Delete the map Harbour"]')!.click();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(2));
    expect(asked.mock.calls[1][0]).toBe('Delete map "Harbour"? This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted Harbour');
  });

  it('a zone from the map\'s zone list: the question quotes, the note does not', async () => {
    const reef = el('zone', 'z1', { name: 'Reef' }) as unknown as Zone;
    const blank = el('zone', 'z2', { name: ' ' }) as unknown as Zone;
    openWorld([reef as unknown as Element, blank as unknown as Element]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toasts = fakeToasts();
    const strip = document.createElement('div');
    document.body.appendChild(strip);
    wireChipStrip({ zoneStrip: strip, mapId: MAP, hiddenZoneKinds: new Set() } as unknown as MapTabCacheEntry, toasts);
    const press = (id: string) => {
      strip.innerHTML = `<span class="atlas-zone-chip" data-zone-id="${id}"><button type="button" data-action="delete">x</button></span>`;
      strip.querySelector<HTMLElement>('[data-action="delete"]')!.click();
    };
    press('z1');
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(asked.mock.calls[0][0]).toBe('Delete zone "Reef"? This also removes 0 marker(s). This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted Reef');
    press('z2');
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(2));
    expect(asked.mock.calls[1][0]).toBe('Delete the unnamed zone? This also removes 0 marker(s). This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted the unnamed zone');
  });

  it("a zone's own page: the unnamed form asked and told; its markers' map heading says the unnamed map", async () => {
    const zone = el('zone', 'z3', { name: '' }) as unknown as Zone;
    const map = el('map', MAP, { name: '' });
    const marker = el('marker', 'mk1', { name: '', zone_id: 'z3', map_id: MAP, x: 1, y: 2 });
    openWorld([zone as unknown as Element, map, marker]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toasts = fakeToasts();
    const host = document.createElement('div');
    document.body.appendChild(host);
    for (const s of buildZoneSections(zone, toasts)) host.appendChild(s);
    expect(host.querySelector('.atlas-zone-markers-group-header')!.textContent).toContain('The unnamed map');
    host.querySelector<HTMLElement>('[data-action="delete-zone"]')!.click();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(asked.mock.calls[0][0]).toBe('Delete the unnamed zone? This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted the unnamed zone');
  });

  it("an element's page: the note says the unnamed form, never \"element\"", async () => {
    const ada = el('character', 'c1', { name: '' });
    openWorld([ada]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const header = renderHeader(ada);
    document.body.appendChild(header);
    const { toastManager } = await import('../../src/ui/toast-manager');
    const said = vi.spyOn(toastManager, 'success').mockImplementation(() => undefined as never);
    header.querySelector<HTMLElement>('[data-action="delete-element"]')!.click();
    await vi.waitFor(() => expect(said).toHaveBeenCalled());
    expect(asked.mock.calls[0][0]).toBe('Delete the unnamed character? This cannot be undone.');
    expect(said).toHaveBeenLastCalledWith('Deleted the unnamed character');
  });

  it('the writing tree: asked and told in the tier\'s word', async () => {
    const book = el('narrative', 'b1', { name: 'The Book', supertype: 'Book', order: 0 });
    const chapter = el('narrative', 'ch1', { name: '', supertype: 'Chapter', parent_narrative: 'b1', order: 0 });
    openWorld([book, chapter]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toasts = fakeToasts();
    window.location.hash = writingHash(W);
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWritingBody({ content, toasts });
    try {
      const row = [...content.querySelectorAll<HTMLElement>('.atlas-writing-tree-row')]
        .find(r => r.querySelector('.atlas-writing-tree-name')?.textContent === 'The unnamed chapter')!;
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      document.querySelector<HTMLElement>('[data-role="delete-narrative"]')!.click();
      await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
      expect(asked.mock.calls[0][0]).toBe('Delete the unnamed chapter? This cannot be undone.');
      expect(toasts.success).toHaveBeenLastCalledWith('Deleted the unnamed chapter');
    } finally {
      unmount();
    }
  });
});

describe('this <type> and its family say the unnamed form', () => {
  const dots = { someone: true, placed: false, happened: false, story: false, copy: false };

  it("the home guide's card: a nameless character's place was deleted, at the line's start", () => {
    const ada = el('character', 'c1', { name: '', location: 'gone' });
    const keep = el('location', 'l1', { name: 'Hollow Keep' });
    openWorld([ada, keep]);
    const block = buildGuideBlock({ kind: 'path', step: 'placed', back: false }, dots, W, fakeToasts(), () => {});
    expect(block.textContent).toContain("The unnamed character's place was deleted.");
    expect([...block.querySelectorAll('button')].map(b => b.textContent)).toContain('Open the unnamed character');
    expect(block.textContent).not.toMatch(/this character/i);
  });

  it("the home guide's card: a free character and its place, a capital where each starts", () => {
    const ada = el('character', 'c1', { name: '' });
    const keep = el('location', 'l1', { name: ' ' });
    openWorld([ada, keep]);
    const block = buildGuideBlock({ kind: 'path', step: 'placed', back: false }, dots, W, fakeToasts(), () => {});
    expect(block.textContent).toContain('The unnamed character has no place yet. The unnamed location could be it.');
    expect([...block.querySelectorAll('button')].map(b => b.textContent)).toContain('Place the unnamed character at the unnamed location');
  });

  it("the home's grow block: the same line, at its start", () => {
    const ada = el('character', 'c1', { name: '', location: 'gone' });
    const keep = el('location', 'l1', { name: 'Hollow Keep' });
    openWorld([ada, keep]);
    const grow = buildGrowBlock(dots, W, fakeToasts(), () => {});
    expect(grow.section.querySelector('[data-role="grow-line"]')!.textContent).toBe("The unnamed character's place was deleted.");
    grow.destroy();
  });

  it("the home grid's sentences: the unnamed form, capital at the start; one not in the world is missing", () => {
    const ada = el('character', 'c1', { name: '' });
    const keep = el('location', 'l1', { name: '' });
    const tale = el('narrative', 'n1', { name: '' });
    const w = { on: 'c1', field: 'location', target: 'l1', single: true, holds: true } as never;
    expect(sentenceFor(w, ada, keep)).toBe('The unnamed character is in the unnamed location');
    expect(promiseFor(w, ada, keep)).toBe('The unnamed character will be in the unnamed location');
    expect(promiseFor(w, ada, keep, false)).toBe('the unnamed character will be in the unnamed location');
    expect(promiseFor(w, ada, undefined)).toBe('The unnamed character will be in a missing element');
    const list = { on: 'n1', field: 'events', target: 'c1', single: false, holds: true } as never;
    expect(sentenceFor(list, tale, ada)).toBe('The unnamed story now lists the unnamed character');
  });

  it("the home picture of a nameless centre: its heading and its link", () => {
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const keep = el('location', id(2), { name: '' });
    const folk = ['Ada', 'Bram', 'Cole'].map((n, i) => el('character', id(20 + i), { name: n, location: keep.id }));
    openWorld([keep, ...folk]);
    resetHomePictureForTests();
    const pic = buildHomePicture(W, 'stand-in');
    expect(pic).not.toBeNull();
    expect(pic!.section.querySelector('.atlas-home-picture-title')!.textContent).toBe('The unnamed location and what it touches');
    expect(pic!.section.querySelector('[data-action="home-picture-see"]')!.textContent).toBe("See the unnamed location's world");
    pic!.destroy();
  });

  it('the Web: a nameless subject is The unnamed character, and a backlink says it mid-line', () => {
    clearContextGraphLayoutMemo();
    const centre = el('character', '00000000-0000-4000-8000-000000000000', { name: '' });
    const bo = el('character', '00000000-0000-4000-8000-000000000001', { name: 'Bo', friends: [centre.id] });
    patchSlice('data', { ...getState().data, elements: [centre, bo] });
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountContextGraph({ host, subject: centre, onSelect: () => {}, hopDepth: 1 });
    const node = (id: string) => host.querySelector<HTMLElement>(`.atlas-context-graph-node[data-element-id="${id}"]`)!;
    expect(node(centre.id).querySelector('.atlas-context-graph-node-label')!.textContent).toBe('The unnamed character');
    expect(node(bo.id).title).toBe('Bo\nlinks to the unnamed character');
  });

  it("the charter mark: the leading charter with no name is the unnamed charter, never the word alone", () => {
    const lead = el('law', 'l0', { name: ' ', supertype: 'Charter', x_charter_of: 'w', created_at: '2026-10-01T00:00:00Z' });
    const newer = el('law', 'l1', { name: 'New Rules', supertype: 'Charter', created_at: '2026-10-20T00:00:00Z' });
    openWorld([lead, newer]);
    const entry = getState().registry.worlds[0];
    const box = buildCharterMarkOffer(newer, entry, {}, W, [lead, newer]);
    expect(box?.textContent).toMatch(/This world's charter is the unnamed charter\. Marking this one makes it the charter in place of the unnamed charter, and Home then offers to retire the unnamed charter\./);
  });
});
