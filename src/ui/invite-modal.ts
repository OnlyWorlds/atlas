/**
 * InviteModal: Invite someone, made in Atlas (#341). Settings, This world,
 * for a world the signed-in account owns online: who the link is for (a
 * contributor or a player), the name it is signed with, then the link once,
 * with Send it (where the system share sheet exists), Copy and a QR code.
 * The same choices and words as Lantern's sheet
 * (`tools/lantern/src/views/invite.ts`); the link is made by
 * `makeInvite` (`src/sync/invite-link.ts`) and never kept.
 */

import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import { owAccessUrl } from '../core/ow-site';
import { escapeAttr } from '../core/dom-utils';
import { loadUiPrefs, setInviterNamePref } from '../core/ui-prefs';
import { problemFor } from '../core/problems';
import { INVITE_DAYS, makeInvite, type InviteRole, type MadeInvite } from '../sync/invite-link';
import { qrCodeSvg } from './qr-code';

const ROLE_WORDS: Record<InviteRole, { title: string; line: string; as: string }> = {
  contributor: { title: 'A contributor', line: 'Sees the whole world and adds to it.', as: 'a contributor' },
  guest: { title: 'A player', line: 'Sees only what their Character knows.', as: 'a player' },
};

export class InviteModal extends BaseModal {
  private role: InviteRole = 'contributor';

  constructor(
    private toasts: ToastManager,
    private token: string,
    private worldId: string,
    private worldName: string,
  ) {
    super();
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({ title: 'Invite someone', dataModal: 'invite', panelClass: 'atlas-invite-panel' });
    this.modal = overlay;
    this.renderChoose(body);
    this.show();
    queueMicrotask(() => this.modal?.querySelector<HTMLButtonElement>('[data-role="contributor"]')?.focus());
  }

  private renderChoose(body: HTMLElement): void {
    const choice = (r: InviteRole): string =>
      `<button type="button" class="atlas-invite-choice" data-role="${r}" aria-pressed="${r === this.role}">
         <strong>${ROLE_WORDS[r].title}</strong><span>${ROLE_WORDS[r].line}</span>
       </button>`;
    body.innerHTML = `
      <form data-form="invite">
        <p class="atlas-modal-hint">Who is it for?</p>
        <div class="atlas-invite-choices" role="group" aria-label="Who the link is for">${choice('contributor')}${choice('guest')}</div>
        <label class="atlas-modal-field">
          <span>Your name, as they will see it</span>
          <input class="atlas-input" type="text" name="inviter-name" maxlength="80" autocomplete="name" />
        </label>
        <p class="atlas-modal-hint">It works once, for ${INVITE_DAYS} days. They need a free account.</p>
        <div class="atlas-modal-error" data-role="error" role="alert" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="make-invite">Make the link</button>
        </div>
      </form>`;
    const nameInput = body.querySelector<HTMLInputElement>('input[name="inviter-name"]')!;
    nameInput.value = loadUiPrefs().inviterName ?? '';
    for (const btn of body.querySelectorAll<HTMLButtonElement>('.atlas-invite-choice')) {
      btn.addEventListener('click', () => {
        this.role = btn.dataset.role as InviteRole;
        for (const o of body.querySelectorAll<HTMLButtonElement>('.atlas-invite-choice')) {
          o.setAttribute('aria-pressed', String(o.dataset.role === this.role));
        }
      });
    }
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const makeBtn = body.querySelector<HTMLButtonElement>('[data-action="make-invite"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancelBtn.addEventListener('click', () => this.hide());
    const choiceBtns = [...body.querySelectorAll<HTMLButtonElement>('.atlas-invite-choice')];
    // Everything the request is made from is locked while keel makes it: a
    // choice tapped during the wait named a role the link did not have (S414
    // gate H1). The role sent is the role said.
    const lock = (on: boolean): void => {
      for (const el of [makeBtn, cancelBtn, nameInput, ...choiceBtns]) el.disabled = on;
    };
    let making = false;
    body.querySelector<HTMLFormElement>('form')!.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (making) return;
      making = true;
      errorBox.hidden = true;
      lock(true);
      makeBtn.textContent = 'Making…';
      // Nothing closes the dialog while keel makes the link: a link made into
      // a closed dialog would be one nobody ever sees.
      this.dismissLocked = true;
      const role = this.role;
      const name = nameInput.value.trim();
      setInviterNamePref(name);
      try {
        const made = await makeInvite(this.token, this.worldId, role, name);
        this.dismissLocked = false;
        this.renderMade(body, made, role);
      } catch (err) {
        this.dismissLocked = false;
        errorBox.textContent = problemFor(err, { inline: true, doing: 'making the invite link' }).sentence;
        errorBox.hidden = false;
        lock(false);
        makeBtn.textContent = 'Make the link';
        makeBtn.focus();
        making = false;
      }
    });
  }

  private renderMade(body: HTMLElement, made: MadeInvite, role: InviteRole): void {
    const canShare = typeof navigator.share === 'function';
    body.innerHTML = `
      <div data-role="invite-made">
        <p class="atlas-invite-lead" data-role="invite-lead"></p>
        <p class="atlas-invite-link" data-role="invite-link"></p>
        <div class="atlas-invite-send">
          ${canShare ? '<button type="button" class="atlas-btn-primary" data-action="share-invite">Send it</button>' : ''}
          <button type="button" class="${canShare ? 'atlas-btn-ghost' : 'atlas-btn-primary'}" data-action="copy-invite">Copy</button>
        </div>
        <div class="atlas-invite-qr" data-role="invite-qr"></div>
        <p class="atlas-modal-hint">Shown only now: Atlas does not keep it. You can make another at any time.</p>
        <p class="atlas-modal-hint"><a class="atlas-settings-link atlas-link-inline" data-link="invite-access" href="${escapeAttr(owAccessUrl(this.worldId))}" target="_blank" rel="noopener">See or take back links on onlyworlds.com</a></p>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="done">Done</button>
        </div>
      </div>`;
    // World names are untrusted (conv. 93): text only.
    body.querySelector<HTMLElement>('[data-role="invite-lead"]')!.textContent =
      `Your invite to ${this.worldName}, as ${ROLE_WORDS[role].as}:`;
    body.querySelector<HTMLElement>('[data-role="invite-link"]')!.textContent = made.link;
    body.querySelector<HTMLButtonElement>('[data-action="done"]')!.addEventListener('click', () => this.hide());
    body.querySelector<HTMLButtonElement>('[data-action="share-invite"]')?.addEventListener('click', () => {
      navigator.share({ title: `An invite to ${this.worldName}`, text: made.line }).catch(() => undefined);
    });
    body.querySelector<HTMLButtonElement>('[data-action="copy-invite"]')!.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(made.line);
        this.toasts.success('Copied the invite.');
      } catch {
        this.toasts.info('Could not copy here. Select the link and copy it.');
      }
    });
    const qr = body.querySelector<HTMLElement>('[data-role="invite-qr"]')!;
    qrCodeSvg(made.link).then((svg) => qr.appendChild(svg)).catch(() => qr.remove());
    queueMicrotask(() => body.querySelector<HTMLButtonElement>('[data-action="share-invite"], [data-action="copy-invite"]')?.focus());
  }
}
