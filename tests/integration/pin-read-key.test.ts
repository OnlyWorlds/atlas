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
import { patchSlice, getState } from '../../src/core/state';
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
import { adoptStoredRegistry, createApiLinkedWorld, loadRegistry, saveRegistry } from '../../src/registry/registry';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import { diagnoseSyncUnavailable } from '../../src/sync/sync-attach';
import { removePicture, uploadPicture } from '../../src/sync/media-upload';
import { MakeOnlineModal } from '../../src/ui/make-online-modal';
import { ToastManager } from '../../src/ui/toast-manager';
import { MockFolderStore } from '../fixtures/mock-folder-store';

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
      await expect(link({ apiPin: WRONG })).rejects.toThrow(/did not accept that PIN/);
      expect(getState().registry.pin).toBeUndefined();
      expect(getState().registry.worlds).toEqual([]);
      await link({ apiPin: RIGHT });
      expect(getState().registry.pin).toBe(RIGHT);
    });

    it('an account world\'s open (the world known, the key made): the PIN proved before it is kept', async () => {
      const known = { id: 'w-played', name: 'Played world' };
      await expect(link({ apiPin: WRONG, knownWorld: known })).rejects.toThrow(/did not accept that PIN/);
      expect(getState().registry.pin).toBeUndefined();
      await link({ apiPin: RIGHT, knownWorld: known });
      expect(getState().registry.pin).toBe(RIGHT);
    });

    it('a PIN typed for a new key: kept beside a write key, never beside a read key', async () => {
      await keepPinProvedBy('ow_r_owner', WRONG);
      expect(getState().registry.pin).toBeUndefined();
      expect(pinsBeside('ow_r_owner')).toEqual([]);
      await expect(keepPinProvedBy('ow_w_owner', WRONG)).rejects.toThrow(/did not accept that PIN/);
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
      expect(said).toEqual([{ kind: 'success', line: 'The key works: Played world. It reads only, so this world opens to read.' }]);
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
      expect(said).toEqual([{ kind: 'info', line: 'The key works: Played world. It reads only, so edits can\'t sync. Put in a write key below.' }]);
    });
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
