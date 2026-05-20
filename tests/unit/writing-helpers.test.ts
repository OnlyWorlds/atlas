/**
 * Writing-system helpers + promote logic.
 *
 * Covers the supertype-tier model (session 224): supertype value drives tree
 * membership + tier, parent_narrative drives position, subtype is free.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  DEFAULT_WRITING_LABELS,
  isWritingInitialized,
  getTierForNarrative,
  isWritingNarrative,
  writingHashForNarrative,
  buildNarrativeIndex,
  ancestorIds,
  findAncestry,
  nextOrder,
} from '../../src/middle/writing-helpers';
import {
  buildPromoteCandidates,
  detectExistingLabels,
  applyPromote,
  applyLabelRenameMigration,
  type PromoteCandidate,
} from '../../src/middle/writing-promote';
import type { Element, WorldRegistryEntry } from '../../src/core/types';
import * as stateMod from '../../src/core/state';

function n(id: string, name: string, opts: Partial<Element & { parent_narrative: string; order: number; supertype: string | null }> = {}): Element {
  return {
    id,
    type: 'narrative',
    name,
    ...opts,
  } as unknown as Element;
}

const labels = { ...DEFAULT_WRITING_LABELS };

describe('isWritingInitialized', () => {
  it('returns true when entry has the explicit flag', () => {
    const entry = { id: 'w', name: 'w', state: 'local-only', writing_initialized: true } as unknown as WorldRegistryEntry;
    expect(isWritingInitialized(entry, [])).toBe(true);
  });

  it('returns true when there are no narratives at all', () => {
    const entry = { id: 'w', name: 'w', state: 'local-only' } as unknown as WorldRegistryEntry;
    expect(isWritingInitialized(entry, [])).toBe(true);
  });

  it('returns true when narratives exist but none have parent chains', () => {
    const entry = { id: 'w', name: 'w', state: 'local-only' } as unknown as WorldRegistryEntry;
    const elements = [n('a', 'A'), n('b', 'B')];
    expect(isWritingInitialized(entry, elements)).toBe(true);
  });

  it('returns false when structured narratives exist and arent yet promoted', () => {
    const entry = { id: 'w', name: 'w', state: 'local-only' } as unknown as WorldRegistryEntry;
    const elements = [
      n('a', 'Book A'),
      n('b', 'Chapter 1', { parent_narrative: 'a' }),
    ];
    expect(isWritingInitialized(entry, elements)).toBe(false);
  });

  it('returns true when every structured narrative already matches writing labels', () => {
    const entry = {
      id: 'w', name: 'w', state: 'local-only',
      writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' },
    } as unknown as WorldRegistryEntry;
    const elements = [
      n('a', 'Book A', { supertype: 'Book' }),
      n('b', 'Chapter 1', { supertype: 'Chapter', parent_narrative: 'a' }),
    ];
    expect(isWritingInitialized(entry, elements)).toBe(true);
  });
});

describe('buildPromoteCandidates', () => {
  it('includes only narratives that participate in a parent chain', () => {
    const elements = [
      n('book', 'Book A'),
      n('ch1', 'Chapter 1', { parent_narrative: 'book' }),
      n('lone', 'Loose narrative'),
    ];
    const candidates = buildPromoteCandidates(elements, labels);
    const ids = candidates.map(c => c.el.id);
    expect(ids).toContain('book');
    expect(ids).toContain('ch1');
    expect(ids).not.toContain('lone');
  });

  it('assigns depths 0/1/2 by traversal from roots', () => {
    const elements = [
      n('book', 'Book A'),
      n('ch1', 'Chapter 1', { parent_narrative: 'book' }),
      n('sc1', 'Scene 1', { parent_narrative: 'ch1' }),
    ];
    const candidates = buildPromoteCandidates(elements, labels);
    expect(candidates.find(c => c.el.id === 'book')?.depth).toBe(0);
    expect(candidates.find(c => c.el.id === 'ch1')?.depth).toBe(1);
    expect(candidates.find(c => c.el.id === 'sc1')?.depth).toBe(2);
  });

  it('proposed supertype matches the labels for the depth (drafts for depth 3+)', () => {
    const elements = [
      n('book', 'Book'),
      n('ch1', 'Chapter', { parent_narrative: 'book' }),
      n('sc1', 'Scene', { parent_narrative: 'ch1' }),
      n('deep', 'Deep', { parent_narrative: 'sc1' }),
    ];
    const candidates = buildPromoteCandidates(elements, labels);
    expect(candidates.find(c => c.el.id === 'book')?.proposedSupertype).toBe('Book');
    expect(candidates.find(c => c.el.id === 'ch1')?.proposedSupertype).toBe('Chapter');
    expect(candidates.find(c => c.el.id === 'sc1')?.proposedSupertype).toBe('Scene');
    expect(candidates.find(c => c.el.id === 'deep')?.proposedSupertype).toBe('Draft');
  });

  it('flags candidates needing order assignment', () => {
    const elements = [
      n('book', 'Book'),
      n('ch1', 'Chapter 1', { parent_narrative: 'book', order: 0 }),
      n('ch2', 'Chapter 2', { parent_narrative: 'book' }), // no order
    ];
    const candidates = buildPromoteCandidates(elements, labels);
    const ch2 = candidates.find(c => c.el.id === 'ch2')!;
    expect(ch2.needsOrder).toBe(true);
  });

  it('returns empty for purely loose narratives', () => {
    expect(buildPromoteCandidates([n('a', 'A'), n('b', 'B')], labels)).toEqual([]);
  });
});

describe('detectExistingLabels', () => {
  it('returns the supertype value when all candidates at a depth share it', () => {
    const cands: PromoteCandidate[] = [
      { el: n('a', 'A'), depth: 0, currentSupertype: 'Plot Arc', proposedSupertype: 'Book', needsOrder: false, proposedOrder: 0 },
      { el: n('b', 'B'), depth: 0, currentSupertype: 'Plot Arc', proposedSupertype: 'Book', needsOrder: false, proposedOrder: 1 },
    ];
    expect(detectExistingLabels(cands).l1).toBe('Plot Arc');
  });

  it('returns null when supertypes are mixed at a depth', () => {
    const cands: PromoteCandidate[] = [
      { el: n('a', 'A'), depth: 0, currentSupertype: 'Plot Arc', proposedSupertype: 'Book', needsOrder: false, proposedOrder: 0 },
      { el: n('b', 'B'), depth: 0, currentSupertype: 'Saga', proposedSupertype: 'Book', needsOrder: false, proposedOrder: 1 },
    ];
    expect(detectExistingLabels(cands).l1).toBeNull();
  });

  it('returns null when no candidates at a depth', () => {
    expect(detectExistingLabels([]).l1).toBeNull();
  });
});

describe('applyPromote', () => {
  it('writes supertype + order only when they differ', async () => {
    const updates: Array<{ id: string; patch: Partial<Element> }> = [];
    const store = {
      updateElement: vi.fn(async (id: string, patch: Partial<Element>) => {
        updates.push({ id, patch });
        return {} as Element;
      }),
    };
    const cands: PromoteCandidate[] = [
      { el: n('a', 'A'), depth: 0, currentSupertype: null, proposedSupertype: 'Book', needsOrder: true, proposedOrder: 0 },
      { el: n('b', 'B', { supertype: 'Book', order: 1 }), depth: 0, currentSupertype: 'Book', proposedSupertype: 'Book', needsOrder: false, proposedOrder: 1 },
      { el: n('c', 'C', { supertype: 'OldName' }), depth: 1, currentSupertype: 'OldName', proposedSupertype: 'Chapter', needsOrder: true, proposedOrder: 0 },
    ];
    const written = await applyPromote(store as never, cands);
    expect(written).toBe(2); // a and c, b is idempotent
    expect(updates.find(u => u.id === 'a')?.patch).toEqual({ supertype: 'Book', order: 0 });
    expect(updates.find(u => u.id === 'c')?.patch).toEqual({ supertype: 'Chapter', order: 0 });
    expect(updates.find(u => u.id === 'b')).toBeUndefined();
  });
});

describe('applyLabelRenameMigration', () => {
  it('rewrites supertype for narratives whose old supertype matches', async () => {
    const updates: Array<{ id: string; patch: Partial<Element> }> = [];
    const store = {
      updateElement: vi.fn(async (id: string, patch: Partial<Element>) => {
        updates.push({ id, patch });
        return {} as Element;
      }),
    };
    const elements = [
      n('a', 'A', { supertype: 'Book' }),
      n('b', 'B', { supertype: 'Chapter' }),
      n('c', 'C', { supertype: 'Unrelated' }),
    ];
    const oldLabels = { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' };
    const newLabels = { l1: 'Volume', l2: 'Chapter', l3: 'Scene', l4: 'Draft' };
    const written = await applyLabelRenameMigration(store as never, elements, oldLabels, newLabels);
    expect(written).toBe(1);
    expect(updates[0]).toEqual({ id: 'a', patch: { supertype: 'Volume' } });
  });

  it('no-ops when labels unchanged', async () => {
    const store = { updateElement: vi.fn() };
    const elements = [n('a', 'A', { supertype: 'Book' })];
    const labels = { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' };
    const written = await applyLabelRenameMigration(store as never, elements, labels, labels);
    expect(written).toBe(0);
    expect(store.updateElement).not.toHaveBeenCalled();
  });
});

describe('writingHashForNarrative', () => {
  it('builds the hash for a top-level book', () => {
    const elements = [n('b', 'Book A', { supertype: 'Book' })];
    expect(writingHashForNarrative('w1', 'b', elements)).toBe('#/w/w1/writing/book/b');
  });

  it('builds the hash for a chapter under a book', () => {
    const elements = [
      n('b', 'Book A', { supertype: 'Book' }),
      n('c', 'Chapter 1', { supertype: 'Chapter', parent_narrative: 'b' }),
    ];
    expect(writingHashForNarrative('w1', 'c', elements)).toBe('#/w/w1/writing/book/b/chapter/c');
  });

  it('builds the hash for a scene under a chapter under a book', () => {
    const elements = [
      n('b', 'Book A', { supertype: 'Book' }),
      n('c', 'Chapter 1', { supertype: 'Chapter', parent_narrative: 'b' }),
      n('s', 'Scene 1', { supertype: 'Scene', parent_narrative: 'c' }),
    ];
    expect(writingHashForNarrative('w1', 's', elements)).toBe('#/w/w1/writing/book/b/chapter/c/scene/s');
  });

  it('handles narratives with a broken parent chain by truncating', () => {
    const elements = [
      // chapter pointing at a missing book id
      n('c', 'Orphan Chapter', { supertype: 'Chapter', parent_narrative: 'ghost' }),
    ];
    // Walks up, finds no valid ancestor → treats c as a root.
    expect(writingHashForNarrative('w1', 'c', elements)).toBe('#/w/w1/writing/book/c');
  });

  it('returns the base writing path when the narrative is absent', () => {
    const elements = [n('b', 'Book A', { supertype: 'Book' })];
    expect(writingHashForNarrative('w1', 'nonexistent', elements)).toBe('#/w/w1/writing/book/nonexistent');
  });
});

describe('isWritingNarrative + getTierForNarrative', () => {
  // These read from state.registry via getWritingLabels, so we stub
  // getState to inject a known registry.
  beforeEach(() => {
    vi.spyOn(stateMod, 'getState').mockReturnValue({
      registry: {
        version: 1,
        worlds: [{
          id: 'w1',
          name: 'World',
          state: 'local-only',
          writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' },
        }],
      },
      data: { elements: [] },
      ui: {} as never,
      sync: { byWorld: {}, activeSync: null },
      atlasRoot: undefined,
      active: null,
    } as never);
  });

  it('classifies by supertype matching one of l1-l4', () => {
    expect(getTierForNarrative(n('a', 'A', { supertype: 'Book' }), 'w1')).toBe('l1');
    expect(getTierForNarrative(n('a', 'A', { supertype: 'Chapter' }), 'w1')).toBe('l2');
    expect(getTierForNarrative(n('a', 'A', { supertype: 'Scene' }), 'w1')).toBe('l3');
    expect(getTierForNarrative(n('a', 'A', { supertype: 'Draft' }), 'w1')).toBe('l4');
    expect(getTierForNarrative(n('a', 'A', { supertype: 'Vision' }), 'w1')).toBeNull();
    expect(getTierForNarrative(n('a', 'A'), 'w1')).toBeNull();

    expect(isWritingNarrative(n('a', 'A', { supertype: 'Book' }), 'w1')).toBe(true);
    expect(isWritingNarrative(n('a', 'A', { supertype: 'Vision' }), 'w1')).toBe(false);
  });
});

// ====== Tree building (F24 — locks behavior before writing-workspace redesign) ======

describe('buildNarrativeIndex', () => {
  beforeEach(() => {
    vi.spyOn(stateMod, 'getState').mockReturnValue({
      registry: {
        version: 1,
        worlds: [{
          id: 'w1',
          name: 'World',
          state: 'local-only',
          writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' },
        }],
      },
      data: { elements: [] },
      ui: {} as never,
      sync: { byWorld: {}, activeSync: null },
      atlasRoot: undefined,
      active: null,
    } as never);
  });

  it('filters out narratives without a writing supertype', () => {
    const elements = [
      n('a', 'In tree', { supertype: 'Book' }),
      n('b', 'Free narrative'),                  // no supertype → excluded
      n('c', 'Vision', { supertype: 'Vision' }), // non-writing supertype → excluded
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    expect(idx.byId.size).toBe(1);
    expect(idx.byId.has('a')).toBe(true);
    expect(idx.byId.has('b')).toBe(false);
    expect(idx.byId.has('c')).toBe(false);
    expect(idx.roots).toHaveLength(1);
    expect(idx.roots[0].el.id).toBe('a');
  });

  it('builds parent → child links and assigns depth via BFS', () => {
    const elements = [
      n('book', 'B', { supertype: 'Book' }),
      n('ch1', 'C1', { supertype: 'Chapter', parent_narrative: 'book', order: 0 }),
      n('ch2', 'C2', { supertype: 'Chapter', parent_narrative: 'book', order: 1 }),
      n('sc1', 'S1', { supertype: 'Scene', parent_narrative: 'ch1' }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    const book = idx.byId.get('book')!;
    expect(book.depth).toBe(0);
    expect(book.children.map(c => c.el.id)).toEqual(['ch1', 'ch2']);
    expect(idx.byId.get('ch1')!.depth).toBe(1);
    expect(idx.byId.get('sc1')!.depth).toBe(2);
    expect(idx.byId.get('ch1')!.children[0].el.id).toBe('sc1');
  });

  it('sorts siblings by order then by name', () => {
    const elements = [
      n('book', 'B', { supertype: 'Book' }),
      // Intentionally out of order on input; sort should reorder.
      n('ch3', 'Gamma', { supertype: 'Chapter', parent_narrative: 'book', order: 2 }),
      n('ch1', 'Alpha', { supertype: 'Chapter', parent_narrative: 'book', order: 0 }),
      n('ch2', 'Beta',  { supertype: 'Chapter', parent_narrative: 'book', order: 1 }),
      // Order ties → fall back to name ascending.
      n('ch4', 'Aardvark', { supertype: 'Chapter', parent_narrative: 'book', order: 0 }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    const children = idx.byId.get('book')!.children.map(c => c.el.id);
    // ch4 (order 0, name 'Aardvark') comes before ch1 (order 0, name 'Alpha') by name.
    expect(children).toEqual(['ch4', 'ch1', 'ch2', 'ch3']);
  });

  it('treats narratives with a missing parent as roots (broken-parent recovery)', () => {
    const elements = [
      n('orphan', 'Orphan', { supertype: 'Scene', parent_narrative: 'gone' }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    // Even though parent_narrative is set, the parent isn't in the index;
    // the node should fall back to root rather than be dropped.
    expect(idx.roots.map(r => r.el.id)).toEqual(['orphan']);
    expect(idx.byId.get('orphan')!.depth).toBe(0);
  });

  it('handles drafts as roots OR nested children depending on parent_narrative', () => {
    const elements = [
      n('book', 'B', { supertype: 'Book' }),
      n('rootDraft', 'Root draft', { supertype: 'Draft' }),                              // root l4
      n('childDraft', 'Child draft', { supertype: 'Draft', parent_narrative: 'book' }),  // nested l4
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    expect(idx.roots.map(r => r.el.id).sort()).toEqual(['book', 'rootDraft']);
    expect(idx.byId.get('book')!.children.map(c => c.el.id)).toEqual(['childDraft']);
    expect(idx.byId.get('childDraft')!.tier).toBe('l4');
  });
});

describe('ancestorIds', () => {
  beforeEach(() => {
    vi.spyOn(stateMod, 'getState').mockReturnValue({
      registry: {
        version: 1,
        worlds: [{
          id: 'w1', name: 'World', state: 'local-only',
          writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' },
        }],
      },
      data: { elements: [] },
      ui: {} as never,
      sync: { byWorld: {}, activeSync: null },
      atlasRoot: undefined,
      active: null,
    } as never);
  });

  it('returns empty for a root narrative', () => {
    const idx = buildNarrativeIndex([n('book', 'B', { supertype: 'Book' })], 'w1');
    expect(ancestorIds(idx, 'book')).toEqual([]);
  });

  it('walks parent chain closest-first', () => {
    const elements = [
      n('book', 'B', { supertype: 'Book' }),
      n('ch1', 'C1', { supertype: 'Chapter', parent_narrative: 'book' }),
      n('sc1', 'S1', { supertype: 'Scene', parent_narrative: 'ch1' }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    expect(ancestorIds(idx, 'sc1')).toEqual(['ch1', 'book']);
    expect(ancestorIds(idx, 'ch1')).toEqual(['book']);
  });

  it('stops walking when parent leaves the index', () => {
    const elements = [
      n('orphan', 'O', { supertype: 'Scene', parent_narrative: 'gone' }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    // parent_narrative='gone' is in the orphan, but 'gone' isn't in the
    // index. The walker pushes 'gone' then breaks.
    expect(ancestorIds(idx, 'orphan')).toEqual(['gone']);
  });

  it('returns empty for unknown id', () => {
    const idx = buildNarrativeIndex([], 'w1');
    expect(ancestorIds(idx, 'does-not-exist')).toEqual([]);
  });
});

describe('findAncestry', () => {
  beforeEach(() => {
    vi.spyOn(stateMod, 'getState').mockReturnValue({
      registry: {
        version: 1,
        worlds: [{
          id: 'w1', name: 'World', state: 'local-only',
          writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' },
        }],
      },
      data: { elements: [] },
      ui: {} as never,
      sync: { byWorld: {}, activeSync: null },
      atlasRoot: undefined,
      active: null,
    } as never);
  });

  it('assigns book/chapter/scene by depth', () => {
    const elements = [
      n('book', 'B', { supertype: 'Book' }),
      n('ch1', 'C1', { supertype: 'Chapter', parent_narrative: 'book' }),
      n('sc1', 'S1', { supertype: 'Scene', parent_narrative: 'ch1' }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    expect(findAncestry(idx, 'sc1')).toEqual({ bookId: 'book', chapterId: 'ch1', sceneId: 'sc1' });
    expect(findAncestry(idx, 'ch1')).toEqual({ bookId: 'book', chapterId: 'ch1' });
    expect(findAncestry(idx, 'book')).toEqual({ bookId: 'book' });
  });

  it('returns empty object for unknown id', () => {
    const idx = buildNarrativeIndex([], 'w1');
    expect(findAncestry(idx, 'nope')).toEqual({});
  });
});

describe('nextOrder', () => {
  beforeEach(() => {
    vi.spyOn(stateMod, 'getState').mockReturnValue({
      registry: {
        version: 1,
        worlds: [{
          id: 'w1', name: 'World', state: 'local-only',
          writing_labels: { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' },
        }],
      },
      data: { elements: [] },
      ui: {} as never,
      sync: { byWorld: {}, activeSync: null },
      atlasRoot: undefined,
      active: null,
    } as never);
  });

  it('returns 0 when no siblings exist', () => {
    const idx = buildNarrativeIndex([], 'w1');
    expect(nextOrder(idx, null)).toBe(0);
  });

  it('returns max(existing) + 1 among root siblings', () => {
    const elements = [
      n('a', 'A', { supertype: 'Book', order: 0 }),
      n('b', 'B', { supertype: 'Book', order: 1 }),
      n('c', 'C', { supertype: 'Book', order: 5 }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    expect(nextOrder(idx, null)).toBe(6);
  });

  it('scopes by parentId when provided', () => {
    const elements = [
      n('book', 'B', { supertype: 'Book', order: 0 }),
      n('ch1', 'C1', { supertype: 'Chapter', parent_narrative: 'book', order: 0 }),
      n('ch2', 'C2', { supertype: 'Chapter', parent_narrative: 'book', order: 2 }),
    ];
    const idx = buildNarrativeIndex(elements, 'w1');
    // Among book's children, the highest order is 2 → next is 3.
    expect(nextOrder(idx, 'book')).toBe(3);
    // Root sibling group has just 'book' at order 0 → next is 1.
    expect(nextOrder(idx, null)).toBe(1);
  });
});
