/**
 * A save elsewhere on Settings' OnlyWorlds tab redraws the whole tab once focus has left the typing. The sign-in's
 * login, password and token are what a person typed and has not sent: the redraw keeps them (a person who typed
 * their login and password, then the World PIN, found both sign-in fields empty).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/ui/onlyworlds-sign-in-button', () => ({
  onlyWorldsSignInButtonHtml: () => '',
  wireOnlyWorldsSignIn: () => {},
}));

const { mountSettingsPanel } = await import('../../src/middle/settings-panel');
const { getState, patchSlice } = await import('../../src/core/state');
const { defaultRegistry } = await import('../../src/core/types');
const { setPin } = await import('../../src/registry/registry');

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
