/**
 * Tests for the narrative-deletion summary kernel (Bout W).
 *
 * The load-bearing test in this file is AGREEMENT: the kernel's descendant walk
 * must return exactly what the store's cascade actually deletes. The kernel's
 * count is a PROMISE to the user about what is about to be destroyed, and a
 * promise that drifts from its subject is worse than no promise at all — so the
 * invariant opens BOTH files rather than comparing the kernel to a copy of
 * itself (the vacuous-invariant lesson).
 */

import { describe, it, expect } from 'vitest';
import {
  summarizeNarrativeDeletion,
  collectNarrativeDescendants,
  narrativeDeleteConfirmMessage,
  pluralizeLabel,
  tierFromSupertype,
} from '../../src/core/narrative-delete';
import { DEFAULT_WRITING_LABELS, type WritingLabels } from '../../src/middle/writing-helpers';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import type { Element } from '../../src/core/types';

const L: WritingLabels = DEFAULT_WRITING_LABELS; // Book / Chapter / Scene / Draft

function narrative(id: string, supertype: string | null, parent?: string): Element {
  return {
    id,
    type: 'narrative',
    name: id,
    supertype,
    ...(parent ? { parent_narrative: parent } : {}),
  } as unknown as Element;
}

function pin(id: string, elementId: string): Element {
  return { id, type: 'pin', name: id, element_id: elementId } as unknown as Element;
}

/** Book > 2 chapters; chapter A has 3 scenes, chapter B has 1. Plus a loose book. */
function standardWorld(): Element[] {
  return [
    narrative('book', L.l1),
    narrative('chA', L.l2, 'book'),
    narrative('chB', L.l2, 'book'),
    narrative('s1', L.l3, 'chA'),
    narrative('s2', L.l3, 'chA'),
    narrative('s3', L.l3, 'chA'),
    narrative('s4', L.l3, 'chB'),
    narrative('other-book', L.l1),
    narrative('unrelated-scene', L.l3, 'other-book'),
  ];
}

describe('collectNarrativeDescendants', () => {
  it('collects the whole subtree, not just direct children', () => {
    const ids = collectNarrativeDescendants(standardWorld(), 'book');
    expect(new Set(ids)).toEqual(new Set(['chA', 'chB', 's1', 's2', 's3', 's4']));
  });

  it('does not reach into a sibling subtree', () => {
    const ids = collectNarrativeDescendants(standardWorld(), 'chB');
    expect(ids).toEqual(['s4']);
  });

  it('returns empty for a leaf', () => {
    expect(collectNarrativeDescendants(standardWorld(), 's1')).toEqual([]);
  });

  it('terminates on a parent cycle instead of hanging', () => {
    // A malformed folder (or hand-edited JSON) can contain a cycle. If this
    // test hangs, the seen-set guard has been removed.
    const cyclic = [
      narrative('a', L.l1, 'b'),
      narrative('b', L.l2, 'a'),
    ];
    const ids = collectNarrativeDescendants(cyclic, 'a');
    expect(ids).toEqual(['b']);
  });

  it('survives a self-parenting narrative without deleting it twice', () => {
    const selfish = [narrative('solo', L.l1, 'solo')];
    expect(collectNarrativeDescendants(selfish, 'solo')).toEqual([]);
  });

  it('ignores a dangling parent_narrative pointing at a missing element', () => {
    const orphaned = [narrative('ghost-child', L.l3, 'no-such-id')];
    expect(collectNarrativeDescendants(orphaned, 'no-such-id')).toEqual(['ghost-child']);
  });
});

describe('AGREEMENT with the store cascade (the invariant that matters)', () => {
  it('kernel descendants match exactly what MockFolderStore.findDependents deletes', async () => {
    const world = standardWorld();
    const store = new MockFolderStore();
    for (const el of world) await store.createElement(el.type, el);

    const storeDeps = await store.findDependents('book');
    const storeIds = new Set(storeDeps.map(d => d.id));
    const kernelIds = new Set(collectNarrativeDescendants(world, 'book'));

    expect(kernelIds).toEqual(storeIds);
  });

  it('agrees when pins hang off descendants too', async () => {
    const world = [...standardWorld(), pin('p1', 's1'), pin('p2', 'book'), pin('p3', 'unrelated-scene')];
    const store = new MockFolderStore();
    for (const el of world) await store.createElement(el.type, el);

    const storeIds = new Set((await store.findDependents('book')).map(d => d.id));
    const summary = summarizeNarrativeDeletion(world, 'book', L);
    // The kernel splits narratives from pins; their union is the store's set.
    const kernelIds = new Set<string>(summary.descendantIds);
    for (const p of ['p1', 'p2']) kernelIds.add(p);

    expect(kernelIds).toEqual(storeIds);
    expect(summary.pins).toBe(2);          // p3 belongs to another book
    expect(summary.total).toBe(8);         // 6 narratives + 2 pins
  });

  it('counts an OFF-TREE descendant that the writing tree cannot see', async () => {
    // DESIGN_WRITING.md: free-texting the supertype removes a narrative from
    // the writing tree. The CASCADE still deletes it. A tree-based counter
    // would under-report and destroy prose the sentence never mentioned.
    const world = [...standardWorld(), narrative('freetexted', 'Interlude', 'chA')];
    const store = new MockFolderStore();
    for (const el of world) await store.createElement(el.type, el);

    const storeIds = new Set((await store.findDependents('book')).map(d => d.id));
    expect(storeIds.has('freetexted')).toBe(true);   // the store really does delete it

    const summary = summarizeNarrativeDeletion(world, 'book', L);
    expect(summary.descendantIds).toContain('freetexted');
    expect(summary.offTree).toBe(1);
    expect(summary.sentence).toContain('1 other narrative');
  });
});

describe('tierFromSupertype', () => {
  it('resolves each configured label to its tier key', () => {
    expect(tierFromSupertype(narrative('a', L.l1), L)).toBe('l1');
    expect(tierFromSupertype(narrative('a', L.l4), L)).toBe('l4');
  });

  it('returns null for a free-texted supertype and for a missing one', () => {
    expect(tierFromSupertype(narrative('a', 'Interlude'), L)).toBeNull();
    expect(tierFromSupertype(narrative('a', null), L)).toBeNull();
  });

  it('resolves against RENAMED labels, not the defaults', () => {
    const custom: WritingLabels = { l1: 'Part', l2: 'Episode', l3: 'Beat', l4: 'Note' };
    expect(tierFromSupertype(narrative('a', 'Episode'), custom)).toBe('l2');
    expect(tierFromSupertype(narrative('a', 'Chapter'), custom)).toBeNull();
  });
});

describe('pluralizeLabel', () => {
  it('never pluralizes at a count of one', () => {
    expect(pluralizeLabel('Chapter', 1)).toBe('Chapter');
    expect(pluralizeLabel('Story', 1)).toBe('Story');
  });

  it('handles regular, y-ending, sibilant and already-plural labels', () => {
    expect(pluralizeLabel('Chapter', 3)).toBe('Chapters');
    expect(pluralizeLabel('Story', 3)).toBe('Stories');
    expect(pluralizeLabel('Sketch', 3)).toBe('Sketches');
    expect(pluralizeLabel('Notes', 3)).toBe('Notes');
  });

  it('does not mangle a vowel-y label', () => {
    expect(pluralizeLabel('Essay', 2)).toBe('Essays');
  });

  it('tolerates a label the user typed with padding', () => {
    expect(pluralizeLabel('  Part  ', 2)).toBe('Parts');
  });
});

describe('summarizeNarrativeDeletion + confirm message', () => {
  it('counts by tier and speaks the user vocabulary', () => {
    const s = summarizeNarrativeDeletion(standardWorld(), 'book', L);
    expect(s.byTier).toEqual({ l1: 0, l2: 2, l3: 4, l4: 0 });
    expect(s.total).toBe(6);
    expect(s.sentence).toBe('This also deletes 2 chapters and 4 scenes.');
  });

  it('uses RENAMED labels in the sentence', () => {
    const custom: WritingLabels = { l1: 'Part', l2: 'Episode', l3: 'Beat', l4: 'Note' };
    const world = [
      narrative('p', 'Part'),
      narrative('e1', 'Episode', 'p'),
      narrative('b1', 'Beat', 'e1'),
      narrative('b2', 'Beat', 'e1'),
    ];
    const s = summarizeNarrativeDeletion(world, 'p', custom);
    expect(s.sentence).toBe('This also deletes 1 episode and 2 beats.');
  });

  it('is singular at exactly one child', () => {
    const world = [narrative('book', L.l1), narrative('only', L.l2, 'book')];
    const s = summarizeNarrativeDeletion(world, 'book', L);
    expect(s.sentence).toBe('This also deletes 1 chapter.');
    expect(narrativeDeleteConfirmMessage('Book One', s))
      .toBe('Delete "Book One"? This also deletes 1 chapter. This cannot be undone.');
  });

  it('says nothing extra for a childless narrative', () => {
    const s = summarizeNarrativeDeletion(standardWorld(), 's1', L);
    expect(s.total).toBe(0);
    expect(s.sentence).toBe('');
    expect(narrativeDeleteConfirmMessage('Scene one', s)).toBe('Delete "Scene one"? This cannot be undone.');
  });

  it('names drafts nested under a chapter (the flexible tier)', () => {
    const world = [
      narrative('book', L.l1),
      narrative('ch', L.l2, 'book'),
      narrative('d1', L.l4, 'ch'),
      narrative('d2', L.l4, 'd1'),   // a draft under a draft — l4 nests freely
    ];
    const s = summarizeNarrativeDeletion(world, 'book', L);
    expect(s.byTier.l4).toBe(2);
    expect(s.sentence).toBe('This also deletes 1 chapter and 2 drafts.');
  });

  it('joins three or more clauses with commas and a final and', () => {
    const world = [
      narrative('book', L.l1),
      narrative('ch', L.l2, 'book'),
      narrative('sc', L.l3, 'ch'),
      narrative('dr', L.l4, 'ch'),
      pin('p', 'sc'),
    ];
    const s = summarizeNarrativeDeletion(world, 'book', L);
    expect(s.sentence).toBe('This also deletes 1 chapter, 1 scene, 1 draft and 1 pin.');
  });

  it('falls back to a generic subject for an unnamed narrative', () => {
    const s = summarizeNarrativeDeletion(standardWorld(), 's1', L);
    expect(narrativeDeleteConfirmMessage('   ', s)).toBe('Delete this narrative? This cannot be undone.');
  });

  it('carries no em-dash (house voice law)', () => {
    const s = summarizeNarrativeDeletion(standardWorld(), 'book', L);
    expect(narrativeDeleteConfirmMessage('Book One', s)).not.toContain('—');
  });
});
