/**
 * S454 (Seethe h20 #10346): a PIN row that takes a seat's secret says so in its
 * label, and a form that makes a world online says why it asks a PIN under the
 * field, before any sign-in (the reason used to show only after it).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { patchSlice } from '../../src/core/state';
import { defaultRegistry } from '../../src/core/types';
import { LinkWorldModal } from '../../src/ui/link-world-modal';
import { NewApiWorldModal } from '../../src/ui/new-api-world-modal';
import { signedInLineHtml } from '../../src/ui/sign-in-fields';
import type { ToastManager } from '../../src/ui/toast-manager';

const toasts = { show: vi.fn(), dismiss: vi.fn() } as unknown as ToastManager;
const REASON = "The PIN lets Atlas upload the world's contents.";

function pinLabel(modal: string, input: string): string {
  const field = document.querySelector(`[data-modal="${modal}"] input[name="${input}"]`)!.closest('label')!;
  return field.querySelector('span')!.textContent!;
}

beforeEach(() => {
  document.body.innerHTML = '';
  patchSlice('registry', { ...defaultRegistry() });
});

describe('the PIN rows', () => {
  it('Download names the seat secret in the label', () => {
    new LinkWorldModal(toasts).open();
    expect(pinLabel('link-world', 'api-pin')).toBe('PIN, or a seat secret');
  });

  it('New world says why it asks a PIN under the field, signed out', () => {
    new NewApiWorldModal(toasts).open();
    const field = document.querySelector('[data-modal="new-api-world"] input[name="api-pin"]')!.closest('label')!;
    expect(field.textContent).toContain(REASON);
    expect(document.querySelector('input[name="signin-login"]')).not.toBeNull();
  });

  it('New world says why signed in too', () => {
    patchSlice('registry', { ...defaultRegistry(), account_token: 'ow_a_' + 'e'.repeat(40), account_username: 'ana' });
    new NewApiWorldModal(toasts).open();
    const field = document.querySelector('[data-modal="new-api-world"] input[name="api-pin"]')!.closest('label')!;
    expect(field.textContent).toContain(REASON);
  });

  it('the signed-in line ends clean with nothing after it', () => {
    expect(signedInLineHtml('ana')).toContain('On your account, ana.</p>');
    expect(signedInLineHtml('ana', 'More.')).toContain('On your account, ana. More.</p>');
  });
});
