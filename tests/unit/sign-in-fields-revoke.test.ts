/**
 * The email and password door mints a token, then asks
 * keel who it belongs to. When that second call fails the token is not kept,
 * so it is revoked at once by its id, never left live with no one holding it.
 * When it succeeds, the id is kept beside the token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const revoke = vi.fn(async () => 'revoked');
const profile = vi.fn();
vi.mock('../../src/sync/token-revoke', () => ({ revokeAtlasToken: (...a: unknown[]) => revoke(...(a as [])) }));
vi.mock('../../src/sync/password-sign-in', () => ({
  signInWithPassword: vi.fn(async () => ({ token: 'ow_a_MINTED', tokenId: ID })),
  passwordSignInLine: () => 'Signing in did not work. Try again in a moment.',
}));
vi.mock('../../src/sync/account-client', () => ({
  AccountClient: class { getProfile = profile; },
}));

const { signInFromFields } = await import('../../src/ui/sign-in-fields');
const { getState, patchSlice } = await import('../../src/core/state');
const { defaultRegistry } = await import('../../src/core/types');

function fields(): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = `<div data-role="sign-in-fields"><input name="signin-login" value="ada@example.com"><input name="signin-password" type="password" value="pw"></div>`;
  document.body.appendChild(root);
  return root;
}

beforeEach(() => {
  revoke.mockClear();
  profile.mockReset();
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
});

describe('signInFromFields', () => {
  it('a minted token whose profile call fails is revoked by its id and not kept', async () => {
    profile.mockRejectedValue(new Error('429'));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await expect(signInFromFields(fields(), 'to continue')).rejects.toThrow();
    expect(revoke).toHaveBeenCalledWith('ow_a_MINTED', ID);
    expect(getState().registry.account_token).toBeUndefined();
  });
  it('a kept token keeps its id, and nothing is revoked', async () => {
    profile.mockResolvedValue({ username: 'ada' });
    await signInFromFields(fields(), 'to continue');
    expect(getState().registry.account_token).toBe('ow_a_MINTED');
    expect(getState().registry.account_token_id).toBe(ID);
    expect(revoke).not.toHaveBeenCalled();
  });
});
