/**
 * Each strand box opens its room (1.121.0, `src/middle/home-strand-room.ts`): the table's every row for a
 * reader who may change the element and one who may not, the map to open a location with, and the line as
 * the box draws it (between the text and Edit, the act never a write, never while the box is open for a
 * change, the focus kept for Back).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { mapFor, roomLine, type RoomFacts } from '../../src/middle/home-strand-room';
import { buildStrandPanel, resetStrandTabForTests } from '../../src/middle/home-strand';
import { memory } from '../../src/middle/home-strand-model';
import { DEFAULT_WRITING_LABELS } from '../../src/middle/writing-helpers';

const W = 'w-strand-room';
const base = (slot: RoomFacts['slot'], extra: Partial<RoomFacts> = {}): RoomFacts => ({ slot, worldId: W, id: 'x1', writer: true, ...extra });
const MAP = { id: 'm1', name: 'The Coast', pinned: false };

describe('roomLine: the table', () => {
  const writing = { hash: `#/w/${W}/writing/x1`, label: 'writing' };
  const rows: Array<[string, RoomFacts, string, { label: string; hash: string } | null]> = [
    ['story in the writing room, a Book', base('narrative', { room: writing, writingReady: true, labels: DEFAULT_WRITING_LABELS, tier: 'l1' }),
      'Its chapters and scenes are written in the writing room.', { label: 'Open in the writing room', hash: `#/w/${W}/writing/x1` }],
    ['story in the writing room, the world\'s own labels', base('narrative', { room: writing, writingReady: true, labels: { l1: 'Saga', l2: 'Act', l3: 'Story', l4: 'Draft' }, tier: 'l1' }),
      'Its acts and stories are written in the writing room.', { label: 'Open in the writing room', hash: `#/w/${W}/writing/x1` }],
    ['story that is a Chapter', base('narrative', { room: writing, writingReady: true, labels: DEFAULT_WRITING_LABELS, tier: 'l2' }),
      'Its scenes are written in the writing room.', { label: 'Open in the writing room', hash: `#/w/${W}/writing/x1` }],
    ['story in the tree, writing not set up', base('narrative', { room: writing, writingReady: false, labels: DEFAULT_WRITING_LABELS, tier: 'l1' }),
      'Its page holds everything about it.', { label: 'Open its page', hash: `#/w/${W}/element/x1` }],
    ['story not in the tree', base('narrative', { room: { hash: `#/w/${W}/element/x1`, label: '' }, writingReady: true }),
      'Its page holds everything about it.', { label: 'Open its page', hash: `#/w/${W}/element/x1` }],
    ['story that is a knowledge entry', base('narrative', { room: { hash: `#/w/${W}/knowledge/x1`, label: 'knowledge' }, writingReady: true }),
      'Its page holds everything about it.', { label: 'Open in Knowledge', hash: `#/w/${W}/knowledge/x1` }],
    ['story that is a page', base('narrative', { room: { hash: `#/w/${W}/share/x1`, label: 'share' }, writingReady: true }),
      'Its page holds everything about it.', { label: 'Open in Pages', hash: `#/w/${W}/share/x1` }],
    ['event with a year', base('event', { dated: true }),
      'Its year puts it on the timeline in Charts.', { label: 'See it on the timeline', hash: `#/w/${W}/timeline/x1` }],
    ['event with a year, a reader who may not', base('event', { dated: true, writer: false }),
      'Its year puts it on the timeline in Charts.', { label: 'See it on the timeline', hash: `#/w/${W}/timeline/x1` }],
    ['event with no year', base('event', { dated: false }), 'Give it a year and it goes on the timeline in Charts.', null],
    ['event with no year, a reader who may not', base('event', { dated: false, writer: false }), 'It has no year yet, so it is not on the timeline.', null],
    ['location, a map, not pinned', base('location', { acts: true, map: MAP }),
      'A location can be pinned on a map.', { label: 'Open it with the map', hash: `#/w/${W}/map/m1/element/x1` }],
    ['location, pinned', base('now', { acts: true, map: { ...MAP, pinned: true } }),
      'It is on The Coast.', { label: 'See it on the map', hash: `#/w/${W}/map/m1/element/x1` }],
    ['location, a map, a reader who may not', base('location', { acts: true, map: MAP, writer: false }),
      'Its page shows everything that is in or at it.', { label: 'Open its page', hash: `#/w/${W}/element/x1` }],
    ['location, a map, where the grid does not act', base('location', { acts: false, map: MAP }),
      'Its page shows everything that is in or at it.', { label: 'Open its page', hash: `#/w/${W}/element/x1` }],
    ['location, no map', base('location', { acts: true, map: null }),
      'Its page shows everything that is in or at it.', { label: 'Open its page', hash: `#/w/${W}/element/x1` }],
    ['character', base('character'), 'Their page holds everything about them.', { label: 'Open their page', hash: `#/w/${W}/element/x1` }],
    ['character, a reader who may not', base('character', { writer: false }), 'Their page holds everything about them.', { label: 'Open their page', hash: `#/w/${W}/element/x1` }],
  ];
  for (const [name, facts, text, act] of rows) {
    it(name, () => expect(roomLine(facts)).toEqual({ text, act }));
  }

  it('no line has an em-dash', () => {
    for (const [, facts] of rows) expect(roomLine(facts).text).not.toMatch(/—/);
  });
});

describe('mapFor', () => {
  const m = (id: string, name: string) => ({ id, type: 'map', name }) as unknown as Element;
  const pin = (id: string, map: string, element: string) => ({ id, type: 'pin', name: 'p', map_id: map, element_id: element }) as unknown as Element;
  it('no map: none', () => expect(mapFor('L', [])).toBeNull());
  it('the world\'s first map by name when no map holds a pin of it', () => {
    expect(mapFor('L', [m('b', 'Zeal'), m('a', 'Atoll')])).toEqual({ id: 'a', name: 'Atoll', pinned: false });
  });
  it('the map that holds a pin of it, before an earlier name', () => {
    expect(mapFor('L', [m('a', 'Atoll'), m('b', 'Zeal'), pin('p1', 'b', 'L'), pin('p2', 'a', 'OTHER')])).toEqual({ id: 'b', name: 'Zeal', pinned: true });
  });
  it('a pin in the map spelling counts', () => {
    const p = { id: 'p', type: 'pin', name: 'p', map: 'b', element_id: 'L' } as unknown as Element;
    expect(mapFor('L', [m('a', 'Atoll'), m('b', 'Zeal'), p])!.id).toBe('b');
  });
});

// ---- The line as the box draws it ----

const N = '0192a000-0000-7000-8000-000000000a01';
const E = '0192a000-0000-7000-8000-000000000b01';
const L = '0192a000-0000-7000-8000-000000000c01';
const L2 = '0192a000-0000-7000-8000-000000000c02';
const C = '0192a000-0000-7000-8000-000000000d01';
const M = '0192a000-0000-7000-8000-000000000e01';
const el = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ id, type, name: `${type}-${id.slice(-2)}`, ...extra }) as unknown as Element;
const whole = (): Element[] => [
  el('narrative', N, { supertype: 'Book', events: [E], protagonist: C, story: 'A tale.' }), el('event', E, { locations: [L], characters: [C], start_date: 12 }),
  el('location', L, { name: 'The Quay' }), el('location', L2, { name: 'The Library' }), el('character', C, { location: L2, name: 'Odile' }),
  el('map', M, { name: 'The Coast' }),
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
const box = (slot: string) => host.querySelector<HTMLElement>(`[data-box="${slot}"]`)!;
const line = (slot: string) => box(slot).querySelector<HTMLElement>('[data-role="strand-room"]');

afterEach(() => {
  resetStrandTabForTests();
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  patchSlice('data', { elements: [] } as never);
  document.body.innerHTML = '';
  host = undefined as unknown as HTMLElement;
});

describe('the room line in each box', () => {
  it('every filled box has one, between its text (and the story\'s two lines) and Edit', () => {
    world(whole());
    draw();
    for (const slot of ['narrative', 'event', 'location', 'character', 'now']) {
      const l = line(slot)!;
      expect(l, slot).not.toBeNull();
      const kids = [...box(slot).children];
      const acts = box(slot).querySelector('.atlas-home-strand-box-acts')!;
      expect(kids.indexOf(l)).toBeLessThan(kids.indexOf(acts));
      expect(kids.indexOf(l)).toBeGreaterThan(kids.indexOf(box(slot).querySelector('.atlas-home-strand-box-name')!));
    }
    const story = [...box('narrative').children];
    expect(story.indexOf(line('narrative')!)).toBeGreaterThan(story.indexOf(box('narrative').querySelector('[data-role="strand-lines"]')!));
    expect(line('narrative')!.textContent).toBe('Its chapters and scenes are written in the writing room. Open in the writing room');
    expect(line('event')!.textContent).toBe('Its year puts it on the timeline in Charts. See it on the timeline');
    expect(line('location')!.textContent).toBe('A location can be pinned on a map. Open it with the map');
    expect(line('character')!.textContent).toBe('Their page holds everything about them. Open their page');
  });

  it('a press only navigates, after keeping the focus key for Back', () => {
    world(whole());
    draw();
    const before = JSON.stringify(whole());
    line('location')!.querySelector<HTMLButtonElement>('[data-strand-key="location:room"]')!.click();
    expect(window.location.hash).toBe(`#/w/${W}/map/${M}/element/${L}`);
    expect(memory.askFocus).toEqual({ worldId: W, key: 'location:room' });
    expect(JSON.stringify(whole())).toBe(before);
  });

  it('a view-only world reads every line, and no act would write (the map\'s becomes the page\'s)', () => {
    world(whole(), { copy_of: { world_id: 'x' } } as never);
    draw();
    expect(line('location')!.textContent).toBe('Its page shows everything that is in or at it. Open its page');
    for (const slot of ['narrative', 'event', 'character', 'now']) expect(line(slot)).not.toBeNull();
    expect(box('event').querySelector('[data-act="edit"]')).toBeNull();
  });

  it('an event with no year: a writer is told to give it one; a reader who may not, that it is not on the timeline', () => {
    const els = whole().map(e => (e.id === E ? el('event', E, { locations: [L], characters: [C] }) : e));
    world(els);
    draw();
    expect(line('event')!.textContent).toBe('Give it a year and it goes on the timeline in Charts.');
    world(els, { copy_of: { world_id: 'x' } } as never);
    draw();
    expect(line('event')!.textContent).toBe('It has no year yet, so it is not on the timeline.');
  });

  it('not drawn while the box is open for Use another', () => {
    world(whole());
    draw();
    box('character').querySelector<HTMLButtonElement>('[data-strand-key="character:more"]')!.click();
    host.querySelector<HTMLButtonElement>('[data-strand-key="character:another"]')!.click();
    expect(line('character')).toBeNull();
    expect(line('event')).not.toBeNull();
  });

  it('the act waits while a write is in flight', () => {
    world(whole());
    memory.inFlight.add(`${W}\u0000event`);
    draw();
    expect(line('character')!.querySelector<HTMLButtonElement>('[data-act="room"]')!.disabled).toBe(true);
  });
});
