/**
 * PersonJoinModal: the `#/join/` door for a person's code (keel #294's Atlas
 * half; keel #212). keel's /join page sends a person here with "Open in
 * Atlas"; the preview says `reader: 'person'`. A person joins with their own
 * account, never as a seat: signed in, Join accepts the link at
 * `POST /account/join` with the account token, then the world opens through
 * the sidebar's open flow (`openAccountWorld`, #199: a key made for the
 * member). Signed out, the code waits in memory through the sign-in in
 * Settings, which runs the door again (`resumeJoinAfterSignIn`).
 *
 * Nothing is spent until Join: the preview was the only call before it.
 */

import { BaseModal } from './modal-base';
import { WAITS_FOR_SIGN_IN, type ToastManager } from './toast-manager';
import { getState } from '../core/state';
import { navigate, settingsHash } from '../core/router';
import { problemFor } from '../core/problems';
import { AccountClient, accountErrorMessage, isAccountAuthError } from '../sync/account-client';
import { OwV2Error } from '../sync/ow-v2-client-adapter';
import { openAccountWorld, refreshAccountWorlds } from '../sync/account-worlds';
import {
  holdJoinForSignIn, isRefusedCode, JOIN_REFUSED_LINE, personRoleLine, type JoinPreview,
} from '../setup/join-door';
import type { AccountWorldRow } from '../core/types';

export class PersonJoinModal extends BaseModal {
  constructor(private toasts: ToastManager, private code: string, private preview: JoinPreview) {
    super();
  }

  open(): void {
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => this.modal?.querySelector<HTMLButtonElement>('[data-role="go"]')?.focus());
  }

  private buildModal(): HTMLElement {
    const p = this.preview;
    const signedIn = !!getState().registry.account_token;
    const { overlay, body } = this.buildModalShell({ title: 'Join a world on OnlyWorlds', dataModal: 'person-join' });
    body.innerHTML = `
      <form data-form="person-join">
        <p class="atlas-join-question">Join <strong data-role="world-name"></strong> on onlyworlds.com?</p>
        <p class="atlas-modal-hint" data-role="who" hidden></p>
        <p class="atlas-modal-hint" data-role="role"></p>
        <p class="atlas-modal-hint" data-role="account"></p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-role="go" data-action="${signedIn ? 'join' : 'sign-in'}">${signedIn ? 'Join' : 'Sign in'}</button>
        </div>
      </form>
    `;
    // World data and the inviter's words are untrusted (conv. 93): text only.
    body.querySelector<HTMLElement>('[data-role="world-name"]')!.textContent = p.world.name;
    const who = body.querySelector<HTMLElement>('[data-role="who"]')!;
    if (p.ownerCharacter) {
      who.textContent = `Owned by ${p.ownerCharacter}.`;
      who.hidden = false;
    } else if (p.invitedBy) {
      who.textContent = `The invitation says it is from "${p.invitedBy}".`;
      who.hidden = false;
    }
    body.querySelector<HTMLElement>('[data-role="role"]')!.textContent = personRoleLine(p.role);
    const username = getState().registry.account_username;
    body.querySelector<HTMLElement>('[data-role="account"]')!.textContent = signedIn
      ? `You join with your OnlyWorlds account${username ? ` (${username})` : ''}. Then Atlas downloads the world, with a key made for you.`
      : 'This invitation is for a person: you join with your own OnlyWorlds account. Sign in to Atlas with your OnlyWorlds account first; the invitation waits until you do.';

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const goBtn = body.querySelector<HTMLButtonElement>('[data-role="go"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });
    const say = (sentence: string) => { errorBox.textContent = sentence; errorBox.hidden = !sentence; };

    let submitting = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (submitting) return;
      submitting = true;
      try {
        if (!signedIn) {
          holdJoinForSignIn(this.code);
          this.hide();
          navigate(settingsHash(getState().active?.worldId ?? null, 'onlyworlds'));
          this.toasts.show('Sign in under Account with your email or username and password. The invitation opens again after that, in this tab; if you reload, open the link again.', 'info', 15_000, { dedupeKey: WAITS_FOR_SIGN_IN });
          return;
        }
        await this.join(say, goBtn, cancelBtn);
      } finally {
        submitting = false;
      }
    });

    return overlay;
  }

  private async join(say: (s: string) => void, goBtn: HTMLButtonElement, cancelBtn: HTMLButtonElement): Promise<void> {
    const token = getState().registry.account_token;
    if (!token) return;
    say('');
    // Nothing closes the dialog while the join is in flight: a Cancel then
    // would still join, and say its failure into a hidden dialog (S413 gate).
    goBtn.disabled = cancelBtn.disabled = true;
    this.dismissLocked = true;
    goBtn.textContent = 'Joining…';
    let joined: { world_id: string; world_name: string; role: string };
    try {
      joined = await new AccountClient(token).joinWithLink(this.code);
    } catch (err) {
      goBtn.disabled = cancelBtn.disabled = false;
      this.dismissLocked = false;
      goBtn.textContent = 'Join';
      if (err instanceof OwV2Error && err.code === 'already_member') {
        // The code is not spent; the world is already on the account's list.
        this.hide();
        refreshAccountWorlds(true);
        this.toasts.info(`You are already a member of ${this.preview.world.name}. Open it from your list of worlds.`, 12_000);
        return;
      }
      if (isRefusedCode(err)) {
        say(JOIN_REFUSED_LINE);
        goBtn.hidden = true;
        cancelBtn.textContent = 'Close';
        return;
      }
      say(isAccountAuthError(err) ? accountErrorMessage(err) : problemFor(err, { inline: true, doing: 'joining the world' }).sentence);
      return;
    }
    this.dismissLocked = false;
    this.hide();
    refreshAccountWorlds(true);
    const row: AccountWorldRow = {
      id: joined.world_id,
      name: joined.world_name || this.preview.world.name,
      role: 'collaborator',
      member_role: joined.role === 'co_builder' || joined.role === 'guest' ? joined.role : 'contributor',
      public_read: false,
      keys: [],
    };
    this.toasts.success(`You joined ${row.name}.`);
    await openUntilOpened(row, this.toasts);
  }
}

/**
 * The join is done; the open can still stop (the where-question or the PIN
 * cancelled, another open running, a download that failed and said so). The
 * person is then a member with no world here, so one toast keeps the way in
 * (the S413 gate: the first screen has no Worlds list to send them to).
 */
async function openUntilOpened(row: AccountWorldRow, toasts: ToastManager): Promise<void> {
  if (await openAccountWorld(row, toasts)) return;
  toasts.show(`You are a member of ${row.name} now. Open it here when you are ready.`, 'info', 0, {
    sticky: true,
    actions: [{ label: 'Open it', run: () => openUntilOpened(row, toasts) }],
  });
}

/**
 * The sign-in in Settings succeeded: a person's code that waited for it runs
 * the door again. True when a code was waiting (the door then speaks).
 */
export async function resumeJoinAfterSignIn(toasts: ToastManager): Promise<boolean> {
  const { takeJoinHeldForSignIn, previewJoin } = await import('../setup/join-door');
  const code = takeJoinHeldForSignIn();
  if (!code) return false;
  const { isTourFlagActive } = await import('../tour/tour-flag');
  if (isTourFlagActive()) {
    toasts.info('Finish the tour first, then open the link again.');
    return true;
  }
  let preview: JoinPreview;
  try {
    preview = await previewJoin(code);
  } catch (err) {
    if (isRefusedCode(err)) toasts.error(JOIN_REFUSED_LINE, 12_000);
    else toasts.error(problemFor(err, { inline: true, doing: 'reading the invitation' }).sentence);
    return true;
  }
  new PersonJoinModal(toasts, code, preview).open();
  return true;
}
