/**
 * A save elsewhere on Settings' OnlyWorlds tab redraws the whole tab once focus has left the typing. The sign-in's
 * login, password and token are what a person typed and has not sent: the redraw keeps them (a person who typed
 * their login and password, then the World PIN, found both sign-in fields empty).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const signIn = vi.fn();
vi.mock('../../src/sync/password-sign-in', () => ({
  signInWithPassword: (...a: unknown[]) => signIn(...(a as [])),
  passwordSignInLine: () => 'Signing in did not work. Try again in a moment.',
}));
vi.mock('../../src/ui/onlyworlds-sign-in-button', () => ({
  onlyWorldsSignInButtonHtml: () => '',
  wireOnlyWorldsSignIn: () => {},
}));

const { mountSettingsPanel } = await import('../../src/middle/settings-panel');
const { getState, patchSlice } = await import('../../src/core/state');
const { defaultRegistry } = await import('../../src/core/types');
const { setEmail, setPin } = await import('../../src/registry/registry');

const toasts = { info: vi.fn(), show: vi.fn(), dismiss: vi.fn(), error: vi.fn(), success: vi.fn() };
const input = (root: HTMLElement, name: string) => root.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;

beforeEach(() => {
  patchSlice('registry', defaultRegistry());
  document.body.innerHTML = '';
  window.location.hash = '#/settings/onlyworlds';
});

describe('the sign-in fields through a redraw of the tab', () => {
  it('keep what was typed when the World PIN is saved after them', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountSettingsPanel({ target, toasts: toasts as never });
    const root = target.firstElementChild as HTMLElement;
    input(root, 'account-login').value = 'ada@example.com';
    input(root, 'account-password').value = 'pw';
    input(root, 'account-token').value = 'ow_a_PASTED';
    const before = input(root, 'account-login');
    // Focus on no text field (the PIN's Show button after a Tab): the redraw runs at once.
    (document.activeElement as HTMLElement | null)?.blur();
    patchSlice('registry', setPin(getState().registry, '1234'));
    const after = input(root, 'account-login');
    expect(after).not.toBe(before);
    expect([after.value, input(root, 'account-password').value, input(root, 'account-token').value])
      .toEqual(['ada@example.com', 'pw', 'ow_a_PASTED']);
    unmount();
  });

  it('keep a pasted token in its fold, open', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountSettingsPanel({ target, toasts: toasts as never });
    const root = target.firstElementChild as HTMLElement;
    root.querySelector<HTMLDetailsElement>('[data-role="account-token-alt"]')!.open = true;
    input(root, 'account-token').value = 'ow_a_PASTED';
    patchSlice('registry', setPin(getState().registry, '1234'));
    expect(input(root, 'account-token').value).toBe('ow_a_PASTED');
    expect(root.querySelector<HTMLDetailsElement>('[data-role="account-token-alt"]')!.open).toBe(true);
    unmount();
  });

  it('draw a sign-in under way busy through a redraw, so it cannot be pressed twice', async () => {
    let fail!: (e: unknown) => void;
    signIn.mockImplementationOnce(() => new Promise((_, no) => { fail = no; }));
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountSettingsPanel({ target, toasts: toasts as never });
    const root = target.firstElementChild as HTMLElement;
    input(root, 'account-login').value = 'ada@example.com';
    input(root, 'account-password').value = 'pw';
    root.querySelector<HTMLFormElement>('[data-role="account-password-form"]')!.dispatchEvent(new Event('submit', { cancelable: true }));
    patchSlice('registry', setEmail(getState().registry, 'a@example.com'));
    const btn = root.querySelector<HTMLButtonElement>('[data-action="account-sign-in-password"]')!;
    expect([btn.disabled, btn.textContent]).toEqual([true, 'Signing in…']);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    fail(new Error('refused'));
    await new Promise(r => setTimeout(r, 20));
    // The refusal is said on the line on screen now, not the one the tab was wired with.
    expect(root.querySelector<HTMLElement>('[data-role="account-token-error"]')!.hidden).toBe(false);
    patchSlice('registry', setEmail(getState().registry, 'b@example.com'));
    expect(root.querySelector<HTMLButtonElement>('[data-action="account-sign-in-password"]')!.disabled).toBe(false);
    unmount();
  });

  it('carry nothing over that was not typed', () => {
    const target = document.createElement('div');
    document.body.appendChild(target);
    const unmount = mountSettingsPanel({ target, toasts: toasts as never });
    const root = target.firstElementChild as HTMLElement;
    patchSlice('registry', setPin(getState().registry, '1234'));
    expect([input(root, 'account-login').value, input(root, 'account-password').value]).toEqual(['', '']);
    unmount();
  });
});
