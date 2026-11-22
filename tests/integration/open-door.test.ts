/**
 * The `#/open/<world id>` door (#104, 1.125.0's 2026-11-22): the door reads the
 * account's list fresh, never from what this tab fetched before (a world made
 * since, an old failure); signed out, a world the public cannot read gets one
 * card that holds the sign-in (R1), whose two sign-ins keep the held id and
 * whose every other way down drops it; signed in, the account's row is one
 * question, named (R2): a toast with a world open, the where-question at once
 * with the folder picker, a card without it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { getState, patchSlice } from '../../src/core/state';
import { TOUR_STARTED_EVENT } from '../../src/tour/tour-flag';
import { WAITS_FOR_SIGN_IN } from '../../src/ui/toast-manager';

const calls = vi.hoisted(() => ({
  order: [] as string[],
  resumes: [] as unknown[],
  begin: { fail: false },
  opens: [] as Array<{ id: string; opts: unknown }>,
  offered: { ow: true },
}));
vi.mock('../../src/sync/onlyworlds-sign-in', async (orig) => ({
  ...(await orig<typeof import('../../src/sync/onlyworlds-sign-in')>()),
  beginOnlyWorldsSignIn: vi.fn(async (resume: unknown) => {
    calls.order.push('begin');
    calls.resumes.push(resume);
    if (calls.begin.fail) throw new Error('no session storage');
  }),
}));
vi.mock('../../src/core/reload-offer', async (orig) => ({
  ...(await orig<typeof import('../../src/core/reload-offer')>()),
  flushBeforeUnloading: vi.fn(async () => { calls.order.push('flush'); }),
}));
vi.mock('../../src/ui/onlyworlds-sign-in-button', async (orig) => ({
  ...(await orig<typeof import('../../src/ui/onlyworlds-sign-in-button')>()),
  onlyWorldsSignInOffered: () => calls.offered.ow,
}));
vi.mock('../../src/sync/account-worlds', async (orig) => ({
  ...(await orig<typeof import('../../src/sync/account-worlds')>()),
  openAccountWorld: vi.fn(async (row: { id: string }, _t: unknown, opts: unknown) => { calls.opens.push({ id: row.id, opts }); return true; }),
}));

import {
  askSignInAgain, dropHeldOpen, openHeldForSignIn, resumeOpenAfterSignIn, runOpenLink,
  OPEN_SIGN_IN_CARD_LINE, OPEN_SIGN_IN_LINE, openSignInNamedLine,
} from '../../src/setup/open-door';
import { applySignInOutcome } from '../../src/setup/sign-in-return';

const ID = '33333333-4444-4555-8666-777777777777';
const TOKEN = 'ow_a_open_door_token_00000000000000000';

function fakeToasts() {
  const said: Array<{ kind: string; msg: string; actions?: string[]; dedupeKey?: string }> = [];
  const t = {
    error: (msg: string) => { said.push({ kind: 'error', msg }); },
    info: (msg: string) => { said.push({ kind: 'info', msg }); },
    success: (msg: string) => { said.push({ kind: 'success', msg }); },
    dismiss: () => {},
    show: (msg: string, kind: string, _d: number, o?: { actions?: Array<{ label: string; run: () => void }>; dedupeKey?: string }) => {
      said.push({ kind, msg, actions: o?.actions?.map(a => a.label), dedupeKey: o?.dedupeKey });
      lastActions = o?.actions ?? [];
    },
  };
  return { said, t: t as never };
}
let lastActions: Array<{ label: string; run: () => void }> = [];

let lists = 0;
beforeEach(() => {
  lists = 0;
  calls.order.length = 0;
  calls.resumes.length = 0;
  calls.opens.length = 0;
  calls.begin.fail = false;
  calls.offered.ow = true;
  dropHeldOpen();
  document.body.innerHTML = '';
  localStorage.removeItem('atlas_tour_v1');
  window.location.hash = '#/';
  patchSlice('active', null as never);
  mswServer.use(http.get('*/account/worlds', () => {
    lists++;
    return HttpResponse.json({ data: [{ id: ID, name: 'Fresh World', role: 'owner', member_role: null, public_read: false, keys: [] }] });
  }));
  // keel's public reader (1.123's door asks it when the account path cannot):
  // this world is not public, so a keyless read is its one 404.
  mswServer.use(http.get('*/api/v2/world/', ({ request }) => {
    if (request.headers.has('API-Key') || request.headers.has('Authorization') || !new URL(request.url).searchParams.get('world')) {
      return HttpResponse.json({ error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null } }, { status: 401 });
    }
    return HttpResponse.json({ error: { type: 'not_found', code: 'not_found', message: 'World not found.', param: null } }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }));
});
afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  document.querySelectorAll('.atlas-modal-overlay').forEach(n => n.remove());
});

function signedIn() {
  patchSlice('registry', { ...getState().registry, worlds: [], account_token: TOKEN, account_username: 'me' });
}
function signedOut() {
  patchSlice('registry', { ...getState().registry, worlds: [], account_token: undefined, account_username: undefined });
}
const card = () => document.querySelector<HTMLElement>('[data-modal="open-sign-in"]');
const cardButton = (action: string) => card()!.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!;
const tick = () => new Promise<void>(r => setTimeout(r, 0));

describe('the open door reads the account fresh', () => {
  it('a list this tab fetched before the world existed is read again, and the world is offered', async () => {
    signedIn();
    patchSlice('accountWorlds', { ...getState().accountWorlds, status: 'ready', rows: [], opening: null, fetchedWithToken: TOKEN });
    const { t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(lists).toBe(1);
    // No folder picker here (jsdom, as Firefox): the card, named, with Not now and Open.
    const ask = document.querySelector('[data-modal="open-account"]');
    expect(ask?.textContent).toContain('Open "Fresh World", from your worlds on OnlyWorlds?');
    expect([...ask!.querySelectorAll('button')].map(b => b.textContent?.trim())).toEqual(['Not now', 'Open']);
  });

  it('an earlier failure in this tab is tried again, never repeated', async () => {
    signedIn();
    patchSlice('accountWorlds', { ...getState().accountWorlds, status: 'error', rows: [], opening: null, fetchedWithToken: TOKEN, error: 'OLD ERROR SENTENCE', errorKind: 'other' });
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(lists).toBe(1);
    expect(said.map(s => s.msg)).not.toContain('OLD ERROR SENTENCE');
    expect(document.querySelector('[data-modal="open-account"]')).not.toBeNull();
  });
});

describe('R1: signed out, one card that holds the sign-in', () => {
  it('waits signed out on a card, never Settings, then runs once at the sign-in', async () => {
    signedOut();
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(card()?.textContent).toContain(OPEN_SIGN_IN_CARD_LINE);
    expect(window.location.hash).toBe('#/');
    expect(said).toEqual([]);
    expect(openHeldForSignIn()).toBe(ID);
    signedIn();
    expect(await resumeOpenAfterSignIn(t)).toBe(true);
    expect(await resumeOpenAfterSignIn(t)).toBe(false);
  });

  it('is dropped when another door takes the sign-in, or the token is forgotten', async () => {
    signedOut();
    const { t } = fakeToasts();
    await runOpenLink(ID, t);
    dropHeldOpen();
    signedIn();
    expect(await resumeOpenAfterSignIn(t)).toBe(false);
    expect(lists).toBe(0);
  });

  it('its buttons, and the primary falls to Email and password where Sign in with OnlyWorlds is not offered', async () => {
    signedOut();
    await runOpenLink(ID, fakeToasts().t);
    expect([...card()!.querySelectorAll('button')].map(b => b.textContent?.trim())).toEqual(['Not now', 'Email and password', 'Sign in with OnlyWorlds']);
    expect(cardButton('sign-in-onlyworlds').className).toContain('atlas-btn-primary');
    expect(document.activeElement).toBe(cardButton('sign-in-onlyworlds'));
    calls.offered.ow = false;
    await runOpenLink(ID, fakeToasts().t);
    expect(document.querySelectorAll('[data-modal="open-sign-in"]')).toHaveLength(1);
    expect(card()!.querySelector('[data-action="sign-in-onlyworlds"]')).toBeNull();
    expect(cardButton('sign-in-password').className).toContain('atlas-btn-primary');
    expect(document.activeElement).toBe(cardButton('sign-in-password'));
    // The card that replaced the first kept the id.
    expect(openHeldForSignIn()).toBe(ID);
  });

  it('with a world open in the tab, Not now takes focus', async () => {
    signedOut();
    patchSlice('active', { worldId: 'local-world', meta: { id: 'local-world', name: 'Desk' }, opened: true } as never);
    await runOpenLink(ID, fakeToasts().t);
    expect(document.activeElement).toBe(cardButton('not-now'));
  });

  it('Email and password keeps the id: Settings, its line, and the card gone without dropping', async () => {
    signedOut();
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    cardButton('sign-in-password').click();
    expect(card()).toBeNull();
    expect(window.location.hash).toBe('#/settings/onlyworlds');
    await tick(); // the hashchange the move fires reaches no card
    expect(openHeldForSignIn()).toBe(ID);
    expect(said).toEqual([expect.objectContaining({ msg: OPEN_SIGN_IN_LINE, dedupeKey: WAITS_FOR_SIGN_IN })]);
  });

  it('Sign in with OnlyWorlds keeps the id: taken into the resume before its first await, the flush before the begin', async () => {
    signedOut();
    await runOpenLink(ID, fakeToasts().t);
    cardButton('sign-in-onlyworlds').click();
    // Dropped right after the click: the resume already holds it.
    const held = openHeldForSignIn();
    dropHeldOpen();
    expect(held).toBe(ID);
    expect(card()).toBeNull();
    await vi.waitFor(() => expect(calls.order).toEqual(['flush', 'begin']));
    expect(calls.resumes[0]).toEqual({ hash: '#/', open: ID });
  });

  it('a begin that fails shows the card again, the id held', async () => {
    signedOut();
    calls.begin.fail = true;
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    cardButton('sign-in-onlyworlds').click();
    await vi.waitFor(() => expect(card()).not.toBeNull());
    expect(openHeldForSignIn()).toBe(ID);
    expect(said.filter(s => s.kind === 'error')).toHaveLength(1);
  });

  it('a Back out of the browser cache drops the parked resume and shows the card again', async () => {
    signedOut();
    await runOpenLink(ID, fakeToasts().t);
    cardButton('sign-in-onlyworlds').click();
    await vi.waitFor(() => expect(calls.order).toEqual(['flush', 'begin']));
    sessionStorage.setItem('atlas-signin-resume', '{"hash":"#/"}');
    const ev = new Event('pageshow') as Event & { persisted?: boolean };
    Object.defineProperty(ev, 'persisted', { value: true });
    window.dispatchEvent(ev);
    expect(sessionStorage.getItem('atlas-signin-resume')).toBeNull();
    expect(card()).not.toBeNull();
    expect(openHeldForSignIn()).toBe(ID);
  });

  const drops: Array<[string, () => void]> = [
    ['Not now', () => cardButton('not-now').click()],
    ['Escape', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))],
    ['an outside click', () => {
      const overlay = card()!.closest<HTMLElement>('.atlas-modal-overlay')!;
      overlay.dispatchEvent(new Event('pointerdown', { bubbles: true }));
      overlay.dispatchEvent(new Event('pointerup', { bubbles: true }));
    }],
    ['a move of the address', () => { window.location.hash = '#/settings/general'; window.dispatchEvent(new HashChangeEvent('hashchange')); }],
    ['the tour\'s start', () => document.dispatchEvent(new CustomEvent(TOUR_STARTED_EVENT))],
  ];
  for (const [how, act] of drops) {
    it(`${how} drops the held id`, async () => {
      signedOut();
      await runOpenLink(ID, fakeToasts().t);
      expect(openHeldForSignIn()).toBe(ID);
      act();
      expect(card()).toBeNull();
      expect(openHeldForSignIn()).toBeNull();
      expect(calls.order).toEqual([]);
    });
  }

  it('a navigate() to the same hash (a synthetic hashchange) is not a move: the card and the id stay', async () => {
    signedOut();
    await runOpenLink(ID, fakeToasts().t);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(card()).not.toBeNull();
    expect(openHeldForSignIn()).toBe(ID);
  });

  it('the public ask\'s Sign in opens this card, named', async () => {
    signedOut();
    mswServer.use(http.get('*/api/v2/world/', () => HttpResponse.json({ id: ID, name: 'Open Lands', meta: { name: 'Open Lands', counts: {} } })));
    await runOpenLink(ID, fakeToasts().t);
    const ask = document.querySelector('[data-modal="public-ask"]');
    expect(ask).not.toBeNull();
    ask!.querySelector<HTMLButtonElement>('[data-action="sign-in"]')!.click();
    expect(card()?.textContent).toContain(openSignInNamedLine('Open Lands'));
    expect(openHeldForSignIn()).toBe(ID);
    expect(window.location.hash).toBe('#/');
  });

  it('a sign-in that came back cancelled shows the card again, the id held, and no Open Settings', async () => {
    signedOut();
    const { said, t } = fakeToasts();
    await applySignInOutcome({ ok: false, cancelled: true, started: true, error: new Error('access_denied'), resume: { hash: '#/', open: ID } }, t);
    expect(card()?.textContent).toContain(OPEN_SIGN_IN_CARD_LINE);
    expect(openHeldForSignIn()).toBe(ID);
    expect(said[0].actions).toBeUndefined();
    cardButton('not-now').click();
    expect(openHeldForSignIn()).toBeNull();
    // Nothing held, nothing to show.
    askSignInAgain(t);
    expect(card()).toBeNull();
  });
});

describe('R2: signed in, the account row is one question, named', () => {
  it('without a folder picker: the card, and nothing opens before its Open', async () => {
    signedIn();
    await runOpenLink(ID, fakeToasts().t);
    expect(calls.opens).toEqual([]);
    document.querySelector<HTMLButtonElement>('[data-modal="open-account"] [data-action="open"]')!.click();
    expect(calls.opens).toEqual([{ id: ID, opts: { fromLink: true } }]);
  });

  it('with the folder picker and no world open: the open runs at once, from the link', async () => {
    signedIn();
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined;
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(said).toEqual([]);
    expect(document.querySelector('[data-modal="open-account"]')).toBeNull();
    expect(calls.opens).toEqual([{ id: ID, opts: { fromLink: true } }]);
  });

  it('with a world open: the corner toast, and its Open', async () => {
    signedIn();
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined;
    patchSlice('active', { worldId: 'local-world', meta: { id: 'local-world', name: 'Desk' }, opened: true } as never);
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(said).toEqual([expect.objectContaining({ msg: 'Open "Fresh World", from your worlds on OnlyWorlds?', actions: ['Open'] })]);
    expect(calls.opens).toEqual([]);
    lastActions[0].run();
    expect(calls.opens).toEqual([{ id: ID, opts: undefined }]);
  });

  it('a tour started before the at-once call stops it', async () => {
    signedIn();
    (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined;
    // The list is read, then the tour starts, then the row would open.
    mswServer.use(http.get('*/account/worlds', () => {
      lists++;
      localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true }));
      return HttpResponse.json({ data: [{ id: ID, name: 'Fresh World', role: 'owner', member_role: null, public_read: false, keys: [] }] });
    }));
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(lists).toBe(1);
    expect(calls.opens).toEqual([]);
    expect(said.map(s => s.msg)).toEqual(['Finish the tour first, then open the world again from onlyworlds.com.']);
  });
});
