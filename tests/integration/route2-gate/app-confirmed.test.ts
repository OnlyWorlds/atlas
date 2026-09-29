// B1's probe no longer reaches its throw (the A7 fix catches it); B1 is covered in tests/integration/make-online-run.test.ts. B4 was fixed by wording, not by the count the probe asserted.
/**
 * Promoted from the S367 composition gate (lens B).
 * S367 gate lens B (app side of Route 2). Each test asserts the FIXED
 * behaviour: RED today = the finding reproduced. Promote by moving into
 * tests/integration/make-online-run.test.ts once the keeper fixes it.
 *
 * Run: from tools/atlas,
 *   npx vitest run --config ../../Notes/2026-09-29-s367-gate/probes/lens-b/vitest.lensb.config.ts
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { MockFolderStore } from '../../fixtures/mock-folder-store';
import { MonotonicClock } from '../../fixtures/monotonic-clock';
import { FakeOwApiClient } from '../../fixtures/fake-ow-client';
import { getState, setState, patchSlice } from '../../../src/core/state';
import { defaultRegistry, type Element, type WorldRegistryEntry } from '../../../src/core/types';
import { __setRegistryTabBaseForTests } from '../../../src/registry/registry';
import { runRoute2 } from '../../../src/sync/make-online-run';
import { mergeLocalIntoApi, type MergeProgress } from '../../../src/sync/make-online';
import { rekeyJournalOrigin } from '../../../src/store/rekey';
import { isRekeyRunning } from '../../../src/sync/rekey-run';

// One jsdom document for every file (vitest singleFork): leave it empty.
afterEach(() => { document.body.innerHTML = ''; });

const W = 'w1';
const O = '11111111-1111-4111-8111-111111111111'; // local Alice
const N = '22222222-2222-4222-8222-222222222222'; // server Alice
const R = '33333333-3333-4333-8333-333333333333'; // local scene naming Alice
const C1 = '44444444-4444-4444-8444-444444444444'; // local-only
const D = '55555555-5555-4555-8555-555555555555'; // server-only

let store: MockFolderStore;
let client: FakeOwApiClient;

beforeEach(async () => {
  localStorage.clear();
  document.body.innerHTML = '<div class="atlas-shell"></div>';
  store = new MockFolderStore();
  store.setClock(new MonotonicClock('2026-03-01T00:00:00.000Z').next);
  await store.open(null);
  await store.createElement('character', { id: O, name: 'Alice', description: 'local' } as Partial<Element>);
  await store.createElement('narrative', { id: R, name: 'Tale', characters: [O] } as Partial<Element>);
  client = new FakeOwApiClient();
  await client.createElement('character', { id: N, name: 'Alice', description: 'server' });
  const entry = {
    id: W, name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' },
    favorites: { protagonist_id: O }, active_calendar_id: O,
  } as unknown as WorldRegistryEntry;
  const reg = { ...defaultRegistry(), worlds: [entry] };
  patchSlice('registry', reg);
  __setRegistryTabBaseForTests(reg);
  patchSlice('active', { worldId: W, meta: { id: W, name: 'W' }, opened: true } as never);
  const cur = getState();
  setState({
    ...cur,
    data: { ...cur.data, elements: await store.listElements() },
    ui: { ...cur.ui, selectedElementId: O, rightTabs: [], zoneEditing: null },
  });
  window.location.hash = `#/w/${W}/element/${O}`;
});

const base = () => ({ store, worldId: W, adapter: client, policy: 'b' as const, matchByName: true });

describe('lens B, CONFIRMED (red today)', () => {
  it('B2: retry-as-recovery keeps the first run\'s unrewritten referrers in the result', async () => {
    store.corruptIds.add(R); // a scene that will not parse (git conflict markers)
    const real = store.deleteElement.bind(store);
    let armed = true;
    vi.spyOn(store, 'deleteElement').mockImplementation(async (id, opts) => {
      if (armed && id === O && (await store.hasRekeyJournal())) { armed = false; throw new Error('tab closed'); }
      return real(id, opts);
    });
    const r = await runRoute2({ ...base(), link: async () => {} });
    expect(r.rekeyed.get(O)).toBe(N); // sanity: recovered and merged
    // The finding: runner merges `rekeyed` from the recovery but drops its
    // `unrewritten`; the second run had no pairs, so it reports none.
    expect(r.unrewritten).toContain(R);
  });

  it('B3: when the retry-as-recovery also fails, the error the modal shows says what to do (Settings, run again)', async () => {
    const real = store.deleteElement.bind(store);
    vi.spyOn(store, 'deleteElement').mockImplementation(async (id, opts) => {
      if (id === O && (await store.hasRekeyJournal())) throw new Error('NotReadableError: file busy');
      return real(id, opts);
    });
    let message = '';
    await runRoute2({ ...base(), link: async () => {} }).catch((e: Error) => { message = e.message; });
    // Sanity (green today): journal left, origin merge, lock and inert released.
    expect(await store.hasRekeyJournal()).toBe(true);
    expect(await rekeyJournalOrigin(store)).toBe('merge');
    expect(isRekeyRunning()).toBe(false);
    // The finding: the raw kernel error reaches the modal's error box; the
    // re-key modal says "Settings, under This world, can finish the update"
    // in the same case (rekey-modal.ts unfinished branch).
    expect(message).toMatch(/Settings/);
  });
});
