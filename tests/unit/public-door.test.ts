/**
 * The open door's public path (1.123, `setup/public-door.ts`): a copy already
 * here is found by the world alone (any time, the newest of several) and
 * opens after one keyless `GET /world`, with a line when the world is no
 * longer public; a copy whose folder is gone goes on to the ask; with none,
 * the ask (its Sign in only signed out), keel's 404, or its 401 with the
 * public reader switched off, the door's own words, anything else one line;
 * the Open re-checks the sign-in it was asked under, builds once per world
 * across tabs, and looks for a copy again inside the lock, in storage. keel
 * is played as its public reader, and as it answers with the reader off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getState, patchSlice } from '../../src/core/state';
import {
  findPublicCopy, openPublicCopy, runPublicDoor, publicAskLine, publicAskSignedInLine, publicGoneLine,
  PUBLIC_UNREAD_LINE, PUBLIC_SIGN_IN_CHANGED_LINE, publicSpentLine, publicWaitLine, type PublicDoorCtx,
} from '../../src/setup/public-door';
import { installFakeLocks } from '../fixtures/fake-locks';
import { __setRegistryTabBaseForTests } from '../../src/registry/registry';
import { REGISTRY_STORAGE_KEY } from '../../src/core/constants';
import type { WorldRegistryEntry } from '../../src/core/types';

// jsdom has no browser storage: the build's own check reads it as there, so a build gets as far as keel.
vi.mock('../../src/core/capabilities', async (orig) => ({
  ...(await orig<typeof import('../../src/core/capabilities')>()),
  opfsStatus: async () => 'ok',
}));

const W = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e';
const OTHER = '44444444-5555-4666-8777-888888888888';
const T = '2026-11-06T10:00:00.000Z';

function copyEntry(id: string, world: string, at?: string, extra: Partial<WorldRegistryEntry> = {}): WorldRegistryEntry {
  return {
    id, name: 'Blood Meridian', state: 'local-only', where: 'browser',
    folder: { handle_key: `world-${id}`, folder_name: id },
    copy_of: { world_id: world, ...(at ? { at } : {}) },
    ...extra,
  } as unknown as WorldRegistryEntry;
}

function keel(status: number) {
  const seen: URL[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    seen.push(url);
    if (status === 200) return new Response(JSON.stringify({ id: W, name: 'Blood Meridian', updated_at: T, counts: { total: 0, types: {} } }), { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (status === 404) return new Response(JSON.stringify({ error: { type: 'not_found', code: 'not_found', message: 'World not found.' } }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    if (status === 429) return new Response(JSON.stringify({ error: { type: 'rate_limit_error', code: 'rate_limited', message: 'Slow.' } }), { status: 429, headers: { 'Retry-After': '9' } });
    // keel with PUBLIC_READER off: a keyless `?world=` read is today's 401 (api-v2-spec, "the public reader": "Off: a keyless `world` is the `401`").
    if (status === 401) return new Response(JSON.stringify({ error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null, doc_url: 'https://onlyworlds.github.io/api/errors/#invalid_credentials' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    return new Response('down', { status: 503 });
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, seen };
}

function fakeToasts() {
  return { show: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() };
}

function ctxFor(k: ReturnType<typeof keel>, token: string | null = null, opens = true) {
  const opened: Array<{ entry: WorldRegistryEntry; said?: () => void }> = [];
  const ctx: PublicDoorCtx = {
    token,
    saySignIn: vi.fn(),
    sayNotAmong: vi.fn(),
    openHere: vi.fn(async (entry: WorldRegistryEntry, said?: () => void) => { opened.push({ entry, said }); if (opens) said?.(); return opens; }),
    readerOpts: { fetch: k.fetch, sleep: async () => {} },
  };
  return { ctx, opened };
}

const before = getState().registry;
afterEach(() => { patchSlice('registry', before); });

describe('a copy already here, found by the world alone', () => {
  it('matches copy_of.world_id at any time, the newest of several, never a cleared one or another world', () => {
    const reg = {
      ...before,
      worlds: [
        copyEntry('older', W, '2026-11-01T00:00:00Z'),
        copyEntry('newest', W, '2026-11-05T00:00:00Z'),
        copyEntry('no-time', W),
        copyEntry('cleared', W, '2026-11-06T00:00:00Z', { cleared_at: T } as never),
        copyEntry('other', OTHER, '2026-11-06T00:00:00Z'),
      ],
    };
    expect(findPublicCopy(reg, W)?.id).toBe('newest');
    expect(findPublicCopy(reg, '55555555-5555-4555-8555-555555555555')).toBeNull();
    expect(findPublicCopy({ ...before, worlds: [copyEntry('own', W, undefined, { copy_of: undefined } as never)] }, W)).toBeNull();
  });

  it('opens after exactly one keyless GET /world, no line while the world is public', async () => {
    patchSlice('registry', { ...before, worlds: [copyEntry('here', W, '2026-11-01T00:00:00Z')] });
    const k = keel(200);
    const { ctx, opened } = ctxFor(k);
    const t = fakeToasts();
    await runPublicDoor(W, t as never, ctx);
    expect(opened.map(o => o.entry.id)).toEqual(['here']);
    expect(k.seen).toHaveLength(1);
    expect(k.seen[0].pathname.replace(/\/$/, '')).toBe('/api/v2/world');
    expect(k.seen[0].searchParams.get('world')).toBe(W);
    expect(t.info).not.toHaveBeenCalled();
    expect(t.show).not.toHaveBeenCalled();
  });

  it('keel\'s 404: the copy opens as it is, with one line that the world is no longer public', async () => {
    patchSlice('registry', { ...before, worlds: [copyEntry('here', W, '2026-11-01T12:00:00Z')] });
    const k = keel(404);
    const { ctx, opened } = ctxFor(k);
    const t = fakeToasts();
    await runPublicDoor(W, t as never, ctx);
    expect(opened).toHaveLength(1);
    expect(t.info).toHaveBeenCalledTimes(1);
    expect(t.info.mock.calls[0][0]).toBe(publicGoneLine('Blood Meridian', '2026-11-01T12:00:00Z'));
    expect(ctx.saySignIn).not.toHaveBeenCalled();
  });

  it('anything else (a 429, a 503, the reader switched off): the copy opens as it is, no line, one request', async () => {
    for (const status of [429, 503, 401]) {
      patchSlice('registry', { ...before, worlds: [copyEntry('here', W, T)] });
      const k = keel(status);
      const { ctx, opened } = ctxFor(k);
      const t = fakeToasts();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await runPublicDoor(W, t as never, ctx);
      expect(opened).toHaveLength(1);
      expect(k.seen).toHaveLength(1);
      expect(t.info).not.toHaveBeenCalled();
    }
  });
});

describe('no copy here', () => {
  beforeEach(() => { patchSlice('registry', { ...before, worlds: [] }); });

  it('signed out, a public world: the ask with Open and Sign in, nothing made', async () => {
    const k = keel(200);
    const { ctx } = ctxFor(k);
    const t = fakeToasts();
    await runPublicDoor(W, t as never, ctx);
    expect(t.show).toHaveBeenCalledTimes(1);
    expect(t.show.mock.calls[0][0]).toBe(publicAskLine('Blood Meridian'));
    expect(t.show.mock.calls[0][3].actions.map((a: { label: string }) => a.label)).toEqual(['Open', 'Sign in']);
    // Sign in is the door's own: the id held, Settings.
    t.show.mock.calls[0][3].actions[1].run();
    expect(ctx.saySignIn).toHaveBeenCalledTimes(1);
    expect(k.seen).toHaveLength(1);
    expect(getState().registry.worlds).toHaveLength(0);
  });

  it('signed in with no row: the line says this account has none, and offers the copy, no Sign in', async () => {
    patchSlice('registry', { ...getState().registry, account_token: 'ow_a_x', account_username: 'e2e-guest' });
    const k = keel(200);
    const { ctx } = ctxFor(k, 'ow_a_x');
    const t = fakeToasts();
    await runPublicDoor(W, t as never, ctx);
    expect(t.show.mock.calls[0][0]).toBe(publicAskSignedInLine('Blood Meridian', 'e2e-guest'));
    expect(t.show.mock.calls[0][3].actions.map((a: { label: string }) => a.label)).toEqual(['Open']);
  });

  it('keel\'s 404 keeps the door\'s own words: signed out the sign-in, signed in the not-among line', async () => {
    const out = ctxFor(keel(404));
    await runPublicDoor(W, fakeToasts() as never, out.ctx);
    expect(out.ctx.saySignIn).toHaveBeenCalledTimes(1);
    const inn = ctxFor(keel(404), 'ow_a_x');
    await runPublicDoor(W, fakeToasts() as never, inn.ctx);
    expect(inn.ctx.sayNotAmong).toHaveBeenCalledTimes(1);
    expect(inn.ctx.saySignIn).not.toHaveBeenCalled();
  });

  it('keel\'s public reader switched off (a keyless 401) keeps the door\'s own words too', async () => {
    const out = ctxFor(keel(401));
    const t = fakeToasts();
    await runPublicDoor(W, t as never, out.ctx);
    expect(out.ctx.saySignIn).toHaveBeenCalledTimes(1);
    expect(t.error).not.toHaveBeenCalled();
    const inn = ctxFor(keel(401), 'ow_a_x');
    await runPublicDoor(W, fakeToasts() as never, inn.ctx);
    expect(inn.ctx.sayNotAmong).toHaveBeenCalledTimes(1);
  });

  it('a copy whose folder is gone (the open could not) goes on to the ask, on the same one read', async () => {
    patchSlice('registry', { ...before, worlds: [copyEntry('gone', W, T)] });
    const k = keel(200);
    const { ctx, opened } = ctxFor(k, null, false);
    const t = fakeToasts();
    await runPublicDoor(W, t as never, ctx);
    expect(opened.map(o => o.entry.id)).toEqual(['gone']);
    expect(t.show).toHaveBeenCalledTimes(1);
    expect(t.show.mock.calls[0][0]).toBe(publicAskLine('Blood Meridian'));
    expect(k.seen).toHaveLength(1);
  });

  it('anything else is one line, nothing held, no ask', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const status of [429, 503]) {
      const { ctx } = ctxFor(keel(status));
      const t = fakeToasts();
      await runPublicDoor(W, t as never, ctx);
      expect(t.error).toHaveBeenCalledWith(PUBLIC_UNREAD_LINE, 12_000);
      expect(t.show).not.toHaveBeenCalled();
      expect(ctx.saySignIn).not.toHaveBeenCalled();
    }
  });
});

describe('the words', () => {
  it('say them as the voice read has them, names quoted, no contractions', () => {
    expect(publicAskLine('Blood Meridian')).toBe('Open a view-only copy of "Blood Meridian" in this browser? If it is your world, sign in instead to open it as your own.');
    expect(publicAskSignedInLine('Blood Meridian', 'wren')).toBe('"Blood Meridian" is not one of your worlds (you are signed in as wren). Open a view-only copy in this browser?');
    expect(publicAskSignedInLine('Blood Meridian', null)).toBe('"Blood Meridian" is not one of the worlds of the account Atlas is signed in with. Open a view-only copy in this browser?');
    expect(PUBLIC_UNREAD_LINE).toBe('Atlas could not reach OnlyWorlds just now. Try the link again in a moment.');
    expect(PUBLIC_SIGN_IN_CHANGED_LINE).toBe('You signed in or out while Atlas was opening this world. Open the link again.');
    expect(publicWaitLine(1)).toBe('OnlyWorlds asked Atlas to wait 1 second.');
    expect(publicWaitLine(7)).toBe('OnlyWorlds asked Atlas to wait 7 seconds.');
    expect(publicSpentLine('Blood Meridian')).toBe('"Blood Meridian" did not download completely, so Atlas did not open it. Try again in a minute.');
    expect(publicGoneLine('Blood Meridian', undefined)).toBe('"Blood Meridian" is no longer public on OnlyWorlds. This copy is as it was when it was taken.');
    expect(publicGoneLine('Blood Meridian', '2026-11-01T12:00:00Z')).toMatch(/^"Blood Meridian" is no longer public on OnlyWorlds\. This copy is as it was on .*2026\.$/);
  });
});

describe('the Open', () => {
  let fake: ReturnType<typeof installFakeLocks>;
  beforeEach(() => { fake = installFakeLocks(); patchSlice('registry', { ...before, worlds: [] }); });
  afterEach(() => fake.uninstall());

  it('refuses when the sign-in moved since the ask', async () => {
    patchSlice('registry', { ...getState().registry, account_token: 'ow_a_new' });
    const k = keel(200);
    const { ctx } = ctxFor(k, null);
    const t = fakeToasts();
    await openPublicCopy(W, 'Blood Meridian', t as never, ctx);
    expect(t.info).toHaveBeenCalledWith(PUBLIC_SIGN_IN_CHANGED_LINE);
    expect(k.seen).toHaveLength(0);
  });

  it('inside the lock, a copy another tab made meanwhile opens instead, nothing read; a second Open while one waits does nothing', async () => {
    const release = await fake.locks.hold(`atlas-public-copy-${W}`);
    const k = keel(200);
    const { ctx, opened } = ctxFor(k);
    const t = fakeToasts();
    const first = openPublicCopy(W, 'Blood Meridian', t as never, ctx);
    const second = openPublicCopy(W, 'Blood Meridian', t as never, ctx);
    await second;
    // The other tab finishes its copy (at another time than any read here), saves, and its
    // storage event has reached this tab; then it lets go.
    const withCopy = { ...getState().registry, worlds: [copyEntry('made-there', W, '2026-11-06T09:00:00Z')] };
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify(withCopy));
    patchSlice('registry', withCopy);
    __setRegistryTabBaseForTests(withCopy);
    release();
    await first;
    expect(opened.map(o => o.entry.id)).toEqual(['made-there']);
    expect(k.seen).toHaveLength(0);
    localStorage.removeItem(REGISTRY_STORAGE_KEY);
    __setRegistryTabBaseForTests(null);
  });

  it('keel closing the door between the ask and the Open (a 404, or the reader switched off) gets the door\'s own words', async () => {
    for (const status of [404, 401]) {
      const k = keel(status);
      const { ctx } = ctxFor(k);
      const t = fakeToasts();
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      await openPublicCopy(W, 'Blood Meridian', t as never, ctx);
      expect(ctx.saySignIn).toHaveBeenCalledTimes(1);
      expect(t.error).not.toHaveBeenCalled();
      expect(k.seen.length).toBeGreaterThan(0);
    }
  });

  it('inside the lock, the copy is read from storage: another tab\'s save whose storage event has not come yet', async () => {
    const here = getState().registry;
    __setRegistryTabBaseForTests(here);
    const release = await fake.locks.hold(`atlas-public-copy-${W}`);
    const k = keel(200);
    const { ctx, opened } = ctxFor(k);
    const first = openPublicCopy(W, 'Blood Meridian', fakeToasts() as never, ctx);
    // The other tab saved its registry with the copy; this tab's memory has not heard.
    localStorage.setItem(REGISTRY_STORAGE_KEY, JSON.stringify({ ...here, worlds: [copyEntry('saved-there', W, '2026-11-06T09:00:00Z')] }));
    expect(getState().registry.worlds).toHaveLength(0);
    release();
    await first;
    expect(opened.map(o => o.entry.id)).toEqual(['saved-there']);
    expect(k.seen).toHaveLength(0);
    localStorage.removeItem(REGISTRY_STORAGE_KEY);
    __setRegistryTabBaseForTests(null);
  });
});
