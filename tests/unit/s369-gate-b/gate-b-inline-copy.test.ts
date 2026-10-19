/**
 * Gate lens B probes B-6, B-7 (S369). Assert the FIXED behaviour.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { WritingCreateModal } from '../../../src/ui/writing-create-modal';
import { isPlainError } from '../../../src/core/plain-error';
import { patchSlice } from '../../../src/core/state';
import { defaultRegistry } from '../../../src/core/types';
import { AccountClient } from '../../../src/sync/account-client';
import { createApiWorld } from '../../../src/sync/make-online';

const flush = () => new Promise(r => setTimeout(r, 0));
beforeEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('B-6 an inline error line never promises a details block it does not have', () => {
  it('an unexpected failure in a modal does not tell the user to send details that are not there', async () => {
    new WritingCreateModal({ label: 'Book', onCreate: () => Promise.reject(new TypeError('x is undefined')) }).open();
    document.querySelector<HTMLButtonElement>('[data-modal="writing-create"] [data-action="create"]')!.click();
    await flush();
    const modal = document.querySelector<HTMLElement>('[data-modal="writing-create"]')!;
    const line = modal.querySelector<HTMLElement>('[data-role="error"]')!;
    const offersDetails = !!modal.querySelector('details, [data-action="copy-details"], a[href*="feedback"]');
    if (/send the details/i.test(line.textContent ?? '')) expect(offersDetails).toBe(true);
  });
});

describe('B-7 an account error Atlas did not expect is not passed off as a refusal', () => {
  it('createApiWorld rethrows a malformed account response as itself, not as a PlainError', async () => {
    patchSlice('registry', { ...defaultRegistry(), account_token: 'tok' } as never);
    vi.spyOn(AccountClient.prototype, 'createWorld').mockRejectedValue(new Error('create-world response missing id or key'));
    let caught: unknown = null;
    try { await createApiWorld({ name: 'W', pin: '1234' }); } catch (e) { caught = e; }
    expect(caught).not.toBeNull();
    expect(isPlainError(caught)).toBe(false);
  });
});
