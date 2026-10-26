/**
 * A parent_narrative cycle (self-parent, or A -> B -> A) in
 * world data must not hang the tab. Every upward walk carries a seen set.
 *
 * Bounded when red: each element is a Proxy that throws after N reads of
 * parent_narrative, so an unguarded walk fails fast instead of hanging.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { mountContextLists } from '../../src/tabs/right/context-pane-lists';
import { ancestorIds, findAncestry, type NarrativeIndex, type NarrativeNode } from '../../src/middle/writing-helpers';
import { patchSlice } from '../../src/core/state';
import type { Element } from '../../src/core/types';

beforeAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class { observe() {} disconnect() {} unobserve() {} };
});
afterEach(() => { document.body.innerHTML = ''; });

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function trapped(id: string, parent: string, extra: Record<string, unknown> = {}): Element {
  let reads = 0;
  return new Proxy({ id, type: 'narrative', name: id, parent_narrative: parent, story: '', ...extra }, {
    get(t, k) {
      if (k === 'parent_narrative' && ++reads > 10_000) throw new Error('LOOP: unbounded parent walk');
      return (t as Record<string | symbol, unknown>)[k];
    },
  }) as unknown as Element;
}

function indexOf(els: Element[]): NarrativeIndex {
  const byId = new Map<string, NarrativeNode>();
  for (const el of els) byId.set(el.id, { el, tier: 'l3', children: [], depth: 0 });
  return { roots: [], byId };
}

describe('C1: context pane Potentials survives a parent cycle', () => {
  it('self-parented narrative mounts', () => {
    const id = uuid(1);
    const loop = trapped(id, id);
    patchSlice('data', { elements: [loop] });
    const host = document.createElement('div');
    expect(() => mountContextLists({ host, narrative: loop, onSelect: () => {} })).not.toThrow();
  });

  it('two-node cycle A -> B -> A mounts', () => {
    const a = uuid(1), b = uuid(2);
    const A = trapped(a, b), B = trapped(b, a);
    patchSlice('data', { elements: [A, B] });
    expect(() => mountContextLists({ host: document.createElement('div'), narrative: A, onSelect: () => {} })).not.toThrow();
  });
});

describe('C1: writing helpers survive a parent cycle', () => {
  it('ancestorIds stops at the first repeat', () => {
    const a = uuid(1), b = uuid(2);
    const idx = indexOf([trapped(a, b), trapped(b, a)]);
    expect(ancestorIds(idx, a)).toEqual([b]);
    const self = uuid(3);
    expect(ancestorIds(indexOf([trapped(self, self)]), self)).toEqual([]);
  });

  it('findAncestry stops at the first repeat', () => {
    const a = uuid(1), b = uuid(2), c = uuid(3);
    // c -> b -> a -> b (cycle above c)
    const idx = indexOf([trapped(a, b), trapped(b, a), trapped(c, b)]);
    const got = findAncestry(idx, c);
    expect(got.sceneId).toBe(c);
    expect(got.chapterId).toBe(b);
    expect(got.bookId).toBe(a);
    const self = uuid(4);
    expect(findAncestry(indexOf([trapped(self, self)]), self)).toEqual({ bookId: self, chapterId: undefined, sceneId: undefined });
  });
});
