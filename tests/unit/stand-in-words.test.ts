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
import { deleteRefusedLine } from '../../src/sync/proposal-lines';
import { installPlacementHintWatcher } from '../../src/tabs/right/map-placement-hint';
import { sliceLine } from '../../src/core/provenance';
import { recordAliasIfForeign } from '../../src/middle/prose-link-existing';
import { elementHash } from '../../src/core/router';
import { buildNarrativeIndex } from '../../src/middle/writing-helpers';

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

describe('a delete names its type whatever the door (the gate\'s S3)', () => {
  async function askFromPage(target: Element, hash?: string): Promise<{ asked: string; said: string }> {
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    if (hash) window.location.hash = hash;
    const { toastManager } = await import('../../src/ui/toast-manager');
    const said = vi.spyOn(toastManager, 'success').mockImplementation(() => undefined as never);
    const header = renderHeader(target);
    document.body.appendChild(header);
    header.querySelector<HTMLElement>('[data-action="delete-element"]')!.click();
    await vi.waitFor(() => expect(said).toHaveBeenCalled());
    return { asked: asked.mock.calls[0][0] as string, said: said.mock.calls[0][0] as string };
  }

  it("a map's own page asks as the Maps tree does", async () => {
    const map = el('map', MAP, { name: 'Harbour' });
    openWorld([map]);
    expect(await askFromPage(map)).toEqual({ asked: 'Delete map "Harbour"? This cannot be undone.', said: 'Deleted Harbour' });
  });

  it("a zone's own page asks as the zone list does", async () => {
    const reef = el('zone', 'z1', { name: 'Reef' }) as unknown as Zone;
    openWorld([reef as unknown as Element]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toasts = fakeToasts();
    const host = document.createElement('div');
    document.body.appendChild(host);
    for (const s of buildZoneSections(reef, toasts)) host.appendChild(s);
    host.querySelector<HTMLElement>('[data-action="delete-zone"]')!.click();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(asked.mock.calls[0][0]).toBe('Delete zone "Reef"? This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted Reef');
  });

  it('a chapter asked from the writing room keeps the tree\'s word; its plain page says the type\'s', async () => {
    const chapter = el('narrative', 'ch1', { name: 'One', supertype: 'Chapter' });
    openWorld([chapter]);
    expect((await askFromPage(chapter, writingHash(W, 'ch1'))).asked).toBe('Delete chapter "One"? This cannot be undone.');
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    expect((await askFromPage(chapter, elementHash(W, 'ch1'))).asked).toBe('Delete narrative "One"? This cannot be undone.');
  });

  it('the writing tree asks a named chapter by its word too', async () => {
    const book = el('narrative', 'b1', { name: 'The Book', supertype: 'Book', order: 0 });
    const chapter = el('narrative', 'ch1', { name: 'One', supertype: 'Chapter', parent_narrative: 'b1', order: 0 });
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
        .find(r => r.querySelector('.atlas-writing-tree-name')?.textContent === 'One')!;
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      document.querySelector<HTMLElement>('[data-role="delete-narrative"]')!.click();
      await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
      expect(asked.mock.calls[0][0]).toBe('Delete chapter "One"? This cannot be undone.');
      expect(toasts.success).toHaveBeenLastCalledWith('Deleted One');
    } finally {
      unmount();
    }
  });

  it('a name holding quotes and markup is said as text: quoted and trimmed in the question, plain in the note', async () => {
    const map = el('map', MAP, { name: '  <b>"Ada"</b> ' });
    openWorld([map]);
    fakeStore();
    const asked = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const toasts = fakeToasts();
    const target = document.createElement('div');
    document.body.appendChild(target);
    mountMapIndexTab(target, toasts);
    expect(target.querySelector('[data-action="delete-map"]')!.getAttribute('aria-label')).toBe('Delete the map <b>"Ada"</b>');
    target.querySelector<HTMLElement>('[data-action="delete-map"]')!.click();
    await vi.waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(asked.mock.calls[0][0]).toBe('Delete map "<b>"Ada"</b>"? This cannot be undone.');
    expect(toasts.success).toHaveBeenLastCalledWith('Deleted <b>"Ada"</b>');
    expect(document.body.querySelector('b')).toBeNull();
  });

  it('a name that is not a string never throws: the Maps tree and the writing tree read it as none', () => {
    const map = el('map', MAP, { name: 42 });
    const book = el('narrative', 'b1', { name: 7, supertype: 'Book', order: 0 });
    openWorld([map, book]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    mountMapIndexTab(target, fakeToasts());
    expect(target.querySelector('[data-action="delete-map"]')!.getAttribute('aria-label')).toBe('Delete the unnamed map');
    window.location.hash = writingHash(W);
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWritingBody({ content, toasts: fakeToasts() });
    try {
      expect(content.querySelector<HTMLElement>('.atlas-writing-tree-row-add')?.title).toBe('New chapter in the unnamed book');
    } finally {
      unmount();
    }
  });
});

describe('a name that is not a string reads as none, wherever the trees read it (gate 2\'s S1)', () => {
  it("the Maps tree: a map named 42 with a map under it draws, its fold names the unnamed map", () => {
    const parent = el('map', MAP, { name: 42 });
    const child = el('map', MAP2, { name: 'Shore', parent_map: MAP });
    openWorld([parent, child]);
    const target = document.createElement('div');
    document.body.appendChild(target);
    mountMapIndexTab(target, fakeToasts());
    const fold = target.querySelector<HTMLElement>('[aria-label="The map under the unnamed map"]');
    expect(fold).not.toBeNull();
    expect(fold!.title).toMatch(/the map under the unnamed map$/);
  });

  it('the writing tree: a search with a narrative named 7 filters, never throws', () => {
    const book = el('narrative', 'b1', { name: 7, supertype: 'Book', order: 0 });
    const one = el('narrative', 'ch1', { name: 'One', supertype: 'Chapter', parent_narrative: 'b1', order: 0 });
    const zed = el('narrative', 'ch2', { name: 'Zed', supertype: 'Chapter', parent_narrative: 'b1', order: 1 });
    openWorld([book, one, zed]);
    window.location.hash = writingHash(W);
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWritingBody({ content, toasts: fakeToasts() });
    try {
      const names = () => [...content.querySelectorAll('.atlas-writing-tree-name')].map(n => n.textContent);
      expect(names()).toEqual(['The unnamed book', 'One', 'Zed']);
      const search = content.querySelector<HTMLInputElement>('[data-role="writing-search"]')!;
      search.value = 'on';
      search.dispatchEvent(new Event('input'));
      expect(names()).toEqual(['The unnamed book', 'One']);
    } finally {
      unmount();
    }
  });

  it("the writing tree: a parent cycle whose cut ties on tier and order, with a name 5, is cut by id", () => {
    // ch1 and ch2 hold each other: one cycle, both chapters, order 0; the cut goes to the first by name, then id.
    const a = el('narrative', 'ch1', { name: 5, supertype: 'Chapter', parent_narrative: 'ch2', order: 0 });
    const b = el('narrative', 'ch2', { name: '', supertype: 'Chapter', parent_narrative: 'ch1', order: 0 });
    openWorld([a, b]);
    const idx = buildNarrativeIndex([a, b], W);
    expect(idx.roots.map(r => r.el.id)).toEqual(['ch1']);
  });

  it('the writing tree: a reorder whose tie-break meets a name 5 still writes the new order', async () => {
    const book = el('narrative', 'b1', { name: 'The Book', supertype: 'Book', order: 0 });
    const a = el('narrative', 'ch1', { name: 'Alpha', supertype: 'Chapter', parent_narrative: 'b1', order: 0 });
    const b = el('narrative', 'ch2', { name: 5, supertype: 'Chapter', parent_narrative: 'b1', order: 0 });
    openWorld([book, a, b]);
    const store = { ...fakeStore(), updateElement: vi.fn(async () => {}) };
    setActiveStore(store as never);
    window.location.hash = writingHash(W);
    const content = document.createElement('div');
    document.body.appendChild(content);
    const unmount = mountWritingBody({ content, toasts: fakeToasts() });
    try {
      const row = (text: string) => [...content.querySelectorAll<HTMLElement>('.atlas-writing-tree-row')]
        .find(r => r.querySelector('.atlas-writing-tree-name')?.textContent === text)!;
      row('Alpha').dispatchEvent(new Event('dragstart'));
      row('The unnamed chapter').dispatchEvent(new Event('drop', { cancelable: true }));
      await vi.waitFor(() => expect(store.updateElement).toHaveBeenCalled());
    } finally {
      unmount();
    }
  });
});

describe('the places one phrase over, and the lines the census cannot see (the gate\'s S1, S2)', () => {
  it("the keeper-only note says the unnamed form mid-line", () => {
    expect(deleteRefusedLine([{ id: 'c1', type: 'character', name: '' } as never]))
      .toBe("Only this world's keeper can delete the unnamed character, so it is back.");
    expect(deleteRefusedLine([{ id: 'c1', type: 'character', name: ' Ada ' } as never]))
      .toBe("Only this world's keeper can delete Ada, so it is back.");
  });

  it('the placement banner names the element, or its unnamed form', () => {
    const ada = el('character', 'c1', { name: '' });
    openWorld([ada]);
    const canvas = document.createElement('div');
    canvas.className = 'atlas-map-canvas-container';
    document.body.appendChild(canvas);
    installPlacementHintWatcher();
    patchSlice('ui', { ...getState().ui, pinPlacement: { elementId: 'c1' } });
    expect(canvas.querySelector('.atlas-map-placement-hint-text')!.textContent).toBe('Click the map to place the unnamed character');
    patchSlice('ui', { ...getState().ui, pinPlacement: null });
  });

  it('a new map of a nameless place starts as New map, of a named one as Map of …', async () => {
    const place = el('location', 'l1', { name: ' ' });
    openWorld([place]);
    fakeStore();
    const header = renderHeader(place);
    document.body.appendChild(header);
    const add = header.querySelector<HTMLElement>('[data-action="add-map"]')!;
    expect(add.title).toBe('Create a new map of the unnamed location');
    add.click();
    await vi.waitFor(() => expect(document.querySelector<HTMLInputElement>('input[name="map-name"]')).not.toBeNull());
    expect(document.querySelector<HTMLInputElement>('input[name="map-name"]')!.value).toBe('New map');
  });

  it("a slice's character with no name is the unnamed character", () => {
    const meta = { exported_as: { kind: 'character', character: { name: '  ' } } };
    expect(sliceLine(meta, () => null)).toBe("Exported as one Character's view: only what the unnamed character knows of the world.");
  });

  it("an alias that could not be saved names the element by its unnamed form, never 'the element name'", async () => {
    const ada = el('character', 'c1', { name: '' });
    openWorld([ada]);
    setActiveStore({ updateElement: vi.fn(async () => { throw new Error('disk'); }) } as never);
    const { toastManager } = await import('../../src/ui/toast-manager');
    const said = vi.spyOn(toastManager, 'error').mockImplementation(() => undefined as never);
    await recordAliasIfForeign(ada, 'the stranger');
    expect(said).toHaveBeenCalledWith('Linked, but could not save "the stranger" as an alias. The link may show the unnamed character instead');
  });
});
