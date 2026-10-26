/**
 * Pull-apply rides the per-id write chain, and its race
 * check happens INSIDE the chain slot. Before, the engine re-read the element,
 * then applied outside the chain: a save landing between the two was
 * overwritten with the server body and read as synced.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { MonotonicClock } from '../fixtures/monotonic-clock';

let store: MockFolderStore;

beforeEach(async () => {
  store = new MockFolderStore();
  // Strictly increasing stamps: the guard compares local_updated_at, and two
  // writes in one millisecond would otherwise look unchanged.
  store.setClock(new MonotonicClock('2026-01-01T00:00:00.000Z').next);
  await store.open(null);
});

describe('applyServerRecordIfUnchanged', () => {
  it('refuses when a save is already queued for the element, and the save survives', async () => {
    const el = await store.createElement('character', { name: 'Rhea', description: 'base' });
    const decidedOn = el.local_updated_at ?? null;

    const save = store.updateElement(el.id, { description: 'mine' }); // queued in the chain
    const applied = await store.applyServerRecordIfUnchanged(
      'character', { id: el.id, name: 'Rhea', description: 'theirs' }, '2099-01-01T00:00:00.000Z', decidedOn);
    await save;

    expect(applied).toBe(false);
    expect((await store.getElement(el.id))!.description).toBe('mine');
  });

  it('applies when nothing moved', async () => {
    const el = await store.createElement('character', { name: 'Rhea', description: 'base' });
    const applied = await store.applyServerRecordIfUnchanged(
      'character', { id: el.id, name: 'Rhea', description: 'theirs' }, '2099-01-01T00:00:00.000Z', el.local_updated_at ?? null);
    expect(applied).toBe(true);
    const back = await store.getElement(el.id);
    expect(back!.description).toBe('theirs');
    expect(back!.server_updated_at).toBe('2099-01-01T00:00:00.000Z');
  });
});
