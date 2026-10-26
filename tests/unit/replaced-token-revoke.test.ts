/**
 * A sign-in that replaces a token Atlas minted lets the old one go (2026-10-26;
 * conv. 179): revoked by the id recorded beside it, after the new token is
 * kept, through both writers (`keepSignIn`, the door of Sign in with
 * OnlyWorlds, the pasted token and Settings' password; `signInFromFields`, the
 * modals' password fields). Never a pasted token, never the token just kept,
 * never when there was none.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const OLD_ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const NEW_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';
const revoke = vi.fn(async () => 'revoked');
vi.mock('../../src/sync/token-revoke', async () => {
  const actual = await vi.importActual<typeof import('../../src/sync/token-revoke')>('../../src/sync/token-revoke');
  return {
    revokeAtlasToken: (...a: unknown[]) => revoke(...(a as [])),
    revokeReplacedToken: (b: never, a: never) => actual.revokeReplacedToken(b, a, revoke as never),
  };
});
vi.mock('../../src/ui/person-join-modal', () => ({ resumeJoinAfterSignIn: async () => true }));
vi.mock('../../src/setup/open-door', () => ({ dropHeldOpen: () => {}, resumeOpenAfterSignIn: async () => true }));
vi.mock('../../src/sync/password-sign-in', () => ({
  signInWithPassword: vi.fn(async () => ({ token: 'ow_a_NEWFIELDSTOKEN', tokenId: NEW_ID })),
  passwordSignInLine: () => 'Signing in did not work.',
}));
vi.mock('../../src/sync/account-client', () => ({
  AccountClient: class { getProfile = async () => ({ username: 'ada' }); },
}));

const { keepSignIn } = await import('../../src/sync/after-sign-in');
const { signInFromFields } = await import('../../src/ui/sign-in-fields');
const { getState, patchSlice } = await import('../../src/core/state');
const { defaultRegistry } = await import('../../src/core/types');
const { setAccountToken } = await import('../../src/registry/registry');
const { revokeReplacedToken } = await vi.importActual<typeof import('../../src/sync/token-revoke')>('../../src/sync/token-revoke');

const toasts = { dismiss: () => {}, success: () => {}, show: () => {} } as never;
const holding = (token: string, id?: string) => patchSlice('registry', setAccountToken(defaultRegistry(), token, 'ada', id));

beforeEach(() => {
  revoke.mockClear();
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
});

describe('revokeReplacedToken', () => {
  const reg = (token?: string, id?: string) => setAccountToken(defaultRegistry(), token, 'ada', id);
  it('a minted token replaced by another: the old one, by its id', () => {
    const r = vi.fn();
    revokeReplacedToken(reg('ow_a_OLDTOKEN', OLD_ID), reg('ow_a_NEWTOKEN', NEW_ID), r as never);
    expect(r).toHaveBeenCalledWith('ow_a_OLDTOKEN', OLD_ID);
  });
  it('a pasted token replaced, the same token kept again, no token before, a Forget: nothing', () => {
    const r = vi.fn();
    revokeReplacedToken(reg('ow_a_PASTED'), reg('ow_a_NEWTOKEN', NEW_ID), r as never);
    revokeReplacedToken(reg('ow_a_SAMETOKEN', OLD_ID), reg('ow_a_SAMETOKEN', OLD_ID), r as never);
    revokeReplacedToken(reg(), reg('ow_a_NEWTOKEN', NEW_ID), r as never);
    expect(r).not.toHaveBeenCalled();
  });
  it('an id recorded beside another token does not count (conv. 179)', () => {
    const r = vi.fn();
    const stale = { ...reg('ow_a_OLDTOKEN', OLD_ID), account_token: 'ow_a_OTHERTOKEN' };
    revokeReplacedToken(stale, reg('ow_a_NEWTOKEN', NEW_ID), r as never);
    expect(r).not.toHaveBeenCalled();
  });
});

describe('both writers revoke what they replace, after the new token is kept', () => {
  it('keepSignIn over a minted token', async () => {
    holding('ow_a_OLDTOKEN', OLD_ID);
    revoke.mockImplementationOnce(async () => {
      // The new token is already kept when the old one is sent away.
      expect(getState().registry.account_token).toBe('ow_a_NEWTOKEN');
      return 'revoked';
    });
    await keepSignIn('ow_a_NEWTOKEN', 'ada', toasts, NEW_ID);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('ow_a_OLDTOKEN', OLD_ID);
    expect(getState().registry.account_token_id).toBe(NEW_ID);
  });
  it('keepSignIn over a pasted token, or with a paste over a minted one kept again: no revoke of a token never minted', async () => {
    holding('ow_a_PASTEDTOKEN');
    await keepSignIn('ow_a_NEWTOKEN', 'ada', toasts, NEW_ID);
    expect(revoke).not.toHaveBeenCalled();
  });
  it('a paste over a minted token revokes the minted one', async () => {
    holding('ow_a_OLDTOKEN', OLD_ID);
    await keepSignIn('ow_a_PASTEDNEW', 'ada', toasts);
    expect(revoke).toHaveBeenCalledWith('ow_a_OLDTOKEN', OLD_ID);
  });
  it('signInFromFields over a minted token', async () => {
    holding('ow_a_OLDTOKEN', OLD_ID);
    const root = document.createElement('div');
    root.innerHTML = `<div data-role="sign-in-fields"><input name="signin-login" value="ada@example.com"><input name="signin-password" type="password" value="pw"></div>`;
    document.body.appendChild(root);
    await signInFromFields(root, 'to continue');
    expect(revoke).toHaveBeenCalledWith('ow_a_OLDTOKEN', OLD_ID);
    expect(getState().registry.account_token).toBe('ow_a_NEWFIELDSTOKEN');
  });
});

describe("a lost save revokes nothing (the gate's M1), and the order holds in both writers (S2)", () => {
  const refuseStorage = () => vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
  const fieldsRoot = () => {
    const root = document.createElement('div');
    root.innerHTML = `<div data-role="sign-in-fields"><input name="signin-login" value="ada@example.com"><input name="signin-password" type="password" value="pw"></div>`;
    document.body.appendChild(root);
    return root;
  };

  it('keepSignIn: storage refuses the new token, so the old one stays live', async () => {
    holding('ow_a_OLDTOKEN', OLD_ID);
    const spy = refuseStorage();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await keepSignIn('ow_a_NEWTOKEN', 'ada', toasts, NEW_ID);
    spy.mockRestore();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('signInFromFields: storage refuses the new token, so the old one stays live', async () => {
    holding('ow_a_OLDTOKEN', OLD_ID);
    const spy = refuseStorage();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await signInFromFields(fieldsRoot(), 'to continue');
    spy.mockRestore();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('signInFromFields: storage already holds the new token when the old one is sent away', async () => {
    holding('ow_a_OLDTOKEN', OLD_ID);
    let stored: string | undefined;
    revoke.mockImplementationOnce(async () => {
      stored = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{}').account_token;
      return 'revoked';
    });
    await signInFromFields(fieldsRoot(), 'to continue');
    expect(revoke).toHaveBeenCalledWith('ow_a_OLDTOKEN', OLD_ID);
    expect(stored).toBe('ow_a_NEWFIELDSTOKEN');
  });
});
