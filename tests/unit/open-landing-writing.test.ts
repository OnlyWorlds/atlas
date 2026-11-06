/**
 * The writing landing (1.123): `#/open/<world>/writing[/<narrative>]` is
 * captured as a landing of its own kind (so `/writing` with no narrative is
 * held too), a narrative that is no id is the malformed link, the landing
 * finds a view-only copy by the world it copies, and the sign-in round trip
 * carries it back beside the open id.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captureOpenWorld, takePendingOpen, takePendingOpenElements, takePendingOpenWriting } from '../../src/core/open-capture';
import {
  clearOpenLanding, landingStep, parkedLandingFor, peekOpenLanding, restoreParkedLanding, setOpenLanding, OPEN_LANDING_TTL_MS,
} from '../../src/core/open-landing';
import { readResume } from '../../src/sync/onlyworlds-sign-in';
import { getState, patchSlice } from '../../src/core/state';
import { applySignInOutcome } from '../../src/setup/sign-in-return';
import { openHeldForSignIn, dropHeldOpen } from '../../src/setup/open-door';
import type { ToastManager } from '../../src/ui/toast-manager';

const W = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e';
const N = '01a1b17c-f4a2-7537-ba96-b51d6eb4cc6c';
const OTHER = '44444444-5555-4666-8777-888888888888';
const hist = { state: null, replaceState: () => {} };

beforeEach(() => { takePendingOpen(); takePendingOpenElements(); takePendingOpenWriting(); clearOpenLanding(); });

describe('captureOpenWorld with a writing ending', () => {
  it('reads /writing/<narrative id>', () => {
    expect(captureOpenWorld({ hash: `#/open/${W}/writing/${N.toUpperCase()}` }, hist)).toBe(true);
    expect(takePendingOpen()).toBe(W);
    expect(takePendingOpenWriting()).toEqual({ narrativeId: N });
    expect(takePendingOpenWriting()).toBeNull();
    expect(takePendingOpenElements()).toEqual([]);
  });

  it('reads /writing with no narrative as the room\'s start', () => {
    captureOpenWorld({ hash: `#/open/${W}/writing` }, hist);
    expect(takePendingOpen()).toBe(W);
    expect(takePendingOpenWriting()).toEqual({ narrativeId: null });
  });

  it('refuses a narrative that is no id: the malformed link, no landing', () => {
    for (const bad of ['chapter-one', '%zz', `${N}x`]) {
      captureOpenWorld({ hash: `#/open/${W}/writing/${bad}` }, hist);
      expect(takePendingOpen()).toBe('');
      expect(takePendingOpenWriting()).toBeNull();
    }
  });

  it('a link with no writing ending carries none', () => {
    captureOpenWorld({ hash: `#/open/${W}/element/${N}` }, hist);
    expect(takePendingOpenWriting()).toBeNull();
    expect(takePendingOpenElements()).toEqual([N]);
  });
});

describe('the writing landing', () => {
  const now = 1_000_000;
  const els = [{ id: N }];
  const active = { worldId: 'copy-local' };

  it('is held with no narrative', () => {
    setOpenLanding(W, { kind: 'writing', narrativeId: null }, now);
    expect(peekOpenLanding()).not.toBeNull();
    const copy = { id: 'copy-local', copy_of: { world_id: W, at: '2026-11-06T10:00:00Z' } } as never;
    expect(landingStep(peekOpenLanding(), active, copy, false, els, now)).toEqual({ kind: 'writing', localWorldId: 'copy-local', narrativeId: null });
  });

  it('finds a view-only copy by the world it copies', () => {
    setOpenLanding(W, { kind: 'writing', narrativeId: N }, now);
    const copy = { id: 'copy-local', copy_of: { world_id: W } } as never;
    expect(landingStep(peekOpenLanding(), active, copy, false, els, now)).toEqual({ kind: 'writing', localWorldId: 'copy-local', narrativeId: N });
    setOpenLanding(W, [N], now);
    expect(landingStep(peekOpenLanding(), active, copy, false, els, now).kind).toBe('land');
    // A copy of another world is not the world the link names.
    const other = { id: 'copy-local', copy_of: { world_id: OTHER } } as never;
    expect(landingStep(peekOpenLanding(), active, other, false, els, now).kind).toBe('wait');
  });

  it('expires as an element landing does', () => {
    setOpenLanding(W, { kind: 'writing', narrativeId: N }, now);
    const copy = { id: 'copy-local', copy_of: { world_id: W } } as never;
    expect(landingStep(peekOpenLanding(), active, copy, false, els, now + OPEN_LANDING_TTL_MS + 1).kind).toBe('expired');
  });
});

describe('the sign-in round trip carries the landing', () => {
  it('parks the landing of the held id only, and reads it back by shape', () => {
    setOpenLanding(W, { kind: 'writing', narrativeId: N }, 1234);
    expect(parkedLandingFor(OTHER)).toBeNull();
    const parked = parkedLandingFor(W)!;
    expect(parked).toEqual({ kind: 'writing', narrativeId: N, at: 1234 });
    expect(readResume(JSON.stringify({ hash: '#/', open: W, landing: parked })).landing).toEqual(parked);
    expect(readResume(JSON.stringify({ hash: '#/', open: W, landing: { kind: 'writing', narrativeId: null, at: 5 } })).landing)
      .toEqual({ kind: 'writing', narrativeId: null, at: 5 });
    expect(readResume(JSON.stringify({ hash: '#/', open: W, landing: { kind: 'elements', ids: [N], at: 5 } })).landing)
      .toEqual({ kind: 'elements', ids: [N], at: 5 });
  });

  it('drops a landing that fails its shape, or rides without an open id', () => {
    const bad = [
      { kind: 'writing', narrativeId: 'nope', at: 5 },
      { kind: 'writing', narrativeId: N },
      { kind: 'elements', ids: [], at: 5 },
      { kind: 'elements', ids: ['x'], at: 5 },
      { kind: 'other', at: 5 },
    ];
    for (const landing of bad) expect(readResume(JSON.stringify({ hash: '#/', open: W, landing })).landing).toBeUndefined();
    expect(readResume(JSON.stringify({ hash: '#/', landing: { kind: 'writing', narrativeId: N, at: 5 } })).landing).toBeUndefined();
  });

  it('the return holds the landing again beside the open id, with its capture time', async () => {
    const before = getState().registry;
    patchSlice('registry', { ...before, account_token: undefined });
    const toasts = { show: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() };
    const landing = { kind: 'writing' as const, narrativeId: N, at: 4321 };
    await applySignInOutcome({ ok: false, cancelled: true, started: true, error: null, resume: { hash: '#/', open: W, landing } }, toasts as unknown as ToastManager);
    expect(openHeldForSignIn()).toBe(W);
    expect(peekOpenLanding()).toEqual({ serverWorldId: W, elementIds: [], writing: { kind: 'writing', narrativeId: N }, at: 4321 });
    dropHeldOpen();
    patchSlice('registry', before);
  });
});
