/**
 * The strand's lines and doors (1.122.0, `src/middle/home-strand-room.ts`): the line above a filled
 * box (a sibling of the box in its cell, the join words between it and a place's box) with its link
 * inline (the amendment's A1), its × and the record it writes, the strut a line leaves for the rest of
 * the visit (G2), the readers who see no line (G3), the location's three states and its links (G4, G7),
 * and each box's ⋯ holding Edit here, its room door and Use another (W6, G6; the amendment's A2).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { mapFor, placedOn, boxDoors } from '../../src/middle/home-strand-room';
import { bornOrFounded } from '../../src/middle/home-strand-box';
import { buildStrandPanel, holdStrandRows, openHeadLatch, resetStrandTabForTests, settleStrandFocus, strandContext } from '../../src/middle/home-strand';
import { memory } from '../../src/middle/home-strand-model';
import { linesOf } from '../../src/core/strand-lines';

const dialogs = vi.hoisted(() => [] as unknown[][]);
/** What the next New map dialog answers: null (Cancel), or a map made. */
const dialogAnswer = vi.hoisted(() => ({ next: null as unknown }));
vi.mock('../../src/ui/map-create-modal', () => ({ createMapDialog: (...args: unknown[]) => { dialogs.push(args); return Promise.resolve(dialogAnswer.next); } }));

const W = 'w-strand-room';
const N = '0192a000-0000-7000-8000-000000000a01';
const E = '0192a000-0000-7000-8000-000000000b01';
const L = '0192a000-0000-7000-8000-000000000c01';
const L2 = '0192a000-0000-7000-8000-000000000c02';
const C = '0192a000-0000-7000-8000-000000000d01';
const M = '0192a000-0000-7000-8000-000000000e01';
const P = '0192a000-0000-7000-8000-000000000f01';
const el = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ id, type, name: `${type}-${id.slice(-2)}`, ...extra }) as unknown as Element;
/** A whole strand: the event undated, no map, the story a Book. */
const whole = (eventExtra: Record<string, unknown> = {}): Element[] => [
  el('narrative', N, { supertype: 'Book', events: [E], protagonist: C, story: 'A tale.' }), el('event', E, { locations: [L], ...eventExtra }),
  el('location', L, { name: 'The Quay' }), el('location', L2, { name: 'The Library' }), el('character', C, { location: L2, name: 'Odile' }),
];
function world(elements: Element[], entry: Partial<WorldRegistryEntry> = {}): void {
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'W', state: 'local-only', ...entry } as WorldRegistryEntry] });
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W', x_strand: { narrative: N, event: E, location: L } } } as never);
  patchSlice('data', { elements, loading: false } as never);
}
let host: HTMLElement;
function draw(): HTMLElement {
  if (!host) { host = document.createElement('div'); document.body.appendChild(host); }
  host.innerHTML = '';
  host.appendChild(buildStrandPanel(W, { alone: false, redraw: draw }));
  return host;
}
const cellOf = (slot: string) => host.querySelector<HTMLElement>(`[data-slot="${slot}"]`)!;
const box = (slot: string) => host.querySelector<HTMLElement>(`[data-box="${slot}"]`)!;
const line = (slot: string) => cellOf(slot).querySelector<HTMLElement>('[data-role="strand-line"]');
const lineText = (slot: string) => line(slot)?.querySelector('.atlas-home-strand-line-text')?.textContent ?? null;
const IDS: Record<string, string> = { narrative: N, event: E, location: L, character: C, now: L2 };
/** The box's ⋯ items in order; null when the box draws no ⋯. */
const menuLabels = (slot: string): string[] | null => {
  const menu = box(slot).querySelector<HTMLElement>('.atlas-home-strand-menu');
  return menu ? [...menu.querySelectorAll<HTMLElement>(':scope > button')].map(b => b.textContent ?? '') : null;
};
const menuItem = (slot: string, label: string) =>
  [...box(slot).querySelectorAll<HTMLButtonElement>('.atlas-home-strand-menu > button')].find(b => b.textContent === label)!;

afterEach(() => {
  resetStrandTabForTests();
  dialogs.length = 0;
  dialogAnswer.next = null;
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
  document.body.innerHTML = '';
  host = undefined as unknown as HTMLElement;
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('mapFor and placedOn', () => {
  const m = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, type: 'map', name, ...extra }) as unknown as Element;
  const pin = (id: string, map: string, element: string, extra: Record<string, unknown> = { x: 10, y: 20 }) =>
    ({ id, type: 'pin', name: 'p', map_id: map, element_id: element, ...extra }) as unknown as Element;
  const idx = (...els: Element[]) => new Map(els.map(e => [e.id, e]));
  it('mapFor: no map, none; the map holding a pin of it, else the first by name', () => {
    expect(mapFor('L', [])).toBeNull();
    expect(mapFor('L', [m('b', 'Zeal'), m('a', 'Atoll')])).toEqual({ id: 'a', name: 'Atoll', pinned: false });
    expect(mapFor('L', [m('a', 'Atoll'), m('b', 'Zeal'), pin('p1', 'b', 'L'), pin('p2', 'a', 'OTHER')])).toEqual({ id: 'b', name: 'Zeal', pinned: true });
  });
  it('placedOn (G7): a settled pin with a point, on a map in view; a proposed pin, a pin with no point, a pin on a missing or proposed map: not placed', () => {
    expect(placedOn('L', idx(m('a', 'A'), pin('p', 'a', 'L')))).toBe(true);
    expect(placedOn('L', idx(m('a', 'A'), { ...pin('p', 'a', 'L'), map: 'a', map_id: undefined } as unknown as Element))).toBe(true);
    expect(placedOn('L', idx(m('a', 'A'), pin('p', 'a', 'L', { x: 1, y: 2, x_review_proposed: { by: 'm', evidence: 'seat' } })))).toBe(false);
    expect(placedOn('L', idx(m('a', 'A'), pin('p', 'a', 'L', { x: null, y: null })))).toBe(false);
    expect(placedOn('L', idx(pin('p', 'gone', 'L')))).toBe(false);
    expect(placedOn('L', idx(m('a', 'A', { x_review_proposed: { by: 'm', evidence: 'seat' } }), pin('p', 'a', 'L')))).toBe(false);
    // A map of the place (`location`) is no pin of it.
    expect(placedOn('L', idx(m('a', 'A', { location: 'L' })))).toBe(false);
  });
  it('mapFor (the code gate\'s C6): a proposed map is never the one opened', () => {
    const proposed = { x_review_proposed: { by: 'm', evidence: 'seat' } };
    expect(mapFor('L', [m('a', 'Atoll', proposed), m('b', 'Zeal')])).toEqual({ id: 'b', name: 'Zeal', pinned: false });
    expect(mapFor('L', [m('a', 'Atoll', proposed)])).toBeNull();
  });
});

describe('the line above each filled box (W3)', () => {
  it('a sibling of the box in its cell, above it; the join words between a place\'s line and its box (G11); each line\'s words and link', () => {
    world(whole());
    draw();
    for (const slot of ['narrative', 'event', 'location', 'character']) {
      const l = line(slot)!;
      expect(l, slot).not.toBeNull();
      expect(box(slot).contains(l)).toBe(false);
      const kids = [...cellOf(slot).children];
      const lineSlot = l.closest('[data-line-key]')!;
      expect(kids.indexOf(lineSlot as HTMLElement)).toBeLessThan(kids.indexOf(box(slot)));
      expect(lineSlot.getAttribute('data-line-key')).toBe(`${slot}:${IDS[slot]}`);
    }
    const kids = [...cellOf('location').children];
    const join = cellOf('location').querySelector('[data-role="strand-join"]')!;
    expect(kids.indexOf(line('location')!.parentElement!)).toBeLessThan(kids.indexOf(join as HTMLElement));
    expect(kids.indexOf(join as HTMLElement)).toBeLessThan(kids.indexOf(box('location')));
    expect(lineText('narrative')).toBe('In the writing room you can shape it into chapters and scenes.');
    expect(lineText('event')).toBe('Give it a date to place it on the timeline in Charts.');
    expect(lineText('location')).toBe('Create a map to pin it in place.');
    expect(lineText('character')).toBe('Their page holds everything about them.');
    // The amendment's A1: where they are now has no line, and leaves no slot for one.
    expect(line('now')).toBeNull();
    expect(cellOf('now').querySelector('[data-line-key]')).toBeNull();
    // Each line's link, inline: the words that go.
    const links = (slot: string) => [...line(slot)!.querySelectorAll('[data-line-link]')].map(b => `${b.getAttribute('data-line-link')}=${b.textContent}`);
    expect(links('narrative')).toEqual(['writing=the writing room']);
    expect(links('event')).toEqual(['charts=Charts']);
    expect(links('location')).toEqual(['create-map=Create a map']);
    expect(links('character')).toEqual(['page=Their page']);
    // Each ends with its ×.
    for (const slot of ['narrative', 'event', 'location', 'character']) {
      const x = line(slot)!.lastElementChild!;
      expect(x.getAttribute('aria-label')).toBe('Hide this line');
      expect(x.querySelector('[aria-hidden="true"]')!.textContent).toBe('×');
    }
  });

  it('the event\'s line changes its words once the timeline places it (a whole number, or a number the timeline reads); never for words it cannot', () => {
    const DATED = 'Its year puts it on the timeline in Charts.';
    world(whole({ start_date: 1142 }));
    draw();
    expect(lineText('event')).toBe(DATED);
    world(whole({ start_date: '12' }));
    draw();
    expect(lineText('event')).toBe(DATED);
    world(whole({ start_date: 'that winter' }));
    draw();
    expect(lineText('event')).toBe('Give it a date to place it on the timeline in Charts.');
  });

  it('the location in three states: no map, a map it is not on, pinned', () => {
    world(whole());
    draw();
    expect(lineText('location')).toBe('Create a map to pin it in place.');
    world([...whole(), el('map', M, { name: 'The Coast' })]);
    draw();
    expect(lineText('location')).toBe('Pin it on a map.');
    world([...whole(), el('map', M, { name: 'The Coast' }), el('pin', P, { map_id: M, element_id: L, x: 5, y: 5 })]);
    draw();
    expect(line('location')).toBeNull();
  });

  it('only a proposed map in the world: still "Create a map" (C6), on the line and the box', () => {
    world([...whole(), el('map', M, { name: 'The Coast', x_review_proposed: { by: 'm', evidence: 'seat' } })]);
    draw();
    expect(lineText('location')).toBe('Create a map to pin it in place.');
    expect(menuLabels('location')).toEqual(['Edit here', 'Create a map', 'Use another location']);
  });

  it('once Create a map made a map, the focus is asked for the Pin it on a map that replaces it (C2); a Cancel asks nothing', async () => {
    world(whole());
    draw();
    line('location')!.querySelector<HTMLButtonElement>('[data-line-link="create-map"]')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(memory.askFocus).toEqual({ worldId: W, key: 'line:location:create-map' });
    dialogAnswer.next = { map: { id: M, name: 'The Coast' } };
    draw();
    line('location')!.querySelector<HTMLButtonElement>('[data-line-link="create-map"]')!.click();
    await Promise.resolve(); await Promise.resolve();
    expect(memory.askFocus).toEqual({ worldId: W, key: 'line:location:pin-map' });
  });

  it('Create a map opens the panel\'s own New map dialog with nothing filled in, and writes nothing', () => {
    world(whole());
    draw();
    const before = JSON.stringify(getState().data.elements);
    line('location')!.querySelector<HTMLButtonElement>('[data-line-link="create-map"]')!.click();
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0][1]).toEqual({});
    expect(JSON.stringify(getState().data.elements)).toBe(before);
    expect(memory.askFocus).toEqual({ worldId: W, key: 'line:location:create-map' });
  });

  it('each link lands where it says and only navigates: Pin it on a map, Charts (the rail undated, its place dated), the writing room, their page', () => {
    world([...whole(), el('map', M, { name: 'The Coast' })]);
    draw();
    const before = JSON.stringify(getState().data.elements);
    const press = (slot: string, kind: string): void => line(slot)!.querySelector<HTMLButtonElement>(`[data-line-link="${kind}"]`)!.click();
    press('location', 'pin-map');
    expect(window.location.hash).toBe(`#/w/${W}/map/${M}/element/${L}`);
    draw();
    press('event', 'charts');
    expect(window.location.hash).toBe(`#/w/${W}/timeline`);
    draw();
    press('narrative', 'writing');
    expect(window.location.hash).toBe(`#/w/${W}/writing/${N}`);
    expect(memory.askFocus).toEqual({ worldId: W, key: 'line:narrative:writing' });
    draw();
    press('character', 'page');
    expect(window.location.hash).toBe(`#/w/${W}/element/${C}`);
    expect(memory.askFocus).toEqual({ worldId: W, key: 'line:character:page' });
    expect(JSON.stringify(getState().data.elements)).toBe(before);
    world([...whole({ start_date: 5 }), el('map', M, { name: 'The Coast' })]);
    draw();
    press('event', 'charts');
    expect(window.location.hash).toBe(`#/w/${W}/timeline/${E}`);
    expect(dialogs).toHaveLength(0);
  });

  it('the story\'s and the character\'s lines go once their room was opened (the record\'s `opened`)', () => {
    world(whole(), { strand_lines: { hidden: [], opened: [`narrative:${N}`, `character:${C}`] } });
    draw();
    expect(line('narrative')).toBeNull();
    expect(line('character')).toBeNull();
    expect(line('event')).not.toBeNull();
  });

  it('a story in Knowledge or Pages, or a writing room not set up: no story line', () => {
    world(whole().map(e => (e.id === N ? el('narrative', N, { supertype: 'Legend', events: [E], protagonist: C }) : e)));
    draw();
    expect(line('narrative')).toBeNull();
  });

  it('the links wait while a write is in flight; the × does not (it writes only this browser\'s record)', () => {
    world(whole());
    memory.inFlight.add(`${W}\u0000now`);
    draw();
    expect(line('event')!.querySelector<HTMLButtonElement>('[data-line-link="charts"]')!.disabled).toBe(true);
    expect(line('event')!.querySelector<HTMLButtonElement>('.atlas-home-strand-line-x')!.disabled).toBe(false);
  });
});

describe('the × (W4, G2, G8)', () => {
  it('hides only its line, records it for this world in this browser, asks the focus for the box', () => {
    world(whole());
    draw();
    line('event')!.querySelector<HTMLButtonElement>('.atlas-home-strand-line-x')!.click();
    expect(line('event')).toBeNull();
    for (const slot of ['narrative', 'location', 'character']) expect(line(slot), slot).not.toBeNull();
    const entry = getState().registry.worlds.find(w => w.id === W);
    expect(linesOf(entry)).toEqual({ hidden: [`event:${E}`], opened: [] });
    // G8: the focus asked for the box's first control once the line is gone.
    expect(memory.askFocus).toEqual({ worldId: W, key: 'box:event' });
    // Nothing of it in the world's elements.
    expect(JSON.stringify(getState().data.elements)).not.toContain('strand_lines');
  });

  it('a line that goes during the visit leaves an empty aria-hidden strut its height, until Home is opened again', () => {
    // jsdom lays nothing out: every box reads 20 px tall in a 600 px grid.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ x: 0, y: 0, top: 0, left: 0, right: 600, bottom: 20, width: 600, height: 20, toJSON: () => ({}) }) as DOMRect);
    world(whole());
    draw();
    holdStrandRows(host, W);
    line('character')!.querySelector<HTMLButtonElement>('.atlas-home-strand-line-x')!.click();
    const strut = cellOf('character').querySelector<HTMLElement>('[data-role="strand-line-strut"]')!;
    expect(strut).not.toBeNull();
    expect(strut.getAttribute('aria-hidden')).toBe('true');
    expect(strut.textContent).toBe('');
    expect(strut.style.minHeight).toBe('20px');
    expect(strut.querySelector('button')).toBeNull();
    // The date given: the event's line changes its words (the amendment's A1), its height held.
    patchSlice('data', { elements: whole({ start_date: 3 }), loading: false } as never);
    draw();
    expect(lineText('event')).toBe('Its year puts it on the timeline in Charts.');
    expect(cellOf('event').querySelector<HTMLElement>('[data-line-key]')!.style.minHeight).toBe('20px');
    // A pin places the location: its line goes the same way as the ×.
    patchSlice('data', { elements: [...whole({ start_date: 3 }), el('map', M, { name: 'The Coast' }), el('pin', P, { map_id: M, element_id: L, x: 5, y: 5 })], loading: false } as never);
    draw();
    expect(cellOf('location').querySelector('[data-role="strand-line-strut"]')).not.toBeNull();
    // Home opened again: no strut.
    openHeadLatch(() => {});
    draw();
    expect(cellOf('character').querySelector('[data-line-key]')).toBeNull();
    expect(cellOf('location').querySelector('[data-line-key]')).toBeNull();
    expect(cellOf('event').querySelector<HTMLElement>('[data-line-key]')!.style.minHeight).toBe('');
  });
});

describe('readers who may not change an element (G3)', () => {
  it('a view-only world: no lines, no Edit here, the ⋯ only where a reading door is, in reading words', () => {
    world(whole({ start_date: 5 }), { copy_of: { world_id: 'x' } } as never);
    draw();
    for (const slot of ['narrative', 'event', 'location', 'character', 'now']) {
      expect(line(slot), slot).toBeNull();
      expect(box(slot).querySelector('[data-act="edit"]'), slot).toBeNull();
      expect(box(slot).querySelector('.atlas-home-strand-box-acts'), slot).toBeNull();
      // The title stays the page's way in.
      expect(box(slot).querySelector('[data-strand-key$=":open"]'), slot).not.toBeNull();
    }
    expect(menuLabels('narrative')).toEqual(['Open in the writing room']);
    expect(menuLabels('event')).toEqual(['See it in Charts']);
    expect(menuLabels('location')).toBeNull();
    expect(menuLabels('character')).toBeNull();
    expect(menuLabels('now')).toBeNull();
  });

  it('an undated event read by one who may not: no "See it in Charts", no ⋯', () => {
    world(whole(), { copy_of: { world_id: 'x' } } as never);
    draw();
    expect(menuLabels('event')).toBeNull();
  });

  it('a member who may not change one element: that box has no line and reading doors; their own box keeps its line', () => {
    const entry = { state: 'api-linked', api: { world_id: 'a', api_key: 'k', member_role: 'contributor', membership: 'mine' } } as never;
    world(whole().map(e => (e.id === C ? el('character', C, { location: L2, name: 'Odile', created_by: 'mine' }) : el(e.type, e.id, { ...e, created_by: 'someone-else' }))), entry);
    draw();
    expect(line('event')).toBeNull();
    expect(box('event').querySelector('[data-act="edit"]')).toBeNull();
    expect(line('character')).not.toBeNull();
    expect(box('character').querySelector('[data-act="edit"]')!.textContent).toBe('Edit here');
  });

  it('the demo world: no location line, so no map dialog (conv. 149)', () => {
    world(whole(), { demo: true } as never);
    draw();
    expect(line('location')).toBeNull();
  });
});

describe('Born and Founded on a box (G9; the code gate\'s C5)', () => {
  const CAL = { id: 'cal-1', type: 'construct', name: 'Reckoning', supertype: 'calendar', atlas_calendar: { version: 1, grain: 'year', eras: [{ name: 'Third Age', abbrev: 'TA', start: 0 }], format: '{year} {era}' } };
  it('in a calendar world: the world calendar\'s reading; without one, the whole number; not a whole number: no line', () => {
    world([...whole(), CAL as unknown as Element]);
    const c = strandContext(W)!;
    const odile = el('character', C, { birth_date: 1119 });
    const said = bornOrFounded(odile, c)!;
    expect(said.startsWith('Born ')).toBe(true);
    expect(said).not.toBe('Born 1119');
    expect(said).toMatch(/TA/);
    expect(bornOrFounded(el('location', L, { founding_date: 1102 }), c)).toMatch(/^Founded .*TA/);
    world(whole());
    const plain = strandContext(W)!;
    expect(bornOrFounded(odile, plain)).toBe('Born 1119');
    expect(bornOrFounded(el('character', C, { birth_date: '1119' }), plain)).toBe('Born 1119');
    expect(bornOrFounded(el('character', C, { birth_date: 11.5 }), plain)).toBeNull();
    expect(bornOrFounded(el('character', C, { birth_date: 'that winter' }), plain)).toBeNull();
    expect(bornOrFounded(el('event', E, { start_date: 5 }), plain)).toBeNull();
  });
});

describe('the box\'s ⋯ (W6, G6; the amendment\'s A2)', () => {
  it('a reader who may change it: no row of buttons; the ⋯ holds Edit here, the room that edits it, then Use another', () => {
    world(whole({ start_date: 5 }));
    draw();
    for (const slot of ['narrative', 'event', 'location', 'character', 'now']) {
      expect(box(slot).querySelector('.atlas-home-strand-box-acts'), slot).toBeNull();
      // No button outside the name row: the title, then the ⋯ beside it.
      const buttons = [...box(slot).querySelectorAll<HTMLElement>('button')].filter(b => !b.closest('.atlas-home-strand-menu') && !b.closest('[data-role="strand-lines"]'));
      expect(buttons.map(b => b.getAttribute('data-strand-key')), slot).toEqual([`${slot}:open`, `${slot}:more`]);
    }
    expect(menuLabels('narrative')).toEqual(['Edit here', 'Edit in the writing room', 'Use another story']);
    expect(menuLabels('event')).toEqual(['Edit here', 'Edit in Charts', 'Use another event']);
    // C3: the location's way to a map, as its line's, kept on the box.
    expect(menuLabels('location')).toEqual(['Edit here', 'Create a map', 'Use another location']);
    expect(menuLabels('character')).toEqual(['Edit here', 'Use another character']);
    expect(menuLabels('now')).toEqual(['Edit here', 'Use another location']);
    // Each item is held while a write is in flight, as every act.
    for (const b of box('event').querySelectorAll('.atlas-home-strand-menu > button')) expect(b.getAttribute('data-act')).toMatch(/^(edit|room|another)$/);
  });

  it('Edit here from the ⋯ opens the in-place form, its focus in Name', () => {
    world(whole());
    draw();
    menuItem('character', 'Edit here').click();
    expect(memory.editing).toMatchObject({ worldId: W, slot: 'character', id: C });
    expect(memory.askFocus).toEqual({ worldId: W, key: 'edit:character:name' });
  });

  it('Back to a closed ⋯\'s item puts the focus on its ⋯; to a line gone since (its page opened), on the box\'s name', () => {
    world(whole({ start_date: 5 }));
    draw();
    memory.askFocus = { worldId: W, key: 'event:room' };
    settleStrandFocus(host, null);
    expect(document.activeElement).toBe(box('event').querySelector('[data-strand-key="event:more"]'));
    memory.askFocus = { worldId: W, key: 'character:edit' };
    settleStrandFocus(host, null);
    expect(document.activeElement).toBe(box('character').querySelector('[data-strand-key="character:more"]'));
    world(whole({ start_date: 5 }), { strand_lines: { hidden: [], opened: [`character:${C}`] } });
    draw();
    memory.askFocus = { worldId: W, key: 'line:character:page' };
    settleStrandFocus(host, null);
    expect(document.activeElement).toBe(box('character').querySelector('[data-strand-key="character:open"]'));
  });

  it('the title opens the element\'s page in every box (the page\'s way in once Open its page went)', () => {
    world(whole({ start_date: 5 }));
    for (const slot of ['event', 'location', 'character', 'now']) {
      draw();
      box(slot).querySelector<HTMLButtonElement>(`[data-strand-key="${slot}:open"]`)!.click();
      expect(window.location.hash, slot).toBe(`#/w/${W}/element/${IDS[slot]}`);
    }
  });

  it('C3: the location\'s third door: Pin it on a map with a map in view (mapFor\'s landing), Create a map without (the dialog, nothing filled, the focus back on the door once made); placed, still the map; never where the grid does not act', async () => {
    world([...whole(), el('map', M, { name: 'The Coast' })]);
    draw();
    const door = () => box('location').querySelector<HTMLButtonElement>('[data-strand-key="location:room"]')!;
    expect(door().textContent).toBe('Pin it on a map');
    door().click();
    expect(window.location.hash).toBe(`#/w/${W}/map/${M}/element/${L}`);
    expect(memory.askFocus).toEqual({ worldId: W, key: 'location:room' });
    // Hidden line, the door stays (Promise 4).
    world([...whole(), el('map', M, { name: 'The Coast' })], { strand_lines: { hidden: [`location:${L}`], opened: [] } });
    draw();
    expect(line('location')).toBeNull();
    expect(door().textContent).toBe('Pin it on a map');
    world(whole());
    dialogAnswer.next = { map: { id: M, name: 'The Coast' } };
    draw();
    expect(door().textContent).toBe('Create a map');
    door().click();
    expect(dialogs[dialogs.length - 1][1]).toEqual({});
    await Promise.resolve(); await Promise.resolve();
    expect(memory.askFocus).toEqual({ worldId: W, key: 'location:room' });
    world(whole(), { demo: true } as never);
    draw();
    expect(box('location').querySelector('[data-strand-key="location:room"]')).toBeNull();
  });

  it('each door lands where it says and only navigates, its focus kept for Back', () => {
    world(whole({ start_date: 5 }));
    draw();
    const before = JSON.stringify(getState().data.elements);
    const lands: Array<[string, string, string]> = [
      ['narrative', 'Edit in the writing room', `#/w/${W}/writing/${N}`],
      ['event', 'Edit in Charts', `#/w/${W}/timeline/${E}`],
    ];
    for (const [slot, label, hash] of lands) {
      draw();
      menuItem(slot, label).click();
      expect(window.location.hash, `${slot} ${label}`).toBe(hash);
      expect(memory.askFocus?.key).toBe(`${slot}:room`);
    }
    expect(JSON.stringify(getState().data.elements)).toBe(before);
  });

  it('G6: a story outside the writing tree, or in a world whose writing is not set up: no story line, no writing room door', () => {
    world(whole().map(e => (e.id === N ? el('narrative', N, { supertype: 'Legend', events: [E], protagonist: C }) : e)));
    draw();
    expect(menuLabels('narrative')).toEqual(['Edit here', 'Use another story']);
    // A foreign chain of narratives: the writing room asks its setup first.
    world([...whole(), el('narrative', 'x-saga', { supertype: 'Saga' }), el('narrative', 'x-part', { supertype: 'Part', parent_narrative: 'x-saga' })]);
    draw();
    expect(menuLabels('narrative')).toEqual(['Edit here', 'Use another story']);
    expect(line('narrative')).toBeNull();
  });

  it('an undated event\'s Edit in Charts opens the timeline, where a date is given', () => {
    world(whole());
    const c = strandContext(W)!;
    expect(boxDoors('event', c.byId.get(E)!, c).map(d => d.hash)).toEqual([`#/w/${W}/timeline`]);
  });

  it('a story in Knowledge: Open in Knowledge, and no Open its page among the doors (the title is the page); no story line', () => {
    world(whole().map(e => (e.id === N ? el('narrative', N, { subtype: 'knowledge', events: [E], protagonist: C }) : e)));
    const c = strandContext(W)!;
    expect(boxDoors('narrative', c.byId.get(N)!, c)).toEqual([
      { label: 'Open in Knowledge', key: 'narrative:room', hash: `#/w/${W}/knowledge/${N}` },
    ]);
    draw();
    expect(line('narrative')).toBeNull();
  });
});
