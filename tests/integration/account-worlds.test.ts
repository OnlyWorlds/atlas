/**
 * Account-mode world list + open-flow short-circuits.
 *
 * refreshAccountWorlds fills the `accountWorlds` state slice from
 * GET /account/worlds — token-identity-guarded, microtask-deferred, offline-
 * tolerant (auth error clears rows; a transient error keeps them). remote-
 * AccountWorlds diffs the fetched rows against the registry. openAccountWorld's
 * synchronous preconditions are the only part unit-testable here — the mint +
 * download path is e2e/live territory.
 *
 * The engine builds AccountClient with NO base override, so it targets the
 * production v2 base; these handlers are registered there (statefulAccount-
 * Handlers' default base) to intercept.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { mswServer } from '../setup';
import { statefulAccountHandlers } from '../msw-account-handlers';
import { statefulOwHandlers } from '../msw-handlers';
import { createApiWorld, setMakeOnlineBaseUrl, worldOriginLines } from '../../src/sync/make-online';
import { getState, patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import {
  setAccountToken,
  createApiLinkedWorld,
  detachApi,
} from '../../src/registry/registry';
import {
  refreshAccountWorlds,
  remoteAccountWorlds,
  openAccountWorld,
  deviceKeyName,
  mintOwnKey,
  opensToWrite,
  sharedOpenLine,
} from '../../src/sync/account-worlds';
import { AccountClient } from '../../src/sync/account-client';
import { SIGNED_IN_AGAIN_LINE } from '../../src/sync/token-revoke';
import type { AccountWorldRow } from '../../src/core/types';
import type { ToastManager } from '../../src/ui/toast-manager';

const V2_BASE = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_valid_token';
const PROFILE = { id: 'acct-1', username: 'titus', email: 't@e.com', date_joined: null };
const ROWS: AccountWorldRow[] = [
  { id: 'srv-owned', name: 'Owned World', role: 'owner', public_read: false, keys: [] },
  { id: 'srv-collab', name: 'Collab World', role: 'collaborator', public_read: true, keys: [] },
];

const tick = (ms = 0) => new Promise<void>(r => setTimeout(r, ms));

/** Register the account handlers at the production base and return capture state. */
function mount(opts: Partial<Parameters<typeof statefulAccountHandlers>[0]> = {}) {
  const { handlers, state } = statefulAccountHandlers({
    token: TOKEN,
    profile: PROFILE,
    worlds: ROWS,
    ...opts,
  });
  mswServer.use(...handlers);
  return state;
}

/** ToastManager stand-in capturing each call (the real one needs a DOM container). */
function makeToasts() {
  const calls: Array<{ level: string; msg: string }> = [];
  const rec = (level: string) => (msg: string) => { calls.push({ level, msg }); };
  const fake = { calls, error: rec('error'), info: rec('info'), success: rec('success') };
  return fake as unknown as ToastManager & { calls: typeof calls };
}

/** Wait until `pred` holds, polling microtasks + fetch turns (real timers). */
async function until(pred: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeoutMs) throw new Error('until: timed out');
    await tick(5);
  }
}

beforeEach(() => {
  // The state store is a module singleton — reset the slices this suite drives.
  patchSlice('registry', defaultRegistry());
  patchSlice('accountWorlds', { status: 'idle', rows: [], opening: null });
  patchSlice('atlasRoot', null);
});

afterEach(async () => {
  // Let any in-flight refresh settle so its module-level inFlightToken latch
  // resets before the next test (otherwise a same-token fetch would no-op).
  await tick(50);
  // Clear the account token so it never leaks into another file's state
  // singleton — make-online.test.ts's createApiWorld tests assume the
  // signed-out lane and would take the v2 lane if a token survived.
  patchSlice('registry', defaultRegistry());
});

describe('refreshAccountWorlds', () => {
  it('does nothing (no fetch, stays idle) when there is no token', async () => {
    const state = mount();
    refreshAccountWorlds();
    await tick(20);
    expect(getState().accountWorlds.status).toBe('idle');
    expect(state.listCount).toBe(0);
  });

  it('fetches rows and lands status ready for a signed-in token', async () => {
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    refreshAccountWorlds();
    await until(() => getState().accountWorlds.status === 'ready');
    expect(getState().accountWorlds.rows.map(r => r.id)).toEqual(['srv-owned', 'srv-collab']);
    expect(state.listCount).toBe(1);
  });

  it('is a no-op on a second same-token call (already fetched)', async () => {
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    refreshAccountWorlds();
    await until(() => getState().accountWorlds.status === 'ready');
    expect(state.listCount).toBe(1);

    refreshAccountWorlds(); // fetchedWithToken already === token → no work
    await tick(20);
    expect(state.listCount).toBe(1);
  });

  it('force=true refetches even after a successful fetch', async () => {
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    refreshAccountWorlds();
    await until(() => getState().accountWorlds.status === 'ready');
    expect(state.listCount).toBe(1);

    refreshAccountWorlds(true);
    await until(() => state.listCount === 2);
    expect(getState().accountWorlds.status).toBe('ready');
  });

  it('an auth error clears rows and lands status error', async () => {
    mount(); // valid token is TOKEN; the registry holds a WRONG one → 401
    patchSlice('accountWorlds', { status: 'ready', rows: ROWS, opening: null });
    patchSlice('registry', setAccountToken(defaultRegistry(), 'ow_a_wrong', 'titus'));
    refreshAccountWorlds();
    await until(() => getState().accountWorlds.status === 'error');
    expect(getState().accountWorlds.rows).toHaveLength(0);
  });

  it('a transient (non-auth) error keeps the existing rows', async () => {
    mount();
    // A 500 shadows the stateful worlds route (last-registered wins in MSW).
    mswServer.use(
      http.get(`${V2_BASE}/account/worlds`, () =>
        HttpResponse.json({ error: { type: 'api_error', code: 'server_error', message: 'boom', param: null } }, { status: 500 })
      ),
    );
    patchSlice('accountWorlds', { status: 'ready', rows: ROWS, opening: null });
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    refreshAccountWorlds();
    await until(() => getState().accountWorlds.status === 'error');
    // Offline-first: a blip must not wipe the last-known list.
    expect(getState().accountWorlds.rows).toHaveLength(ROWS.length);
  });

  it('discards a late response when the token changes mid-fetch (forget)', async () => {
    mount();
    // Slow the worlds route so we can forget the token while the fetch is open.
    mswServer.use(
      http.get(`${V2_BASE}/account/worlds`, async () => {
        await delay(30);
        return HttpResponse.json({ data: ROWS });
      }),
    );
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    refreshAccountWorlds();
    await until(() => getState().accountWorlds.status === 'loading');

    // Forget mid-fetch.
    patchSlice('registry', setAccountToken(getState().registry, undefined));
    await tick(60); // let the delayed response resolve into the discard guard

    expect(getState().accountWorlds.status).not.toBe('ready');
    expect(getState().accountWorlds.rows).toHaveLength(0);
  });
});

describe('remoteAccountWorlds', () => {
  it('excludes rows already represented by a live link OR a former link', () => {
    // Registry: srv-1 live-linked, srv-2 unlinked (former). srv-3 is genuinely remote.
    let reg = defaultRegistry();
    const live = createApiLinkedWorld(reg, {
      name: 'Live', apiWorldId: 'srv-1', apiKey: 'k', folderName: 'live', handleKey: 'h1',
    });
    reg = live.next;
    const former = createApiLinkedWorld(reg, {
      name: 'Former', apiWorldId: 'srv-2', apiKey: 'k', folderName: 'former', handleKey: 'h2',
    });
    reg = detachApi(former.next, former.entry.id); // srv-2 → former_api_world_id
    reg = setAccountToken(reg, TOKEN, 'titus');
    patchSlice('registry', reg);
    patchSlice('accountWorlds', {
      status: 'ready',
      rows: [
        { id: 'srv-1', name: 'A', role: 'owner', public_read: false, keys: [] },
        { id: 'srv-2', name: 'B', role: 'owner', public_read: false, keys: [] },
        { id: 'srv-3', name: 'C', role: 'owner', public_read: false, keys: [] },
      ],
      opening: null,
    });
    expect(remoteAccountWorlds().map(r => r.id)).toEqual(['srv-3']);
  });

  it('returns [] when no account token is set', () => {
    patchSlice('accountWorlds', {
      status: 'ready',
      rows: [{ id: 'srv-1', name: 'A', role: 'owner', public_read: false, keys: [] }],
      opening: null,
    });
    expect(remoteAccountWorlds()).toEqual([]);
  });
});

describe('deviceKeyName — the portal key label (live 2026-07-13)', () => {
  it('reads "atlas · <platform>", lowercase, within the server 255 limit', () => {
    const name = deviceKeyName();
    expect(name).toMatch(/^atlas · \S/);
    expect(name).toBe(name.toLowerCase());
    expect(name.length).toBeLessThanOrEqual(255);
  });
});

describe('openAccountWorld — synchronous short-circuits', () => {
  const row: AccountWorldRow = { id: 'srv-owned', name: 'Owned World', role: 'owner', public_read: false, keys: [] };

  it('returns false without minting when an open is already in flight', async () => {
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    patchSlice('accountWorlds', { status: 'ready', rows: [row], opening: 'srv-other' });
    const toasts = makeToasts();

    const ok = await openAccountWorld(row, toasts);
    expect(ok).toBe(false);
    expect(state.minted).toHaveLength(0);
    expect(toasts.calls).toHaveLength(0);
  });

  it('asks where the world lives first; a folder answer with no home folder asks for one; Cancel never mints (1.17)', async () => {
    // The picker exists and the user last chose a folder: the folder row is pre-selected.
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null);
    localStorage.setItem('atlas_ui_prefs', JSON.stringify({ sidebarMode: 'worlds', defaultCreateType: 'character', newWorldWhere: 'folder' }));
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    patchSlice('atlasRoot', null);
    const toasts = makeToasts();

    const pending = openAccountWorld(row, toasts);
    await vi.waitFor(() => expect(document.querySelector('[data-modal="where-ask"]')).not.toBeNull(), { timeout: 10_000 });
    expect(document.querySelector<HTMLInputElement>('[data-modal="where-ask"] input[value="folder"]')!.checked).toBe(true);
    document.querySelector<HTMLButtonElement>('[data-modal="where-ask"] [data-action="go"]')!.click();
    await vi.waitFor(() => expect(document.querySelector('[data-modal="home-folder"]')).not.toBeNull(), { timeout: 10_000 });
    document.querySelector<HTMLButtonElement>('[data-modal="home-folder"] [data-action="cancel"]')!.click();
    // Back at the question (the browser row is still there to choose); Cancel it.
    await vi.waitFor(() => expect(document.querySelector('[data-modal="home-folder"]')).toBeNull(), { timeout: 10_000 });
    expect(document.querySelector('[data-modal="where-ask"]')).not.toBeNull();
    document.querySelector<HTMLButtonElement>('[data-modal="where-ask"] [data-action="cancel"]')!.click();
    const ok = await pending;
    expect(ok).toBe(false);
    expect(state.minted).toHaveLength(0);
    expect(toasts.calls.some(c => c.level === 'error')).toBe(false);
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    localStorage.removeItem('atlas_ui_prefs');
  });

  it('a second open while the first waits on the where-question does nothing', async () => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null);
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    const toasts = makeToasts();

    const first = openAccountWorld(row, toasts);
    await vi.waitFor(() => expect(document.querySelector('[data-modal="where-ask"]')).not.toBeNull(), { timeout: 10_000 });
    // `opening` is not set yet: before the guard, this started a second open.
    expect(getState().accountWorlds.opening).toBeNull();
    expect(await openAccountWorld(row, toasts)).toBe(false);
    expect(document.querySelectorAll('[data-modal="where-ask"]')).toHaveLength(1);
    document.querySelector<HTMLButtonElement>('[data-modal="where-ask"] [data-action="cancel"]')!.click();
    expect(await first).toBe(false);
    expect(state.minted).toHaveLength(0);
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  it('returns false when the row is already represented in the registry', async () => {
    const state = mount();
    let reg = defaultRegistry();
    reg = createApiLinkedWorld(reg, {
      name: 'Owned', apiWorldId: 'srv-owned', apiKey: 'k', folderName: 'owned', handleKey: 'h',
    }).next;
    reg = setAccountToken(reg, TOKEN, 'titus');
    patchSlice('registry', reg);
    patchSlice('atlasRoot', { folderName: 'root' });
    const toasts = makeToasts();

    const ok = await openAccountWorld(row, toasts);
    expect(ok).toBe(false);
    expect(state.minted).toHaveLength(0);
    expect(toasts.calls.some(c => c.level === 'info' && /already here/i.test(c.msg))).toBe(true);
    await tick(20); // the branch fires a background refreshAccountWorlds(true)
  });
});

describe('mintOwnKey — a shared world takes a key made for the member (#199, keel D72 R9)', () => {
  const contributor: AccountWorldRow = { id: 'srv-collab', name: 'Collab World', role: 'collaborator', member_role: 'contributor', public_read: true, keys: [] };
  const guest: AccountWorldRow = { ...contributor, member_role: 'guest' };
  const owned: AccountWorldRow = { id: 'srv-owned', name: 'Owned World', role: 'owner', public_read: false, keys: [] };

  it('an owner and a member with an account PIN get a write key', async () => {
    const state = mount({ worlds: [owned, contributor], accountHasPin: true });
    const client = new AccountClient(TOKEN);
    expect(await mintOwnKey(client, owned)).toMatchObject({ readOnly: false });
    expect(await mintOwnKey(client, contributor)).toMatchObject({ readOnly: false });
    expect(state.minted.map(m => m.scope)).toEqual(['WRITE', 'WRITE']);
  });

  it('a guest gets a read key, and only one mint', async () => {
    const state = mount({ worlds: [guest], accountHasPin: true });
    const out = await mintOwnKey(new AccountClient(TOKEN), guest);
    expect(out).toMatchObject({ readOnly: true, why: 'guest' });
    expect(out.minted.key).toMatch(/^ow_r_/);
    expect(state.minted.map(m => m.scope)).toEqual(['READ']);
  });

  it('a member with no account PIN: the write mint is refused (409), then a read key', async () => {
    const state = mount({ worlds: [contributor], accountHasPin: false });
    const out = await mintOwnKey(new AccountClient(TOKEN), contributor);
    expect(out).toMatchObject({ readOnly: true, why: 'no-pin' });
    expect(state.minted.map(m => m.scope)).toEqual(['READ']);
  });

  it('an owner never falls back to a read key: a 409 on its mint rethrows', async () => {
    const state = mount({ worlds: [owned], accountHasPin: true });
    mswServer.use(
      // Only the write mint is refused: a read mint here would answer, so a
      // fallback taken for an owner would show as a read key.
      http.post(`${V2_BASE}/account/worlds/srv-owned/keys`, async ({ request }) => {
        const body = (await request.json().catch(() => ({}))) as { scope?: string } | null;
        if (body?.scope === 'read') {
          return HttpResponse.json({ id: 'k', last4: 'rrrr', scope: 'READ', name: '', revoked: false, key: 'ow_r_ownerread' }, { status: 201 });
        }
        return HttpResponse.json({ error: { type: 'invalid_request', code: 'pin_required', message: 'x', param: null } }, { status: 409 });
      }),
    );
    await expect(mintOwnKey(new AccountClient(TOKEN), owned)).rejects.toMatchObject({ status: 409, code: 'pin_required' });
    expect(state.minted).toHaveLength(0);
  });

  it('a world the account is not in still throws (404), with nothing minted', async () => {
    const state = mount({ worlds: [], accountHasPin: true });
    await expect(mintOwnKey(new AccountClient(TOKEN), contributor)).rejects.toMatchObject({ status: 404 });
    expect(state.minted).toHaveLength(0);
  });

  it('who asks for the PIN, and the line each open leaves', () => {
    expect([owned, contributor, { ...contributor, member_role: 'co_builder' as const }, guest].map(opensToWrite))
      .toEqual([true, true, true, false]);
    expect(sharedOpenLine(owned, undefined)).toBeNull();
    expect(sharedOpenLine({ ...contributor, member_role: 'co_builder' }, undefined)).toBeNull();
    expect(sharedOpenLine(contributor, undefined)).toContain('As a contributor in Collab World');
    expect(sharedOpenLine(guest, 'guest')).toContain('you are a guest in it');
    expect(sharedOpenLine(contributor, 'no-pin')).toContain('under World PIN');
  });
});

describe('createApiWorld — the signed-in v2 lane; signed out it refuses', () => {
  const WORLDSYNC_BASE = 'https://test-ow.local/api/worldapi';

  it('signed in, pinless account: the PIN dance retries with the pin and returns the row + key', async () => {
    // Pinless account → the no-pin attempt 422s param=pin, so a plain success
    // here can ONLY come from the dance's retry-with-pin. AccountClient builds
    // with no base override, so these handlers sit at the production v2 base.
    const state = mount({ accountHasPin: false });
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));

    const result = await createApiWorld({ name: 'Fresh World', pin: '4242' });

    expect(result.apiKey).toMatch(/^ow_w_/);
    expect(result.worldId).toBeTruthy();
    expect(result.worldName).toBe('Fresh World');
    expect(state.created).toHaveLength(1);
    expect(state.created[0].name).toBe('Fresh World');
  });

  it('signed in, account already has a pin: the no-pin attempt succeeds without a retry', async () => {
    const state = mount({ accountHasPin: true });
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));

    const result = await createApiWorld({ name: 'Second World', pin: '4242' });

    expect(result.apiKey).toMatch(/^ow_w_/);
    expect(result.worldName).toBe('Second World');
    expect(state.created).toHaveLength(1);
  });

  it('sends the folder\'s producer and source lines, which keel keeps as the world\'s origin', async () => {
    const state = mount({ accountHasPin: false });
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    const producer = { tool: 'atlas', version: '1.83.0', input: 'bare' };
    const source = { server: 'https://www.onlyworlds.com', world: 'w-old', at: '2026-10-20T10:00:00Z' };
    const lines = worldOriginLines({ id: 'x', name: 'N', producer, source });

    await createApiWorld({ name: 'Made Online', pin: '4242', lines });

    expect(state.created).toHaveLength(1);
    expect(state.created[0].origin).toEqual({ source, producer });
  });

  it('a folder line keel would refuse stays home, and the world still goes online', async () => {
    const state = mount({ accountHasPin: true });
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    const lines = worldOriginLines({ id: 'x', name: 'N', producer: { tool: 7 }, source: ['not', 'an', 'object'] });
    expect(lines).toEqual({});

    await createApiWorld({ name: 'Odd Lines', pin: '4242', lines });

    expect(state.created[0].origin).toEqual({ source: null, producer: null });
  });

  it('a line keel refuses for its own reason: the world is made once more without the lines', async () => {
    const state = mount({ accountHasPin: true });
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    let refused = 0;
    mswServer.use(http.post(`${V2_BASE}/account/worlds`, async ({ request }) => {
      const body = await request.clone().json() as Record<string, unknown>;
      if (!('producer' in body)) return undefined; // falls through to the stateful handler
      refused++;
      return HttpResponse.json({ error: { type: 'invalid_request', code: 'invalid_request', message: 'producer.tool too long.', param: 'producer' } }, { status: 422 });
    }));
    const lines = worldOriginLines({ id: 'x', name: 'N', producer: { tool: 'atlas', version: '1.83.0', input: 'bare' } });

    const result = await createApiWorld({ name: 'Plain Lines', pin: '4242', lines });

    expect(refused).toBe(1);
    expect(result.worldName).toBe('Plain Lines');
    expect(state.created[0].origin).toEqual({ source: null, producer: null });
  });

  it('signed out: refuses, and the retired v1 create-world-external is never called', async () => {
    // No account token (beforeEach reset the registry). The v1 handlers stay
    // mounted as a tripwire: a regression back to the legacy lane would land there.
    const v1 = statefulOwHandlers({ baseUrl: WORLDSYNC_BASE });
    mswServer.use(...v1.handlers);
    setMakeOnlineBaseUrl(WORLDSYNC_BASE);

    await expect(createApiWorld({ name: 'Legacy World', pin: '4242' })).rejects.toThrow(/Sign in to OnlyWorlds first/);
    expect(v1.worldCreations).toHaveLength(0);
  });
});

describe('openAccountWorld — a sign-in elsewhere while it asks (conv. 179, 2026-10-26)', () => {
  it('the token replaced while the where-question waits: stops with the line, mints nothing, says no refusal', async () => {
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => Promise.resolve(null);
    localStorage.setItem('atlas_ui_prefs', JSON.stringify({ sidebarMode: 'worlds', defaultCreateType: 'character', newWorldWhere: 'folder' }));
    const state = mount();
    patchSlice('registry', setAccountToken(defaultRegistry(), TOKEN, 'titus'));
    // A home folder is set, so the folder answer goes on at once.
    patchSlice('atlasRoot', { name: 'home' } as never);
    const row: AccountWorldRow = { id: 'srv-collab', name: 'Collab World', role: 'collaborator', public_read: true, keys: [] };
    const toasts = makeToasts();
    const pending = openAccountWorld(row, toasts);
    await vi.waitFor(() => expect(document.querySelector('[data-modal="where-ask"]')).not.toBeNull(), { timeout: 10_000 });
    // Another tab signs in: the registry now holds another token.
    patchSlice('registry', setAccountToken(getState().registry, 'ow_a_another_tab_token', 'titus'));
    document.querySelector<HTMLButtonElement>('[data-modal="where-ask"] [data-action="go"]')!.click();
    expect(await pending).toBe(false);
    expect(state.minted).toHaveLength(0);
    expect(toasts.calls.map(c => c.msg)).toContain(SIGNED_IN_AGAIN_LINE);
    expect(toasts.calls.filter(c => c.level === 'error')).toEqual([]);
    delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
    localStorage.removeItem('atlas_ui_prefs');
  });
});
