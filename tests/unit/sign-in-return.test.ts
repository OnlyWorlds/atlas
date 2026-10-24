/**
 * The return from Sign in with OnlyWorlds (S465; the gate's G1, G3, G4):
 * the app's base stays absolute so `/signin/callback` loads its scripts; a
 * return this tab never started is left alone while signed in; a refusal
 * keeps an invitation waiting for the next sign-in.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { OwSignInError } from '@onlyworlds/sdk';
import { getState, patchSlice } from '../../src/core/state';
import { applySignInOutcome } from '../../src/setup/sign-in-return';
import { joinHeldForSignIn, takeJoinHeldForSignIn } from '../../src/setup/join-door';
import type { ToastManager } from '../../src/ui/toast-manager';

const JOIN = 'ow_j_abcdefghijklmnop0465';

function fakeToasts() {
  return { show: vi.fn(), info: vi.fn(), error: vi.fn(), success: vi.fn(), dismiss: vi.fn() };
}
const refused = (started: boolean, reason: ConstructorParameters<typeof OwSignInError>[0] = 'state_mismatch') =>
  ({ ok: false as const, cancelled: false, started, error: new OwSignInError(reason, 'x'), resume: { hash: '#/', join: JOIN } });

describe('the return (S465)', () => {
  const before = getState().registry;
  afterEach(() => { patchSlice('registry', before); takeJoinHeldForSignIn(); });

  it('the build loads its scripts by absolute paths (G1: a relative base breaks /signin/callback)', () => {
    expect(readFileSync('vite.config.ts', 'utf8')).toMatch(/^\s*base: '\/',$/m);
    // A public script Vite does not rewrite resolves from the page's own path too.
    expect(readFileSync('index.html', 'utf8')).not.toMatch(/(src|href)="\.\//);
  });

  it('signed in, a return this tab never started says nothing (G3)', async () => {
    patchSlice('registry', { ...before, account_token: 'ow_a_kept' });
    const t = fakeToasts();
    await applySignInOutcome(refused(false), t as unknown as ToastManager);
    expect(t.show).not.toHaveBeenCalled();
    expect(joinHeldForSignIn()).toBeNull();
  });

  it('one this tab started is said, and the invitation still waits (G4)', async () => {
    patchSlice('registry', { ...before, account_token: 'ow_a_kept' });
    const t = fakeToasts();
    await applySignInOutcome(refused(true), t as unknown as ToastManager);
    expect(t.show).toHaveBeenCalledTimes(1);
    expect(t.show.mock.calls[0][1]).toBe('error');
    expect(joinHeldForSignIn()).toBe(JOIN);
  });

  it('signed out, even a return this tab never started is said, with the way to Settings', async () => {
    patchSlice('registry', { ...before, account_token: undefined });
    const t = fakeToasts();
    await applySignInOutcome({ ...refused(false, 'invalid_grant'), resume: { hash: '#/' } }, t as unknown as ToastManager);
    expect(t.show).toHaveBeenCalledTimes(1);
    expect(t.show.mock.calls[0][3]?.actions?.[0]?.label).toBe('Open Settings');
  });
});
