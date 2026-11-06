/**
 * A view-only world skips "Set up writing" when the default labels read its
 * tree (1.123): every chain's root is a Book, every chain member carries a
 * default label or sits under one that does, and no labelled member sits
 * under an unlabelled one. Blood Meridian's shape (Book › Chapter › six
 * Scenes, a Telling under a Scene, a Memoir and a First page loose) skips;
 * a chain rooted in a non-Book, a middle tier in other words, or a world with
 * labels of its own shows the setup; a writer's own world is unchanged. And
 * the writing link's landing: in the tree, under it, outside it, missing.
 */
import { describe, it, expect } from 'vitest';
import { isWritingInitialized, writingLandingFor, writingOutsideLine } from '../../src/middle/writing-helpers';
import type { Element, WorldRegistryEntry } from '../../src/core/types';

function n(id: string, name: string, supertype: string | null, parent: string | null = null, order?: number): Element {
  return { id, type: 'narrative', name, supertype, parent_narrative: parent, ...(order !== undefined ? { order } : {}) } as unknown as Element;
}

const BOOK = 'book', CH1 = 'ch1', TELLING = 'telling';
/** Blood Meridian's narratives as keel's public reader serves them (probed 2026-11-06). */
const bloodMeridian: Element[] = [
  n('memoir', 'My Confession', 'Memoir'),
  n(BOOK, 'Blood Meridian (the novel)', 'Book'),
  n('first', "Green's revival in the rain", 'First page'),
  n(CH1, 'Chapter I', 'Chapter', BOOK, 1),
  n('s1', 'The child', 'Scene', CH1, 1),
  n('s2', 'The night he was born', 'Scene', CH1, 2),
  n('s3', 'The way south', 'Scene', CH1, 3),
  n('s4', 'New Orleans', 'Scene', CH1, 4),
  n('s5', 'Divested', 'Scene', CH1, 5),
  n('s6', 'Texas', 'Scene', CH1, 6),
  n(TELLING, "The father's telling", 'Telling', 's2', 1),
];

const copy = { id: 'c', name: 'Blood Meridian', state: 'local-only', copy_of: { world_id: 'w', at: '2026-11-06T10:00:00Z' } } as unknown as WorldRegistryEntry;
const readKey = { id: 'r', name: 'R', state: 'api-linked', api: { world_id: 'w', read_only: true } } as unknown as WorldRegistryEntry;
const own = { id: 'o', name: 'Own', state: 'local-only' } as unknown as WorldRegistryEntry;

describe('R7: the defaults read a view-only world\'s tree', () => {
  it('Blood Meridian\'s shape skips the setup, as a copy and on a read key', () => {
    expect(isWritingInitialized(copy, bloodMeridian)).toBe(true);
    expect(isWritingInitialized(readKey, bloodMeridian)).toBe(true);
  });

  it('a writer\'s own world is unchanged: the Telling still asks for the setup there', () => {
    expect(isWritingInitialized(own, bloodMeridian)).toBe(false);
  });

  it('a chain rooted in a non-Book shows the setup', () => {
    const saga = [n('a', 'Saga', 'Saga'), n('b', 'Chapter 1', 'Chapter', 'a'), n('c', 'Scene 1', 'Scene', 'b')];
    expect(isWritingInitialized(copy, saga)).toBe(false);
    // A root with no label at all, too.
    expect(isWritingInitialized(copy, [n('a', 'A', null), n('b', 'Chapter 1', 'Chapter', 'a')])).toBe(false);
    // And a root that carries a default label, but not the Book's (a chain all
    // in default words opens without the setup on any world, as before 1.123).
    expect(isWritingInitialized(copy, [n('a', 'Chapter 1', 'Chapter'), n('b', 'Scene 1', 'Scene', 'a'), n('c', 'Aside', 'Telling', 'b')])).toBe(false);
  });

  it('a middle tier in other words shows the setup (it would cut the tree)', () => {
    const parts = [n('a', 'Book', 'Book'), n('b', 'Part one', 'Part', 'a'), n('c', 'Scene 1', 'Scene', 'b')];
    expect(isWritingInitialized(copy, parts)).toBe(false);
  });

  it('labels of the world\'s own are not the defaults: the setup', () => {
    const relabelled = { ...copy, writing_labels: { l1: 'Volume' } } as unknown as WorldRegistryEntry;
    expect(isWritingInitialized(relabelled, bloodMeridian)).toBe(false);
  });

  it('exactly the default words: "book" is not "Book"', () => {
    expect(isWritingInitialized(copy, [n('a', 'A', 'book'), n('b', 'B', 'Chapter', 'a')])).toBe(false);
  });
});

describe('a writing link\'s landing in the room', () => {
  const W = 'local-copy';

  it('a narrative in the tree lands on itself', () => {
    expect(writingLandingFor(bloodMeridian, CH1, W)).toEqual({ narrativeId: CH1, line: null });
  });

  it('no narrative is the room\'s start', () => {
    expect(writingLandingFor(bloodMeridian, null, W)).toEqual({ narrativeId: null, line: null });
  });

  it('one under the tree lands on the part it sits under, and says so', () => {
    const place = writingLandingFor(bloodMeridian, TELLING, W);
    expect(place).toEqual({ narrativeId: 's2', line: 'outside', name: "The father's telling", under: 'The night he was born' });
    expect(writingOutsideLine("The father's telling", 'The night he was born'))
      .toBe('"The father\'s telling" is not in the book\'s tree, so the writing room opens on "The night he was born", the part it sits under.');
  });

  it('one outside any chain lands on the start, and says so', () => {
    expect(writingLandingFor(bloodMeridian, 'memoir', W)).toEqual({ narrativeId: null, line: 'outside', name: 'My Confession', under: null });
    expect(writingOutsideLine('My Confession', null)).toBe('"My Confession" is not in the book\'s tree, so the writing room opens at its start.');
  });

  it('one not in the world is missing', () => {
    expect(writingLandingFor(bloodMeridian, 'nowhere', W)).toEqual({ narrativeId: null, line: 'missing' });
  });
});
