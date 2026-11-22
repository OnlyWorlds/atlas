/**
 * keel's PIN wall, met by the sync (1.124.35). A wrong PIN is a 401 each time; ten different wrong PINs on
 * one key lock it, and while locked every request that carries a PIN, the right one included, answers 429
 * `rate_limited`, `param` `API-Pin`, with a Retry-After. keel's other throttles answer 429 with no `param`.
 *
 * Atlas's side, through the real engine, the real attach and the real adapter on the played keel
 * (`played-keel-pin.ts`, the wall included):
 * - a PIN keel refused is never sent again by itself, page loads (a fresh attach) included;
 * - inside a 429's wait nothing goes on the wire by itself: an edit stays dirty and the one retry at the
 *   wait's end pushes it; a press says the wait; the wait outlives a world switch, a new PIN saved in
 *   Settings and a new engine on the same key;
 * - the words tell the wall from any other wait.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { playedKeel, type PlayedKeel } from '../fixtures/played-keel-pin';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry, type WorldsRegistry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { DEFAULT_V2_BASE } from '../../src/sync/ow-v2-client-adapter';
import {
  attachSyncEngine, detachSyncEngine, getCurrentSyncEngine, pullNowAndRefresh, refusedEngineLine, sayRateWait,
  __resetSamePinRevivedForTests,
} from '../../src/sync/sync-attach';
import { testWorldConnection } from '../../src/middle/settings-world';
import { setPin } from '../../src/registry/registry';
import { toastManager, type ToastManager } from '../../src/ui/toast-manager';
import { __resetRateWaitsForTests, rateWaitOf, setRateWait, waitWords } from '../../src/sync/rate-wait';
import { holdBigBatchAtOpen, answerHeldBatch, isDiskHoldPersisted, forgetPersistedDiskHold } from '../../src/core/live-folder';
import { __resetPinAskedForTests, renderAccountTab, wireAccountTab } from '../../src/middle/settings-account';
import { settingsHash } from '../../src/core/router';
import { SyncEngine } from '../../src/sync/sync-engine';
import { FakeOwApiClient } from '../fixtures/fake-ow-client';

const BASE = DEFAULT_V2_BASE;
const KEY = 'ow_w_wall';
const OTHER_KEY = 'ow_w_other';
const RIGHT = '1234';
const WRONG = '9999';

const WALL_LINE = (when: string) => `OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while. Check the World PIN in Settings; Atlas tries again in ${when}.`;
const WAIT_LINE = (when: string) => `OnlyWorlds asked Atlas to wait. Your changes are saved in the folder, and Atlas tries again in ${when}.`;

let keel: PlayedKeel;

function entry(id: string, key: string): WorldRegistryEntry {
  return {
    id, name: id, state: 'api-linked',
    api: { world_id: 'w-played', api_key: key },
    folder: { handle_key: `vault-${id}`, folder_name: id },
    created_at: '2026-01-01T00:00:00Z',
  };
}

function useRegistry(pin: string, state?: 'proved' | 'refused', worlds: WorldRegistryEntry[] = [entry('w1', KEY)]): WorldsRegistry {
  const reg = { ...setPin(defaultRegistry(), pin), ...(state ? { pin_state: state } : {}), worlds };
  patchSlice('registry', reg);
  patchSlice('active', { worldId: worlds[0].id, meta: { name: worlds[0].name } } as never);
  return reg;
}

/** Everything that reached the played keel; with a PIN; writes. */
const sent = () => keel.seen.length;
const withPin = () => keel.seen.filter(s => s.pin !== null);
const writes = () => keel.seen.filter(s => !s.call.startsWith('GET'));

/** Lets the attach's chain and MSW's answers run, under fake timers. */
async function settle(ms = 50): Promise<void> {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(ms / 4);
}

async function newFolder(names: string[] = []): Promise<MockFolderStore> {
  const folder = new MockFolderStore();
  await folder.open(null);
  for (const name of names) await folder.createElement('character', { name });
  return folder;
}

/** The names of the elements keel has not stamped (never landed). */
async function unstamped(folder: MockFolderStore): Promise<string[]> {
  return (await folder.listElements()).filter(e => typeof e.server_updated_at !== 'string').map(e => e.name as string).sort();
}

let infos: string[];
let shown: string[];
let errors: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-21T08:00:00Z'));
  detachSyncEngine();
  __resetRateWaitsForTests();
  __resetPinAskedForTests();
  __resetSamePinRevivedForTests();
  const played = playedKeel(BASE, { keys: { [KEY]: { scope: 'write' }, [OTHER_KEY]: { scope: 'write' } }, worldPin: RIGHT });
  keel = played.state;
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(
    played.gate,
    // The roster read at attach: nobody else in the world.
    http.get(`${BASE}/members`, () => HttpResponse.json({ results: [], next: null })),
    ...statefulV2Handlers({ baseUrl: BASE, clock: clock.next }).handlers,
  );
  infos = [];
  vi.spyOn(toastManager, 'info').mockImplementation((m: string) => { infos.push(m); return undefined as never; });
  errors = [];
  vi.spyOn(toastManager, 'error').mockImplementation((m: string) => { errors.push(m); return undefined as never; });
  vi.spyOn(toastManager, 'success').mockImplementation(() => undefined as never);
  shown = [];
  vi.spyOn(toastManager, 'show').mockImplementation((m: string) => { shown.push(m); return undefined as never; });
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

describe('a PIN keel refused is never sent again by itself', () => {
  it('an attach with the stored PIN recorded refused starts as the refusal left it, and sends nothing', async () => {
    useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    const engine = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    expect(engine.getState()).toMatchObject({ kind: 'error', auth_reason: 'pin' });
    expect(getState().sync.activeSync).toMatchObject({ kind: 'error', auth_reason: 'pin' });
    // Every door the engine has: an edit's push, a sync, a pull, a held push.
    engine.requestPush();
    await engine.syncNow();
    await engine.pullNow();
    expect(engine.flushPendingPush()).toBeNull();
    await settle(60_000);
    expect(keel.seen).toEqual([]);
  });

  it('a PIN not recorded refused attaches as before: the waiting edit goes, with the PIN (the control)', async () => {
    useRegistry(RIGHT);
    const folder = await newFolder(['Waiting']);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    expect(writes().map(s => s.pin)).toEqual([RIGHT]);
    expect(getState().registry.pin_state).toBe('proved');
  });

  it('saving a different PIN clears the refusal and brings the engine back: the edit goes with the new PIN', async () => {
    const reg = useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    expect(keel.seen).toEqual([]);
    const next = setPin(reg, RIGHT);
    expect(next.pin_state).toBeUndefined();
    patchSlice('registry', next);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    expect(writes().map(s => s.pin)).toEqual([RIGHT]);
    expect(getState().sync.activeSync?.kind).toBe('idle');
  });

  it('a seat world or a read key is never held by the account PIN\'s refusal', async () => {
    useRegistry(WRONG, 'refused', [{ ...entry('w1', KEY), api: { world_id: 'w-played', api_key: KEY, read_only: true } }]);
    const folder = await newFolder();
    const engine = attachSyncEngine(getState().registry.worlds[0], folder)!;
    await settle();
    expect(engine.getState().kind).not.toBe('error');
  });

  it('the pill, the stored PIN refused: its press sends nothing and opens the OnlyWorlds tab, and its words say to put the PIN in again', async () => {
    useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    const { mountRightPane } = await import('../../src/tabs/right/right-pane');
    const tabBar = document.createElement('div');
    const pane = document.createElement('div');
    document.body.append(tabBar, pane);
    const toasts = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } as unknown as ToastManager;
    const unmount = mountRightPane({ tabBar, pane, toasts });
    try {
      const pill = document.querySelector<HTMLElement>('[data-role="sync-pill"]')!;
      expect(pill.title).toBe('OnlyWorlds did not accept this World PIN. Check it in Settings, OnlyWorlds · click to put in the World PIN again in Settings, OnlyWorlds');
      expect(pill.querySelector('[data-role="refresh"]')!.getAttribute('aria-label')).toBe('Put in the World PIN again in Settings, OnlyWorlds');
      pill.click();
      await settle();
      expect(window.location.hash).toBe(settingsHash('w1', 'onlyworlds'));
      expect(keel.seen).toEqual([]);
    } finally {
      unmount();
    }
  });
});

describe('inside a 429 wait nothing goes by itself', () => {
  /** A world whose first push meets the wall (locked for `lockSecs`): the wait runs when this returns. */
  async function lockedPush(lockSecs = 60): Promise<{ folder: MockFolderStore; engineSends: () => number }> {
    useRegistry(RIGHT, 'proved');
    keel.lockedUntil[KEY] = Date.now() + lockSecs * 1000;
    const folder = await newFolder(['First']);
    setActiveStore(folder as never);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    expect(writes()).toHaveLength(1); // the flush met the wall
    expect(infos).toContain(WALL_LINE(waitWords(lockSecs * 1000)));
    return { folder, engineSends: sent };
  }

  it('an edit made inside the wait stays dirty and goes once, with the retry at the wait\'s end', async () => {
    const { folder } = await lockedPush(60);
    const before = sent();
    await folder.createElement('character', { name: 'Second' });
    getCurrentSyncEngine()!.requestPush();
    // No debounce is armed (the pill would offer "Saving in 5s"): the edit waits for the wait's end.
    expect(getCurrentSyncEngine()!.getPendingPush()).toBeNull();
    // The edit's own debounce (5 s), and a while more: nothing on the wire.
    await settle(30_000);
    expect(sent()).toBe(before);
    expect(await unstamped(folder)).toEqual(['First', 'Second']);
    // The wait's end: the one retry pushes both.
    await settle(31_000);
    const after = keel.seen.slice(before);
    expect(after.filter(s => !s.call.startsWith('GET'))).toHaveLength(1);
    expect(after[0].call).toMatch(/^POST /);
    expect(await unstamped(folder)).toEqual([]);
  });

  it('a press of Sync now or refresh inside the wait sends nothing and says the wait in the toast\'s words', async () => {
    await lockedPush(120);
    const before = sent();
    infos.length = 0;
    expect(sayRateWait()).toBe(true);
    const result = await pullNowAndRefresh();
    expect(result).toMatchObject({ transient_blocked: true, transient_reason: 'rate_limited', rate_limited_pin: true });
    await getCurrentSyncEngine()!.syncNow();
    expect(sent()).toBe(before);
    expect(infos).toEqual([WALL_LINE('2 minutes'), WALL_LINE('2 minutes')]);
  });

  it('the wait outlives a world switch and back: the new engine sends nothing until it ends, then the retry goes', async () => {
    const { folder } = await lockedPush(60);
    await folder.createElement('character', { name: 'Second' });
    const other = await newFolder();
    const worlds = getState().registry.worlds;
    patchSlice('registry', { ...getState().registry, worlds: [...worlds, entry('w2', OTHER_KEY)] });
    attachSyncEngine(entry('w2', OTHER_KEY), other);
    await settle(5_000);
    const before = keel.seen.filter(s => s.key === KEY).length;
    attachSyncEngine(entry('w1', KEY), folder);
    await settle(20_000);
    expect(keel.seen.filter(s => s.key === KEY)).toHaveLength(before);
    await settle(40_000);
    const after = keel.seen.filter(s => s.key === KEY).slice(before);
    expect(after.filter(s => !s.call.startsWith('GET'))).toHaveLength(1);
    expect(await unstamped(folder)).toEqual([]);
  });

  it('a new PIN saved in Settings inside the wall\'s wait: never recorded refused, the wait said, nothing sent', async () => {
    await lockedPush(300);
    const before = sent();
    document.body.innerHTML = `<div class="atlas-settings">${renderAccountTab(getState().registry)}</div>`;
    const said: string[] = [];
    const toasts = { info: (l: string) => said.push(l), error: (l: string) => said.push(`error: ${l}`), success: vi.fn() } as unknown as ToastManager;
    wireAccountTab(toasts);
    const field = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]')!;
    field.value = '4321';
    field.dispatchEvent(new Event('change'));
    await settle(1_000);
    expect(getState().registry.pin).toBe('4321');
    expect(getState().registry.pin_state).toBeUndefined();
    expect(said).toEqual([`OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while. This World PIN is not checked by OnlyWorlds yet; OnlyWorlds takes World PINs again in 5 minutes.`]);
    // The engine the save attached waits too.
    await settle(60_000);
    expect(sent()).toBe(before);
  });

  it('Settings\' check meeting the wall itself: the 429 is the wait, never a refusal, and the sync waits it out', async () => {
    useRegistry(RIGHT);
    keel.lockedUntil[KEY] = Date.now() + 90_000;
    const folder = await newFolder();
    setActiveStore(folder as never);
    document.body.innerHTML = `<div class="atlas-settings">${renderAccountTab(getState().registry)}</div>`;
    const said: string[] = [];
    const toasts = { info: (l: string) => said.push(l), error: (l: string) => said.push(`error: ${l}`), success: vi.fn() } as unknown as ToastManager;
    wireAccountTab(toasts);
    const field = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]')!;
    field.value = '4321';
    field.dispatchEvent(new Event('change'));
    await settle(1_000);
    expect(keel.seen.filter(s => s.call === 'GET /me' && s.pin === '4321')).toHaveLength(1);
    expect(getState().registry.pin_state).toBeUndefined();
    expect(said).toEqual([`OnlyWorlds refused too many different World PINs for this world's key, so it takes none for a while. This World PIN is not checked by OnlyWorlds yet; OnlyWorlds takes World PINs again in 2 minutes.`]);
    const before = sent();
    await folder.createElement('character', { name: 'Edit' });
    getCurrentSyncEngine()!.requestPush();
    await settle(60_000);
    expect(sent()).toBe(before);
  });

  it('keel\'s other throttles: the same wait, in their own words', async () => {
    useRegistry(RIGHT, 'proved');
    keel.throttleUntil = Date.now() + 45_000;
    const folder = await newFolder(['First']);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    expect(infos).toContain(WAIT_LINE('45 seconds'));
    const before = sent();
    await folder.createElement('character', { name: 'Second' });
    getCurrentSyncEngine()!.requestPush();
    await settle(30_000);
    expect(sent()).toBe(before);
    await settle(16_000);
    expect(await unstamped(folder)).toEqual([]);
  });

  it('a busy server (503) keeps its own retry, and an edit inside it pushes on its debounce as before', async () => {
    useRegistry(RIGHT, 'proved');
    let busy = true;
    mswServer.use(http.post(`${BASE}/character`, () => busy
      ? HttpResponse.json({ error: { type: 'api_error', code: 'server_busy', message: 'busy', param: null } }, { status: 503, headers: { 'Retry-After': '60' } })
      : undefined));
    const folder = await newFolder(['First']);
    const engine = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    expect(engine.rateWaitNow()).toBeNull();
    busy = false;
    const before = writes().length;
    await folder.createElement('character', { name: 'Second' });
    engine.requestPush();
    await settle(6_000);
    expect(writes().length).toBeGreaterThan(before);
  });
});

describe('round 2: the world settings, the pause, the hold, another tab, the pill', () => {
  /** A linked world whose world-settings baseline is seeded (one full round), the PIN proved. */
  async function seededWorld(): Promise<MockFolderStore> {
    useRegistry(RIGHT, 'proved');
    const folder = await newFolder();
    setActiveStore(folder as never);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle(200);
    await getCurrentSyncEngine()!.syncNow();
    await settle(200);
    return folder;
  }
  const patches = (from: number) => keel.seen.slice(from).filter(s => s.call === 'PATCH /world');

  it('a world-settings change meeting the wall is the round\'s 429: the wall\'s words, no failure, one PATCH at the wait\'s end', async () => {
    const folder = await seededWorld();
    await folder.writeWorldMeta({ description: 'changed here' } as never);
    keel.lockedUntil[KEY] = Date.now() + 60_000;
    infos.length = 0;
    const before = sent();
    getCurrentSyncEngine()!.requestPush();
    await settle(6_000);
    expect(patches(before)).toHaveLength(1); // met the wall
    expect(infos.some(l => l.startsWith("OnlyWorlds refused too many different World PINs for this world's key"))).toBe(true);
    expect(shown).toEqual([]); // no failure toast ("could not sync")
    expect(rateWaitOf(KEY)).toMatchObject({ pin: true });
    const mid = sent();
    await settle(40_000);
    expect(sent()).toBe(mid);
    await settle(30_000);
    expect(patches(mid)).toHaveLength(1);
    expect(patches(mid).map(s => s.pin)).toEqual([RIGHT]);
  });

  it('a world opened inside a wait with only its settings unsent: nothing inside the wait, one PATCH at its end', async () => {
    const folder = await seededWorld();
    detachSyncEngine();
    await folder.writeWorldMeta({ description: 'edited while away' } as never);
    setRateWait(KEY, 60_000, true);
    const before = sent();
    attachSyncEngine(entry('w1', KEY), folder);
    await settle(30_000);
    expect(sent()).toBe(before);
    await settle(40_000);
    expect(patches(before)).toHaveLength(1);
  });

  it('unticking a pause with the PIN refused sends nothing; the pill keeps the refusal, and the toggle says it', async () => {
    useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    const engine = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    engine.pause('manual');
    expect(getState().sync.activeSync).toMatchObject({ kind: 'error', auth_reason: 'pin' });
    expect(engine.resume()).toBe(false);
    await settle(60_000);
    expect(keel.seen).toEqual([]);
    expect(getState().sync.activeSync).toMatchObject({ kind: 'error', auth_reason: 'pin' });
    expect(refusedEngineLine()).toBe('Sync paused: OnlyWorlds did not accept this World PIN. Check it in Settings, OnlyWorlds.');
  });

  it('a big batch held at open with the PIN refused: the pill shows the refusal; Upload them keeps the question and says the refusal', async () => {
    useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    setActiveStore(folder as never);
    holdBigBatchAtOpen('w1', 300, { hold: async () => () => {} });
    const engine = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    expect(engine.isHeld()).toBe(true);
    expect(getState().sync.activeSync).toMatchObject({ kind: 'error', auth_reason: 'pin' });
    await answerHeldBatch(true);
    await settle(10_000);
    // Nothing uploads under a refused PIN: the question is not spent, and is asked again after a new PIN.
    expect(isDiskHoldPersisted('w1')).toBe(true);
    expect(errors).toContain('Sync paused: OnlyWorlds did not accept this World PIN. Check it in Settings, OnlyWorlds.');
    expect(getState().sync.activeSync).toMatchObject({ kind: 'error', auth_reason: 'pin' });
    expect(keel.seen).toEqual([]);
    patchSlice('registry', setPin(getState().registry, RIGHT));
    const next = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    expect(next.isHeld()).toBe(true);
    expect(writes()).toEqual([]);
  });

  it('another tab\'s new PIN, proved there, brings this tab\'s refused engine back; the same refused PIN again sends nothing', async () => {
    const reg = useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    const first = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    // The same refused PIN stored again (a save here of the same value, another tab's echo): nothing.
    patchSlice('registry', { ...reg });
    await settle(1_000);
    expect(getCurrentSyncEngine()).toBe(first);
    expect(keel.seen).toEqual([]);
    // Another tab saved and proved a new PIN: the storage event brings it here.
    patchSlice('registry', { ...getState().registry, pin: RIGHT, pin_state: 'proved' });
    await settle(1_000);
    expect(getCurrentSyncEngine()).not.toBe(first);
    expect(writes().map(s => s.pin)).toEqual([RIGHT]);
  });

  it('a 429 on the world-settings read (a general throttle) stops the round there: its words, no failure, no element sent until the wait ends', async () => {
    const folder = await seededWorld();
    await folder.writeWorldMeta({ description: 'changed here' } as never);
    await folder.createElement('character', { name: 'Also waiting' });
    keel.throttleUntil = Date.now() + 30_000;
    infos.length = 0;
    const before = sent();
    getCurrentSyncEngine()!.requestPush();
    await settle(6_000);
    expect(keel.seen.slice(before).map(s => s.call)).toEqual(['GET /world']);
    expect(infos.filter(l => l.startsWith('OnlyWorlds asked Atlas to wait. Your changes are saved in the folder'))).toHaveLength(1);
    expect(shown).toEqual([]);
    const mid = sent();
    await settle(15_000);
    expect(sent()).toBe(mid);
    await settle(15_000);
    const after = keel.seen.slice(mid).map(s => s.call);
    expect(after.filter(c => c === 'PATCH /world')).toHaveLength(1);
    expect(after.filter(c => c.startsWith('POST'))).toHaveLength(1);
  });

  it('the engine: a refusal set while a hold stands comes back when the hold is released, never "paused"', async () => {
    const folder = await newFolder();
    const engine = new SyncEngine({ folder, client: new FakeOwApiClient() });
    try {
      const release = await engine.hold('disk');
      engine.startRefused('pin');
      expect(engine.getState()).toMatchObject({ kind: 'error', auth_reason: 'pin' });
      release();
      expect(engine.getState()).toMatchObject({ kind: 'error', auth_reason: 'pin' });
      expect(engine.resume()).toBe(false);
    } finally {
      engine.stop();
    }
  });

  it('the pill says the wait while one runs, never "Synced just now"', async () => {
    useRegistry(RIGHT, 'proved');
    keel.lockedUntil[KEY] = Date.now() + 120_000;
    const folder = await newFolder(['First']);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    const { mountRightPane } = await import('../../src/tabs/right/right-pane');
    const tabBar = document.createElement('div');
    const pane = document.createElement('div');
    document.body.append(tabBar, pane);
    const toasts = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } as unknown as ToastManager;
    const unmount = mountRightPane({ tabBar, pane, toasts });
    try {
      const pill = document.querySelector<HTMLElement>('[data-role="sync-pill"]')!;
      expect(pill.textContent).toContain('Waiting');
      expect(pill.textContent).not.toMatch(/Synced/);
      expect(pill.title).toBe(WALL_LINE(waitWords(getCurrentSyncEngine()!.rateWaitNow()!.leftMs)));
      expect(getState().sync.activeSync).toMatchObject({ kind: 'idle', last_sync_at: null });
    } finally {
      unmount();
    }
  });
});

describe('round 3: a press on a stopped engine, the same PIN proved elsewhere, a held pull', () => {
  async function waitingEngine(): Promise<{ folder: MockFolderStore; engine: ReturnType<typeof getCurrentSyncEngine> }> {
    useRegistry(RIGHT, 'proved');
    const folder = await newFolder();
    const engine = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    await folder.createElement('character', { name: 'Waiting' });
    setRateWait(KEY, 60_000, false);
    return { folder, engine };
  }

  it('a press inside a wait on a paused, offline or held engine says that state, never "tries again in"', async () => {
    const { engine } = await waitingEngine();
    const before = sent();
    infos.length = 0;
    engine!.pause('manual');
    expect(sayRateWait()).toBe(true);
    await pullNowAndRefresh();
    engine!.resume();
    engine!.pause('network');
    expect(sayRateWait()).toBe(true);
    engine!.resume();
    const release = await engine!.hold('disk');
    expect(sayRateWait()).toBe(true);
    release();
    expect(infos.slice(0, 4)).toEqual([
      'Sync is paused. Turn off Pause sync or Pause all sync in Settings to refresh.',
      'Sync is paused. Turn off Pause sync or Pause all sync in Settings to refresh.',
      'Offline, so nothing was refreshed.',
      'Files changed on disk are waiting for your answer in the element list.',
    ]);
    expect(infos.some(l => /tries again in/.test(l))).toBe(false);
    expect(sent()).toBe(before);
  });

  it('the same refused PIN recorded proved by another tab, again and again: one more try, never a loop', async () => {
    useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    for (let i = 0; i < 3; i++) {
      patchSlice('registry', { ...getState().registry, pin_state: 'proved' });
      await settle(2_000);
    }
    expect(writes().map(s => s.pin)).toEqual([WRONG]);
    // A new PIN still brings it back.
    patchSlice('registry', { ...getState().registry, pin: RIGHT, pin_state: undefined });
    await settle(2_000);
    expect(writes().map(s => s.pin)).toEqual([WRONG, RIGHT]);
  });

  it('a pull held by a wait is carried: the retry at the wait\'s end runs a full round, its pull included', async () => {
    useRegistry(RIGHT, 'proved');
    const folder = await newFolder();
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    setRateWait(KEY, 60_000, false);
    const before = sent();
    await pullNowAndRefresh({ auto: true });
    await settle(30_000);
    expect(sent()).toBe(before);
    expect(infos.filter(l => l.startsWith('OnlyWorlds asked Atlas to wait'))).toEqual([]);
    await settle(31_000);
    const after = keel.seen.slice(before).map(s => s.call);
    expect(after.some(c => c.startsWith('GET /changes'))).toBe(true);
  });
});

describe('round 4: a press that proves the PIN gives its try back; a held pull outlives no wait', () => {
  it('refused, revived once by another tab\'s proof and refused again, then the person\'s own Test connection proves it: sync comes back', async () => {
    useRegistry(WRONG, 'refused');
    const folder = await newFolder(['Waiting']);
    setActiveStore(folder as never);
    attachSyncEngine(entry('w1', KEY), folder);
    await settle();
    // Another tab records the same PIN proved (beside another account's key): one try, refused here.
    patchSlice('registry', { ...getState().registry, pin_state: 'proved' });
    await settle(2_000);
    expect(writes().map(s => s.pin)).toEqual([WRONG]);
    expect(getState().registry.pin_state).toBe('refused');
    // The PIN is put right on OnlyWorlds, and the person presses Test connection.
    keel.worldPin = WRONG;
    const said = { success: vi.fn(), info: vi.fn(), error: vi.fn(), warning: vi.fn() } as unknown as ToastManager;
    await testWorldConnection(getState().registry.worlds[0], said);
    await settle(2_000);
    expect(getState().registry.pin_state).toBe('proved');
    expect(writes().map(s => s.pin)).toEqual([WRONG, WRONG]);
    expect(getState().sync.activeSync?.kind).toBe('idle');
    expect(await unstamped(folder)).toEqual([]);
  });

  it('a held pull whose wait ends while paused goes with the resume\'s round, and a later retry is a push alone', async () => {
    useRegistry(RIGHT, 'proved');
    const folder = await newFolder();
    const engine = attachSyncEngine(entry('w1', KEY), folder)!;
    await settle();
    setRateWait(KEY, 30_000, false);
    await pullNowAndRefresh({ auto: true });
    engine.pause('manual');
    const before = sent();
    await settle(40_000);
    expect(sent()).toBe(before);
    engine.resume();
    await settle(1_000);
    expect(keel.seen.slice(before).some(s => s.call.startsWith('GET /changes'))).toBe(true);
    // A later wait with an edit, no pull held: its retry pushes alone.
    const mid = sent();
    await folder.createElement('character', { name: 'Later' });
    setRateWait(KEY, 20_000, false);
    engine.requestPush();
    await settle(25_000);
    const after = keel.seen.slice(mid).map(s => s.call);
    expect(after.filter(c => c.startsWith('POST'))).toHaveLength(1);
    expect(after.some(c => c.startsWith('GET /changes'))).toBe(false);
  });
});
