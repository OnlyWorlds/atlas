/**
 * Settings' own email and password door (conv. 179 gap): it mints a
 * token, then asks keel who it belongs to. When that second call fails the
 * token is not kept, so it is revoked at once by its id; when it succeeds the
 * id goes to keepSignIn beside the token. A pasted token that fails is never
 * revoked: Atlas did not make it. The sign-in-fields twin is
 * `sign-in-fields-revoke.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ID = '0f1e2d3c-4b5a-4968-8776-655443322110';
const revoke = vi.fn(async () => 'revoked');
const profile = vi.fn();
const keep = vi.fn(async () => {});
vi.mock('../../src/sync/token-revoke', () => ({ revokeAtlasToken: (...a: unknown[]) => revoke(...(a as [])) }));
vi.mock('../../src/sync/password-sign-in', () => ({
  signInWithPassword: vi.fn(async () => ({ token: 'ow_a_MINTED', tokenId: ID })),
  passwordSignInLine: () => 'Signing in did not work. Try again in a moment.',
}));
vi.mock('../../src/sync/account-client', () => ({
  AccountClient: class { getProfile = profile; },
  accountErrorMessage: () => 'refused',
}));
vi.mock('../../src/sync/after-sign-in', () => ({ keepSignIn: (...a: unknown[]) => keep(...(a as [])) }));
vi.mock('../../src/ui/onlyworlds-sign-in-button', () => ({
  onlyWorldsSignInButtonHtml: () => '',
  wireOnlyWorldsSignIn: () => {},
}));

const { renderAccountTab, wireAccountTab } = await import('../../src/middle/settings-account');
const { getState, patchSlice } = await import('../../src/core/state');
const { defaultRegistry } = await import('../../src/core/types');

const toasts = { info: vi.fn(), show: vi.fn(), dismiss: vi.fn() };

function mount(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'atlas-settings';
  root.innerHTML = renderAccountTab(getState().registry);
  document.body.appendChild(root);
  wireAccountTab(toasts as never);
  return root;
}

const settle = () => new Promise(r => setTimeout(r, 0));

function submitPassword(root: HTMLElement): void {
  root.querySelector<HTMLInputElement>('input[name="account-login"]')!.value = 'ada@example.com';
  root.querySelector<HTMLInputElement>('input[name="account-password"]')!.value = 'pw';
  root.querySelector<HTMLFormElement>('[data-role="account-password-form"]')!
    .dispatchEvent(new Event('submit', { cancelable: true }));
}

beforeEach(() => {
  revoke.mockClear();
  keep.mockClear();
  profile.mockReset();
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('Settings, the password door', () => {
  it('a minted token whose profile call fails is revoked by its id, not kept, and the error is said', async () => {
    profile.mockRejectedValue(new Error('429'));
    const root = mount();
    submitPassword(root);
    await settle();
    expect(revoke).toHaveBeenCalledWith('ow_a_MINTED', ID);
    expect(keep).not.toHaveBeenCalled();
    expect(getState().registry.account_token).toBeUndefined();
    expect(root.querySelector<HTMLElement>('[data-role="account-token-error"]')!.hidden).toBe(false);
    expect(root.querySelector<HTMLInputElement>('input[name="account-password"]')!.value).toBe('');
  });

  it('a minted token whose profile answers is kept with its id, and nothing is revoked', async () => {
    profile.mockResolvedValue({ username: 'ada' });
    const root = mount();
    submitPassword(root);
    await settle();
    expect(keep).toHaveBeenCalledWith('ow_a_MINTED', 'ada', toasts, ID);
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('Settings, the pasted token', () => {
  it('a pasted token that keel refuses is never revoked', async () => {
    profile.mockRejectedValue(new Error('401'));
    const root = mount();
    root.querySelector<HTMLInputElement>('input[name="account-token"]')!.value = 'ow_a_PASTED';
    root.querySelector<HTMLButtonElement>('[data-action="account-sign-in"]')!.click();
    await settle();
    expect(revoke).not.toHaveBeenCalled();
    expect(keep).not.toHaveBeenCalled();
    expect(root.querySelector<HTMLElement>('[data-role="account-token-error"]')!.hidden).toBe(false);
  });

  it('a pasted token that keel accepts is kept with no id', async () => {
    profile.mockResolvedValue({ username: 'ada' });
    const root = mount();
    root.querySelector<HTMLInputElement>('input[name="account-token"]')!.value = 'ow_a_PASTED';
    root.querySelector<HTMLButtonElement>('[data-action="account-sign-in"]')!.click();
    await settle();
    expect(keep).toHaveBeenCalledWith('ow_a_PASTED', 'ada', toasts, undefined);
    expect(revoke).not.toHaveBeenCalled();
  });
});
