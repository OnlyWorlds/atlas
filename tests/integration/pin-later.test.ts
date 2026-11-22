/**
 * An owner's world opened with no PIN asked (1.125.0, 2026-11-22, R3), through the real attach, the real engine
 * and the real adapter on the played keel (`played-keel-pin.ts`): the world waits on the World PIN with no
 * engine; its first change says so once; the World PIN dialog asks keel before it keeps anything; Settings'
 * field asks first and then attaches on every answer; a PIN removed detaches; a PIN that arrives from
 * another tab attaches the world after one question.
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
import { DEFAULT_V2_BASE } from '../../src/sync/ow-v2-client-adapter';
import {
  attachSyncEngine, detachSyncEngine, diagnoseSyncUnavailable, firstChangeLine, getCurrentSyncEngine,
  requestPushIfLinked, __resetFirstChangeToldForTests, __resetSamePinRevivedForTests,
} from '../../src/sync/sync-attach';
import { setPin } from '../../src/registry/registry';
import { toastManager } from '../../src/ui/toast-manager';
import { __resetRateWaitsForTests } from '../../src/sync/rate-wait';
import { __resetPinAskedForTests, __setPinAskTimeoutForTests, renderAccountTab, wireAccountTab } from '../../src/middle/settings-account';
import { askWorldPin, WORLD_PIN_REFUSED_LINE, worldPinLine } from '../../src/ui/world-pin-modal';
import { surfaceSyncUnavailable } from '../../src/ui/sync-toasts';
import { waitsOnPin } from '../../src/core/saves-online';
import { CANNOT_REACH_LINE } from '../../src/setup/key-check-errors';

const BASE = DEFAULT_V2_BASE;
const KEY = 'ow_w_owner_later';
const RIGHT = '1234';
const WRONG = '9999';

let keel: PlayedKeel;

function entry(id: string, key = KEY): WorldRegistryEntry {
  return {
    id, name: id === 'w1' ? 'Tangle ground' : id, state: 'api-linked',
    api: { world_id: 'w-played', api_key: key },
    folder: { handle_key: `vault-${id}`, folder_name: id },
    created_at: '2026-01-01T00:00:00Z',
  };
}

/** The open world `w1`, linked, with no PIN kept (or `pin`), its store active. */
async function openWithNoPin(pin?: string, names: string[] = []): Promise<MockFolderStore> {
  const worlds = [entry('w1'), entry('w2', 'ow_w_second')];
  patchSlice('registry', { ...setPin(defaultRegistry(), pin), worlds });
  patchSlice('active', { worldId: 'w1', meta: { name: 'Tangle ground' } } as never);
  const folder = new MockFolderStore();
  await folder.open(null);
  for (const name of names) await folder.createElement('character', { name });
  setActiveStore(folder as never);
  return folder;
}

const withPin = () => keel.seen.filter(s => s.pin !== null);
const writes = () => keel.seen.filter(s => !s.call.startsWith('GET'));

async function settle(ms = 50): Promise<void> {
  for (let i = 0; i < 4; i++) await vi.advanceTimersByTimeAsync(ms / 4);
}

let shown: Array<{ msg: string; actions: string[] }>;
/** The toasts' action presses, in order. */
let runs: Array<() => void>;
let successes: string[];
/** Every line said, and whether an engine was attached when it was: the door's own attach, never the watch's later one. */
let said: Array<{ msg: string; engine: boolean }>;
let dismissed: string[];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-11-22T08:00:00Z'));
  detachSyncEngine();
  __resetRateWaitsForTests();
  __resetPinAskedForTests();
  __resetSamePinRevivedForTests();
  __resetFirstChangeToldForTests();
  const played = playedKeel(BASE, { keys: { [KEY]: { scope: 'write' }, ow_w_second: { scope: 'write' } }, worldPin: RIGHT });
  keel = played.state;
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(
    played.gate,
    http.get(`${BASE}/members`, () => HttpResponse.json({ results: [], next: null })),
    ...statefulV2Handlers({ baseUrl: BASE, clock: clock.next }).handlers,
  );
  shown = [];
  runs = [];
  vi.spyOn(toastManager, 'show').mockImplementation((m: string, _k?: unknown, _d?: unknown, o?: { actions?: Array<{ label: string; run: () => void }> }) => {
    shown.push({ msg: m, actions: o?.actions?.map(a => a.label) ?? [] });
    runs.push(...(o?.actions?.map(a => a.run) ?? []));
    return undefined as never;
  });
  successes = [];
  said = [];
  dismissed = [];
  vi.spyOn(toastManager, 'dismiss').mockImplementation((k: string) => { dismissed.push(k); });
  const note = (m: string) => { said.push({ msg: m, engine: !!getCurrentSyncEngine() }); return undefined as never; };
  vi.spyOn(toastManager, 'success').mockImplementation((m: string) => { successes.push(m); return note(m); });
  vi.spyOn(toastManager, 'info').mockImplementation(note);
  vi.spyOn(toastManager, 'error').mockImplementation(note);
});

afterEach(() => {
  detachSyncEngine();
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
  __setPinAskTimeoutForTests(15_000);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const dialog = () => document.querySelector<HTMLElement>('[data-modal="world-pin"]');
async function giveInDialog(pin: string): Promise<void> {
  dialog()!.querySelector<HTMLInputElement>('input[name="pin"]')!.value = pin;
  dialog()!.querySelector<HTMLFormElement>('form')!.requestSubmit();
  await settle(200);
}

describe('the world waits on the World PIN', () => {
  it('no engine, the reason pin-missing, and the first change says so once a session per world', async () => {
    const folder = await openWithNoPin();
    expect(attachSyncEngine(entry('w1'), folder)).toBeNull();
    expect(diagnoseSyncUnavailable()).toEqual({ kind: 'pin-missing', worldId: 'w1' });
    expect(waitsOnPin(getState().registry.worlds[0], getState().registry)).toBe(true);
    requestPushIfLinked();
    requestPushIfLinked();
    expect(shown).toEqual([{ msg: firstChangeLine('Tangle ground'), actions: ['Add PIN'] }]);
    expect(firstChangeLine('Tangle ground')).toBe('Your change to "Tangle ground" is kept here. Add your World PIN to save it to OnlyWorlds.');
    expect(keel.seen).toEqual([]);
  });

  it('the line is its world\'s: another world opened takes it down, and its Add PIN asks nothing there', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    requestPushIfLinked();
    expect(runs).toHaveLength(1);
    // The person opens w2 (no engine there either; its own question is the pill's).
    patchSlice('active', { worldId: 'w2', meta: { name: 'w2' } } as never);
    expect(dismissed).toContain('pin-waits:w1');
    runs[0]();
    await settle();
    expect(document.querySelector('[data-modal="world-pin"]')).toBeNull();
    // Back in w1, its own press opens it.
    patchSlice('active', { worldId: 'w1', meta: { name: 'Tangle ground' } } as never);
    runs[0]();
    await settle();
    expect(document.querySelector('[data-modal="world-pin"]')).not.toBeNull();
  });

  it('a world with its PIN kept says nothing of the PIN on a change', async () => {
    const folder = await openWithNoPin(RIGHT);
    attachSyncEngine(entry('w1'), folder);
    requestPushIfLinked();
    expect(shown).toEqual([]);
  });
});

describe('the World PIN dialog', () => {
  it('one at a time, named; proved: kept with its state, the dialog closes, the engine attaches and pushes what waited', async () => {
    const folder = await openWithNoPin(undefined, ['Waited here']);
    attachSyncEngine(entry('w1'), folder);
    askWorldPin(toastManager);
    surfaceSyncUnavailable(toastManager); // the pill's press, with the dialog up
    await settle();
    expect(document.querySelectorAll('[data-modal="world-pin"]')).toHaveLength(1);
    expect(dialog()!.querySelector('.atlas-modal-title')?.textContent).toBe('World PIN');
    expect(dialog()!.textContent).toContain(worldPinLine('Tangle ground'));
    await giveInDialog(RIGHT);
    expect(dialog()).toBeNull();
    // The dialog attached it itself, before it said so; the first change's line is taken down.
    expect(said).toContainEqual({ msg: 'World PIN saved. Your changes save to OnlyWorlds now.', engine: true });
    expect(dismissed).toContain('pin-waits:w1');
    expect(getState().registry).toMatchObject({ pin: RIGHT, pin_state: 'proved' });
    expect(getCurrentSyncEngine()).not.toBeNull();
    await settle(8_000);
    // What waited went up with the PIN: the element made before it.
    expect(writes().map(s => s.call)).toContain('POST /character');
    expect(new Set(writes().map(s => s.pin))).toEqual(new Set([RIGHT]));
    expect(withPin()[0].call).toBe('GET /me');
  });

  it('refused: the dialog stays, the field cleared, the line under it, nothing kept and no write sent', async () => {
    const folder = await openWithNoPin(undefined, ['Waited here']);
    attachSyncEngine(entry('w1'), folder);
    askWorldPin(toastManager);
    await giveInDialog(WRONG);
    expect(dialog()).not.toBeNull();
    expect(dialog()!.querySelector<HTMLInputElement>('input[name="pin"]')!.value).toBe('');
    expect(dialog()!.querySelector('[data-role="error"]')!.textContent).toBe(WORLD_PIN_REFUSED_LINE);
    expect(getState().registry.pin).toBeUndefined();
    expect(getCurrentSyncEngine()).toBeNull();
    await settle(8_000);
    expect(writes()).toEqual([]);
    expect(withPin().map(s => s.call)).toEqual(['GET /me']);
  });

  it('a timeout is said in place: nothing kept, and Continue can be pressed again', async () => {
    __setPinAskTimeoutForTests(60);
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    mswServer.use(http.get(`${BASE}/me`, () => new Promise<Response>(() => {})));
    askWorldPin(toastManager);
    await giveInDialog(RIGHT);
    expect(dialog()!.querySelector('[data-role="error"]')!.textContent).toBe(CANNOT_REACH_LINE);
    expect(getState().registry.pin).toBeUndefined();
    expect(dialog()!.querySelector<HTMLButtonElement>('[data-action="confirm"]')!.disabled).toBe(false);
    expect(dialog()!.querySelector<HTMLButtonElement>('[data-action="confirm"]')!.textContent).toBe('Continue');
  });

  it('a wait (keel\'s 429) is said in place, in its own words, nothing kept', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    keel.throttleUntil = Date.now() + 30_000;
    askWorldPin(toastManager);
    await giveInDialog(RIGHT);
    expect(dialog()!.querySelector('[data-role="error"]')!.textContent).toMatch(/^OnlyWorlds asked Atlas to wait\. Try again in \d+ seconds\.$/);
    expect(getState().registry.pin).toBeUndefined();
  });

  it('the pill\'s press and Refresh (`surfaceSyncUnavailable`) open it here, never Settings', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    window.location.hash = '#/w/w1';
    surfaceSyncUnavailable(toastManager);
    await settle();
    expect(dialog()).not.toBeNull();
    expect(window.location.hash).toBe('#/w/w1');
  });

  it('Cancel changes nothing', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    askWorldPin(toastManager);
    dialog()!.querySelector<HTMLButtonElement>('[data-action="cancel"]')!.click();
    expect(dialog()).toBeNull();
    expect(getState().registry.pin).toBeUndefined();
    expect(keel.seen).toEqual([]);
  });
});

describe('Settings\' field asks first, then attaches on every answer', () => {
  function settings() {
    document.body.innerHTML = `<div class="atlas-settings">${renderAccountTab(getState().registry)}</div>`;
    wireAccountTab(toastManager);
    const field = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]')!;
    return async (pin: string) => {
      field.value = pin;
      field.dispatchEvent(new Event('change'));
    };
  }

  it('proved: no engine while the question is out, then one; the PIN reached keel once', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    let answer: () => void = () => {};
    mswServer.use(http.get(`${BASE}/me`, async ({ request }) => {
      keel.seen.push({ call: 'GET /me', key: request.headers.get('API-Key'), pin: request.headers.get('API-Pin') });
      await new Promise<void>(r => { answer = r; });
      return HttpResponse.json({ world: { id: 'w-played' }, scope: 'write', kind: 'owner', role: 'owner' });
    }));
    await settings()(RIGHT);
    await settle(200);
    expect(getCurrentSyncEngine()).toBeNull();
    answer();
    await settle(200);
    expect(getCurrentSyncEngine()).not.toBeNull();
    expect(getState().registry.pin_state).toBe('proved');
    await settle(8_000);
    // The watch shared the question: one /me, never a second beside it.
    expect(keel.seen.filter(s => s.call === 'GET /me')).toHaveLength(1);
  });

  it('refused: the engine attaches stopped on the PIN, and no write is sent', async () => {
    const folder = await openWithNoPin(undefined, ['Waited here']);
    attachSyncEngine(entry('w1'), folder);
    await settings()(WRONG);
    await settle(200);
    // Settings attached it itself, before it said the refusal.
    expect(said).toContainEqual({ msg: 'OnlyWorlds did not accept this PIN. Check it and save it again.', engine: true });
    const engine = getCurrentSyncEngine();
    expect(engine).not.toBeNull();
    expect(engine!.authRefusal()).toBe('pin');
    expect(diagnoseSyncUnavailable()).toBeNull();
    await settle(8_000);
    expect(writes()).toEqual([]);
    expect(withPin().map(s => s.call)).toEqual(['GET /me']);
  });

  it('no answer: the engine attaches when the question ends, and Home reads the world online only once a PIN is kept', async () => {
    __setPinAskTimeoutForTests(60);
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    expect(waitsOnPin(getState().registry.worlds[0], getState().registry)).toBe(true);
    mswServer.use(http.get(`${BASE}/me`, () => new Promise<Response>(() => {})));
    await settings()(RIGHT);
    await settle(500);
    expect(getCurrentSyncEngine()).not.toBeNull();
    expect(said).toContainEqual({ msg: 'Not checked by OnlyWorlds yet', engine: true });
    expect(waitsOnPin(getState().registry.worlds[0], getState().registry)).toBe(false);
  });

  it('a world switched while the question was out is never attached to another\'s store', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    let answer: () => void = () => {};
    mswServer.use(http.get(`${BASE}/me`, async () => {
      await new Promise<void>(r => { answer = r; });
      return HttpResponse.json({ world: { id: 'w-played' }, scope: 'write', kind: 'owner', role: 'owner' });
    }));
    await settings()(RIGHT);
    await settle(200);
    // The person opens w2 meanwhile: its own activation attaches it on the PIN now kept.
    const other = new MockFolderStore();
    await other.open(null);
    patchSlice('active', { worldId: 'w2', meta: { name: 'w2' } } as never);
    setActiveStore(other as never);
    const second = attachSyncEngine(getState().registry.worlds[1], other);
    answer();
    await settle(200);
    expect(getCurrentSyncEngine()).toBe(second);
  });

  it('a PIN removed detaches the open world\'s engine: the pill says Add PIN, and the world reads not online', async () => {
    const folder = await openWithNoPin(RIGHT);
    attachSyncEngine(entry('w1'), folder);
    expect(getCurrentSyncEngine()).not.toBeNull();
    await settings()('');
    expect(getCurrentSyncEngine()).toBeNull();
    expect(diagnoseSyncUnavailable()).toEqual({ kind: 'pin-missing', worldId: 'w1' });
  });
});

describe('a PIN removed in another tab', () => {
  it('detaches this tab\'s engine on it, as one removed here does', async () => {
    const folder = await openWithNoPin(RIGHT);
    attachSyncEngine(entry('w1'), folder);
    expect(getCurrentSyncEngine()).not.toBeNull();
    patchSlice('registry', setPin(getState().registry, undefined));
    expect(getCurrentSyncEngine()).toBeNull();
    expect(diagnoseSyncUnavailable()).toEqual({ kind: 'pin-missing', worldId: 'w1' });
  });
});

describe('a PIN that arrives from another tab', () => {
  it('attaches the world that waited, after one question', async () => {
    const folder = await openWithNoPin(undefined, ['Waited here']);
    attachSyncEngine(entry('w1'), folder);
    // Another tab saved the PIN (the registry's storage event brings it here, not checked there yet).
    patchSlice('registry', { ...getState().registry, pin: RIGHT });
    await settle(500);
    expect(getCurrentSyncEngine()).not.toBeNull();
    expect(keel.seen.filter(s => s.call === 'GET /me' && s.pin === RIGHT)).toHaveLength(1);
    await settle(8_000);
    expect(writes().map(s => s.call)).toContain('POST /character');
    expect(new Set(writes().map(s => s.pin))).toEqual(new Set([RIGHT]));
  });

  it('recorded proved there: attaches with no question here', async () => {
    const folder = await openWithNoPin();
    attachSyncEngine(entry('w1'), folder);
    patchSlice('registry', { ...getState().registry, pin: RIGHT, pin_state: 'proved' });
    await settle(500);
    expect(getCurrentSyncEngine()).not.toBeNull();
    expect(keel.seen.filter(s => s.call === 'GET /me')).toHaveLength(0);
  });
});
