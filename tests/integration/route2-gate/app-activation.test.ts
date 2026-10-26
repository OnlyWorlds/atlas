/**
 * Promoted from the composition gate (lens B).
 * Gate lens B, activation recovery for a Route 2 journal. RED today =
 * finding reproduced.
 *
 * B6: the boot path activates the URL's world SILENTLY (app.ts
 * tryAutoActivateFromUrl, `silent: true`). Recovery then finishes a
 * `origin: 'merge'` journal and its success toast is gated on `!silent`,
 * so the one sentence carrying the next step ("Linking did not finish: run
 * Make online again with the same key") is never shown, and the Settings row
 * is gone too (the journal is finished). A reload mid-route is common: any
 * other tab accepting a new version reloads this one (conv. 121,
 * `onNeedReload`). For the Settings re-key the silent success is harmless
 * (the job is done); for Route 2 it is not (the link is not done).
 * Harness copied from tests/integration/activate-world.rekeyRecovery.test.ts.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { patchSlice } from '../../../src/core/state';
import { defaultRegistry } from '../../../src/core/types';
import { setActiveStore, clearParkedStores } from '../../../src/core/active-store';
import type { MockFolderStore } from '../../fixtures/mock-folder-store';
import type { Element } from '../../../src/core/types';

const stores: MockFolderStore[] = [];
let seedNext: ((s: MockFolderStore) => Promise<void>) | null = null;

vi.mock('../../../src/store/handle-vault', () => ({
  storeHandle: async () => {},
  loadHandle: async () => ({ kind: 'directory', name: 'fake' }),
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
}));

vi.mock('../../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../../fixtures/mock-folder-store');
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

import { activateWorld } from '../../../src/sidebar/worlds-sidebar';

// One jsdom document for every file (vitest singleFork): leave it empty.
afterEach(() => { document.body.innerHTML = ''; });

const O = '11111111-1111-4111-8111-111111111111';
const N = '99999999-9999-4999-8999-999999999999';

async function interruptedLink(s: MockFolderStore): Promise<void> {
  await s.createElement('character', { id: O, name: 'Alice' } as Partial<Element>);
  await s.createElementVerbatim('character', { id: N, name: 'Alice', type: 'character', local_updated_at: 'x' } as Element);
  await s.writeRekeyJournal({
    version: 1, world_id: 'w1', map: { [O]: N }, types: { [O]: 'character' },
    stamps: { [O]: (await s.getElement(O))!.local_updated_at }, unrewritten: [], started_at: 'x',
    origin: 'merge',
  } as never);
}

beforeEach(() => {
  stores.length = 0;
  seedNext = null;
  localStorage.clear();
  setActiveStore(null);
  clearParkedStores();
  patchSlice('active', null);
  patchSlice('data', { elements: [] });
  patchSlice('registry', {
    ...defaultRegistry(),
    worlds: [{ id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k-w1', folder_name: 'f-w1' } } as never],
  });
  window.location.hash = `#/w/w1/element/${O}`;
});

describe('lens B, activation (red today)', () => {
  it('B6: a Route 2 journal finished on the SILENT boot path still tells the user linking did not finish', async () => {
    seedNext = interruptedLink;
    const said: string[] = [];
    const toasts = {
      error: (m: string) => { said.push(m); }, info: (m: string) => { said.push(m); }, success: (m: string) => { said.push(m); },
    } as never;
    // What app.ts tryAutoActivateFromUrl passes after a reload.
    expect(await activateWorld('w1', toasts, { silent: true, preserveSelection: true, permissionMode: 'query' } as never)).toBe(true);
    // Sanity (green today): recovery ran.
    expect(await stores[0].hasRekeyJournal()).toBe(false);
    expect(await stores[0].getElement(O)).toBeNull();
    // The finding: nothing said.
    expect(said.some(m => /Make online/.test(m))).toBe(true);
  });

  it('control: the same journal on a clicked (non-silent) open does say it', async () => {
    seedNext = interruptedLink;
    const said: string[] = [];
    const toasts = { error: (m: string) => said.push(m), info: (m: string) => said.push(m), success: (m: string) => said.push(m) } as never;
    expect(await activateWorld('w1', toasts)).toBe(true);
    expect(said.some(m => /Make online again with the same key/.test(m))).toBe(true);
  });
});
