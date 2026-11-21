/**
 * No PIN beside a read key (1.124.31). keel reads a PIN sent beside a key that
 * cannot write today, and a wrong one counts against the account the PIN
 * belongs to; after its change it reads none. Atlas sends none either way:
 * the world's read-only state comes from `GET /me`'s scope, and a PIN is kept
 * as the account's only once a key that writes proves it.
 *
 * Every rule runs against the played keel both ways (`played-keel-pin.ts`):
 * as keel answers today, and as after the change.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { statefulV2Handlers } from '../msw-handlers';
import { playedKeel, type PlayedKeel, type ReadKeyPin } from '../fixtures/played-keel-pin';
import { MonotonicClock } from '../fixtures/monotonic-clock';
import { patchSlice, getState, subscribe } from '../../src/core/state';
import { defaultRegistry, type WorldRegistryEntry } from '../../src/core/types';
import { setActiveStore } from '../../src/core/active-store';
import { FakeDirHandle } from '../fixtures/fake-fs';
import { setOpfsRootForTests } from '../../src/core/browser-worlds';
import { OwV2ClientAdapter, OwV2Error } from '../../src/sync/ow-v2-client-adapter';

const TEST_BASE = 'https://test-ow.local/api/v2';

vi.mock('../../src/store/handle-vault', () => ({
  storeHandle: vi.fn(async () => {}),
  loadHandle: async () => null,
  ensureWritable: async () => true,
  queryWritable: async () => true,
  deleteHandle: async () => {},
  listHandleKeys: async () => [],
}));
vi.mock('../../src/store/folder-store-fs', async () => {
  const { MockFolderStore } = await import('../fixtures/mock-folder-store');
  return { FsFolderStore: MockFolderStore };
});
vi.mock('../../src/setup/browser-first-download', () => import('../fixtures/mock-first-download'));
vi.mock('../../src/sync/make-online', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/make-online')>()),
  buildV2Adapter: (apiKey: string, apiPin: string) => new OwV2ClientAdapter({ apiKey, apiPin, baseUrl: TEST_BASE }),
}));
vi.mock('../../src/sync/sync-attach', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/sync-attach')>()),
  attachSyncEngine: vi.fn(),
}));

import { linkExistingApiWorldInRoot } from '../../src/setup/atlas-root-flow';
import { checkNewKey, keepPinProvedBy } from '../../src/sync/world-key';
import { testWorldConnection } from '../../src/middle/settings-world';
import { problemFor } from '../../src/core/problems';
import { SharingClient } from '../../src/sync/sharing-client';
import { rosterFor } from '../../src/sync/world-roster';
import { removeFile } from '../../src/sync/element-files';
import { adoptStoredRegistry, createApiLinkedWorld, loadRegistry, mergeRegistry, saveRegistry, setPin } from '../../src/registry/registry';
import { notePinState, recordPinState } from '../../src/registry/pin-proof';
import { __setRegistryTabBaseForTests, storedRegistry } from '../../src/registry/registry';
import { pushProvedPin } from '../../src/ui/make-online-modal';
import { keyRefusalHere, keyRefusalPill, keyRefusalLine } from '../../src/sync/world-key-lines';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { diagnoseSyncUnavailable } from '../../src/sync/sync-attach';
import { removePicture, uploadPicture } from '../../src/sync/media-upload';
import { MakeOnlineModal } from '../../src/ui/make-online-modal';
import { ToastManager } from '../../src/ui/toast-manager';
import { MockFolderStore } from '../fixtures/mock-folder-store';
import { renderAccountTab, wireAccountTab, pinStateLine, __resetPinAskedForTests, beginSettingsOpening, PIN_REFUSED_LINE } from '../../src/middle/settings-account';
import { mountSettingsPanel } from '../../src/middle/settings-panel';
import { settingsHash } from '../../src/core/router';

const KEYS = {
  'ow_r_owner': { scope: 'read' as const },
  'ow_w_owner': { scope: 'write' as const },
  'ow_r_guest': { scope: 'read' as const, member: 'person' as const },
  'odd-read-key': { scope: 'read' as const },
};
const WRONG = '9999';
const RIGHT = '1234';

let keel: PlayedKeel;
let worldSeq = 0;

function setUp(mode: ReadKeyPin): void {
  const played = playedKeel(TEST_BASE, { keys: KEYS, readKeyPin: mode, worldPin: RIGHT });
  keel = played.state;
  const clock = new MonotonicClock('2026-01-01T00:00:00.000Z');
  mswServer.use(played.gate, ...statefulV2Handlers({ baseUrl: TEST_BASE, clock: clock.next }).handlers);
}

const link = (over: Partial<Parameters<typeof linkExistingApiWorldInRoot>[0]>) =>
  linkExistingApiWorldInRoot({ where: 'browser', apiKey: 'ow_w_owner', apiPin: RIGHT, ...over });

/** The PINs sent beside one key, in order. */
const pinsBeside = (key: string) => keel.seen.filter(s => s.key === key).map(s => s.pin);

function linked(api: Partial<NonNullable<WorldRegistryEntry['api']>>): WorldRegistryEntry {
  worldSeq += 1;
  return {
    id: `local-${worldSeq}`, name: 'Here', state: 'api-linked',
    api: { world_id: 'w-played', api_key: 'ow_r_owner', world_name: 'Played world', ...api },
    folder: { handle_key: `vault-${worldSeq}`, folder_name: 'here' },
    created_at: '2026-01-01T00:00:00Z',
  };
}

function fakeToasts() {
  const said: Array<{ kind: string; line: string }> = [];
  const toasts = {
    success: (line: string) => said.push({ kind: 'success', line }),
    error: (line: string) => said.push({ kind: 'error', line }),
    info: (line: string) => said.push({ kind: 'info', line }),
  } as unknown as ToastManager;
  return { said, toasts };
}

beforeEach(() => {
  setOpfsRootForTests(async () => new FakeDirHandle('opfs') as unknown as FileSystemDirectoryHandle);
  setActiveStore(null);
  patchSlice('active', null);
  patchSlice('registry', { ...defaultRegistry(), worlds: [] });
});
afterEach(() => {
  setOpfsRootForTests(null);
  mswServer.resetHandlers();
  vi.restoreAllMocks();
});

describe.each(['checked', 'ignored'] as const)('keel reading a PIN beside a read key: %s', (mode) => {
  beforeEach(() => setUp(mode));

  describe('no PIN goes beside a read key', () => {
    it('the adapter: not on /world, /me, a list or a write, though it holds one', async () => {
      const a = new OwV2ClientAdapter({ apiKey: 'ow_r_owner', apiPin: WRONG, baseUrl: TEST_BASE });
      await a.getWorld();
      await a.me();
      await a.keyScope();
      await a.listElements('character');
      const refused = await a.updateElement('character', 'c-1', { description: 'x' }).then(() => null, (e: unknown) => e);
      expect((refused as OwV2Error).code).toBe('permission_error');
      expect(pinsBeside('ow_r_owner').every(p => p === null)).toBe(true);
      expect(keel.counted).toEqual({});
    });

    it('a member\'s read key on /me', async () => {
      const a = new OwV2ClientAdapter({ apiKey: 'ow_r_guest', apiPin: WRONG, baseUrl: TEST_BASE });
      await expect(a.me()).resolves.toMatchObject({ scope: 'read' });
      expect(pinsBeside('ow_r_guest')).toEqual([null]);
      expect(keel.counted).toEqual({});
    });

    it('the sharing client and the roster\'s SDK client', async () => {
      const headers: Array<string | null> = [];
      const fetchFn = (async (_url: string, init: RequestInit) => {
        headers.push(new Headers(init.headers).get('API-Pin'));
        return new Response(JSON.stringify([]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }) as unknown as typeof fetch;
      await new SharingClient({ apiKey: 'ow_r_owner', pin: WRONG, baseUrl: 'https://share.test', fetchFn }).listForWorld('w-played');
      await new SharingClient({ apiKey: 'ow_w_owner', pin: RIGHT, baseUrl: 'https://share.test', fetchFn }).listForWorld('w-played');
      expect(headers).toEqual([null, RIGHT]);

      const rosterPins: Array<string | null> = [];
      mswServer.use(http.get('*/api/v2/members*', ({ request }) => {
        rosterPins.push(request.headers.get('API-Pin'));
        return HttpResponse.json({ data: [{ id: null, kind: 'owner', role: 'owner', character: null, status: 'active' }] });
      }), http.get('*/api/v2/me', ({ request }) => {
        rosterPins.push(request.headers.get('API-Pin'));
        return HttpResponse.json({ world: { id: 'w-played', name: 'Played world' }, scope: 'read', role: 'guest', membership: 'mem-1' });
      }));
      await rosterFor(linked({ api_key: 'ow_r_owner' }), Date.now, { maxAgeMs: 0, pin: WRONG });
      expect(rosterPins.length).toBeGreaterThan(0);
      expect(rosterPins.every(p => p === null)).toBe(true);
    });

    it('a file or picture write on a world whose key reads: said as the key, nothing sent', async () => {
      const entry = linked({ api_key: 'ow_r_owner' });
      const reg = { ...defaultRegistry(), pin: WRONG, worlds: [entry] };
      await expect(removeFile(entry, reg, 'character', 'c-1', 'f-1')).rejects.toThrow(/key can only read/);
      await expect(uploadPicture(entry, reg, new Blob(['x'], { type: 'image/png' }))).rejects.toThrow(/key can only read/);
      await expect(removePicture(entry, reg, 'u/w-played/a.png')).rejects.toThrow(/key can only read/);
      expect(keel.seen).toEqual([]);
    });
  });

  describe('the read-only state comes from /me, and a pasted read key asks no PIN', () => {
    it('Download a world given a read key and a wrong saved PIN: opens to read, no PIN sent or kept', async () => {
      const { entry } = await link({ apiKey: 'ow_r_owner', apiPin: WRONG });
      expect(entry.api?.read_only).toBe(true);
      expect(getState().registry.pin).toBeUndefined();
      expect(pinsBeside('ow_r_owner').every(p => p === null)).toBe(true);
      expect(keel.counted).toEqual({});
    });

    it('a read key with the PIN field empty opens too (no "Enter your PIN")', async () => {
      const { entry } = await link({ apiKey: 'ow_r_owner', apiPin: '' });
      expect(entry.api?.read_only).toBe(true);
    });

    it('Make online\'s link refuses a read key in words, by its shape or by /me, with no PIN sent', async () => {
      document.body.innerHTML = '<div class="atlas-shell"></div>';
      const store = new MockFolderStore();
      await store.open(null);
      setActiveStore(store as never);
      patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } } as never] });
      patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
      try {
        for (const key of ['ow_r_owner', 'odd-read-key']) {
          new MakeOnlineModal(new ToastManager()).open();
          const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
          modal.querySelector<HTMLButtonElement>('[data-route-tab="link"]')!.click();
          modal.querySelector<HTMLInputElement>('input[name="link-api-key"]')!.value = key;
          modal.querySelector<HTMLInputElement>('input[name="link-pin"]')!.value = WRONG;
          modal.querySelector<HTMLFormElement>('[data-form="link-route"]')!.requestSubmit();
          const error = modal.querySelector<HTMLElement>('[data-role="link-error"]')!;
          await vi.waitFor(() => expect(error.textContent).toMatch(/That key can only read/), { timeout: 3000 });
          modal.closest('.atlas-modal-overlay')?.remove();
          modal.remove();
        }
        expect(keel.seen.every(s => s.pin === null)).toBe(true);
        expect(keel.seen.some(s => s.call.startsWith('POST') || s.call.startsWith('PATCH'))).toBe(false);
        expect(getState().registry.worlds[0].state).toBe('local-only');
      } finally {
        document.body.innerHTML = '';
      }
    });

    it('Make online\'s link given a read key and an empty PIN field: the key\'s words, never "PIN is required"', async () => {
      document.body.innerHTML = '<div class="atlas-shell"></div>';
      const store = new MockFolderStore();
      await store.open(null);
      setActiveStore(store as never);
      patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } } as never] });
      patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
      try {
        new MakeOnlineModal(new ToastManager()).open();
        const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
        modal.querySelector<HTMLButtonElement>('[data-route-tab="link"]')!.click();
        modal.querySelector<HTMLInputElement>('input[name="link-api-key"]')!.value = 'ow_r_owner';
        modal.querySelector<HTMLInputElement>('input[name="link-pin"]')!.value = '';
        modal.querySelector<HTMLFormElement>('[data-form="link-route"]')!.requestSubmit();
        const error = modal.querySelector<HTMLElement>('[data-role="link-error"]')!;
        await vi.waitFor(() => expect(error.hidden).toBe(false), { timeout: 3000 });
        expect(error.textContent).toMatch(/That key can only read/);
        expect(error.textContent).not.toMatch(/PIN/);
        expect(keel.seen).toEqual([]);
      } finally {
        document.body.innerHTML = '';
      }
    });

    it('the roster on a demo-key world handed a PIN: none rides /members (the SDK sends a classic key\'s PIN on every call)', async () => {
      const pins: Array<string | null> = [];
      mswServer.use(http.get('*/api/v2/members*', ({ request }) => {
        pins.push(request.headers.get('API-Pin'));
        return HttpResponse.json({ data: [{ id: null, kind: 'owner', role: 'owner', character: null, status: 'active' }] });
      }));
      await rosterFor(linked({ api_key: '0000000003' }), Date.now, { maxAgeMs: 0, pin: WRONG });
      expect(pins).toEqual([null]);
    });

    it('a key put in place, which /me says reads: taken as read only, the saved PIN never sent', async () => {
      const entry = linked({ api_key: 'ow_w_owner' });
      patchSlice('registry', { ...defaultRegistry(), pin: WRONG, worlds: [entry] });
      await expect(checkNewKey(entry, 'odd-read-key')).resolves.toEqual({ readOnly: true });
      await expect(checkNewKey(entry, 'ow_r_owner')).resolves.toEqual({ readOnly: true });
      expect([...pinsBeside('odd-read-key'), ...pinsBeside('ow_r_owner')].every(p => p === null)).toBe(true);
      expect(keel.counted).toEqual({});
    });

    it('a key of no shape keel names, which /me says reads: view-only, its PIN never sent or kept', async () => {
      const { entry } = await link({ apiKey: 'odd-read-key', apiPin: RIGHT });
      expect(entry.api?.read_only).toBe(true);
      expect(getState().registry.pin).toBeUndefined();
      expect(pinsBeside('odd-read-key').every(p => p === null)).toBe(true);
    });
  });

  describe('a PIN is kept as the account\'s only after a write key proves it', () => {
    it('a write key with a wrong PIN: refused, nothing kept; the right one: kept', async () => {
      await expect(link({ apiPin: WRONG })).rejects.toThrow(/did not accept this PIN/);
      expect(getState().registry.pin).toBeUndefined();
      expect(getState().registry.worlds).toEqual([]);
      await link({ apiPin: RIGHT });
      expect(getState().registry.pin).toBe(RIGHT);
    });

    it('an account world\'s open (the world known, the key made): the PIN proved before it is kept', async () => {
      const known = { id: 'w-played', name: 'Played world' };
      await expect(link({ apiPin: WRONG, knownWorld: known })).rejects.toThrow(/did not accept this PIN/);
      expect(getState().registry.pin).toBeUndefined();
      await link({ apiPin: RIGHT, knownWorld: known });
      expect(getState().registry.pin).toBe(RIGHT);
    });

    it('a PIN typed for a new key: kept beside a write key, never beside a read key', async () => {
      await keepPinProvedBy('ow_r_owner', WRONG);
      expect(getState().registry.pin).toBeUndefined();
      expect(pinsBeside('ow_r_owner')).toEqual([]);
      await expect(keepPinProvedBy('ow_w_owner', WRONG)).rejects.toThrow(/did not accept this PIN/);
      expect(getState().registry.pin).toBeUndefined();
      await keepPinProvedBy('ow_w_owner', RIGHT);
      expect(getState().registry.pin).toBe(RIGHT);
    });
  });

  describe('Test connection on a view-only world', () => {
    it('says the key works and reads only, with a wrong PIN saved, never a PIN line', async () => {
      const entry = linked({ api_key: 'ow_r_owner', read_only: true });
      patchSlice('registry', { ...defaultRegistry(), pin: WRONG, worlds: [entry] });
      const { said, toasts } = fakeToasts();
      await testWorldConnection(entry, toasts);
      expect(said).toEqual([{ kind: 'success', line: 'The key works: Played world. This key can only read, so this world opens to read.' }]);
      expect(pinsBeside('ow_r_owner').every(p => p === null)).toBe(true);
    });

    it('asks for no PIN when none is saved', async () => {
      const entry = linked({ api_key: 'ow_r_owner', read_only: true });
      patchSlice('registry', { ...defaultRegistry(), worlds: [entry] });
      const { said, toasts } = fakeToasts();
      await testWorldConnection(entry, toasts);
      expect(said[0].line).toMatch(/^The key works/);
    });

    it('a read key under a world that thinks it writes: the key, and the fix', async () => {
      const entry = linked({ api_key: 'ow_r_owner' });
      patchSlice('registry', { ...defaultRegistry(), pin: WRONG, worlds: [entry] });
      const { said, toasts } = fakeToasts();
      await testWorldConnection(entry, toasts);
      expect(said).toEqual([{ kind: 'info', line: 'The key works: Played world. This key can only read, so edits can\'t sync. Put in a write key below.' }]);
    });
  });
});

describe.each(['checked', 'ignored'] as const)('the PIN kept here says what OnlyWorlds said of it (keel: %s)', (mode) => {
  beforeEach(() => {
    setUp(mode);
    __resetPinAskedForTests();
  });
  afterEach(() => { document.body.innerHTML = ''; });

  /** The open world, linked with `key`; the registry keeping `pin` (and `pin_state`). */
  function openWorld(key: string, pin?: string, state?: 'proved' | 'refused'): WorldRegistryEntry {
    const entry = linked({ api_key: key });
    patchSlice('registry', { ...defaultRegistry(), pin, ...(state ? { pin_state: state } : {}), worlds: [entry] });
    patchSlice('active', { worldId: entry.id, meta: { name: 'Here' } } as never);
    return entry;
  }
  /** Settings' OnlyWorlds account section, wired. */
  function settings() {
    document.body.innerHTML = `<div class="atlas-settings">${renderAccountTab(getState().registry)}</div>`;
    const { said, toasts } = fakeToasts();
    wireAccountTab(toasts);
    const field = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]')!;
    const line = () => document.querySelector<HTMLElement>('.atlas-settings [data-role="pin-state"]')!;
    const save = async (pin: string) => {
      field.value = pin;
      field.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(said.length).toBeGreaterThan(0));
    };
    return { said, save, line };
  }
  const withPin = (key: string) => keel.seen.filter(s => s.key === key && s.pin !== null).length;

  it('the field saves at once, and says PIN saved only once OnlyWorlds took it beside a key that writes', async () => {
    openWorld('ow_w_owner');
    const { said, save, line } = settings();
    await save(RIGHT);
    expect(said).toEqual([{ kind: 'info', line: 'PIN saved' }]);
    expect(getState().registry).toMatchObject({ pin: RIGHT, pin_state: 'proved' });
    expect(line().textContent).toBe('PIN saved');
    // One question for the save, with the PIN once.
    expect(withPin('ow_w_owner')).toBe(1);
  });

  it('a PIN OnlyWorlds refuses is kept, and said refused', async () => {
    openWorld('ow_w_owner');
    const { said, save, line } = settings();
    await save(WRONG);
    expect(said).toEqual([{ kind: 'error', line: 'OnlyWorlds did not accept this PIN. Check it and save it again.' }]);
    expect(getState().registry).toMatchObject({ pin: WRONG, pin_state: 'refused' });
    expect(line().textContent).toBe('OnlyWorlds did not accept this PIN. Check it and save it again.');
    expect(withPin('ow_w_owner')).toBe(1);
  });

  it('with nothing to ask with (no world, a read key, a seat), it is kept here, not checked yet, and no PIN is sent', async () => {
    for (const setup of [
      () => patchSlice('registry', { ...defaultRegistry(), worlds: [] }),
      () => openWorld('ow_r_owner'),
      () => { const e = openWorld('ow_w_owner'); patchSlice('registry', { ...getState().registry, worlds: [{ ...e, api: { ...e.api!, seat: { role: 'narrator' }, seat_secret: 'ow_s_x' } }] } as never); },
    ]) {
      setup();
      document.body.innerHTML = '';
      const { said, save, line } = settings();
      await save(RIGHT);
      expect(said).toEqual([{ kind: 'info', line: 'Saved in this browser, not checked yet' }]);
      expect(getState().registry.pin).toBe(RIGHT);
      expect(getState().registry.pin_state).toBeUndefined();
      expect(line().textContent).toBe('Saved in this browser, not checked yet');
      patchSlice('registry', { ...defaultRegistry(), worlds: [] });
    }
    expect(keel.seen.filter(s => s.pin !== null)).toEqual([]);
  });

  it('no answer (offline) leaves it not checked yet, never refused', async () => {
    openWorld('ow_w_owner');
    mswServer.use(http.get(`${TEST_BASE}/me`, () => HttpResponse.error()));
    const { said, save } = settings();
    await save(RIGHT);
    expect(said).toEqual([{ kind: 'info', line: 'Saved in this browser, not checked yet' }]);
    expect(getState().registry.pin_state).toBeUndefined();
  });

  it('a question with no answer is not spent: the next opening of Settings asks again, still once per opening', async () => {
    openWorld('ow_w_owner', RIGHT);
    let asked = 0;
    let offline = true;
    mswServer.use(http.get(`${TEST_BASE}/me`, () => {
      asked += 1;
      if (offline) return HttpResponse.error();
      return HttpResponse.json({ world: { id: 'w-played', name: 'Played world' }, scope: 'write', kind: 'owner', role: 'owner', membership: null });
    }));
    settings();
    await vi.waitFor(() => expect(asked).toBe(1));
    await new Promise(r => setTimeout(r, 20));
    // Redraws of the same opening ask nothing more.
    document.body.innerHTML = '';
    settings();
    await new Promise(r => setTimeout(r, 20));
    expect(asked).toBe(1);
    expect(getState().registry.pin_state).toBeUndefined();
    // The next opening asks again; keel answers now.
    offline = false;
    beginSettingsOpening();
    document.body.innerHTML = '';
    settings();
    await vi.waitFor(() => expect(getState().registry.pin_state).toBe('proved'));
    expect(asked).toBe(2);
  });

  it('a question still out is never sent again: quick openings and a save of the same PIN wait on its one answer', async () => {
    openWorld('ow_w_owner', WRONG);
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    let asked = 0;
    mswServer.use(http.get(`${TEST_BASE}/me`, async () => {
      asked += 1;
      await held;
      return HttpResponse.json({ error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' } }, { status: 401 });
    }));
    const opening = () => { beginSettingsOpening(); document.body.innerHTML = ''; return settings(); };
    opening();
    await vi.waitFor(() => expect(asked).toBe(1));
    // Settings closed and opened four more times before OnlyWorlds answers.
    for (let i = 0; i < 4; i++) { opening(); await new Promise(r => setTimeout(r, 2)); }
    // The same PIN saved again, then one more opening, all while the question is out.
    const { said, save } = settings();
    const saving = save(WRONG);
    await new Promise(r => setTimeout(r, 5));
    opening();
    await new Promise(r => setTimeout(r, 20));
    expect(asked).toBe(1);
    release();
    await saving;
    await vi.waitFor(() => expect(getState().registry.pin_state).toBe('refused'));
    // One wrong PIN reached OnlyWorlds; the save says the answer it waited on.
    expect(asked).toBe(1);
    expect(said).toEqual([{ kind: 'error', line: PIN_REFUSED_LINE }]);
    // A refused PIN is asked about no more.
    opening();
    await new Promise(r => setTimeout(r, 20));
    expect(asked).toBe(1);
  });

  it('each mount of the Settings panel is an opening: one question per mount, none on a tab switch, none while one is out', async () => {
    const entry = openWorld('ow_w_owner', RIGHT);
    let asked = 0;
    let offline = true;
    const out = { release: () => {} };
    mswServer.use(http.get(`${TEST_BASE}/me`, async () => {
      asked += 1;
      if (offline) return HttpResponse.error();
      await new Promise<void>(r => { out.release = r; });
      return HttpResponse.json({ world: { id: 'w-played', name: 'Played world' }, scope: 'write', kind: 'owner', role: 'owner', membership: null });
    }));
    const tick = () => new Promise(r => setTimeout(r, 20));
    const go = async (tab: 'onlyworlds' | 'general') => {
      window.location.hash = settingsHash(entry.id, tab);
      window.dispatchEvent(new HashChangeEvent('hashchange'));
      await tick();
    };
    await go('onlyworlds');
    const target = document.createElement('div');
    document.body.appendChild(target);
    const { toasts } = fakeToasts();
    let unmount = mountSettingsPanel({ target, toasts });
    try {
      // Opening, offline: one question, no answer.
      await vi.waitFor(() => expect(asked).toBe(1));
      await tick();
      expect(document.querySelector('.atlas-settings input[name="pin"]')).not.toBeNull();
      // A tab switch inside the same opening redraws and asks nothing.
      await go('general');
      await go('onlyworlds');
      expect(document.querySelector('.atlas-settings input[name="pin"]')).not.toBeNull();
      expect(asked).toBe(1);
      // Settings mounted again: a new opening asks again.
      offline = false;
      unmount();
      unmount = mountSettingsPanel({ target, toasts });
      await vi.waitFor(() => expect(asked).toBe(2));
      // Mounted twice more while that question is out: nothing more is sent.
      unmount();
      unmount = mountSettingsPanel({ target, toasts });
      unmount();
      unmount = mountSettingsPanel({ target, toasts });
      await tick();
      expect(asked).toBe(2);
      out.release();
      await vi.waitFor(() => expect(getState().registry.pin_state).toBe('proved'));
      expect(asked).toBe(2);
    } finally {
      unmount();
      window.location.hash = '';
    }
  });

  it('opening Settings asks once about a PIN kept but not checked yet, and not again in that opening', async () => {
    openWorld('ow_w_owner', RIGHT);
    settings();
    await vi.waitFor(() => expect(getState().registry.pin_state).toBe('proved'));
    expect(withPin('ow_w_owner')).toBe(1);
    // A PIN already proved, or opened again: no question.
    document.body.innerHTML = '';
    patchSlice('registry', { ...getState().registry, pin_state: undefined } as never);
    settings();
    await new Promise(r => setTimeout(r, 30));
    expect(withPin('ow_w_owner')).toBe(1);
  });

  it('a new value is not checked yet; the same value keeps what was said of it', () => {
    openWorld('ow_w_owner', RIGHT, 'proved');
    expect(pinStateLine(getState().registry)).toBe('PIN saved');
    expect(setPin(getState().registry, ` ${RIGHT} `).pin_state).toBe('proved');
    const next = setPin(getState().registry, WRONG);
    expect(next.pin).toBe(WRONG);
    expect(next.pin_state).toBeUndefined();
    expect(pinStateLine(next)).toBe('Saved in this browser, not checked yet');
    expect(pinStateLine(setPin(next, ''))).toBe('');
    // A proof of another PIN says nothing of the one kept.
    expect(notePinState(next, RIGHT, 'proved')).toBe(next);
  });

  it('every proof site records it: a link, a new key, Test connection; their refusals too', async () => {
    await link({ apiPin: RIGHT });
    expect(getState().registry).toMatchObject({ pin: RIGHT, pin_state: 'proved' });
    patchSlice('registry', { ...defaultRegistry(), pin: WRONG, worlds: [] });
    await expect(link({ apiPin: WRONG })).rejects.toThrow(/did not accept this PIN/);
    expect(getState().registry.pin_state).toBe('refused');
    patchSlice('registry', { ...defaultRegistry(), pin: RIGHT, worlds: [] });
    await keepPinProvedBy('ow_w_owner', RIGHT);
    expect(getState().registry.pin_state).toBe('proved');
    patchSlice('registry', { ...defaultRegistry(), pin: WRONG, worlds: [] });
    await expect(keepPinProvedBy('ow_w_owner', WRONG)).rejects.toThrow(/did not accept this PIN/);
    expect(getState().registry.pin_state).toBe('refused');
    // Test connection on a world that writes.
    const entry = openWorld('ow_w_owner', RIGHT);
    await testWorldConnection(entry, fakeToasts().toasts);
    expect(getState().registry.pin_state).toBe('proved');
    openWorld('ow_w_owner', WRONG);
    await testWorldConnection(getState().registry.worlds[0], fakeToasts().toasts);
    expect(getState().registry.pin_state).toBe('refused');
  });

  it('the field moved on while its question was out: the answer says nothing of the new PIN, nor does the toast', async () => {
    openWorld('ow_w_owner');
    let release!: () => void;
    const held = new Promise<void>(r => { release = r; });
    let asked = 0;
    mswServer.use(http.get(`${TEST_BASE}/me`, async () => {
      asked += 1;
      await held;
      return HttpResponse.json({ world: { id: 'w-played', name: 'Played world' }, scope: 'write', kind: 'owner', role: 'owner', membership: null });
    }));
    const { said, save } = settings();
    const saving = save(RIGHT);
    await vi.waitFor(() => expect(asked).toBe(1));
    patchSlice('registry', setPin(getState().registry, '5555'));
    release();
    await saving;
    expect(getState().registry.pin).toBe('5555');
    expect(getState().registry.pin_state).toBeUndefined();
    expect(said).toEqual([{ kind: 'info', line: 'Saved in this browser, not checked yet' }]);
  });

  it('only keel naming the PIN refuses it: a 401 for the key, a 5xx, a 429 or a 403 leave it not checked', async () => {
    const answers: Array<[number, Record<string, unknown>]> = [
      [401, { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.' }],
      [401, { type: 'authentication_error', code: 'key_revoked', message: 'Revoked.' }],
      [500, { type: 'api_error', code: 'server_error', message: 'm', param: 'API-Pin' }],
      [429, { type: 'rate_limit', code: 'too_many_requests', message: 'm', param: 'API-Pin' }],
      [403, { type: 'permission_error', code: 'permission_error', message: 'm', param: 'API-Pin' }],
    ];
    for (const [status, error] of answers) {
      document.body.innerHTML = '';
      __resetPinAskedForTests();
      openWorld('ow_w_owner');
      mswServer.use(http.get(`${TEST_BASE}/me`, () => HttpResponse.json({ error }, { status })));
      const { said, save } = settings();
      await save(RIGHT);
      expect(getState().registry.pin_state, `${status} ${String(error.code)}`).toBeUndefined();
      expect(said).toEqual([{ kind: 'info', line: 'Saved in this browser, not checked yet' }]);
    }
  });

  it('Test connection records no refusal of the PIN for a key keel refused itself (revoked, unknown)', async () => {
    for (const [code, param] of [['key_revoked', null], ['invalid_credentials', null]] as const) {
      const entry = openWorld('ow_w_owner', RIGHT);
      mswServer.use(http.get(`${TEST_BASE}/world`, () => HttpResponse.json({ error: { type: 'authentication_error', code, message: 'm', param } }, { status: 401 })));
      await testWorldConnection(entry, fakeToasts().toasts);
      expect(getState().registry.pin_state, code).toBeUndefined();
    }
  });

  it('opening Settings with nothing to ask with spends no question: once a world that writes is open, it asks', async () => {
    patchSlice('registry', { ...defaultRegistry(), pin: RIGHT, worlds: [] });
    settings();
    await new Promise(r => setTimeout(r, 20));
    expect(keel.seen.filter(s => s.pin !== null)).toEqual([]);
    document.body.innerHTML = '';
    const entry = linked({ api_key: 'ow_w_owner' });
    patchSlice('registry', { ...getState().registry, worlds: [entry] });
    patchSlice('active', { worldId: entry.id, meta: { name: 'Here' } } as never);
    settings();
    await vi.waitFor(() => expect(getState().registry.pin_state).toBe('proved'));
    expect(withPin('ow_w_owner')).toBe(1);
  });

  it('a PIN typed with no world open is asked about once a world that writes is open', async () => {
    patchSlice('registry', { ...defaultRegistry(), worlds: [] });
    const first = settings();
    await first.save(RIGHT);
    expect(first.said).toEqual([{ kind: 'info', line: 'Saved in this browser, not checked yet' }]);
    document.body.innerHTML = '';
    const entry = linked({ api_key: 'ow_w_owner' });
    patchSlice('registry', { ...getState().registry, worlds: [entry] });
    patchSlice('active', { worldId: entry.id, meta: { name: 'Here' } } as never);
    settings();
    await vi.waitFor(() => expect(getState().registry.pin_state).toBe('proved'));
  });

  it('one save asks once, though the panel redraws on the save as the page does (the field not focused)', async () => {
    openWorld('ow_w_owner');
    const { said, toasts } = fakeToasts();
    const draw = () => {
      document.body.innerHTML = `<div class="atlas-settings">${renderAccountTab(getState().registry)}</div>`;
      wireAccountTab(toasts);
    };
    // Settings redraws on every state change while nothing in it is being typed in.
    const off = subscribe(draw);
    try {
      draw();
      const field = document.querySelector<HTMLInputElement>('.atlas-settings input[name="pin"]')!;
      field.value = RIGHT;
      field.dispatchEvent(new Event('change'));
      await vi.waitFor(() => expect(said.length).toBeGreaterThan(0));
      await new Promise(r => setTimeout(r, 50));
    } finally {
      off();
    }
    expect(withPin('ow_w_owner')).toBe(1);
    expect(getState().registry.pin_state).toBe('proved');
  });

  it('a key of no known shape that turns out to read spends no question: a world that writes, opened later, is asked', async () => {
    openWorld('odd-read-key');
    const first = settings();
    await first.save(RIGHT);
    expect(first.said).toEqual([{ kind: 'info', line: 'Saved in this browser, not checked yet' }]);
    expect(keel.seen.filter(s => s.pin !== null)).toEqual([]);
    document.body.innerHTML = '';
    const entry = linked({ api_key: 'ow_w_owner' });
    patchSlice('registry', { ...getState().registry, worlds: [entry] });
    patchSlice('active', { worldId: entry.id, meta: { name: 'Here' } } as never);
    settings();
    await vi.waitFor(() => expect(getState().registry.pin_state).toBe('proved'));
  });

  it('saving again a PIN OnlyWorlds refused says so as an error', async () => {
    openWorld('ow_w_owner', RIGHT, 'refused');
    const { said, save } = settings();
    // The same PIN, saved again (the field's value differs only in spaces).
    await save(` ${RIGHT} `);
    expect(said).toEqual([{ kind: 'error', line: 'OnlyWorlds did not accept this PIN. Check it and save it again.' }]);
  });

  it('Make online\'s link with no PIN kept: the link keeps the PIN it proved, and says it proved', async () => {
    document.body.innerHTML = '<div class="atlas-shell"></div>';
    const store = new MockFolderStore();
    await store.open(null);
    setActiveStore(store as never);
    try {
      patchSlice('registry', { ...defaultRegistry(), worlds: [{ id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } } as never] });
      patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
      new MakeOnlineModal(new ToastManager()).open();
      const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
      modal.querySelector<HTMLButtonElement>('[data-route-tab="link"]')!.click();
      modal.querySelector<HTMLInputElement>('input[name="link-api-key"]')!.value = 'ow_w_owner';
      modal.querySelector<HTMLInputElement>('input[name="link-pin"]')!.value = RIGHT;
      modal.querySelector<HTMLFormElement>('[data-form="link-route"]')!.requestSubmit();
      await vi.waitFor(() => expect(getState().registry.worlds[0]?.state).toBe('api-linked'), { timeout: 5000 });
      expect(getState().registry).toMatchObject({ pin: RIGHT, pin_state: 'proved' });
    } finally {
      document.body.innerHTML = '';
    }
  });

  it('Make online\'s link that stops after keel took the PIN (the world already linked here) still says it proved', async () => {
    document.body.innerHTML = '<div class="atlas-shell"></div>';
    const store = new MockFolderStore();
    await store.open(null);
    setActiveStore(store as never);
    try {
      const already = linked({ api_key: 'ow_w_owner' });
      patchSlice('registry', { ...defaultRegistry(), pin: RIGHT, worlds: [{ id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } } as never, already] });
      patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
      new MakeOnlineModal(new ToastManager()).open();
      const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
      modal.querySelector<HTMLButtonElement>('[data-route-tab="link"]')!.click();
      modal.querySelector<HTMLInputElement>('input[name="link-api-key"]')!.value = 'ow_w_owner';
      modal.querySelector<HTMLInputElement>('input[name="link-pin"]')!.value = RIGHT;
      modal.querySelector<HTMLFormElement>('[data-form="link-route"]')!.requestSubmit();
      const error = modal.querySelector<HTMLElement>('[data-role="link-error"]')!;
      await vi.waitFor(() => expect(error.hidden).toBe(false), { timeout: 3000 });
      expect(getState().registry.worlds[0].state).toBe('local-only');
      expect(getState().registry.pin_state).toBe('proved');
    } finally {
      document.body.innerHTML = '';
    }
  });

  it('Make online\'s link: keel taking the PIN kept here says proved; refusing it says refused', async () => {
    document.body.innerHTML = '<div class="atlas-shell"></div>';
    const store = new MockFolderStore();
    await store.open(null);
    setActiveStore(store as never);
    const local = { id: 'w1', name: 'W', state: 'local-only', folder: { handle_key: 'k', folder_name: 'f' } } as never;
    try {
      for (const [pin, want] of [[RIGHT, 'proved'], [WRONG, 'refused']] as const) {
        patchSlice('registry', { ...defaultRegistry(), pin, worlds: [local] });
        patchSlice('active', { worldId: 'w1', meta: { id: 'w1', name: 'W' }, opened: true } as never);
        new MakeOnlineModal(new ToastManager()).open();
        const modal = document.querySelector<HTMLElement>('[data-modal="make-online"]')!;
        modal.querySelector<HTMLButtonElement>('[data-route-tab="link"]')!.click();
        modal.querySelector<HTMLInputElement>('input[name="link-api-key"]')!.value = 'ow_w_owner';
        modal.querySelector<HTMLInputElement>('input[name="link-pin"]')!.value = pin;
        modal.querySelector<HTMLFormElement>('[data-form="link-route"]')!.requestSubmit();
        await vi.waitFor(() => expect(getState().registry.pin_state).toBe(want), { timeout: 3000 });
        modal.closest('.atlas-modal-overlay')?.remove();
        modal.remove();
      }
    } finally {
      document.body.innerHTML = '';
    }
  });
});

describe('the PIN and what OnlyWorlds said of it travel together across tabs', () => {
  it('a tab behind another\'s new PIN never puts the old one back by saying what OnlyWorlds said of it', () => {
    const base = { ...defaultRegistry(), pin: '1111', worlds: [] };
    const out = mergeRegistry(base, { ...base, pin_state: 'refused' as const }, { ...defaultRegistry(), pin: '2222', worlds: [] });
    expect({ pin: out.pin, pin_state: out.pin_state }).toEqual({ pin: '2222', pin_state: undefined });
    // Through the save path, refused and proved: storage keeps the other tab's new PIN, with no state.
    for (const state of ['refused', 'proved'] as const) {
      const behind = { ...defaultRegistry(), pin: '1111', worlds: [] };
      localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ ...defaultRegistry(), pin: '2222', worlds: [] }));
      __setRegistryTabBaseForTests(behind);
      patchSlice('registry', behind);
      recordPinState('1111', state);
      const stored = storedRegistry();
      __setRegistryTabBaseForTests(null);
      localStorage.removeItem(REGISTRY_STORAGE_KEY);
      expect({ pin: stored.pin, pin_state: stored.pin_state }, state).toEqual({ pin: '2222', pin_state: undefined });
    }
    // The same PIN in storage: the state goes.
    const same = mergeRegistry(base, { ...base, pin_state: 'proved' as const }, base);
    expect({ pin: same.pin, pin_state: same.pin_state }).toEqual({ pin: '1111', pin_state: 'proved' });
  });

  it('Make online\'s create proves the PIN only when its push landed something and keel refused nothing', () => {
    expect(pushProvedPin({ pushed: { creates: 2, updates: 0 } })).toBe(true);
    expect(pushProvedPin({ pushed: { creates: 0, updates: 1 } })).toBe(true);
    expect(pushProvedPin({ pushed: { creates: 0, updates: 0 } })).toBe(false);
    expect(pushProvedPin({ pushed: { creates: 2, updates: 0 }, auth_blocked: true })).toBe(false);
  });

  it('a PIN changed here drops the state another tab stored for the old one', () => {
    const base = { ...defaultRegistry(), pin: '1111', pin_state: 'proved' as const, worlds: [] };
    const mine = setPin(base, '2222');
    const stored = { ...base, pin: '1111', pin_state: 'refused' as const };
    const out = mergeRegistry(base, mine, stored);
    expect(out.pin).toBe('2222');
    expect(out.pin_state).toBeUndefined();
    // Only the PIN changed here, while another tab refused the old one: the pair is this tab's, no state.
    const bare = { ...defaultRegistry(), pin: '1111', worlds: [] };
    const out2 = mergeRegistry(bare, setPin(bare, '2222'), { ...bare, pin_state: 'refused' as const });
    expect(out2.pin).toBe('2222');
    expect(out2.pin_state).toBeUndefined();
    // Unchanged here: storage's pair, whole.
    expect(mergeRegistry(base, base, stored)).toMatchObject({ pin: '1111', pin_state: 'refused' });
  });
});

describe('a world saved before 1.124.31, writable with a read key', () => {
  it('reads as view-only from the registry, so no PIN sentence meets it (sync, share section)', () => {
    const old = {
      id: 'old-1', name: 'Old', state: 'api-linked',
      api: { world_id: 'w-x', api_key: 'ow_r_oldkey', world_name: 'Old' },
      folder: { handle_key: 'v', folder_name: 'o' }, created_at: '2026-01-01T00:00:00Z',
    };
    const writer = { ...old, id: 'w-1', api: { ...old.api, api_key: 'ow_w_writer' } };
    const demo = { ...old, id: 'demo-1', api: { ...old.api, api_key: '0000000003' } };
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ version: 1, worlds: [old, writer, demo] }));
    try {
      const reg = loadRegistry();
      expect(reg.worlds.map(w => !!w.api?.read_only)).toEqual([true, false, true]);
      patchSlice('registry', reg);
      patchSlice('active', { worldId: 'old-1', meta: { id: 'old-1', name: 'Old' }, opened: true } as never);
      expect(diagnoseSyncUnavailable()).not.toEqual({ kind: 'pin-missing', worldId: 'old-1' });
    } finally {
      localStorage.removeItem(REGISTRY_STORAGE_KEY);
      patchSlice('active', null);
    }
  });

  const entryWith = (id: string, api: Record<string, unknown>) => ({
    id, name: id, state: 'api-linked', api: { world_id: `w-${id}`, ...api },
    folder: { handle_key: `v-${id}`, folder_name: id }, created_at: '2026-01-01T00:00:00Z',
  });

  it('a save of another change writes the mark back, and the writer stays as it was', () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ version: 1, worlds: [entryWith('w', { api_key: 'ow_w_writer' }), entryWith('r', { api_key: 'ow_r_oldkey' })] }));
    try {
      saveRegistry({ ...loadRegistry(), pin: RIGHT });
      const stored = JSON.parse(localStorage.getItem(REGISTRY_STORAGE_KEY)!) as { worlds: Array<{ api: { read_only?: boolean } }> };
      expect(stored.worlds.map(w => w.api.read_only)).toEqual([undefined, true]);
    } finally {
      localStorage.removeItem(REGISTRY_STORAGE_KEY);
    }
  });

  it('another tab\'s save, adopted here (the storage event), reads marked', () => {
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ version: 1, worlds: [] }));
    try {
      const here = loadRegistry();
      localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ version: 1, worlds: [entryWith('r', { api_key: 'ow_r_oldkey' })] }));
      expect(adoptStoredRegistry(here)?.worlds[0].api?.read_only).toBe(true);
    } finally {
      localStorage.removeItem(REGISTRY_STORAGE_KEY);
    }
  });

  it('an entry whose key is not a string is left as stored, and the rest of the registry still loads', () => {
    const odd = entryWith('odd', { api_key: 12345 });
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ version: 1, worlds: [odd, entryWith('r', { api_key: 'ow_r_oldkey' })] }));
    try {
      const reg = loadRegistry();
      expect(reg.worlds).toHaveLength(2);
      expect(reg.worlds[0]).toEqual(odd);
      expect(reg.worlds[1].api?.read_only).toBe(true);
    } finally {
      localStorage.removeItem(REGISTRY_STORAGE_KEY);
    }
  });

  it('a world registered fresh from its world.json with a read key is view-only this session', () => {
    const { next, entry } = createApiLinkedWorld(defaultRegistry(), {
      name: 'Old', apiWorldId: 'w-9', apiKey: 'ow_r_oldkey', handleKey: 'k', folderName: 'f', pathHint: 'p', readOnly: false,
    });
    expect(entry.api?.read_only).toBe(true);
    patchSlice('registry', next);
    patchSlice('active', { worldId: entry.id, meta: { id: 'w-9', name: 'Old' }, opened: true } as never);
    try {
      expect(diagnoseSyncUnavailable()).not.toEqual({ kind: 'pin-missing', worldId: entry.id });
      const writer = createApiLinkedWorld(defaultRegistry(), {
        name: 'Mine', apiWorldId: 'w-8', apiKey: 'ow_w_writer', handleKey: 'k2', folderName: 'f2', pathHint: 'p', readOnly: false,
      });
      expect(writer.entry.api?.read_only).toBeUndefined();
    } finally {
      patchSlice('active', null);
    }
  });
});

describe('the played keel answers both ways', () => {
  const ask = (key: string, pin: string | null, path = '/me', method = 'GET') =>
    fetch(`${TEST_BASE}${path}`, { method, headers: { 'API-Key': key, ...(pin ? { 'API-Pin': pin } : {}) } });

  it('today: a wrong PIN beside a read key is refused and counted, an owner\'s on any read, a member\'s on /me', async () => {
    setUp('checked');
    expect((await ask('ow_r_owner', WRONG)).status).toBe(401);
    expect((await ask('ow_r_owner', WRONG, '/world')).status).toBe(401);
    expect((await ask('ow_r_guest', WRONG)).status).toBe(401);
    expect(keel.counted).toEqual({ ow_r_owner: 2, ow_r_guest: 1 });
  });

  it('after the change: a PIN beside a read key is not read; beside a write key it still is', async () => {
    setUp('ignored');
    expect((await ask('ow_r_owner', WRONG)).status).toBe(200);
    expect((await ask('ow_r_guest', WRONG)).status).toBe(200);
    expect((await ask('ow_w_owner', WRONG)).status).toBe(401);
    expect((await ask('ow_w_owner', RIGHT)).status).toBe(200);
    expect((await ask('ow_r_owner', null, '/character', 'POST')).status).toBe(403);
    expect(keel.counted).toEqual({ ow_w_owner: 1 });
  });
});

describe('the first write refused for a read key', () => {
  it('says it is a read key, never a PIN sentence', () => {
    const err = new OwV2Error(403, { type: 'permission_error', code: 'permission_error', message: 'This key is read-only and cannot write to this world.', param: null }, '');
    const sentence = problemFor(err, { doing: 'linking the world' }).sentence;
    expect(sentence).toMatch(/key can only read/);
    expect(sentence).toMatch(/write key/);
    expect(sentence).not.toMatch(/PIN/);
  });

  it('keel\'s same code for another refusal is not said as a read key', () => {
    const err = new OwV2Error(403, { type: 'permission_error', code: 'permission_error', message: 'Only the owner can do this.', param: null }, '');
    expect(problemFor(err, { doing: 'linking the world' }).sentence).not.toMatch(/can only read/);
  });
});

describe('one phrase for a key that can only read', () => {
  it('the sync pill, the This world tab and the paused note say the key can only read', () => {
    expect(keyRefusalPill('read_only_key')).toBe('This key can only read, so edits can\'t sync. Put in a write key in Settings, This world');
    expect(keyRefusalHere('read_only_key')).toBe('This key can only read, so edits can\'t sync. Put in a write key below.');
    expect(keyRefusalLine('read_only_key')).toMatch(/can only read/);
  });

  it('the census: no sentence a person reads says a key reads only any other way', () => {
    const SRC = join(__dirname, '..', '..', 'src');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
    });
    const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
    const OTHER = /\breads only\b|\bonly reads\b|\bis a read key\b|\bread-only key\b|\bview-only key\b|\bkey reads\b/i;
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel === 'changelog/changelog.data.ts') continue;
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\/\*|\*)/.test(line) || /console\.|new (Type)?Error\(/.test(line)) return;
        if ((line.match(STRINGS) ?? []).some(lit => OTHER.test(lit))) hits.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
    // The instrument sees the old words.
    expect(OTHER.test('. It reads only, so this world opens to read.')).toBe(true);
    expect(OTHER.test('This is a read key, so edits can\'t sync.')).toBe(true);
  });
});

describe('a PIN OnlyWorlds refused is said one way', () => {
  it('every door that names the PIN alone says "OnlyWorlds did not accept this PIN." and then its own next step', () => {
    expect(PIN_REFUSED_LINE.startsWith('OnlyWorlds did not accept this PIN. ')).toBe(true);
    expect(keyRefusalPill('pin')).toBe('OnlyWorlds did not accept this PIN. Check it in Settings, OnlyWorlds');
    expect(keyRefusalLine('pin')).toBe('Sync paused: OnlyWorlds did not accept this PIN. Check it in Settings, OnlyWorlds.');
    expect(keyRefusalHere('pin')).toBe('OnlyWorlds did not accept this PIN. Check it on the OnlyWorlds tab.');
  });

  it('the census: no sentence a person reads says a refused PIN any other way', () => {
    const SRC = join(__dirname, '..', '..', 'src');
    const walk = (d: string): string[] => readdirSync(d).flatMap(n => {
      const p = join(d, n);
      return statSync(p).isDirectory() ? walk(p) : /\.ts$/.test(n) ? [p] : [];
    });
    const STRINGS = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g;
    // The PIN alone refused, in any wording but the ruled one. "the key or PIN" (a refusal that does not say
    // which) and "wrong PIN tries" (a wall, not a refusal) are other sentences.
    const OTHER = /did not accept (?:that|your|the) PIN\b|\bPIN (?:was|is) (?:not accepted|refused|wrong)\b|\bincorrect PIN\b/i;
    const hits: string[] = [];
    for (const file of walk(SRC)) {
      const rel = relative(SRC, file).split(sep).join('/');
      if (rel === 'changelog/changelog.data.ts') continue;
      readFileSync(file, 'utf8').split(/\r?\n/).forEach((line, i) => {
        if (/^\s*(\/\/|\/\*|\*)/.test(line) || /console\./.test(line)) return;
        if ((line.match(STRINGS) ?? []).some(lit => OTHER.test(lit))) hits.push(`${rel}:${i + 1} ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
    // The instrument sees the old words.
    expect(OTHER.test('OnlyWorlds did not accept that PIN. Check it, then try again.')).toBe(true);
    expect(OTHER.test('OnlyWorlds did not accept your PIN with that key.')).toBe(true);
    expect(OTHER.test('OnlyWorlds did not accept the key or PIN.')).toBe(false);
  });
});
