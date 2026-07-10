/**
 * Chart recipe + scope-filter — the Bout-F core (DESIGN_CHARTS.md). Pure,
 * deterministic logic; locked in before any UI builds on it. Hardened per the
 * charts-core-gate findings (dated-neighbourhood ranking, fail-safe unknown
 * scope, schema_version + tagged axis on the output contract).
 */

import { describe, it, expect } from 'vitest';
import { pickDefaultChart, filterNodesByScope, scopeFromFocus, protagonistWindow } from '../../src/visualization/timeline/chart-recipe';
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

describe('protagonistWindow — S5 protagonist-first default window', () => {
  const ref = (id: string) => ({ id, type: 'event', name: id, fieldLabel: 'Link' });
  const dated = (id: string, elementType: string, startDate: number, opts: {
    links?: { id: string; type: string; name: string; fieldLabel: string }[];
    degree?: number; endDate?: number;
  } = {}): TimelineNode => ({
    id, elementType, name: id, startDate, endDate: opts.endDate ?? null,
    dateSpec: { kind: 'exact', value: startDate }, color: '#fff',
    links: opts.links ?? [], degree: opts.degree ?? 0, contentMass: 0,
  });

  it('explicit protagonist → window spans their dated neighbourhood, padded', () => {
    // Universe spans 0..1000; hero's neighbourhood is 430..457.
    const nodes = [
      dated('hero', 'character', 440, { links: [ref('b1'), ref('b2')] }),
      dated('b1', 'event', 430),
      dated('b2', 'event', 457),
      dated('far0', 'event', 0),
      dated('far1', 'event', 1000),
    ];
    const win = protagonistWindow(nodes, 'hero')!;
    expect(win).not.toBeNull();
    expect(win.start).toBeLessThan(430);
    expect(win.end).toBeGreaterThan(457);
    // A protagonist window is an ERA, not the whole universe.
    expect(win.end - win.start).toBeLessThan(300);
  });

  it('includes reverse links (events pointing AT the protagonist)', () => {
    const heroRef = { id: 'hero', type: 'character', name: 'hero', fieldLabel: 'Characters' };
    const nodes = [
      dated('hero', 'character', 440),
      dated('battle', 'event', 470, { links: [heroRef] }),
      dated('far', 'event', 5000),
    ];
    const win = protagonistWindow(nodes, 'hero')!;
    expect(win.start).toBeLessThan(440);
    expect(win.end).toBeGreaterThan(470);
    expect(win.end).toBeLessThan(5000);
  });

  it('undated explicit protagonist still centers via reverse links', () => {
    const heroRef = { id: 'ghost-hero', type: 'character', name: 'x', fieldLabel: 'Characters' };
    const nodes = [
      dated('b1', 'event', 100, { links: [heroRef] }),
      dated('b2', 'event', 140, { links: [heroRef] }),
      dated('far', 'event', 9000),
    ];
    const win = protagonistWindow(nodes, 'ghost-hero')!;
    expect(win).not.toBeNull();
    expect(win.start).toBeLessThan(100);
    expect(win.end).toBeGreaterThan(140);
  });

  it('no explicit favorite → infers the highest-degree character', () => {
    const nodes = [
      dated('minor', 'character', 10, { degree: 1, links: [ref('e1')] }),
      dated('major', 'character', 500, { degree: 7, links: [ref('e2')] }),
      dated('e1', 'event', 12),
      dated('e2', 'event', 520),
      dated('spread', 'event', 5000),
    ];
    const win = protagonistWindow(nodes, null)!;
    expect(win.start).toBeLessThan(500);
    expect(win.end).toBeGreaterThan(520);
    expect(win.end).toBeLessThan(5000);
  });

  it('infers an UNDATED character from the dated set that references it (the usual worldbuilding shape)', () => {
    // No character has a birth_date (so none is a node), but three events in
    // one era all reference 'hero' — inference must find them via links.
    const heroRef = { id: 'hero', type: 'character', name: 'hero', fieldLabel: 'Characters' };
    const sideRef = { id: 'side', type: 'character', name: 'side', fieldLabel: 'Characters' };
    const nodes = [
      dated('b1', 'event', 430, { links: [heroRef] }),
      dated('b2', 'event', 445, { links: [heroRef, sideRef] }),
      dated('b3', 'event', 457, { links: [heroRef] }),
      dated('far', 'event', 0),
    ];
    const win = protagonistWindow(nodes, null)!;
    expect(win).not.toBeNull();
    expect(win.start).toBeLessThan(430);
    expect(win.end).toBeGreaterThan(457);
    expect(win.start).toBeGreaterThan(0); // 'far' is outside the hero's era
  });

  it('returns null when no character qualifies (lone dots orient nothing)', () => {
    expect(protagonistWindow([], null)).toBeNull();
    expect(protagonistWindow([dated('e', 'event', 5)], null)).toBeNull();
    // A zero-degree character never wins inference.
    expect(protagonistWindow([dated('c', 'character', 5, { degree: 0 })], null)).toBeNull();
  });

  it('lands on the DENSEST cluster, not the min-max envelope (outlier-robust)', () => {
    // One early chronicle at year 50 must not stretch the window across all of
    // history — the era is where the neighbourhood's mass is (the live
    // Moppetopia finding: The Crumbler).
    const heroRef = { id: 'hero', type: 'character', name: 'hero', fieldLabel: 'Characters' };
    const nodes = [
      dated('hero', 'character', 320),
      dated('old-chronicle', 'event', 50, { links: [heroRef] }),
      ...[447, 453, 455, 456, 457, 458].map((d, i) => dated(`n${i}`, 'event', d, { links: [heroRef] })),
      dated('bookend', 'event', 0),
    ];
    const win = protagonistWindow(nodes, 'hero')!;
    expect(win).not.toBeNull();
    expect(win.start).toBeGreaterThan(300);   // year-50 outlier excluded
    expect(win.end).toBeGreaterThan(458);     // the story cluster is inside
    expect(win.end - win.start).toBeLessThan(200);
  });

  it('returns null when the neighbourhood spans most of the universe anyway', () => {
    const nodes = [
      dated('hero', 'character', 0, { links: [ref('e1')] }),
      dated('e1', 'event', 1000),
    ];
    expect(protagonistWindow(nodes, 'hero')).toBeNull();
  });
});
