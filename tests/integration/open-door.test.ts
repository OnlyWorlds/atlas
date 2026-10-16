/**
 * The `#/open/<world id>` door's account read (#104, S416 gate F2-F4): the
 * door reads the account's list fresh, never from what this tab fetched
 * before (a world made since, an old failure), and an id held for a sign-in
 * is dropped when another door takes that sign-in or the token is forgotten.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { getState, patchSlice } from '../../src/core/state';
import { dropHeldOpen, resumeOpenAfterSignIn, runOpenLink } from '../../src/setup/open-door';

const ID = '33333333-4444-4555-8666-777777777777';
const TOKEN = 'ow_a_open_door_token_00000000000000000';

function fakeToasts() {
  const said: Array<{ kind: string; msg: string; actions?: string[] }> = [];
  const t = {
    error: (msg: string) => { said.push({ kind: 'error', msg }); },
    info: (msg: string) => { said.push({ kind: 'info', msg }); },
    success: (msg: string) => { said.push({ kind: 'success', msg }); },
    show: (msg: string, kind: string, _d: number, o?: { actions?: Array<{ label: string }> }) => {
      said.push({ kind, msg, actions: o?.actions?.map(a => a.label) });
    },
  };
  return { said, t: t as never };
}

let lists = 0;
beforeEach(() => {
  lists = 0;
  dropHeldOpen();
  mswServer.use(http.get('*/account/worlds', () => {
    lists++;
    return HttpResponse.json({ data: [{ id: ID, name: 'Fresh World', role: 'owner', member_role: null, public_read: false, keys: [] }] });
  }));
});

function signedIn() {
  patchSlice('registry', { ...getState().registry, worlds: [], account_token: TOKEN, account_username: 'me' });
}

describe('the open door reads the account fresh', () => {
  it('a list this tab fetched before the world existed is read again, and the world is offered', async () => {
    signedIn();
    patchSlice('accountWorlds', { ...getState().accountWorlds, status: 'ready', rows: [], opening: null, fetchedWithToken: TOKEN });
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(lists).toBe(1);
    expect(said).toEqual([expect.objectContaining({ msg: 'Open "Fresh World", from your worlds on OnlyWorlds?', actions: ['Open'] })]);
  });

  it('an earlier failure in this tab is tried again, never repeated', async () => {
    signedIn();
    patchSlice('accountWorlds', { ...getState().accountWorlds, status: 'error', rows: [], opening: null, fetchedWithToken: TOKEN, error: 'OLD ERROR SENTENCE', errorKind: 'other' });
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(lists).toBe(1);
    expect(said.map(s => s.msg)).not.toContain('OLD ERROR SENTENCE');
    expect(said[0].actions).toEqual(['Open']);
  });
});

describe('an id held for the sign-in', () => {
  it('waits signed out, then runs once at the sign-in', async () => {
    patchSlice('registry', { ...getState().registry, worlds: [], account_token: undefined, account_username: undefined });
    const { said, t } = fakeToasts();
    await runOpenLink(ID, t);
    expect(said[0].msg).toMatch(/sign in to Atlas with your OnlyWorlds account/);
    signedIn();
    expect(await resumeOpenAfterSignIn(t)).toBe(true);
    expect(await resumeOpenAfterSignIn(t)).toBe(false);
  });

  it('is dropped when another door takes the sign-in, or the token is forgotten', async () => {
    patchSlice('registry', { ...getState().registry, worlds: [], account_token: undefined, account_username: undefined });
    const { t } = fakeToasts();
    await runOpenLink(ID, t);
    dropHeldOpen();
    signedIn();
    expect(await resumeOpenAfterSignIn(t)).toBe(false);
    expect(lists).toBe(0);
  });
});
