/**
 * A cascade must serialize against EACH DEPENDENT's own write chain.
 *
 * `deleteElement` serializes on the TARGET's id only. The cascade then removed
 * descendants from inside that same slot, and `PerIdWriteChain` is per-id by
 * design ("operations on DIFFERENT elements stay concurrent"), so a concurrent
 * `updateElement(childId, ...)` was NOT serialized against that child's
 * deletion.
 *
 * The interleaving that loses data: the update reads the child, yields at its
 * I/O gap, the cascade removes the child, and then the update's write lands —
 * RESURRECTING it. In the real store that recreates the file AND restores it
 * to `fileIndex`/`bodyCache` while the tombstone is already written, so the
 * next sync round pushes a DELETE for an element that still exists locally.
 * Permanent divergence, and atlas has no undo.
 *
 * Realistic trigger: the writing workspace fires `flushPendingSave()` without
 * awaiting it when you switch narrative or unmount, and a subtree delete lands
 * in that window.
 *
 * Found by an integration gate. The keeper had noticed the bypass while
 * reading the cascade and moved on without following it — the gate's whole
 * value here was refusing to let a noticed-and-dropped thread stay dropped.
 *
 * ⚠ THE BEHAVIOURAL TESTS BELOW DO NOT REPRODUCE THE RACE, AND SAYING SO IS
 * THE POINT. I wrote them first, and they passed against the UNFIXED cascade —
 * a false green. The reason is structural: in MockFolderStore the update has
 * ONE read→write yield while the cascade has several before it removes
 * anything, so the update's write always lands first. The dangerous
 * interleaving needs the update's gap to be real disk I/O (getDir +
 * writeJsonAtomic) spanning the cascade's own I/O, which only the FS-backed
 * store has. A fake cannot model it without a test-only delay hook, and a
 * concurrency guarantee proven by a hand-tuned hook proves mostly the hook.
 *
 * So the honest split (the rule: when the repro will not fail, say the lock
 * is coarse and let the fix stand on construction):
 *   - the SOURCE SCAN at the bottom is the real lock — it fails if either
 *     store stops routing dependent unlinks through a per-id chain;
 *   - the behavioural tests below lock the OBSERVABLE contract (a dependent
 *     stays deleted, its in-flight write still lands first, tombstones cover
 *     the subtree), which is worth having and would catch a naive rewrite.
 *
 * MockFolderStore carries the same fix and gained the tombstone-write yield it
 * had been missing, because a fake that cannot express production's I/O gaps
 * produces confident-wrong tests (convention #20).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import type { Element } from '../../src/core/types';

let folder: MockFolderStore;
let clock: MonotonicClock;

beforeEach(async () => {
  clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  folder = new MockFolderStore();
  folder.setClock(clock.next);
  await folder.open(null as unknown as FileSystemDirectoryHandle);
});

/** Book > Chapter, the shape a writing-tree delete cascades over. */
async function manuscript(): Promise<{ book: Element; chapter: Element }> {
  const book = await folder.createElement('narrative', { name: 'The Cycle', supertype: 'Book' });
  const chapter = await folder.createElement('narrative', {
    name: 'Chapter One',
    supertype: 'Chapter',
    parent_narrative: book.id,
  } as Partial<Element>);
  return { book, chapter };
}

describe('cascade delete serializes against each dependent', () => {
  it('an in-flight update to a CHILD cannot resurrect it after the cascade', async () => {
    const { book, chapter } = await manuscript();

    // The autosave flush: started, deliberately NOT awaited — exactly how
    // `flushPendingSave()` is invoked on narrative switch and unmount.
    const pendingSave = folder.updateElement(chapter.id, {
      story: 'words the writer never saw saved',
    } as Partial<Element>);

    // The user deletes the book while that save is in flight.
    await folder.deleteElement(book.id);
    await pendingSave.catch(() => { /* may legitimately fail once deleted */ });

    // The chapter must stay dead. Before the fix it came back, fully indexed,
    // with a tombstone already logged against it.
    expect(await folder.getElement(chapter.id)).toBeNull();
    expect(await folder.getElement(book.id)).toBeNull();
  });

  it('the in-flight update still LANDS before the delete, rather than being dropped', async () => {
    // The fix orders the writes rather than discarding one: the pending save
    // completes first, then the cascade removes the element. A fix that simply
    // cancelled in-flight writes would also pass the test above, so this pins
    // the ordering that makes the guarantee honest.
    const { book, chapter } = await manuscript();

    let sawStory: string | undefined;
    const pendingSave = folder.updateElement(chapter.id, { story: 'landed' } as Partial<Element>)
      .then((el) => { sawStory = (el as Element & { story?: string }).story; })
      .catch(() => { /* ignore */ });

    await folder.deleteElement(book.id);
    await pendingSave;

    expect(sawStory).toBe('landed');
    expect(await folder.getElement(chapter.id)).toBeNull();
  });

  it('tombstones still cover the whole subtree', async () => {
    const { book, chapter } = await manuscript();
    const scene = await folder.createElement('narrative', {
      name: 'Scene', supertype: 'Scene', parent_narrative: chapter.id,
    } as Partial<Element>);

    const { tombstones } = await folder.deleteElement(book.id);
    const ids = tombstones.map(t => t.id).sort();
    expect(ids).toEqual([book.id, chapter.id, scene.id].sort());
  });

  it('a pin dependent races the same way and is equally protected', async () => {
    const char = await folder.createElement('character', { name: 'Alice' });
    const map = await folder.createMap({ name: 'Atlas' });
    const pin = await folder.createPin({
      name: 'Alice@home', element_id: char.id, map_id: map.id, x: 0, y: 0,
    } as never);

    const pending = folder.updateElement(pin.id, { name: 'renamed mid-delete' } as Partial<Element>);
    await folder.deleteElement(char.id);
    await pending.catch(() => { /* ignore */ });

    expect(await folder.getElement(pin.id)).toBeNull();
  });
});

/**
 * THE ACTUAL LOCK.
 *
 * A source scan, because the property is structural and the behavioural tests
 * above provably cannot fail on it (see the header). This is the same shape as
 * `name-sort-guarded.test.ts`: lock the FAMILY so the next person who touches
 * a cascade cannot quietly reintroduce the bypass.
 */
describe('the cascade routes dependent unlinks through a per-id chain (source scan)', () => {
  const read = (p: string) => readFileSync(resolve(__dirname, p), 'utf8');

  it('FsFolderStore serializes each dependent on its own chain', () => {
    const src = read('../../src/store/folder-store-fs.ts');
    const cascade = src.slice(
      src.indexOf('private async deleteElementUnchained'),
      src.indexOf('private async unlinkElement'),
    );
    expect(cascade.length).toBeGreaterThan(100);   // guard the slice itself
    // Pin the WIRING, not the absence of a line: the unlink call still exists,
    // it just lives inside the closure handed to the chain. (My first cut here
    // asserted that `await this.unlinkElement(dep);` was gone and failed on
    // correct code — a test written from an assumption about the shape of the
    // fix rather than from the fix.)
    expect(cascade).toContain('this.writeChain.run(dep.id, unlinkDep)');
    expect(cascade).toContain('const unlinkDep');
  });

  it('MockFolderStore mirrors it, so tests written against the fake mean something', () => {
    const src = read('../fixtures/mock-folder-store.ts');
    const cascade = src.slice(
      src.indexOf('async deleteElement('),
      src.indexOf('// ---- Spatial passthroughs'),
    );
    expect(cascade.length).toBeGreaterThan(100);
    expect(cascade).toContain('this.writeChain.run(dep.id');
  });

  it('both guard against re-entering the target id (which would deadlock)', () => {
    for (const p of ['../../src/store/folder-store-fs.ts', '../fixtures/mock-folder-store.ts']) {
      expect(read(p)).toContain('dep.id === id');
    }
  });
});
