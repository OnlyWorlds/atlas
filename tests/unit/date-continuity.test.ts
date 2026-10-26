import { describe, it, expect } from 'vitest';
import { findDateConflicts, type DateConflict } from '../../src/core/date-continuity';
import type { Element } from '../../src/core/types';

// #281: a pure check that lists each pair of dates that cannot both be true.
const el = (type: string, id: string, name: string, fields: Record<string, unknown> = {}): Element =>
  ({ id, type, name, ...fields }) as unknown as Element;

const brief = (c: DateConflict) => `${c.kind}: ${c.a.name}.${c.a.field}=${c.a.date} / ${c.b.name}.${c.b.field}=${c.b.date}`;

describe('date continuity (#281)', () => {
  // Every rule, planted once, in the shapes a folder can hold (string ids, {id} objects, a lone id string).
  const planted = [
    el('character', 'c-late', 'Ireena', { birth_date: 120 }),
    el('character', 'c-ok', 'Strahd', { birth_date: 10 }),
    el('creature', 'cr-late', 'the wolf', { birth_date: 106 }),
    el('event', 'e-battle', 'The Battle', { start_date: 100, end_date: 105, characters: ['c-late', { id: 'c-ok' }], creatures: 'cr-late' }),
    el('event', 'e-moment', 'The Coronation', { start_date: 50, characters: [{ id: 'c-late' }] }),
    el('event', 'e-backwards', 'The Siege', { start_date: 300, end_date: 200, characters: ['c-late'] }),
    el('title', 't-crown', 'The Crown', { grant_date: 20, revoke_date: 110, holders: ['c-late', 'c-ok'] }),
    el('title', 't-reversed', 'The Mitre', { grant_date: 90, revoke_date: 40 }),
    el('relation', 'r-pact', 'The Pact', { start_date: 60, end_date: 80, characters: ['c-late'] }),
    // The war (start 200) lists the treaty (start 250) as what set it off.
    el('event', 'e-treaty', 'The Treaty', { start_date: 250 }),
    el('event', 'e-war', 'The War', { start_date: 200, triggers: ['e-treaty'] }),
  ];

  it('finds every planted impossibility, once, and nothing else', () => {
    expect(findDateConflicts(planted).map(brief)).toEqual([
      'reversed: The Mitre.grant_date=90 / The Mitre.revoke_date=40',
      'reversed: The Siege.start_date=300 / The Siege.end_date=200',
      'cause-after-effect: The Treaty.start_date=250 / The War.start_date=200',
      'born-after-event: Ireena.birth_date=120 / The Battle.end_date=105',
      'born-after-event: Ireena.birth_date=120 / The Coronation.start_date=50',
      'born-after-event: the wolf.birth_date=106 / The Battle.end_date=105',
      'born-after-relation: Ireena.birth_date=120 / The Pact.end_date=80',
      'holder-born-after-revoke: Ireena.birth_date=120 / The Crown.revoke_date=110',
    ]);
  });

  it('a clean world finds none, near misses included', () => {
    const clean = [
      el('character', 'c', 'Ireena', { birth_date: 100 }),
      el('character', 'u', 'the stranger'), // undated: nothing to compare
      // Born at an event's start, or inside it: there.
      el('event', 'e1', 'The Battle', { start_date: 100, end_date: 105, characters: ['c', 'u'] }),
      el('event', 'e2', 'The Feast', { start_date: 100, characters: ['c'] }),
      // Born one step before the end: there.
      el('event', 'e3', 'The Vigil', { start_date: 90, end_date: 101, characters: ['c'] }),
      // A relation or title that began before birth and still runs: possible (an inherited feud, a crown passed on).
      el('relation', 'r', 'The Feud', { start_date: 10, characters: ['c'] }),
      el('title', 't', 'The Crown', { grant_date: 10, holders: ['c'] }),
      el('title', 't2', 'The Mitre', { grant_date: 10, revoke_date: 101, holders: ['c'] }),
      // A zero-length span, a cause on the same date, a dangling or wrong-type link, a self-trigger.
      el('event', 'e4', 'The Spark', { start_date: 200, end_date: 200 }),
      el('event', 'e5', 'The Fire', { start_date: 200, triggers: ['e4', 'gone', 'c', 'e5'] }),
      // Strings that are numbers count; text is no date.
      el('event', 'e6', 'The Thaw', { start_date: '100', end_date: 'that spring', characters: ['c'] }),
    ];
    expect(findDateConflicts(clean).map(brief)).toEqual([]);
  });

  it('an end that is there but not a number is unknown, never a moment', () => {
    const w = [
      el('character', 'c', 'Ireena', { birth_date: 101 }),
      el('event', 'e', 'The Thaw', { start_date: 100, end_date: 'that spring', characters: ['c'] }),
    ];
    expect(findDateConflicts(w)).toEqual([]);
  });

  it('the end is half-open: born on the end date is born after it was over', () => {
    const w = [
      el('character', 'c', 'Ireena', { birth_date: 105 }),
      el('event', 'e', 'The Battle', { start_date: 100, end_date: 105, characters: ['c'] }),
    ];
    expect(findDateConflicts(w).map(c => c.kind)).toEqual(['born-after-event']);
  });

  it('a reversed span is named once, not echoed by its other rules', () => {
    const w = [
      el('character', 'c', 'Ireena', { birth_date: 500 }),
      el('event', 'e', 'The Siege', { start_date: 300, end_date: 200, characters: ['c'] }),
      el('event', 'w', 'The War', { start_date: 100, triggers: ['e'] }),
    ];
    expect(findDateConflicts(w).map(c => c.kind)).toEqual(['reversed']);
  });
});
