/**
 * The re-key kernel's S367 additions, for Route 2: caller-supplied pairs (a
 * local element onto the server element it matched), the stale-baseline
 * allowance, the journal's origin, and step 5b (`.atlas/world-prefs.json`
 * names elements too: lane B N3, a folder that travels opens elsewhere with
 * the file's ids winning).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { startRekey, recoverRekey, rollbackRekey, rekeyJournalOrigin, RekeyRefusedError } from '../../src/store/rekey';
import type { Element } from '../../src/core/types';

const W = 'world-1';
const O = '00000000-0000-4000-8000-000000000010';
const O2 = '00000000-0000-4000-8000-000000000011';
const N = '00000000-0000-4000-8000-000000000090';
const R = '00000000-0000-4000-8000-000000000020';

let store: MockFolderStore;

beforeEach(async () => {
  store = new MockFolderStore();
  store.setClock(new MonotonicClock('2026-02-01T00:00:00.000Z').next);
  await store.open(null);
  await store.createElement('character', { id: O, name: 'Alice', server_updated_at: '2026-01-01T00:00:00.000Z' } as Partial<Element>);
  await store.createElement('character', { id: O2, name: 'Bob' } as Partial<Element>);
  await store.createElement('narrative', { id: R, name: 'Tale', characters: [O, O2] } as Partial<Element>);
  store.worldPrefs = { notes: 'n', favorites: { protagonist_id: O }, active_calendar_id: O, writing_labels: { l1: 'Book' } };
});

describe('startRekey with pairs', () => {
  it('moves each old id onto the GIVEN id, with origin on the journal and the result', async () => {
    const seenOrigins: Array<string | null> = [];
    const real = store.createElementVerbatim.bind(store);
    vi.spyOn(store, 'createElementVerbatim').mockImplementation(async (...a) => {
      seenOrigins.push(await rekeyJournalOrigin(store));
      return real(...a);
    });
    const r = await startRekey(store, { worldId: W, pairs: new Map([[O, N]]), allowStaleBaseline: true, origin: 'merge' });
    expect(r.map).toEqual(new Map([[O, N]]));
    expect(r.origin).toBe('merge');
    expect(seenOrigins).toEqual(['merge']);
    expect(await store.getElement(O)).toBeNull();
    expect((await store.getElement(N))!.server_updated_at).toBeUndefined();
    expect((await store.getElement(R))!.characters).toEqual([N, O2]);
    expect(await rekeyJournalOrigin(store)).toBeNull();
  });

  it('refuses an element with a baseline unless allowed, and a given id already in use, touching nothing', async () => {
    await expect(startRekey(store, { worldId: W, pairs: new Map([[O, N]]) })).rejects.toBeInstanceOf(RekeyRefusedError);
    await expect(startRekey(store, { worldId: W, pairs: new Map([[O2, R]]) })).rejects.toThrow(/already in use/);
    await expect(startRekey(store, { worldId: W, pairs: new Map([[O2, N], [O, N]]), allowStaleBaseline: true })).rejects.toThrow(/already in use/);
    expect(await store.hasRekeyJournal()).toBe(false);
    expect(await store.getElement(O)).not.toBeNull();
    expect(store.worldPrefs!.active_calendar_id).toBe(O);
  });

  it('an empty plan still refuses beside an unfinished journal', async () => {
    await store.writeRekeyJournal({ version: 1, world_id: W, map: {}, types: {}, stamps: {}, unrewritten: [], started_at: 'x' });
    await expect(startRekey(store, { worldId: W, pairs: new Map() })).rejects.toBeInstanceOf(RekeyRefusedError);
  });

  it('a journal from before S367 reads as a plain re-key', async () => {
    await store.writeRekeyJournal({ version: 1, world_id: W, map: {}, types: {}, stamps: {}, unrewritten: [], started_at: 'x' });
    expect(await rekeyJournalOrigin(store)).toBe('rekey');
  });
});

describe('step 5b: world-prefs.json follows', () => {
  it('the cast and the calendar lens move; other prefs and absent keys stay as they were', async () => {
    await startRekey(store, { worldId: W, pairs: new Map([[O, N]]), allowStaleBaseline: true, origin: 'merge' });
    expect(store.worldPrefs).toEqual({ notes: 'n', favorites: { protagonist_id: N }, active_calendar_id: N, writing_labels: { l1: 'Book' } });
  });

  it('a crash after the move, then recovery, leaves the file on the new id; Discard puts it back', async () => {
    const real = store.deleteElement.bind(store);
    let armed = true;
    vi.spyOn(store, 'deleteElement').mockImplementation(async (id, opts) => {
      if (armed && id === O) { armed = false; throw new Error('tab closed'); }
      return real(id, opts);
    });
    await expect(startRekey(store, { worldId: W, pairs: new Map([[O, N]]), allowStaleBaseline: true })).rejects.toThrow(/tab closed/);
    expect(store.worldPrefs!.active_calendar_id).toBe(N); // 5b ran before 6
    await rollbackRekey(store);
    expect(store.worldPrefs).toMatchObject({ favorites: { protagonist_id: O }, active_calendar_id: O });
    expect(await store.getElement(O)).not.toBeNull();

    armed = true;
    await expect(startRekey(store, { worldId: W, pairs: new Map([[O, N]]), allowStaleBaseline: true })).rejects.toThrow(/tab closed/);
    const done = await recoverRekey(store);
    expect(done!.map.get(O)).toBe(N);
    expect(store.worldPrefs).toMatchObject({ favorites: { protagonist_id: N }, active_calendar_id: N });
  });

  it('a prefs file that will not parse never stops the re-key', async () => {
    store.worldPrefsCorrupt = true;
    const r = await startRekey(store, { worldId: W, pairs: new Map([[O, N]]), allowStaleBaseline: true });
    expect(r.map.get(O)).toBe(N);
    expect(await store.hasRekeyJournal()).toBe(false);
  });
});
