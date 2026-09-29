/**
 * planMerge: Route 2's pure merge planner (lane-a-route2.md §2 H10/H11, §3 step 3).
 *
 * Pure: locals + server records in, a MergePlan out. No FolderStore, no network.
 * One block per rule: per type, two-pass id then name, empty key, ambiguity
 * skipped and reported, id clashes across types, matchByName off, determinism,
 * no mutation, NFC, non-string names, absent types.
 */

import { describe, it, expect } from 'vitest';
import { planMerge, normalizeMatchName } from '../../src/sync/plan-merge';
import type { ServerRec } from '../../src/sync/plan-merge';
import type { Element, ElementType } from '../../src/core/types';

function el(id: string, type: ElementType, name: unknown, extra: Record<string, unknown> = {}): Element {
  return { id, type, name, local_updated_at: '2026-09-29T00:00:00Z', ...extra } as Element;
}

function srv(id: string, name: unknown, extra: Record<string, unknown> = {}): ServerRec {
  return { id, name, updated_at: '2026-09-28T00:00:00Z', ...extra };
}

function server(entries: Array<[ElementType, ServerRec[]]>): Map<ElementType, ServerRec[]> {
  return new Map(entries);
}

const ON = { matchByName: true };
const OFF = { matchByName: false };

const ids = (list: Array<{ local: Element }>) => list.map(x => x.local.id);
const sids = (list: Array<{ server: ServerRec }>) => list.map(x => x.server.id);

describe('normalizeMatchName', () => {
  it('trims, lower-cases and NFC-normalizes, leaving inner whitespace alone', () => {
    expect(normalizeMatchName('  Alice  Smith ')).toBe('alice  smith');
    expect(normalizeMatchName('Café')).toBe('café');
  });

  it('gives an empty key for non-strings and whitespace-only names', () => {
    expect(normalizeMatchName(undefined)).toBe('');
    expect(normalizeMatchName(42)).toBe('');
    expect(normalizeMatchName(null)).toBe('');
    expect(normalizeMatchName('   ')).toBe('');
  });
});

describe('planMerge: rule 1, per type', () => {
  it('never matches a local and a server record of different types by name', () => {
    const plan = planMerge(
      [el('L1', 'location', 'Ravenholm')],
      server([['character', [srv('S1', 'Ravenholm')]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['L1']);
    expect(sids(plan.downloads)).toEqual(['S1']);
  });

  it('never id-matches across types (the other-type record is an id clash)', () => {
    const plan = planMerge(
      [el('X', 'location', 'Somewhere')],
      server([['character', [srv('X', 'Someone')]]]),
      ON,
    );
    expect(plan.sameId).toEqual([]);
    expect(ids(plan.creates)).toEqual(['X']);
  });
});

describe('planMerge: rule 2, id pass runs over all locals first (H10)', () => {
  it('matches a local whose id equals a same-type server record', () => {
    const s = srv('N', 'Alice');
    const plan = planMerge([el('N', 'character', 'Alice')], server([['character', [s]]]), ON);
    expect(plan.sameId).toHaveLength(1);
    expect(plan.sameId[0].server).toBe(s);
    expect(plan.sameId[0].type).toBe('character');
    expect(plan.pairs.size).toBe(0);
    expect(plan.downloads).toEqual([]);
  });

  it('an id-matched local keeps its server record when a same-named twin is listed first', () => {
    const plan = planMerge(
      [el('TWIN', 'character', 'Alice'), el('N', 'character', 'Alice', { description: 'mine' })],
      server([['character', [srv('N', 'Alice')]]]),
      ON,
    );
    expect(ids(plan.sameId)).toEqual(['N']);
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['TWIN']);
    expect(plan.downloads).toEqual([]);
  });
});

describe('planMerge: rule 3, name pass', () => {
  it('pairs one local and one server record sharing a normalized name', () => {
    const s = srv('S1', '  alice ');
    const plan = planMerge([el('L1', 'character', 'Alice')], server([['character', [s]]]), ON);
    expect([...plan.pairs]).toEqual([['L1', 'S1']]);
    expect(plan.renamed).toHaveLength(1);
    expect(plan.renamed[0].server).toBe(s);
    expect(plan.creates).toEqual([]);
    expect(plan.downloads).toEqual([]);
  });

  it('a whitespace-only name does not match a blank server name (H11)', () => {
    const plan = planMerge(
      [el('O2', 'character', '   ')],
      server([['character', [srv('S1', ''), srv('S2', '  ')]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['O2']);
    expect(sids(plan.downloads)).toEqual(['S1', 'S2']);
    expect(plan.ambiguous).toEqual([]);
  });

  it('ambiguous names are not matched: two local Alices + one server Alice', () => {
    const plan = planMerge(
      [el('A1', 'character', ' Alice '), el('A2', 'character', 'alice')],
      server([['character', [srv('S1', 'ALICE')]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
    expect(plan.renamed).toEqual([]);
    expect(ids(plan.creates)).toEqual(['A1', 'A2']);
    expect(sids(plan.downloads)).toEqual(['S1']);
    expect(plan.ambiguous).toEqual([{ type: 'character', name: 'Alice' }]);
  });

  it('ambiguous the other way: one local + two server records sharing the name', () => {
    const plan = planMerge(
      [el('L1', 'character', 'Bob')],
      server([['character', [srv('S1', 'Bob'), srv('S2', 'bob')]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['L1']);
    expect(sids(plan.downloads)).toEqual(['S1', 'S2']);
    expect(plan.ambiguous).toEqual([{ type: 'character', name: 'Bob' }]);
  });

  it('reports an ambiguous name once per type, separately for each type', () => {
    const plan = planMerge(
      [
        el('C1', 'character', 'Echo'), el('C2', 'character', 'Echo'), el('C3', 'character', 'echo'),
        el('P1', 'phenomenon', 'Echo'),
      ],
      server([
        ['character', [srv('S1', 'Echo'), srv('S2', 'Echo')]],
        ['phenomenon', [srv('S3', 'Echo'), srv('S4', 'ECHO')]],
      ]),
      ON,
    );
    expect(plan.ambiguous).toEqual([
      { type: 'character', name: 'Echo' },
      { type: 'phenomenon', name: 'Echo' },
    ]);
    expect(ids(plan.creates)).toEqual(['C1', 'C2', 'C3', 'P1']);
    expect(sids(plan.downloads)).toEqual(['S1', 'S2', 'S3', 'S4']);
  });

  it('shared names with nothing on the other side are not ambiguous', () => {
    const plan = planMerge(
      [el('A1', 'character', 'Alice'), el('A2', 'character', 'Alice')],
      server([['character', [srv('S1', 'Bob'), srv('S2', 'Bob')]]]),
      ON,
    );
    expect(plan.ambiguous).toEqual([]);
    expect(ids(plan.creates)).toEqual(['A1', 'A2']);
    expect(sids(plan.downloads)).toEqual(['S1', 'S2']);
  });

  it('an id-matched server record is not a name target, and its twin name becomes unique', () => {
    // Server holds two "Alice": N is id-matched in pass 1, leaving S2 unique for L1.
    const plan = planMerge(
      [el('L1', 'character', 'Alice'), el('N', 'character', 'Alice')],
      server([['character', [srv('N', 'Alice'), srv('S2', 'Alice')]]]),
      ON,
    );
    expect(ids(plan.sameId)).toEqual(['N']);
    expect([...plan.pairs]).toEqual([['L1', 'S2']]);
    expect(plan.ambiguous).toEqual([]);
  });

  it('a server record whose id is a local of another type is never a name target', () => {
    const plan = planMerge(
      [el('L1', 'character', 'Alice'), el('X', 'location', 'Elsewhere')],
      server([['character', [srv('X', 'Alice')]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['L1', 'X']);
    expect(plan.downloads).toEqual([]);
  });
});

describe('planMerge: rule 4, unmatched', () => {
  it('sends unmatched locals to creates and unmatched server records to downloads', () => {
    const plan = planMerge(
      [el('L1', 'character', 'Alice'), el('L2', 'object', 'Sword')],
      server([['character', [srv('S1', 'Carol')]], ['object', [srv('S2', 'Shield')]]]),
      ON,
    );
    expect(ids(plan.creates)).toEqual(['L1', 'L2']);
    expect(plan.creates.map(c => c.type)).toEqual(['character', 'object']);
    expect(sids(plan.downloads)).toEqual(['S1', 'S2']);
    expect(plan.downloads.map(d => d.type)).toEqual(['character', 'object']);
  });
});

describe('planMerge: rule 5, id clashes', () => {
  it('records a server record whose id is a local of another type, once, and never downloads it', () => {
    const plan = planMerge(
      [el('X', 'location', 'Ravenholm')],
      server([['character', [srv('X', 'Ravenholm')]]]),
      ON,
    );
    expect(plan.idClashes).toEqual([{ id: 'X', localType: 'location', serverType: 'character' }]);
    expect(plan.downloads).toEqual([]);
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['X']);
  });

  it('still lets the clashing local match by name in its own type', () => {
    const plan = planMerge(
      [el('X', 'location', 'Ravenholm')],
      server([
        ['character', [srv('X', 'Someone')]],
        ['location', [srv('S9', 'Ravenholm')]],
      ]),
      ON,
    );
    expect(plan.idClashes).toEqual([{ id: 'X', localType: 'location', serverType: 'character' }]);
    expect([...plan.pairs]).toEqual([['X', 'S9']]);
  });

  it('is independent of matchByName', () => {
    const plan = planMerge(
      [el('X', 'location', 'Ravenholm')],
      server([['character', [srv('X', 'Ravenholm')]]]),
      OFF,
    );
    expect(plan.idClashes).toHaveLength(1);
    expect(plan.downloads).toEqual([]);
  });
});

describe('planMerge: rule 6, matchByName off', () => {
  it('skips the name pass entirely', () => {
    const plan = planMerge(
      [el('L1', 'character', 'Alice'), el('A1', 'object', 'Key'), el('A2', 'object', 'Key'), el('N', 'object', 'Lamp')],
      server([
        ['character', [srv('S1', 'Alice')]],
        ['object', [srv('S2', 'Key'), srv('N', 'Lamp')]],
      ]),
      OFF,
    );
    expect(plan.pairs.size).toBe(0);
    expect(plan.renamed).toEqual([]);
    expect(plan.ambiguous).toEqual([]);
    expect(ids(plan.sameId)).toEqual(['N']);
    expect(ids(plan.creates)).toEqual(['L1', 'A1', 'A2']);
    expect(sids(plan.downloads)).toEqual(['S1', 'S2']);
  });
});

describe('planMerge: rule 7, determinism', () => {
  const locals = [
    el('Z', 'object', 'Zed'),
    el('A', 'character', 'Alice'),
    el('M', 'character', 'Mallory'),
    el('B', 'character', 'Bob'),
  ];
  // Map insertion order deliberately differs from ALL_ELEMENT_TYPES order.
  const srvMap = () => server([
    ['object', [srv('O2', 'Other'), srv('O1', 'Zed')]],
    ['character', [srv('C2', 'Carol'), srv('B', 'Bob'), srv('C1', 'alice')]],
  ]);

  it('keeps locals in input order and servers in ALL_ELEMENT_TYPES then array order', () => {
    const plan = planMerge(locals, srvMap(), ON);
    expect(ids(plan.creates)).toEqual(['M']);
    expect(ids(plan.renamed)).toEqual(['Z', 'A']);
    expect([...plan.pairs]).toEqual([['Z', 'O1'], ['A', 'C1']]);
    expect(sids(plan.downloads)).toEqual(['C2', 'O2']);
  });

  it('gives deep-equal output for two runs on the same input', () => {
    expect(planMerge(locals, srvMap(), ON)).toEqual(planMerge(locals, srvMap(), ON));
  });
});

describe('planMerge: rule 8, pure', () => {
  it('does not mutate frozen inputs', () => {
    const locals = Object.freeze([
      Object.freeze(el('N', 'character', 'Alice')),
      Object.freeze(el('L1', 'character', 'Bob')),
      Object.freeze(el('X', 'location', 'Here')),
    ]) as readonly Element[];
    const charRecs = Object.freeze([
      Object.freeze(srv('N', 'Alice')),
      Object.freeze(srv('S1', 'bob')),
      Object.freeze(srv('S2', 'Carol')),
    ]) as readonly ServerRec[];
    const clashRecs = Object.freeze([Object.freeze(srv('X', 'Clash'))]) as readonly ServerRec[];
    const map = new Map<ElementType, readonly ServerRec[]>([['character', charRecs], ['object', clashRecs]]);
    const snapshot = JSON.stringify({ locals, map: [...map] });

    const plan = planMerge(locals, map, ON);

    expect(JSON.stringify({ locals, map: [...map] })).toBe(snapshot);
    expect(map.size).toBe(2);
    expect([...plan.pairs]).toEqual([['L1', 'S1']]);
    expect(plan.idClashes).toEqual([{ id: 'X', localType: 'location', serverType: 'object' }]);
  });
});

describe('planMerge: rule 9, NFC', () => {
  it('matches a local name in NFD against a server name in NFC', () => {
    const plan = planMerge(
      [el('L1', 'location', 'Café')],
      server([['location', [srv('S1', 'Café')]]]),
      ON,
    );
    expect([...plan.pairs]).toEqual([['L1', 'S1']]);
  });
});

describe('planMerge: rule 10, missing or non-string names', () => {
  it('never name-matches a local without a string name', () => {
    const plan = planMerge(
      [el('L1', 'character', undefined), el('L2', 'character', 7)],
      server([['character', [srv('S1', ''), srv('S2', '7')]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
    expect(ids(plan.creates)).toEqual(['L1', 'L2']);
  });

  it('still id-matches a local without a string name', () => {
    const plan = planMerge(
      [el('N', 'character', undefined)],
      server([['character', [srv('N', 'Alice')]]]),
      ON,
    );
    expect(ids(plan.sameId)).toEqual(['N']);
  });

  it('never name-matches a server record without a string name', () => {
    const plan = planMerge(
      [el('L1', 'character', '7')],
      server([['character', [srv('S1', 7), srv('S2', undefined)]]]),
      ON,
    );
    expect(plan.pairs.size).toBe(0);
  });
});

describe('planMerge: rule 11, absent types', () => {
  it('treats a type missing from serverByType as an empty list', () => {
    const plan = planMerge(
      [el('L1', 'creature', 'Wyrm'), el('L2', 'zone', 'Marsh')],
      new Map(),
      ON,
    );
    expect(ids(plan.creates)).toEqual(['L1', 'L2']);
    expect(plan.downloads).toEqual([]);
    expect(plan.sameId).toEqual([]);
  });
});
