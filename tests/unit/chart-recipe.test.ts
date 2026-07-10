/**
 * Chart recipe + scope-filter — the Bout-F core (DESIGN_CHARTS.md). Pure,
 * deterministic logic; locked in before any UI builds on it. Hardened per the
 * charts-core-gate findings (dated-neighbourhood ranking, fail-safe unknown
 * scope, schema_version + tagged axis on the output contract).
 */

import { describe, it, expect } from 'vitest';
import { pickDefaultChart, filterNodesByScope, scopeFromFocus, tableauScope } from '../../src/visualization/timeline/chart-recipe';
import type { TimelineNode } from '../../src/visualization/timeline/types';
import type { Element, ElementType } from '../../src/core/types';

function el(id: string, type: string, extra: Record<string, unknown> = {}): Element {
  return { id, type, name: id, local_updated_at: '2026-01-01', ...extra } as Element & Record<string, unknown>;
}
function node(id: string, elementType: string, links: { id: string; type: string; name: string; fieldLabel: string }[] = []): TimelineNode {
  return { id, elementType, name: id, startDate: 0, endDate: null, dateSpec: { kind: 'exact', value: 0 }, color: '#fff', links, degree: 0, contentMass: 0 };
}

describe('pickDefaultChart — ordered recipes', () => {
  it('empty world → fallback "all", with a versioned/time-axis contract', () => {
    const c = pickDefaultChart([]);
    expect(c.scope.kind).toBe('all');
    expect(c.schema_version).toBe(1);
    expect(c.axis).toEqual({ kind: 'time', direction: 'both' });
    expect(c.render).toBe('2d');
  });

  it('narrative tree + dated content → Story (narratives + events)', () => {
    const c = pickDefaultChart([
      el('book', 'narrative', { start_date: 100 }),
      el('ch1', 'narrative', { parent_narrative: 'book', start_date: 100 }),
      el('ev', 'event', { start_date: 120 }),
    ]);
    expect(c.scope).toEqual({ kind: 'types', types: ['narrative', 'event'] });
    expect(c.name).toBe('Story');
  });

  it('narratives WITHOUT a tree fall through to events', () => {
    const c = pickDefaultChart([
      el('n1', 'narrative', { start_date: 100 }), // no parent_narrative → not a "tree"
      el('ev', 'event', { start_date: 120 }),
    ]);
    expect(c.scope).toEqual({ kind: 'types', types: ['event'] });
  });

  it('dated events only → Events', () => {
    const c = pickDefaultChart([el('ev', 'event', { start_date: 5 }), el('loc', 'location')]);
    expect(c.scope).toEqual({ kind: 'types', types: ['event'] });
  });

  it('character life: focus on the char with the largest DATED neighbourhood', () => {
    const c = pickDefaultChart([
      el('lyra', 'character', { birth_date: 1180 }),                    // 0 dated neighbours
      el('oren', 'character', { birth_date: 1165, birthplace: 'keep' }), // links to a dated location
      el('keep', 'location', { founding_date: 1000 }),                  // dated → oren's neighbour
    ]);
    expect(c.scope).toEqual({ kind: 'focus', elementId: 'oren' });
  });

  it('character with ONLY undated referrers does NOT get a lone-dot focus (falls through)', () => {
    const c = pickDefaultChart([
      el('lyra', 'character', { birth_date: 1180 }),
      el('e1', 'event', { characters: ['lyra'] }), // UNDATED → not a dated neighbour, and recipe-2 stays off
    ]);
    expect(c.scope.kind).toBe('all'); // recipe 3 falls through; no foundings → fallback
  });

  it('two dated chars with no dated neighbours → falls through to all', () => {
    const c = pickDefaultChart([
      el('lyra', 'character', { birth_date: 1180 }),
      el('oren', 'character', { birth_date: 1165 }),
    ]);
    expect(c.scope.kind).toBe('all');
  });

  it('a character WITH a dated neighbour beats foundings (recipe 3 before 4)', () => {
    const c = pickDefaultChart([
      el('lyra', 'character', { birth_date: 1180, birthplace: 'city' }),
      el('city', 'location', { founding_date: 800 }), // dated: both lyra's neighbour AND a founding
    ]);
    expect(c.scope).toEqual({ kind: 'focus', elementId: 'lyra' });
  });

  it('foundings only → Foundings', () => {
    const c = pickDefaultChart([
      el('city', 'location', { founding_date: 800 }),
      el('guild', 'institution', { founding_date: 1100 }),
      el('obj', 'object', {}),
    ]);
    expect(c.scope).toEqual({ kind: 'types', types: ['location', 'institution'] });
  });

  it('malformed dates do not count as dated', () => {
    const c = pickDefaultChart([el('ev', 'event', { start_date: 'soon' })]);
    expect(c.scope.kind).toBe('all');
  });
});

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

  it('cast always in; lead character + location stand in when unset', () => {
    const nodes = [
      mk('c1', 'character', { degree: 5 }),
      mk('c2', 'character', { degree: 1 }),
      mk('l1', 'location', { degree: 3 }),
      mk('e1', 'event', { degree: 2 }),
    ];
    const withCast = tableauScope(nodes, ['c2']);
    expect(withCast.kind).toBe('selection');
    const ids1 = (withCast as { elementIds: string[] }).elementIds;
    expect(ids1).toContain('c2');       // the explicit cast, even at low weight
    expect(ids1).toContain('l1');       // lead location stands in
    const noCast = tableauScope(nodes, []);
    const ids2 = (noCast as { elementIds: string[] }).elementIds;
    expect(ids2).toContain('c1');       // lead character inferred by weight
    expect(ids2).toContain('l1');
  });

  it('caps per type so one category never floods the tableau', () => {
    const nodes = [
      ...Array.from({ length: 12 }, (_, i) => mk(`n${i}`, 'narrative', { degree: 12 - i })),
      mk('c1', 'character', { degree: 1 }),
      mk('e1', 'event', { degree: 1 }),
    ];
    const ids = (tableauScope(nodes, []) as { elementIds: string[] }).elementIds;
    const narratives = ids.filter(id => id.startsWith('n'));
    expect(narratives.length).toBeLessThanOrEqual(4);
    expect(ids).toContain('c1');
    expect(ids).toContain('e1');
  });

  it('caps the total and is deterministic', () => {
    const nodes = Array.from({ length: 60 }, (_, i) =>
      mk(`x${i}`, ['event', 'character', 'location', 'object', 'narrative', 'title'][i % 6], { degree: i % 9 }));
    const a = (tableauScope(nodes, []) as { elementIds: string[] }).elementIds;
    const b = (tableauScope(nodes, []) as { elementIds: string[] }).elementIds;
    expect(a.length).toBeLessThanOrEqual(22);
    expect(a).toEqual(b);
  });
});
