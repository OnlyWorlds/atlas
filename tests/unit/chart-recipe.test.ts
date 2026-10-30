/**
 * Chart recipe + scope-filter — the Bout-F core (DESIGN_CHARTS.md). Pure,
 * deterministic logic; locked in before any UI builds on it. Hardened per the
 * charts-core-gate findings (dated-neighbourhood ranking, fail-safe unknown
 * scope, schema_version + tagged axis on the output contract).
 */

import { describe, it, expect } from 'vitest';
import { filterNodesByScope, scopeFromFocus, tableauScope } from '../../src/visualization/timeline/chart-recipe';
import type { TimelineNode } from '../../src/visualization/timeline/types';
import type { ElementType } from '../../src/core/types';

function node(id: string, elementType: string, links: { id: string; type: string; name: string; fieldLabel: string }[] = []): TimelineNode {
  return { id, elementType, name: id, startDate: 0, endDate: null, dateSpec: { kind: 'exact', value: 0 }, color: '#fff', links, degree: 0, contentMass: 0 };
}

// (pickDefaultChart and its ordered-recipe tests removed — dead code
// since the tableau default; the home strip runs the same tableauScope the
// Charts room does.)

describe('filterNodesByScope', () => {
  const nodes = [
    node('ev', 'event', [{ id: 'lyra', type: 'character', name: 'Lyra', fieldLabel: 'Participant' }]),
    node('lyra', 'character'),
    node('loc', 'location'),
    node('book', 'narrative'),
  ];

  it('all → every node', () => {
    expect(filterNodesByScope(nodes, { kind: 'all' })).toHaveLength(4);
  });

  it('types → only matching types', () => {
    const r = filterNodesByScope(nodes, { kind: 'types', types: ['event', 'narrative'] });
    expect(r.map(n => n.id).sort()).toEqual(['book', 'ev']);
  });

  it('selection → only picked ids', () => {
    const r = filterNodesByScope(nodes, { kind: 'selection', elementIds: ['loc', 'book'] });
    expect(r.map(n => n.id).sort()).toEqual(['book', 'loc']);
  });

  it('focus → the node + everything linked to/from it (both directions)', () => {
    const r = filterNodesByScope(nodes, { kind: 'focus', elementId: 'lyra' });
    expect(r.map(n => n.id).sort()).toEqual(['ev', 'lyra']);
  });

  it('focus → forward links too (focus node points at others)', () => {
    const r = filterNodesByScope(nodes, { kind: 'focus', elementId: 'ev' });
    expect(r.map(n => n.id).sort()).toEqual(['ev', 'lyra']);
  });

  it('unknown scope kind → empty (fail safe, never the whole-world wall)', () => {
    const r = filterNodesByScope(nodes, { kind: 'spatial' } as unknown as Parameters<typeof filterNodesByScope>[1]);
    expect(r).toEqual([]);
  });
});

describe('scopeFromFocus — URL focus + broad-view type filter (chart #2 nav)', () => {
  it('a focus id in the URL wins → focus scope (even with a type filter set)', () => {
    expect(scopeFromFocus('lyra', null)).toEqual({ kind: 'focus', elementId: 'lyra' });
    expect(scopeFromFocus('lyra', new Set<ElementType>(['event']))).toEqual({ kind: 'focus', elementId: 'lyra' });
  });

  it('no focus + a type filter → types scope', () => {
    expect(scopeFromFocus(null, new Set<ElementType>(['event', 'narrative'])))
      .toEqual({ kind: 'types', types: ['event', 'narrative'] });
  });

  it('no focus + no filter (or an empty one) → all', () => {
    expect(scopeFromFocus(null, null)).toEqual({ kind: 'all' });
    expect(scopeFromFocus(null, new Set<ElementType>())).toEqual({ kind: 'all' });
  });
});

describe('tableauScope — the default world view (all chips off)', () => {
  const mk = (id: string, elementType: string, opts: { degree?: number; contentMass?: number } = {}): TimelineNode => ({
    id, elementType, name: id, startDate: 0, endDate: null,
    dateSpec: { kind: 'exact', value: 0 }, color: '#fff', links: [],
    degree: opts.degree ?? 0, contentMass: opts.contentMass ?? 0,
  });

  it('the lead character and location come first, by weight', () => {
    const nodes = [
      mk('c1', 'character', { degree: 5 }),
      mk('c2', 'character', { degree: 1 }),
      mk('l1', 'location', { degree: 3 }),
      mk('e1', 'event', { degree: 2 }),
    ];
    const scope = tableauScope(nodes);
    expect(scope.kind).toBe('selection');
    const ids = (scope as { elementIds: string[] }).elementIds;
    expect(ids.slice(0, 2)).toEqual(['c1', 'l1']);
  });

  it('diversity first, then a dominant type may fill remaining slots', () => {
    const nodes = [
      ...Array.from({ length: 12 }, (_, i) => mk(`n${i}`, 'narrative', { degree: 12 - i })),
      mk('c1', 'character', { degree: 1 }),
      mk('e1', 'event', { degree: 1 }),
    ];
    const ids = (tableauScope(nodes) as { elementIds: string[] }).elementIds;
    // Every present type is seated (fairness) …
    expect(ids).toContain('c1');
    expect(ids).toContain('e1');
    // … and with room under the total cap, the dominant type fills the rest
    // (14 dated elements < 22 → ALL of them show; hiding 8 narratives while
    // slots sit empty was the fx-4 bug at small scale).
    expect(ids.length).toBe(14);
  });

  it('fx-4 shape: a dominant type fills to the total cap; minority types keep seats', () => {
    const nodes = [
      ...Array.from({ length: 60 }, (_, i) => mk(`e${i}`, 'event', { degree: 60 - i })),
      mk('l1', 'location', { degree: 0 }),
      mk('l2', 'location', { degree: 0 }),
      mk('l3', 'location', { degree: 0 }),
    ];
    const ids = (tableauScope(nodes) as { elementIds: string[] }).elementIds;
    expect(ids.length).toBe(22);                                  // budget spent, not stranded at 7
    expect(ids.some(id => id.startsWith('l'))).toBe(true);        // locations keep a seat
    expect(ids.filter(id => id.startsWith('e')).length).toBeGreaterThan(10); // events allowed to dominate
  });

  it('fx-6 shape: no present type gets zero slots (fairness round-robin)', () => {
    const types = ['character', 'creature', 'collective', 'construct', 'event', 'institution',
      'location', 'narrative', 'relation', 'title', 'law', 'zone'];
    // institutions deliberately weighted ABOVE nothing but below everyone else
    const nodes = types.flatMap((t, ti) =>
      [0, 1].map(k => mk(`${t}-${k}`, t, { degree: t === 'institution' ? 0 : 24 - ti - k })));
    const ids = (tableauScope(nodes) as { elementIds: string[] }).elementIds;
    for (const t of types) {
      expect(ids.some(id => id.startsWith(`${t}-`)), `type ${t} must hold a seat`).toBe(true);
    }
    expect(ids.length).toBeLessThanOrEqual(22);
  });

  it('caps the total and is deterministic', () => {
    const nodes = Array.from({ length: 60 }, (_, i) =>
      mk(`x${i}`, ['event', 'character', 'location', 'object', 'narrative', 'title'][i % 6], { degree: i % 9 }));
    const a = (tableauScope(nodes) as { elementIds: string[] }).elementIds;
    const b = (tableauScope(nodes) as { elementIds: string[] }).elementIds;
    expect(a.length).toBeLessThanOrEqual(22);
    expect(a).toEqual(b);
  });
});
