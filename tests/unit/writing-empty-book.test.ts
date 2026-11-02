/**
 * The writing room's empty Book (1.121.0, `emptyBookLine`): derived, no stored flag. A Book with no part at
 * the second tier says what a part can be, in the world's own labels; nothing once a part exists, for a
 * Book with only a Draft still something, and nothing for a Chapter, a Scene, a Draft or a view-only world.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../src/core/types';
import { emptyBookLine } from '../../src/middle/writing-helpers';

const W = 'w-empty-book';
const n = (id: string, supertype: string, parent?: string) =>
  ({ id, type: 'narrative', name: id, supertype, ...(parent ? { parent_narrative: parent } : {}) }) as unknown as Element;
function world(entry: Partial<WorldRegistryEntry> = {}): void {
  patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: W, name: 'W', state: 'local-only', ...entry } as WorldRegistryEntry] });
}
afterEach(() => patchSlice('registry', defaultRegistry()));

describe('emptyBookLine', () => {
  it('a Book with no chapter says what a chapter can be', () => {
    world();
    const book = n('b', 'Book');
    expect(emptyBookLine(book, [book], W, false)).toBe('A chapter can be any part you like: a chapter, an act, a session. Press + to add one.');
  });
  it('goes once a chapter exists', () => {
    world();
    const book = n('b', 'Book');
    expect(emptyBookLine(book, [book, n('c', 'Chapter', 'b')], W, false)).toBeNull();
  });
  it('a Draft is not a part: a Book with only a Draft still says it', () => {
    world();
    const book = n('b', 'Book');
    expect(emptyBookLine(book, [book, n('d', 'Draft', 'b')], W, false)).not.toBeNull();
  });
  it('the world\'s own labels, with their article', () => {
    world({ writing_labels: { l1: 'Saga', l2: 'Act', l3: 'Scene', l4: 'Draft' } } as never);
    const saga = n('s', 'Saga');
    expect(emptyBookLine(saga, [saga], W, false)).toBe('An act can be any part you like: a chapter, an act, a session. Press + to add one.');
    expect(emptyBookLine(saga, [saga, n('a', 'Act', 's')], W, false)).toBeNull();
  });
  it('any Book, not only the strand\'s story; nothing for a Chapter, a Scene, a Draft or a narrative outside the tree', () => {
    world();
    expect(emptyBookLine(n('c', 'Chapter'), [n('c', 'Chapter')], W, false)).toBeNull();
    expect(emptyBookLine(n('s', 'Scene'), [n('s', 'Scene')], W, false)).toBeNull();
    expect(emptyBookLine(n('d', 'Draft'), [n('d', 'Draft')], W, false)).toBeNull();
    expect(emptyBookLine(n('x', 'Legend'), [n('x', 'Legend')], W, false)).toBeNull();
  });
  it('nothing in a view-only world', () => {
    world();
    const book = n('b', 'Book');
    expect(emptyBookLine(book, [book], W, true)).toBeNull();
  });
});
