/**
 * The strand's lines (Atlas 1.122.0, `src/core/strand-lines.ts`): the rule as a pure function for every
 * slot (the fact, the room opened, the ×, the reader), and the record (G1): kept out of the world's
 * prefs, written as a union across tabs, per world, noted only for the strand's own story and main
 * character, and moved by a re-key.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { __setRegistryTabBaseForTests, rekeyRegistryEntry, saveRegistry } from '../../src/registry/registry';
import { WORLD_PREF_KEYS, prefsOf } from '../../src/core/world-prefs';
import {
  NO_LINES, lineKey, lineWords, linesOf, noteStrandLine, noteStrandOpened, resetStrandLinesForTests, strandLine, type LineFacts, type StrandLines,
} from '../../src/core/strand-lines';
import { DEFAULT_WRITING_LABELS } from '../../src/middle/writing-helpers';

const W = 'w-lines';
const V = 'w-lines-other';
const f = (slot: LineFacts['slot'], extra: Partial<LineFacts> = {}): LineFacts => ({ slot, id: 'x1', writer: true, ...extra });
const words = (facts: LineFacts, rec: StrandLines = NO_LINES): string | null => {
  const l = strandLine(facts, rec);
  return l ? lineWords(l) : null;
};
const hidden = (slot: LineFacts['slot']): StrandLines => ({ hidden: [lineKey(slot, 'x1')], opened: [] });
const opened = (slot: LineFacts['slot']): StrandLines => ({ hidden: [], opened: [lineKey(slot, 'x1')] });

describe('strandLine: each slot\'s line, and when it goes', () => {
  const writing = { tier: 'l1' as const, labels: DEFAULT_WRITING_LABELS };

  it('the story: in the writing room\'s words by the world\'s tiers; gone once the room was opened on it, or on its ×', () => {
    expect(words(f('narrative', { writing }))).toBe('In the writing room you can shape it into chapters and scenes.');
    expect(words(f('narrative', { writing: { tier: 'l1', labels: { l1: 'Saga', l2: 'Act', l3: 'Story', l4: 'Draft' } } }))).toBe('In the writing room you can shape it into acts and stories.');
    expect(words(f('narrative', { writing: { tier: 'l2', labels: DEFAULT_WRITING_LABELS } }))).toBe('In the writing room you can shape it into scenes.');
    // A blank label falls back to the default word.
    expect(words(f('narrative', { writing: { tier: 'l1', labels: { l1: 'Book', l2: ' ', l3: '', l4: 'Draft' } } }))).toBe('In the writing room you can shape it into chapters and scenes.');
    expect(words(f('narrative', { writing: { tier: 'l3', labels: DEFAULT_WRITING_LABELS } }))).toBeNull();
    // Not in the writing room (a Knowledge entry, a Page, writing not set up): no line.
    expect(words(f('narrative', { writing: null }))).toBeNull();
    expect(words(f('narrative', { writing }), opened('narrative'))).toBeNull();
    expect(words(f('narrative', { writing }), hidden('narrative'))).toBeNull();
  });

  it('the main character: their page; gone once it was opened, or on its ×', () => {
    expect(words(f('character'))).toBe('Open their page to see and edit them in full.');
    expect(words(f('character'), opened('character'))).toBeNull();
    expect(words(f('character'), hidden('character'))).toBeNull();
  });

  it('the event: a date asked, Charts a link; gone once the timeline places it, or on its ×', () => {
    expect(strandLine(f('event', { dated: false }), NO_LINES)).toEqual([
      { text: 'Give it a date to place it in a timeline in ' }, { link: 'charts', text: 'Charts' }, { text: '.' },
    ]);
    expect(words(f('event', { dated: true }))).toBeNull();
    expect(words(f('event', { dated: false }), hidden('event'))).toBeNull();
    // Opened marks never take the event's line: only its fact or its ×.
    expect(words(f('event', { dated: false }), opened('event'))).not.toBeNull();
  });

  it('the location in its three states: no map, a map it is not on, placed', () => {
    expect(strandLine(f('location', { acts: true, hasMap: false, placed: false }), NO_LINES)).toEqual([
      { link: 'create-map', text: 'Create a map' }, { text: ' to pin it in place.' },
    ]);
    expect(strandLine(f('location', { acts: true, hasMap: true, placed: false }), NO_LINES)).toEqual([
      { link: 'pin-map', text: 'Pin it on a map' }, { text: '.' },
    ]);
    expect(words(f('location', { acts: true, hasMap: true, placed: true }))).toBeNull();
    expect(words(f('location', { acts: true, hasMap: false }), hidden('location'))).toBeNull();
    // Where the grid does not act (the demo, Moppetopia, a view-only world): no line, so no map dialog (conv. 149).
    expect(words(f('location', { acts: false, hasMap: false }))).toBeNull();
  });

  it('where they are now: one line, gone on its × only', () => {
    expect(words(f('now'))).toBe('Their location is where they are now.');
    expect(words(f('now'), opened('now'))).toBe('Their location is where they are now.');
    expect(words(f('now'), hidden('now'))).toBeNull();
  });

  it('a reader who may not change the element sees no line, in every slot', () => {
    for (const slot of ['narrative', 'event', 'location', 'character', 'now'] as const) {
      expect(strandLine(f(slot, { writer: false, writing, dated: false, acts: true }), NO_LINES), slot).toBeNull();
    }
  });

  it('a × is per element: another element in the slot has its own line', () => {
    expect(words(f('character', { id: 'x2' }), hidden('character'))).toBe('Open their page to see and edit them in full.');
  });

  it('no line has an em-dash or the word "year"', () => {
    const all = [
      f('narrative', { writing }), f('narrative', { writing: { tier: 'l2', labels: DEFAULT_WRITING_LABELS } }), f('character'), f('event', { dated: false }),
      f('location', { acts: true, hasMap: false }), f('location', { acts: true, hasMap: true }), f('now'),
    ];
    for (const facts of all) {
      const w = words(facts)!;
      expect(w).not.toContain('—');
      expect(w).not.toMatch(/\byears?\b/i);
    }
  });
});

// ---- The record ----

const entry = (id: string, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry =>
  ({ id, name: id, state: 'local-only', created_at: 'x', ...extra }) as WorldRegistryEntry;
const reg = (...worlds: WorldRegistryEntry[]): WorldsRegistry => ({ ...defaultRegistry(), worlds });
const stored = (): WorldsRegistry => JSON.parse(localStorage.getItem(REGISTRY_STORAGE_KEY)!) as WorldsRegistry;
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };

beforeEach(() => { localStorage.clear(); __setRegistryTabBaseForTests(null); resetStrandLinesForTests(); });
afterEach(() => {
  patchSlice('registry', defaultRegistry());
  patchSlice('active', null);
  patchSlice('data', { elements: [] } as never);
});

describe('the record (G1)', () => {
  it('never one of the world\'s prefs: not in WORLD_PREF_KEYS, not in the world folder\'s file', () => {
    expect((WORLD_PREF_KEYS as readonly string[]).includes('strand_lines')).toBe(false);
    const prefs = prefsOf(entry(W, { strand_lines: { hidden: ['character:x'], opened: ['narrative:y'] }, notes: 'n' }));
    expect(prefs).not.toHaveProperty('strand_lines');
    expect(prefs).toHaveProperty('notes', 'n');
  });

  it('reads anything else as nothing done', () => {
    expect(linesOf(undefined)).toEqual(NO_LINES);
    expect(linesOf({ strand_lines: 'x' } as never)).toEqual(NO_LINES);
    expect(linesOf({ strand_lines: { hidden: ['a', 3], opened: null } } as never)).toEqual({ hidden: ['a'], opened: [] });
  });

  it('a × in one world hides nothing in another, and survives the store (a reload reads it back)', () => {
    const start = reg(entry(W), entry(V));
    saveRegistry(start);
    __setRegistryTabBaseForTests(start);
    patchSlice('registry', start);
    noteStrandLine(W, 'hidden', 'event:e1');
    expect(linesOf(getState().registry.worlds.find(w => w.id === W))).toEqual({ hidden: ['event:e1'], opened: [] });
    expect(linesOf(stored().worlds.find(w => w.id === W))).toEqual({ hidden: ['event:e1'], opened: [] });
    expect(linesOf(stored().worlds.find(w => w.id === V))).toEqual(NO_LINES);
  });

  it('two tabs never undo each other: each write unions what is stored with its own', () => {
    const start = reg(entry(W));
    saveRegistry(start);
    const tabB = structuredClone(start);
    // Tab A hides the event's line.
    __setRegistryTabBaseForTests(start);
    patchSlice('registry', start);
    noteStrandLine(W, 'hidden', 'event:e1');
    // Tab B, holding its stale copy, hides the character's line.
    __setRegistryTabBaseForTests(tabB);
    patchSlice('registry', tabB);
    noteStrandLine(W, 'hidden', 'character:c1');
    expect(linesOf(stored().worlds[0]).hidden.sort()).toEqual(['character:c1', 'event:e1']);
    expect(linesOf(getState().registry.worlds[0]).hidden.sort()).toEqual(['character:c1', 'event:e1']);
  });

  it('a re-key moves each key\'s id, and leaves other keys', () => {
    const r = reg(entry(W, { strand_lines: { hidden: ['event:old-e', 'now:keep'], opened: ['character:old-c'] } }));
    const next = rekeyRegistryEntry(r, W, new Map([['old-e', 'new-e'], ['old-c', 'new-c']]));
    expect(linesOf(next.worlds[0])).toEqual({ hidden: ['event:new-e', 'now:keep'], opened: ['character:new-c'] });
    expect(rekeyRegistryEntry(r, W, new Map([['nothing', 'x']]))).toBe(r);
  });
});

describe('noteStrandOpened: only the strand\'s own story and main character', () => {
  const N = 'story-1';
  const C = 'char-1';
  function open(): void {
    const start = reg(entry(W));
    saveRegistry(start);
    __setRegistryTabBaseForTests(start);
    patchSlice('registry', start);
    patchSlice('active', { worldId: W, meta: { id: W, name: 'W', x_strand: { narrative: N, event: null, location: null } } } as never);
    patchSlice('data', { loading: false, elements: [
      { id: N, type: 'narrative', name: 'S', protagonist: C }, { id: C, type: 'character', name: 'C' }, { id: 'other', type: 'character', name: 'O' },
    ] as unknown as Element[] } as never);
  }

  it('the writing room on the story, the page of its main character: noted; another narrative or character: not', async () => {
    open();
    noteStrandOpened(W, 'narrative', 'some-chapter');
    noteStrandOpened(W, 'character', 'other');
    await settle();
    expect(linesOf(getState().registry.worlds[0]).opened).toEqual([]);
    noteStrandOpened(W, 'narrative', N);
    await settle();
    noteStrandOpened(W, 'character', C);
    await settle();
    expect(linesOf(getState().registry.worlds[0]).opened).toEqual([lineKey('narrative', N), lineKey('character', C)]);
    expect(linesOf(stored().worlds[0]).opened).toEqual([lineKey('narrative', N), lineKey('character', C)]);
  });

  it('a world still loading is asked again on the next draw', async () => {
    open();
    patchSlice('data', { ...getState().data, loading: true } as never);
    noteStrandOpened(W, 'character', C);
    await settle();
    expect(linesOf(getState().registry.worlds[0]).opened).toEqual([]);
    patchSlice('data', { ...getState().data, loading: false } as never);
    noteStrandOpened(W, 'character', C);
    await settle();
    expect(linesOf(getState().registry.worlds[0]).opened).toEqual([lineKey('character', C)]);
  });
});
