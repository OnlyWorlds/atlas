/**
 * The confirm-floor rule (S310, Bout W).
 *
 * The load-bearing case in this file is `confirmPref: false` with a cascade:
 * before S310 that combination deleted an entire manuscript with no dialog at
 * all (verified live — 8 of 9 elements destroyed on one click). Every other
 * test here is scaffolding around that one.
 */

import { describe, it, expect } from 'vitest';
import { decideDeleteConfirm } from '../../src/core/delete-confirm';
import { DEFAULT_WRITING_LABELS, type WritingLabels } from '../../src/middle/writing-helpers';
import type { Element } from '../../src/core/types';

const L: WritingLabels = DEFAULT_WRITING_LABELS;

function narrative(id: string, supertype: string | null, parent?: string): Element {
  return {
    id, type: 'narrative', name: id, supertype,
    ...(parent ? { parent_narrative: parent } : {}),
  } as unknown as Element;
}
function map(id: string): Element {
  return { id, type: 'map', name: id } as unknown as Element;
}
function pin(id: string, elementId?: string): Element {
  return { id, type: 'pin', name: id, element_id: elementId } as unknown as Element;
}

/** Book > 2 chapters > 4 scenes — the shape from the live repro. */
const MANUSCRIPT: Element[] = [
  narrative('book', L.l1),
  narrative('ch1', L.l2, 'book'),
  narrative('ch2', L.l2, 'book'),
  narrative('s1', L.l3, 'ch1'),
  narrative('s2', L.l3, 'ch1'),
  narrative('s3', L.l3, 'ch2'),
  narrative('s4', L.l3, 'ch2'),
];
const MANUSCRIPT_DEPS = MANUSCRIPT.filter(e => e.id !== 'book');

describe('the confirm FLOOR (the thing this module exists for)', () => {
  it('CONFIRMS a cascading delete even when the user turned confirmations off', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[0],
      dependents: MANUSCRIPT_DEPS,
      allElements: MANUSCRIPT,
      labels: L,
      confirmPref: false,          // <- the setting is OFF
    });
    expect(d.needed).toBe(true);
    expect(d.cascades).toBe(true);
    expect(d.message).toBe(
      'Delete "book"? This also deletes 2 chapters and 4 scenes. This cannot be undone.',
    );
  });

  it('still honours the preference for a NON-cascading delete', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[3],           // a lone scene
      dependents: [],
      allElements: MANUSCRIPT,
      labels: L,
      confirmPref: false,
    });
    expect(d.needed).toBe(false);
    expect(d.cascades).toBe(false);
    expect(d.message).toBe('');
  });

  it('confirms a non-cascading delete when the preference is on', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[3],
      dependents: [],
      allElements: MANUSCRIPT,
      labels: L,
      confirmPref: true,
    });
    expect(d.needed).toBe(true);
    expect(d.message).toBe('Delete "s1"? This cannot be undone.');
  });

  it('applies the floor to NON-narrative cascades too (a map with pins)', () => {
    // Same class, same silent loss: deleting a map sweeps its pins.
    const world = [map('m1'), pin('p1'), pin('p2'), pin('p3')];
    const d = decideDeleteConfirm({
      el: world[0],
      dependents: [world[1], world[2], world[3]],
      allElements: world,
      labels: L,
      confirmPref: false,
    });
    expect(d.needed).toBe(true);
    expect(d.message).toBe(
      'Delete "m1"? This also deletes 3 elements filed under it. This cannot be undone.',
    );
  });

  it('is singular in the generic branch at exactly one dependent', () => {
    const world = [map('m1'), pin('p1')];
    const d = decideDeleteConfirm({
      el: world[0], dependents: [world[1]], allElements: world, labels: L, confirmPref: false,
    });
    expect(d.message).toContain('1 element filed under it.');
    expect(d.message).not.toContain('1 elements');
  });
});

describe('narrative vocabulary', () => {
  it('speaks the user renamed labels', () => {
    const custom: WritingLabels = { l1: 'Part', l2: 'Episode', l3: 'Beat', l4: 'Note' };
    const world = [
      narrative('p', 'Part'),
      narrative('e1', 'Episode', 'p'),
      narrative('b1', 'Beat', 'e1'),
    ];
    const d = decideDeleteConfirm({
      el: world[0], dependents: [world[1], world[2]], allElements: world, labels: custom, confirmPref: true,
    });
    expect(d.message).toBe('Delete "p"? This also deletes 1 episode and 1 beat. This cannot be undone.');
  });

  it('names an off-tree descendant the writing tree cannot show', () => {
    const world = [...MANUSCRIPT, narrative('interlude', 'Interlude', 'ch1')];
    const d = decideDeleteConfirm({
      el: world[0],
      dependents: [...MANUSCRIPT_DEPS, world[world.length - 1]],
      allElements: world,
      labels: L,
      confirmPref: true,
    });
    expect(d.message).toContain('1 other narrative');
  });

  it('falls back to the generic branch when the store reports dependents the tier walk cannot explain', () => {
    // Defensive: if the two walkers ever disagree, we must still WARN. A
    // narrative with no narrative-children but a pin dependent lands here.
    const world = [narrative('lone', L.l3), pin('p1', 'lone')];
    const d = decideDeleteConfirm({
      el: world[0], dependents: [world[1]], allElements: world, labels: L, confirmPref: false,
    });
    expect(d.needed).toBe(true);
    expect(d.message).toContain('pin');   // the kernel counts pins, so it speaks them
  });
});

describe('copy hygiene', () => {
  it('never emits an em-dash (house voice law)', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[0], dependents: MANUSCRIPT_DEPS, allElements: MANUSCRIPT, labels: L, confirmPref: true,
    });
    expect(d.message).not.toContain('—');
  });

  it('warns that the loss is permanent whenever anything cascades', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[0], dependents: MANUSCRIPT_DEPS, allElements: MANUSCRIPT, labels: L, confirmPref: true,
    });
    expect(d.message).toContain('This cannot be undone.');
  });

  it('says "this element" when the name is blank, never the id', () => {
    const nameless = { id: 'abc-123', type: 'narrative', name: '', supertype: L.l3 } as unknown as Element;
    const d = decideDeleteConfirm({
      el: nameless, dependents: [], allElements: [nameless], labels: L, confirmPref: true,
    });
    expect(d.message).toBe('Delete this element? This cannot be undone.');
  });
});

/**
 * S323 — "we could not look" is not "there is nothing there".
 *
 * `findDependents` can throw. The caller swallowed it and passed an empty
 * array, which makes `cascades` false, which switches OFF the S310 confirm
 * floor — so with `confirm_before_delete` turned off, a failed probe deleted
 * a whole subtree with no prompt at all, while the store went on cascading by
 * default. The unknown case now always asks and says why.
 */
describe('unknown blast radius', () => {
  it('confirms even when the preference is off and the list came back empty', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[0],
      dependents: [],
      dependentsUnknown: true,
      allElements: MANUSCRIPT,
      labels: L,
      confirmPref: false,
    });
    expect(d.needed).toBe(true);
    expect(d.cascades).toBe(true);
  });

  it('says plainly that the check failed rather than implying nothing else dies', () => {
    const d = decideDeleteConfirm({
      el: MANUSCRIPT[0],
      dependents: [],
      dependentsUnknown: true,
      allElements: MANUSCRIPT,
      labels: L,
      confirmPref: true,
    });
    expect(d.message).toContain('could not check');
    expect(d.message).toContain('This cannot be undone.');
    expect(d.message).not.toContain('—');
  });

  it('is not triggered on a successful probe that genuinely found nothing', () => {
    const lone = { id: 'lone-1', type: 'character', name: 'Alone' } as unknown as Element;
    const d = decideDeleteConfirm({
      el: lone, dependents: [], allElements: [lone], labels: L, confirmPref: false,
    });
    expect(d.needed).toBe(false);
    expect(d.cascades).toBe(false);
  });
});
