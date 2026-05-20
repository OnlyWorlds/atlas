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
