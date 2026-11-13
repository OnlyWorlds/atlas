/**
 * Records (core/records.ts, middle/element-detail-records.ts): a record is read
 * only from its mark; Tactical Tangle's battles from before the mark show under
 * their own head; belonging (for the carve-outs) ignores review, showing does not.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Element } from '../../src/core/types';
import { recordsOf } from '@onlyworlds/sdk';
import {
  characterRecords, isLegacyBattle, isProposedForRecords, playGlyph, playKindOf, playNarrativeIds, toolName,
} from '../../src/core/records';
import { buildRecordsSection, recordLine } from '../../src/middle/element-detail-records';
import { patchSlice } from '../../src/core/state';
import { customFieldNameProblem } from '../../src/middle/element-detail-custom-fields';
import { isCustomEditableField, isProfileField } from '../../src/core/constants';

const TALLY = { winner: 'Left', sides: [{ name: 'Left', fallen: 3 }, { name: 'Right', fallen: 9 }], units: [] };
const mark = (tool: string, played_at: string, more: Record<string, unknown> = {}) => ({ tool, played_at, ...more });
const ev = (id: string, extra: Record<string, unknown>): Element =>
  ({ id, type: 'event', name: id, local_updated_at: '2026-01-01T00:00:00Z', ...extra }) as unknown as Element;
const nar = (id: string, extra: Record<string, unknown>): Element =>
  ({ id, type: 'narrative', name: id, local_updated_at: '2026-01-01T00:00:00Z', ...extra }) as unknown as Element;
const ch = (id: string): Element => ({ id, type: 'character', name: id, local_updated_at: '2026-01-01T00:00:00Z' }) as unknown as Element;

describe('what is from play', () => {
  it('a valid mark makes a record; a word or a malformed mark does not', () => {
    expect(playKindOf(ev('a', { x_record: mark('tangle', '2026-11-01T12:00:00Z') }))).toEqual({ kind: 'record', tool: 'tangle' });
    expect(playKindOf(ev('b', { supertype: 'Chronicle', subtype: 'Battle' }))).toBeNull();
    expect(playKindOf(ev('c', { x_record: mark('tangle', '2026-11-01T12:00:00Z', { seed: 5 }) }))).toBeNull();
    // A mark on a Narrative is no record.
    expect(playKindOf(nar('d', { x_record: mark('tangle', '2026-11-01T12:00:00Z') }))).toBeNull();
  });

  it('a Tangle tally with no valid mark is a legacy battle; with a mark it is a record only', () => {
    expect(playKindOf(ev('a', { x_tangle_battle: TALLY }))).toEqual({ kind: 'legacy' });
    expect(playKindOf(ev('b', { x_tangle_battle: TALLY, x_record: mark('tangle', '2026-11-01T12:00:00Z') }))).toEqual({ kind: 'record', tool: 'tangle' });
    // A broken mark beside the tally falls back to what the tally is: a legacy battle, never a record.
    expect(isLegacyBattle(ev('c', { x_tangle_battle: TALLY, x_record: mark('Tangle', '2026-11-01T12:00:00Z') }))).toBe(true);
    expect(playKindOf(ev('d', { x_tangle_battle: { nonsense: true } }))).toBeNull();
  });

  it('the glyph: swords for Tangle and its legacy battles, a controller for any other game', () => {
    expect(playGlyph({ kind: 'legacy' })).toBe('swords');
    expect(playGlyph({ kind: 'record', tool: 'tangle' })).toBe('swords');
    expect(playGlyph({ kind: 'record', tool: 'subs' })).toBe('sports_esports');
  });

  it('a game is named from the tools list, then its id (Tangle\'s row since SDK 4.127.0, Subs\'s since 4.158.1)', () => {
    expect(toolName('atlas')).toBe('Atlas');
    expect(toolName('tangle')).toBe('Tactical Tangle');
    expect(toolName('subs')).toBe('Subs');
    expect(toolName('a-game-not-listed')).toBe('a-game-not-listed');
    expect(toolName('constructor')).toBe('constructor');
  });

  it('proposed exactly as recordsOf reads it (serial 103: an empty mark, or no object, is settled)', () => {
    const values: unknown[] = ['', '  ', {}, [], 'yes', true, 0, { by: 'x' }, { by: 'x', expires: '2099-01-01' }, null, undefined];
    for (const v of values) {
      const run = ev('r', { x_record: mark('tangle', '2026-11-01T12:00:00Z'), x_review_proposed: v, characters: ['c'] });
      const read = recordsOf('c', [run]).length === 1;
      expect(isProposedForRecords({ x_review_proposed: v }), JSON.stringify(v)).toBe(!read);
    }
    expect(isProposedForRecords({ x_review_proposed: { by: 'x' } })).toBe(true);
    expect(isProposedForRecords({ x_review_proposed: {} })).toBe(false);
  });
});

describe('belonging (the carve-outs)', () => {
  it('a Narrative listing a run belongs, and so does one under it; a proposed run still owns its chain', () => {
    const els = [
      ev('r', { x_record: mark('tangle', '2026-11-01T12:00:00Z'), x_review_proposed: { by: 'm' } }),
      nar('chron', { events: ['r'] }),
      nar('story', { parent_narrative: 'chron' }),
      nar('other', { supertype: 'Chronicle' }),
      nar('lone-string', { events: 'r' }),
    ];
    const ids = playNarrativeIds(els);
    expect([...ids].sort()).toEqual(['chron', 'story']);
  });
});

describe('a Character\'s records', () => {
  const world = (): Element[] => [
    ch('c1'), ch('c2'),
    ev('old', { x_record: mark('tangle', '2026-10-01T12:00:00Z', { outcome: 'won', seats: { c1: 'General' } }), characters: ['c1'] }),
    ev('new', { x_record: mark('subs', '2026-10-20T12:00:00Z', { outcome: 'survived', seats: { c1: 'Commander, HMS Keeling', c2: 'Bosun' } }), characters: ['c1'] }),
    ev('mine-proposed', { x_record: mark('subs', '2026-10-25T12:00:00Z'), characters: ['c1'], x_review_proposed: { by: 'm' } }),
    nar('told', { events: ['new'], narrator: 'c1' }),
    nar('about', { events: ['new'], protagonist: 'c1', narrator: 'c1' }),
    nar('chronicle', { events: ['new'] }),
    ev('legacy-a', { x_tangle_battle: TALLY, characters: ['c1'], created_at: '2026-09-01T00:00:00Z' }),
    ev('legacy-b', { x_tangle_battle: TALLY, characters: ['c1'], created_at: '2026-09-05T00:00:00Z' }),
    ev('legacy-proposed', { x_tangle_battle: TALLY, characters: ['c1'], x_review_proposed: { by: 'm' } }),
    nar('legacy-story', { events: ['legacy-a', 'legacy-a'], protagonist: 'c1', parent_narrative: 'x' }),
    nar('legacy-story-proposed', { events: ['legacy-a'], protagonist: 'c1', x_review_proposed: { by: 'm' } }),
    ev('word-only', { supertype: 'Chronicle', subtype: 'Battle', characters: ['c1'] }),
    ev('both', { x_tangle_battle: TALLY, x_record: mark('tangle', '2026-09-20T12:00:00Z'), characters: ['c1'] }),
  ];

  it('records come in the SDK\'s order, newest first, with their stories; proposed ones are held back', () => {
    const { records } = characterRecords('c1', world());
    expect(records.map(r => r.event.id)).toEqual(['new', 'old', 'both']);
    expect(records[0].seat).toBe('Commander, HMS Keeling');
    expect(records[0].stories.map(s => [s.id, s.as])).toEqual([['about', 'both'], ['told', 'narrator']]);
  });

  it('legacy battles are ordered by when they were made as instants: offsets count, an unreadable time last', () => {
    const els = [
      ch('c1'),
      ev('a', { x_tangle_battle: TALLY, characters: ['c1'], created_at: '2026-09-05T00:00:00Z' }),
      // 02:00+05:00 is 21:00Z the day before: older than 'a', though its text sorts after.
      ev('b', { x_tangle_battle: TALLY, characters: ['c1'], created_at: '2026-09-05T02:00:00+05:00' }),
      ev('c', { x_tangle_battle: TALLY, characters: ['c1'], created_at: 'yesterday' }),
      ev('d', { x_tangle_battle: TALLY, characters: ['c1'], created_at: '2026-09-01T00:00:00Z' }),
    ];
    expect(characterRecords('c1', els).legacy.map(l => l.event.id)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('legacy battles: newest made first, their own stories, never proposed ones, never a word', () => {
    const { legacy } = characterRecords('c1', world());
    expect(legacy.map(l => l.event.id)).toEqual(['legacy-b', 'legacy-a']);
    expect(legacy[1].stories.map(s => s.id)).toEqual(['legacy-story']);
    expect(legacy[1].outcome).toBe('Left held the field');
  });

  it('a seat for someone not in characters makes no record', () => {
    expect(characterRecords('c2', world()).records).toEqual([]);
  });

  it('the line: the game, the day played, the outcome, the seat', () => {
    const { records } = characterRecords('c1', world());
    expect(recordLine(records[0])).toMatch(/^Subs · .*2026.* · survived · as Commander, HMS Keeling$/);
    expect(recordLine(records[1])).toMatch(/^Tactical Tangle · .*2026.* · won · as General$/);
  });
});

describe('the section', () => {
  beforeEach(() => { patchSlice('data', { elements: [] } as never); });

  it('draws Records, then the legacy head, and nothing for a Character with neither', () => {
    const els = [
      ch('c1'), ch('c3'),
      ev('new', { x_record: mark('subs', '2026-10-20T12:00:00Z'), characters: ['c1'] }),
      ev('legacy-a', { x_tangle_battle: TALLY, characters: ['c1'] }),
    ];
    patchSlice('data', { elements: els } as never);
    const sec = buildRecordsSection(els[0])!;
    expect(sec.querySelector('.atlas-detail-section-header')?.textContent).toContain('Records');
    const order = [...sec.querySelectorAll('[data-role="record"], [data-role="records-legacy-head"], [data-role="record-legacy"]')]
      .map(n => (n as HTMLElement).dataset.role);
    expect(order).toEqual(['record', 'records-legacy-head', 'record-legacy']);
    expect(sec.querySelectorAll('[data-role="record"]')).toHaveLength(1);
    expect(sec.querySelector('[data-role="records-legacy-head"]')?.textContent).toBe('Battles from Tactical Tangle');
    expect(sec.querySelectorAll('[data-role="record-legacy"]')).toHaveLength(1);
    expect(sec.querySelectorAll('button.atlas-record-row')).toHaveLength(2);
    expect(buildRecordsSection(els[1])).toBeNull();
    expect(buildRecordsSection(els[2])).toBeNull();
  });
});

describe('the mark is a profile key (reader rule 2)', () => {
  it('never an editable custom field, never minted by hand', () => {
    expect(isProfileField('x_record')).toBe(true);
    expect(isCustomEditableField('x_record')).toBe(false);
    expect(customFieldNameProblem(ev('e', {}), 'x_record')).toMatch(/x_record/);
  });
});
