/**
 * An interrupted re-key finishes when its world is activated, on the open
 * path AND the revive (unpark) path, before the element list is primed
 * (S363, re-key gate lens 1 F3/F6). Otherwise the list shows old and new
 * elements as twins and the user can edit either while recovery writes.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchSlice, getState, subscribe } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../src/core/active-store';
import type { MockFolderStore } from '../fixtures/mock-folder-store';
import type { Element } from '../../src/core/types';

const stores: MockFolderStore[] = [];
let seedNext: ((s: MockFolderStore) => Promise<void>) | null = null;

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => ({ kind: 'directory', name: 'fake' }),
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));

vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  class SeededStore extends MockFolderStore {
    constructor() { super(); stores.push(this); }
    async open(handle: unknown): Promise<void> {
      await super.open(handle as never);
      if (seedNext) { const s = seedNext; seedNext = null; await s(this); }
    }
    park(): void {}
    async unpark(): Promise<boolean> { return true; }
  }
  return { FsFolderStore: SeededStore };
});

import { activateWorld } from '../../src/sidebar/worlds-sidebar';

const toastStub = { error() {}, info() {}, success() {} } as never;
const O = '11111111-1111-4111-8111-111111111111';
const N = '99999999-9999-4999-8999-999999999999';
const R = '33333333-3333-4333-8333-333333333333';

async function interruptedRekey(s: MockFolderStore): Promise<void> {
  // A crash after step 2: the old element and its new copy both exist, and
  // the referrer still names the old one.
  await s.createElement('location', { id: O, name: 'Rivendell' } as Partial<Element>);
  await s.createElementVerbatim('location', { id: N, name: 'Rivendell', type: 'location', local_updated_at: 'x' } as Element);
  await s.createElement('character', { id: R, name: 'Elrond', location: O } as Partial<Element>);
  await s.writeRekeyJournal({
    version: 1, world_id: 'w1', map: { [O]: N }, types: { [O]: 'location' },
    stamps: { [O]: (await s.getElement(O))!.local_updated_at }, unrewritten: [], started_at: 'x',
  });
}

function worldEntry(id: string) {
  return { id, name: id, state: 'local-only', folder: { handle_key: `k-${id}`, folder_name: `f-${id}` } } as never;
}

/** Every element list the UI was ever handed, in order. */
function watchPrimes(): string[][] {
  const seen: string[][] = [];
  let last: unknown = null;
  subscribe(() => {
    const els = getState().data.elements;
    if (els !== last && els.length > 0) { last = els; seen.push(els.map(e => e.id)); }
  });
  return seen;
}

beforeEach(() => {
  stores.length = 0;
  seedNext = null;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', { ...defaultRegistry(), worlds: [worldEntry('w1'), worldEntry('w2')] });
  window.location.hash = '#/';
});

describe('an interrupted re-key completes at activation, before the list is primed', () => {
  it('open path', async () => {
    seedNext = interruptedRekey;
    const primes = watchPrimes();
    expect(await activateWorld('w1', toastStub)).toBe(true);
    const s = stores[0];
    expect(await s.hasRekeyJournal()).toBe(false);
    expect(await s.getElement(O)).toBeNull();
    expect((await s.getElement(R))!.location).toBe(N);
    for (const ids of primes) expect(ids).not.toContain(O); // never shown as a twin
    expect(getState().data.elements.map(e => e.id).sort()).toEqual([R, N].sort());
  });

  it('revive path (a parked store is unparked, never reopened)', async () => {
    expect(await activateWorld('w1', toastStub)).toBe(true);
    expect(await activateWorld('w2', toastStub)).toBe(true);
    await interruptedRekey(stores[0]); // the crash happened while w1 was parked
    const primes = watchPrimes();
    expect(await activateWorld('w1', toastStub)).toBe(true);
    expect(stores.length).toBe(2); // w1 was revived, not reopened
    expect(await stores[0].hasRekeyJournal()).toBe(false);
    expect((await stores[0].getElement(R))!.location).toBe(N);
    for (const ids of primes) expect(ids).not.toContain(O);
  });

  it('the deep link the user reloaded on follows the id', async () => {
    seedNext = interruptedRekey;
    window.location.hash = `#/w/w1/element/${O}`;
    await activateWorld('w1', toastStub, { preserveSelection: true } as never);
    expect(window.location.hash).toBe(`#/w/w1/element/${N}`);
  });
});
