/**
 * Node significance (degree.ts) — chart #2 anchor-beats foundation.
 * Asserts bidirectional dated-neighbour counting, dated-only gating, and a
 * deterministic, stable anchor ranking (no flicker across renders).
 */

import { describe, it, expect } from 'vitest';
import { computeDegrees, rankAnchors } from '../../src/visualization/timeline/degree';
import type { LinkedRef, TimelineNode } from '../../src/visualization/timeline/types';

function link(id: string): LinkedRef {
  return { id, type: 'event', name: id, fieldLabel: 'Link' };
}
function node(id: string, opts: { links?: LinkedRef[]; startDate?: number; degree?: number } = {}): TimelineNode {
  return {
    id,
    elementType: 'event',
    name: id,
    startDate: opts.startDate ?? 0,
    endDate: null,
    dateSpec: { kind: 'exact', value: opts.startDate ?? 0 },
    color: '#fff',
    links: opts.links ?? [],
    degree: opts.degree ?? 0,
    contentMass: 0,
  };
}

describe('computeDegrees', () => {
  it('counts a single edge for BOTH endpoints (bidirectional)', () => {
    const nodes = [node('a', { links: [link('b')] }), node('b')];
    const d = computeDegrees(nodes);
    expect(d.get('a')).toBe(1);
    expect(d.get('b')).toBe(1);
  });

  it('excludes links to undated (non-node) targets', () => {
    const nodes = [node('a', { links: [link('ghost'), link('b')] }), node('b')];
    const d = computeDegrees(nodes);
    expect(d.get('a')).toBe(1); // only the b edge counts; ghost is not in the set
    expect(d.get('b')).toBe(1);
  });

  it('a hub accumulates incoming edges', () => {
    const nodes = [
      node('h'),
      node('a', { links: [link('h')] }),
      node('b', { links: [link('h')] }),
      node('c', { links: [link('h')] }),
    ];
    const d = computeDegrees(nodes);
    expect(d.get('h')).toBe(3);
    expect(d.get('a')).toBe(1);
    expect(d.get('b')).toBe(1);
    expect(d.get('c')).toBe(1);
  });

  it('mutual links count twice (each direction is an edge)', () => {
    const nodes = [node('a', { links: [link('b')] }), node('b', { links: [link('a')] })];
    const d = computeDegrees(nodes);
    expect(d.get('a')).toBe(2);
    expect(d.get('b')).toBe(2);
  });

  it('isolated nodes have degree 0', () => {
    const d = computeDegrees([node('a'), node('b')]);
    expect(d.get('a')).toBe(0);
    expect(d.get('b')).toBe(0);
  });
});

describe('rankAnchors', () => {
  it('returns the cap highest-degree nodes', () => {
    const nodes = [
      node('low', { degree: 1 }),
      node('high', { degree: 9 }),
      node('mid', { degree: 5 }),
    ];
    expect(rankAnchors(nodes, 2)).toEqual(new Set(['high', 'mid']));
  });

  it('ties break by earliest startDate, then id — stable across calls', () => {
    const nodes = [
      node('z', { degree: 3, startDate: 100 }),
      node('a', { degree: 3, startDate: 100 }), // same degree+date as z → id wins → 'a'
      node('early', { degree: 3, startDate: 10 }), // earlier date wins outright
    ];
    const first = rankAnchors(nodes, 2);
    const second = rankAnchors([...nodes].reverse(), 2);
    expect(first).toEqual(new Set(['early', 'a']));
    expect(second).toEqual(first); // input order must not change the result
  });

  it('cap 0 → empty; cap ≥ count → all', () => {
    const nodes = [node('a', { degree: 2 }), node('b', { degree: 1 })];
    expect(rankAnchors(nodes, 0)).toEqual(new Set());
    expect(rankAnchors(nodes, 5)).toEqual(new Set(['a', 'b']));
  });

  it('empty input → empty set', () => {
    expect(rankAnchors([], 5)).toEqual(new Set());
  });
});
