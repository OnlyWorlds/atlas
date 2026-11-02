/**
 * The strand as a journey, its pure rules (`src/core/strand-journey.ts`, Atlas 1.120.0): each card's
 * question for every fill pattern (R3), which slot is asked (R2), what counts toward Home's tab head
 * (R1), the story card's two lines (R5), the Event's `characters` append (R4), and an Edit's changed
 * fields (R7).
 */
import { describe, it, expect } from 'vitest';
import type { Element } from '../../src/core/types';
import { EMPTY_STRAND, type OwStrand, type StrandSlot } from '../../src/core/strand';
import {
  appendToList, askedSlot, boxTextOf, cardCopy, changedFields, countedOutsideStrand, createFields, editOpening, parseWhen,
  sameCellWords, storyForWritingRoom, storyLines, strandWhole, type LinePart,
} from '../../src/core/strand-journey';

const slot = (id: string, name: string) => ({ id, name });
const S = slot('n', 'The Lantern Ferry');
const EV = slot('e', 'The night crossing');
const PL = slot('l', 'Saltmere Quay');
const CH = slot('c', 'Odile');
const NOW = slot('m', 'The Drowned Library');
const strand = (p: Partial<OwStrand>): OwStrand => ({ ...EMPTY_STRAND, ...p });
const el = (type: string, id: string, extra: Record<string, unknown> = {}) => ({ id, type, name: id, ...extra }) as unknown as Element;
const index = (...els: Element[]) => new Map(els.map(e => [e.id, e]));

describe('R3: each card asks from what is filled', () => {
  it('the story, the event and the place', () => {
    expect(cardCopy('narrative', EMPTY_STRAND)).toEqual({ title: 'Start with a story', what: 'The story your world tells, or the first of them.', text: 'The story' });
    expect(cardCopy('event', strand({ narrative: S }))).toEqual({ title: 'What happens in The Lantern Ferry?', what: 'One event in the story: a night, a battle, a meeting.', text: 'What happens' });
    expect(cardCopy('location', strand({ narrative: S, event: EV }))).toEqual({ title: 'Where did The night crossing happen?', what: 'A location in your world.', text: 'About this location' });
  });

  it('the main character, with an event and without one', () => {
    expect(cardCopy('character', strand({ narrative: S, event: EV }))).toEqual({
      title: 'Who was involved in The night crossing?', what: "Someone who was there. They become the story's main character.", text: 'About them',
    });
    expect(cardCopy('character', strand({ narrative: S }))).toEqual({ title: 'Who is the story about?', what: 'Its main character.', text: 'About them' });
  });

  it('where they are now: "After" only with an event', () => {
    expect(cardCopy('now', strand({ narrative: S, event: EV, character: CH }))).toEqual({ title: 'Where is Odile now?', what: 'After The night crossing.', text: 'About this location' });
    expect(cardCopy('now', strand({ narrative: S, character: CH }))).toEqual({ title: 'Where is Odile now?', what: null, text: 'About this location' });
  });

  it('no word on any card says "hero", and none carries an em-dash', () => {
    const fills = [EMPTY_STRAND, strand({ narrative: S }), strand({ narrative: S, event: EV }), strand({ narrative: S, character: CH }), strand({ narrative: S, event: EV, character: CH })];
    for (const s of fills) for (const k of ['narrative', 'event', 'location', 'character', 'now'] as StrandSlot[]) {
      const words = JSON.stringify(cardCopy(k, s));
      expect(words).not.toMatch(/hero/i);
      expect(words).not.toContain('—');
    }
  });
});

describe('R2: the asked slot', () => {
  const all = () => true;
  const none = () => false;
  it('the first empty slot in the story\'s order this reader may write', () => {
    expect(askedSlot(EMPTY_STRAND, all, none)).toBe('narrative');
    expect(askedSlot(strand({ narrative: S }), all, none)).toBe('event');
    expect(askedSlot(strand({ narrative: S, event: EV }), all, none)).toBe('location');
    expect(askedSlot(strand({ narrative: S, event: EV, location: PL }), all, none)).toBe('character');
    expect(askedSlot(strand({ narrative: S, event: EV, location: PL, character: CH }), all, none)).toBe('now');
    expect(askedSlot(strand({ narrative: S, event: EV, location: PL, character: CH, now: NOW }), all, none)).toBeNull();
  });

  it('a slot this reader may not write is passed over (a contributor: the Character first)', () => {
    const contributor = (k: StrandSlot) => k === 'character';
    expect(askedSlot(strand({ narrative: S }), contributor, none)).toBe('character');
    expect(askedSlot(strand({ narrative: S }), none, none)).toBeNull();
  });

  it('a skipped slot is passed over; a forced slot is asked out of order while it is empty and writable', () => {
    const skipped = (k: StrandSlot) => k === 'event';
    expect(askedSlot(strand({ narrative: S }), k => k !== 'location', skipped)).toBe('character');
    expect(askedSlot(strand({ narrative: S }), all, none, 'character')).toBe('character');
    expect(askedSlot(strand({ narrative: S, character: CH }), all, none, 'character')).toBe('event');
    expect(askedSlot(strand({ narrative: S }), k => k !== 'now', none, 'now')).toBe('event');
  });

  it('whole only with all five', () => {
    expect(strandWhole(strand({ narrative: S, event: EV, location: PL, character: CH }))).toBe(false);
    expect(strandWhole(strand({ narrative: S, event: EV, location: PL, character: CH, now: PL }))).toBe(true);
  });
});

describe('R1: what counts toward the tab head', () => {
  const kept = () => false;
  it('nothing, or the strand\'s own bodies only: nothing counted', () => {
    expect(countedOutsideStrand([], kept, EMPTY_STRAND)).toBe(false);
    expect(countedOutsideStrand([el('narrative', 'n'), el('event', 'e')], kept, strand({ narrative: S, event: EV }))).toBe(false);
  });

  it('an element of the world outside the five counts', () => {
    expect(countedOutsideStrand([el('character', 'x')], kept, EMPTY_STRAND)).toBe(true);
    expect(countedOutsideStrand([el('narrative', 'n'), el('character', 'x')], kept, strand({ narrative: S }))).toBe(true);
  });

  it('a pin, a marker, a zone, a reading aid, a Message, a proposed or room element, a stub and a kept-here copy never count', () => {
    const quiet = [
      el('pin', 'p'), el('marker', 'k'), el('zone', 'z'),
      el('law', 'charter', { supertype: 'Charter' }), el('construct', 'guide', { supertype: 'Guide' }),
      el('narrative', 'msg', { supertype: 'Message' }),
      el('character', 'prop', { x_review_proposed: { by: 'm', evidence: 'seat' } }),
      el('event', 'room', { supertype: 'Sitting', x_room_of: 'w' }),
      el('character', 'stub', { known_of: true }),
      el('character', 'keptcopy'),
    ];
    expect(countedOutsideStrand(quiet, id => id === 'keptcopy', EMPTY_STRAND)).toBe(false);
    for (const one of quiet) expect(countedOutsideStrand([one], id => id === 'keptcopy', EMPTY_STRAND)).toBe(false);
  });
});

describe('R5: the story card\'s lines', () => {
  const words = (lines: LinePart[][]) => lines.map(l => l.map(p => ('text' in p ? p.text : `[${p.name}]`)).join(''));
  const chips = (lines: LinePart[][]) => lines.flat().filter((p): p is Extract<LinePart, { chip: StrandSlot }> => 'chip' in p).map(p => p.chip);

  it('only what is filled', () => {
    expect(storyLines(strand({ narrative: S }), index())).toEqual([]);
    expect(words(storyLines(strand({ narrative: S, event: EV }), index()))).toEqual(['It tells of [The night crossing].']);
    expect(words(storyLines(strand({ narrative: S, event: EV, location: PL }), index()))).toEqual(['It tells of [The night crossing], which happened in or at [Saltmere Quay].']);
    expect(words(storyLines(strand({ narrative: S, character: CH }), index()))).toEqual(['Its main character is [Odile].']);
    expect(words(storyLines(strand({ narrative: S, character: CH, now: NOW, same: null }), index()))).toEqual(['Its main character is [Odile], now in or at [The Drowned Library].']);
  });

  it('"still" only when where they are now is where it happened and the Event lists them', () => {
    const s = strand({ narrative: S, event: EV, location: PL, character: CH, now: PL, same: true });
    const listing = index(el('event', 'e', { characters: [{ id: 'c' }] }));
    const silent = index(el('event', 'e', { characters: ['someone-else'] }));
    expect(words(storyLines(s, listing))[1]).toBe('Its main character is [Odile], still in or at [Saltmere Quay].');
    expect(chips(storyLines(s, listing))).toEqual(['event', 'location', 'character', 'location']);
    expect(words(storyLines(s, silent))[1]).toBe('Its main character is [Odile], now in or at [Saltmere Quay].');
    expect(sameCellWords(s, listing)).toBe('is still in or at Saltmere Quay');
    expect(sameCellWords(s, silent)).toBe('is in or at Saltmere Quay');
  });
});

describe('R4: the Event\'s characters', () => {
  it('appends the bare id to an absent, null or array value, every entry kept', () => {
    expect(appendToList(undefined, 'c')).toEqual({ next: ['c'] });
    expect(appendToList(null, 'c')).toEqual({ next: ['c'] });
    expect(appendToList(['a', { id: 'b', name: 'B' }], 'c')).toEqual({ next: ['a', { id: 'b', name: 'B' }, 'c'] });
  });

  it('already listed in either spelling is nothing; another shape is left alone', () => {
    expect(appendToList(['c'], 'c')).toBe('listed');
    expect(appendToList([{ id: 'c' }], 'c')).toBe('listed');
    expect(appendToList('c', 'c')).toBe('listed');
    expect(appendToList('ana', 'c')).toBe('shape');
    expect(appendToList({ id: 'ana' }, 'c')).toBe('shape');
    expect(appendToList(7, 'c')).toBe('shape');
  });
});

describe('the cards\' fields', () => {
  it('a Make carries the text where the type keeps it and When, and leaves out what is empty', () => {
    expect(createFields('narrative', { name: ' A Tale ', text: 'Once.', when: '' })).toEqual({ name: 'A Tale', story: 'Once.' });
    expect(createFields('event', { name: 'The Flood', text: '', when: '1142' })).toEqual({ name: 'The Flood', start_date: 1142 });
    expect(createFields('location', { name: 'The Weir', text: '  ', when: '9' })).toEqual({ name: 'The Weir' });
    expect(createFields('event', { name: 'X', text: '', when: '11.5' })).toBe('bad-when');
  });

  it('When is a whole number or nothing', () => {
    expect(parseWhen('')).toBeNull();
    expect(parseWhen(' -40 ')).toBe(-40);
    expect(parseWhen('1e3')).toBe('bad');
    expect(parseWhen('twelve')).toBe('bad');
  });

  it('Edit writes only the fields changed; an empty name is no change; a cleared text or When writes null', () => {
    const opened = { name: 'The Flood', text: 'Water.', when: '1142' };
    expect(changedFields('event', opened, { ...opened })).toEqual({});
    expect(changedFields('event', opened, { ...opened, name: 'The Great Flood' })).toEqual({ name: 'The Great Flood' });
    expect(changedFields('event', opened, { ...opened, name: '   ' })).toEqual({});
    expect(changedFields('event', opened, { ...opened, text: '' })).toEqual({ description: null });
    expect(changedFields('event', opened, { ...opened, when: '' })).toEqual({ start_date: null });
    expect(changedFields('event', opened, { ...opened, when: '1150' })).toEqual({ start_date: 1150 });
    expect(changedFields('narrative', { name: 'A', text: 'x', when: '' }, { name: 'A', text: 'y', when: '' })).toEqual({ story: 'y' });
    expect(changedFields('narrative', { name: 'A', text: 'x', when: '' }, { name: 'A', text: 'y', when: '' }, false)).toEqual({});
    expect(changedFields('location', { name: 'A', text: '', when: '' }, { name: 'A', text: '', when: '7' })).toEqual({});
  });

  it('an Edit opens on the element as it is, the raw values kept for the compare', () => {
    const e = el('event', 'e', { name: 'The Flood', description: 'Water.', start_date: 1142 });
    expect(editOpening(e)).toEqual({ values: { name: 'The Flood', text: 'Water.', when: '1142' }, raw: { name: 'The Flood', description: 'Water.', start_date: 1142 } });
    expect(editOpening(el('narrative', 'n', { name: 'A', story: 'Once.' })).raw).toEqual({ name: 'A', story: 'Once.' });
  });

  it('a story with the writing room\'s rich text, or past six lines, goes to the writing room', () => {
    expect(storyForWritingRoom(el('narrative', 'n', { story: 'One line.' }))).toBe(false);
    expect(storyForWritingRoom(el('narrative', 'n', { story: 'x', atlas_richtext_json: { type: 'doc' } }))).toBe(true);
    expect(storyForWritingRoom(el('narrative', 'n', { story: '1\n2\n3\n4\n5\n6\n7' }))).toBe(true);
    expect(storyForWritingRoom(el('narrative', 'n', { story: '1\n2\n3\n4\n5\n6' }))).toBe(false);
    expect(storyForWritingRoom(el('event', 'e', { description: '1\n2\n3\n4\n5\n6\n7' }))).toBe(false);
  });

  it('a box shows a Narrative\'s story, else its description', () => {
    expect(boxTextOf(el('narrative', 'n', { story: 'Told.', description: 'Said.' }))).toBe('Told.');
    expect(boxTextOf(el('narrative', 'n', { description: 'Said.' }))).toBe('Said.');
    expect(boxTextOf(el('location', 'l', { description: 'A quay.' }))).toBe('A quay.');
  });
});
