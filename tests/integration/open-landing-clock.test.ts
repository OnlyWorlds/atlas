/**
 * An open link's landing outlives its own door's questions: the Open toast
 * and the copy's card wait for the person as long as they like, and a sign-in
 * on onlyworlds.com sits before them, so the landing's clock starts again
 * when the person says Open. Measured from the capture alone, a person who
 * answered after the TTL got the world at its Home with the element never
 * shown and nothing said.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { mswServer } from '../setup';
import { getState, patchSlice } from '../../src/core/state';
import { runOpenLink } from '../../src/setup/open-door';
import { openPublicCopy } from '../../src/setup/public-door';
import { clearOpenLanding, landingStep, peekOpenLanding, setOpenLanding, OPEN_LANDING_TTL_MS } from '../../src/core/open-landing';

const opened: string[] = [];
vi.mock('../../src/sync/account-worlds', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/sync/account-worlds')>()),
  // The where-question, the mint and the download are the account open's own: here only its call.
  openAccountWorld: async (row: { id: string }) => { opened.push(row.id); return true; },
}));

const ID = '33333333-4444-4555-8666-777777777777';
const EL = 'c0000000-0000-4000-8000-000000000077';
const TOKEN = 'ow_a_open_clock_token_0000000000000000';
const T0 = Date.parse('2026-11-12T10:00:00.000Z');
const LATE = T0 + OPEN_LANDING_TTL_MS + 5 * 60_000;

function toastsWithActions() {
  const actions: Array<{ label: string; run: () => void }> = [];
  const t = {
    error: () => {}, info: () => {}, success: () => {},
    show: (_m: string, _k: string, _d: number, o?: { actions?: Array<{ label: string; run: () => void }> }) => { actions.push(...(o?.actions ?? [])); },
  };
  return { actions, t: t as never };
}

/** The world the link names, open and loaded, as the landing reads it. */
function stepAt(now: number) {
  const entry = { id: 'local-1', api: { world_id: ID } } as never;
  return landingStep(peekOpenLanding(), { worldId: 'local-1' }, entry, false, [{ id: EL }], now);
}

beforeEach(() => {
  opened.length = 0;
  clearOpenLanding();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  mswServer.use(http.get('*/account/worlds', () => HttpResponse.json({ data: [{ id: ID, name: 'Slow Reader', role: 'owner', member_role: null, public_read: false, keys: [] }] })));
});
afterEach(() => { vi.useRealTimers(); clearOpenLanding(); });

describe('the landing waits for its own door', () => {
  it('an Open pressed long after the link was captured still lands on the element', async () => {
    patchSlice('registry', { ...getState().registry, worlds: [], account_token: TOKEN, account_username: 'me' });
    setOpenLanding(ID, [EL]);
    const { actions, t } = toastsWithActions();
    await runOpenLink(ID, t);
    const open = actions.find(a => a.label === 'Open');
    expect(open).toBeDefined();
    // The person reads, signs in, comes back: the toast is still there.
    vi.setSystemTime(LATE);
    open!.run();
    expect(opened).toEqual([ID]);
    expect(stepAt(LATE + 60_000)).toEqual({ kind: 'land', localWorldId: 'local-1', found: [EL], missing: 0 });
  });

  it("the copy's Open pressed long after the capture still lands on the element", async () => {
    patchSlice('registry', { ...getState().registry, worlds: [], account_token: undefined, account_username: undefined });
    setOpenLanding(ID, [EL]);
    vi.setSystemTime(LATE);
    const { t } = toastsWithActions();
    const run = openPublicCopy(ID, 'Slow Reader', t, { token: null, saySignIn: () => {}, sayNotAmong: () => {}, openHere: async () => false });
    expect(stepAt(LATE + 60_000).kind).toBe('land');
    await run;
  });

  it('a landing nobody answered for still expires', () => {
    setOpenLanding(ID, [EL]);
    expect(stepAt(LATE).kind).toBe('expired');
  });
});
