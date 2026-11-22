/**
 * The two known gaps of 1.125.0's PIN later (2026-11-22 R3, DESIGN_SYNC "An owner's world waiting on the World
 * PIN"), each made true by a test: the attach after the PIN pushes what waited, through the real attach,
 * engine and adapter on the played keel.
 * - A folder world with more than 50 changed elements before the PIN meets law 117's question at the
 *   attach: nothing uploads unasked, nothing is lost, and Upload them sends them.
 * - A change made on onlyworlds.com between the download and the PIN is overwritten by Atlas's copy where
 *   both changed: an owner alone is local-wins.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { playedKeel, type PlayedKeel } from '../fixtures/played-keel-pin';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { DEFAULT_V2_BASE, OwV2ClientAdapter } from '../../src/sync/ow-v2-client-adapter';
import { attachSyncEngine, detachSyncEngine, getCurrentSyncEngine, __resetFirstChangeToldForTests, __resetSamePinRevivedForTests } from '../../src/sync/sync-attach';
import { toastManager } from '../../src/ui/toast-manager';
import { __resetRateWaitsForTests } from '../../src/sync/rate-wait';
import { __resetPinAskedForTests } from '../../src/middle/settings-account';
import { askWorldPin } from '../../src/ui/world-pin-modal';
import { answerHeldBatch, forgetPersistedDiskHold, isDiskHoldPersisted } from '../../src/core/live-folder';

const BASE = DEFAULT_V2_BASE;
const KEY = 'ow_w_owner_gaps';
const RIGHT = '1234';

let keel: PlayedKeel;

/** A folder world (no `where`: not this browser), linked, no PIN kept. */
const world: WorldRegistryEntry = {
  id: 'w1', name: 'Gap world', state: 'api-linked',
  api: { world_id: 'w-played', api_key: KEY },
  folder: { handle_key: 'vault-w1', folder_name: 'w1' },
  created_at: '2026-01-01T00:00:00Z',
};

const writes = () => keel.seen.filter(s => !s.call.startsWith('GET'));
async function settle(ms = 50): Promise<void> {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(ms / 4);
}
async function givePin(): Promise<void> {
  askWorldPin(toastManager);
  const dialog = document.querySelector<HTMLElement>('[data-modal="world-pin"]')!;
  dialog.querySelector<HTMLInputElement>('input[name="pin"]')!.value = RIGHT;
  dialog.querySelector<HTMLFormElement>('form')!.requestSubmit();
  await settle(300);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-22T08:00:00Z'));
  detachSyncEngine();
  __resetRateWaitsForTests();
  __resetPinAskedForTests();
  __resetSamePinRevivedForTests();
  __resetFirstChangeToldForTests();
  const played = playedKeel(BASE, { keys: { [KEY]: { scope: 'write' } }, worldPin: RIGHT });
  keel = played.state;
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(
    played.gate,
    http.get(`${BASE}/members`, () => HttpResponse.json({ results: [], next: null })),
    ...statefulV2Handlers({ baseUrl: BASE, clock: clock.next }).handlers,
  );
  for (const m of ['show', 'success', 'info', 'error'] as const) vi.spyOn(toastManager, m).mockImplementation(() => undefined as never);
  patchSlice('registry', { ...defaultRegistry(), worlds: [world] });
  patchSlice('active', { worldId: 'w1', meta: { name: 'Gap world' } } as never);
});

afterEach(() => {
  forgetPersistedDiskHold('w1');
  detachSyncEngine();
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
  mswServer.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('known gaps of the PIN later (1.125.0)', () => {
  it('more than 50 changed elements in a folder world before the PIN: law 117\'s question, nothing lost, Upload them sends them', async () => {
    const folder = new MockFolderStore();
    await folder.open(null);
    for (let i = 0; i < 51; i++) await folder.createElement('character', { name: `Made ${i}` });
    setActiveStore(folder as never);
    expect(attachSyncEngine(world, folder)).toBeNull();
    await givePin();
    await settle(8_000);
    expect(getCurrentSyncEngine()!.isHeld()).toBe(true);
    expect(isDiskHoldPersisted('w1')).toBe(true);
    expect(writes()).toEqual([]);
    expect((await folder.listElements()).filter(e => typeof e.server_updated_at !== 'string')).toHaveLength(51);
    await answerHeldBatch(true);
    await settle(20_000);
    expect(writes().length).toBeGreaterThan(0);
    expect((await folder.listElements()).filter(e => typeof e.server_updated_at !== 'string')).toHaveLength(0);
  });

  it('a change made on onlyworlds.com between the download and the PIN is overwritten where both changed (an owner alone, local-wins)', async () => {
    const server = new OwV2ClientAdapter({ apiKey: KEY, apiPin: RIGHT, baseUrl: BASE });
    const made = await server.createElement('character', { name: 'As downloaded' }) as unknown as { id: string; updated_at: string };
    // The download: the element here with the server's stamp.
    const folder = new MockFolderStore();
    await folder.open(null);
    await folder.createElement('character', { id: made.id, name: 'As downloaded', server_updated_at: made.updated_at } as never);
    setActiveStore(folder as never);
    expect(attachSyncEngine(world, folder)).toBeNull();
    // Then the site changes it, and the person changes it here.
    await server.updateElement('character', made.id, { name: 'Changed on the site' });
    await settle(1_000);
    await folder.updateElement(made.id, { name: 'Changed here' } as never);
    keel.seen.length = 0;
    await givePin();
    await settle(10_000);
    const now = await server.getElement('character', made.id) as unknown as { name: string };
    expect(now.name).toBe('Changed here');
  });
});
