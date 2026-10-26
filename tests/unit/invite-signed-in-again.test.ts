/**
 * The invite dialog keeps the token it opened with. A sign-in since then replaced it, and the old
 * token is revoked (conv. 179, 2026-10-26): Make the link says so and sends nothing, never a refused
 * key or PIN (the gate's M2).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const makeInvite = vi.fn(async () => { throw new Error('should not be asked'); });
vi.mock('../../src/sync/invite-link', async () => {
  const actual = await vi.importActual<typeof import('../../src/sync/invite-link')>('../../src/sync/invite-link');
  return { ...actual, makeInvite: (...a: unknown[]) => makeInvite(...(a as [])) };
});

const { InviteModal } = await import('../../src/ui/invite-modal');
const { patchSlice, getState } = await import('../../src/core/state');
const { defaultRegistry } = await import('../../src/core/types');
const { setAccountToken } = await import('../../src/registry/registry');
const { SIGNED_IN_AGAIN_LINE } = await import('../../src/sync/token-revoke');

const toasts = { dismiss: () => {}, success: () => {}, show: () => {}, info: () => {}, error: () => {} } as never;

beforeEach(() => {
  makeInvite.mockClear();
  document.body.innerHTML = '';
  patchSlice('registry', setAccountToken(defaultRegistry(), 'ow_a_OPENEDWITH1', 'ada'));
});

describe('Invite someone after a sign-in elsewhere', () => {
  it('says the line and asks keel nothing when the token changed since the dialog opened', async () => {
    new InviteModal(toasts, 'ow_a_OPENEDWITH1', 'w-1', 'Ada world').open();
    const form = await vi.waitFor(() => {
      const f = document.querySelector<HTMLFormElement>('[data-action="make-invite"]')?.closest('form');
      if (!f) throw new Error('no form yet');
      return f;
    });
    patchSlice('registry', setAccountToken(getState().registry, 'ow_a_ANOTHERTAB2', 'ada'));
    form.requestSubmit();
    const error = document.querySelector<HTMLElement>('[data-role="error"]')!;
    await vi.waitFor(() => expect(error.hidden).toBe(false));
    expect(error.textContent).toContain(SIGNED_IN_AGAIN_LINE);
    expect(makeInvite).not.toHaveBeenCalled();
    expect(document.querySelector<HTMLButtonElement>('[data-action="make-invite"]')!.disabled).toBe(false);
  });

  it('the same token: the link is asked for as before', async () => {
    new InviteModal(toasts, 'ow_a_OPENEDWITH1', 'w-1', 'Ada world').open();
    const form = await vi.waitFor(() => {
      const f = document.querySelector<HTMLFormElement>('[data-action="make-invite"]')?.closest('form');
      if (!f) throw new Error('no form yet');
      return f;
    });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    form.requestSubmit();
    await vi.waitFor(() => expect(makeInvite).toHaveBeenCalledTimes(1));
  });
});
