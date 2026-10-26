/**
 * InviteModal: Invite someone, made in Atlas (#341). Settings, This world,
 * for a world the signed-in account owns online: who the link is for (a
 * contributor, a player with no account, or a player with an account), the
 * Character a player reads as, the name it is signed with, then the link
 * once, with Send it (where the system share sheet exists), Copy and a QR
 * code. "A player" is keel's no-account player link (#416, the Captain's yes
 * on the sharing floor, h50 #7610); the account guest is one choice down.
 * The same choices and words as Lantern's sheet
 * (`tools/lantern/src/views/invite.ts`); the link is made by
 * `makeInvite` (`src/sync/invite-link.ts`) and never kept.
 */

import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import { owAccessUrl } from '../core/ow-site';
import { escapeAttr, escapeText } from '../core/dom-utils';
import { typeNameStart } from '../core/type-words';
import { getState } from '../core/state';
import { loadUiPrefs, setInviterNamePref } from '../core/ui-prefs';
import { problemFor } from '../core/problems';
import { INVITE_DAYS, makeInvite, NEW_CHARACTER, type InviteFor, type MadeInvite } from '../sync/invite-link';
import { qrCodeSvg } from './qr-code';
import { SIGNED_IN_AGAIN_LINE } from '../sync/token-revoke';

const FOR_WORDS: Record<InviteFor, { title: string; line: string; as: string; needs: string }> = {
  contributor: { title: 'A contributor', line: 'Sees the whole world and adds to it.', as: 'a contributor', needs: 'They need a free account.' },
  player: { title: 'A player', line: 'Sees only what their Character knows. No account needed.', as: 'a player', needs: 'No account needed: they open it in Lantern.' },
  guest: { title: 'A player with an account', line: 'The same, signed in to an account of their own.', as: 'a player with an account', needs: 'They need a free account.' },
};

/** A role's line, the player's Character in the world's own word ("their Employee"; names.md). */
function forLine(r: InviteFor): string {
  return FOR_WORDS[r].line.replace('their Character', `their ${typeNameStart('character')}`);
}

/**
 * The world's Characters a player link can name: keel holds only what has
 * synced (`server_updated_at`), so a Character made here and not yet up is
 * left out rather than refused. Only for the open world's own elements.
 */
export function playableCharacters(worldId: string): Array<{ id: string; name: string }> {
  const s = getState();
  const open = s.registry.worlds.find(w => w.id === s.active?.worldId);
  if (open?.api?.world_id !== worldId) return [];
  return s.data.elements
    .filter(el => el.type === 'character' && !!el.server_updated_at)
    .map(el => ({ id: el.id, name: typeof el.name === 'string' && el.name.trim() ? el.name.trim() : '(unnamed)' }))
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));
}

export class InviteModal extends BaseModal {
  private inviteFor: InviteFor = 'contributor';

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
    const choice = (r: InviteFor): string =>
      `<button type="button" class="atlas-invite-choice" data-role="${r}" aria-pressed="${r === this.inviteFor}">
         <strong>${FOR_WORDS[r].title}</strong><span>${escapeText(forLine(r))}</span>
       </button>`;
    body.innerHTML = `
      <form data-form="invite">
        <p class="atlas-modal-hint">Who is it for?</p>
        <div class="atlas-invite-choices" role="group" aria-label="Who the link is for">${choice('contributor')}${choice('player')}${choice('guest')}</div>
        <label class="atlas-modal-field" data-role="plays-as" hidden>
          <span>They play as</span>
          <select class="atlas-input" name="plays-as"></select>
        </label>
        <label class="atlas-modal-field">
          <span>Your name, as they will see it</span>
          <input class="atlas-input" type="text" name="inviter-name" maxlength="80" autocomplete="name" />
        </label>
        <p class="atlas-modal-hint" data-role="invite-needs"></p>
        <div class="atlas-modal-error" data-role="error" role="alert" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="make-invite">Make the link</button>
        </div>
      </form>`;
    const nameInput = body.querySelector<HTMLInputElement>('input[name="inviter-name"]')!;
    nameInput.value = loadUiPrefs().inviterName ?? '';
    // Who a player reads as: a new Character they name, or one of the world's.
    // Names are world data (conv. 93): options are built as text.
    const playsAs = body.querySelector<HTMLElement>('[data-role="plays-as"]')!;
    const playsAsSelect = body.querySelector<HTMLSelectElement>('select[name="plays-as"]')!;
    playsAsSelect.append(new Option(`A new ${typeNameStart('character')} for them`, NEW_CHARACTER));
    for (const c of playableCharacters(this.worldId)) playsAsSelect.append(new Option(c.name, c.id));
    const needs = body.querySelector<HTMLElement>('[data-role="invite-needs"]')!;
    const showChoice = (): void => {
      for (const o of body.querySelectorAll<HTMLButtonElement>('.atlas-invite-choice')) {
        o.setAttribute('aria-pressed', String(o.dataset.role === this.inviteFor));
      }
      playsAs.hidden = this.inviteFor !== 'player';
      needs.textContent = `It works once, for ${INVITE_DAYS} days. ${FOR_WORDS[this.inviteFor].needs}`;
    };
    showChoice();
    for (const btn of body.querySelectorAll<HTMLButtonElement>('.atlas-invite-choice')) {
      btn.addEventListener('click', () => {
        this.inviteFor = btn.dataset.role as InviteFor;
        showChoice();
      });
    }
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const makeBtn = body.querySelector<HTMLButtonElement>('[data-action="make-invite"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    cancelBtn.addEventListener('click', () => this.hide());
    const choiceBtns = [...body.querySelectorAll<HTMLButtonElement>('.atlas-invite-choice')];
    // Everything the request is made from is locked while keel makes it: a
    // choice tapped during the wait named a role the link did not have (S414
    // gate H1). The role sent is the role said, and the Character too.
    const lock = (on: boolean): void => {
      for (const el of [makeBtn, cancelBtn, nameInput, playsAsSelect, ...choiceBtns]) el.disabled = on;
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
      const inviteFor = this.inviteFor;
      const name = nameInput.value.trim();
      const character = playsAsSelect.value || NEW_CHARACTER;
      const characterName = character === NEW_CHARACTER ? null : playsAsSelect.selectedOptions[0]?.textContent ?? null;
      setInviterNamePref(name);
      // A sign-in since the dialog opened replaced its token, and the old one is revoked (conv. 179):
      // said as that, never as a refused key or PIN (2026-10-26's gate, M2).
      if (getState().registry.account_token !== this.token) {
        this.dismissLocked = false;
        errorBox.textContent = `${SIGNED_IN_AGAIN_LINE} Close this and choose Invite someone again.`;
        errorBox.hidden = false;
        lock(false);
        makeBtn.textContent = 'Make the link';
        making = false;
        return;
      }
      try {
        const made = await makeInvite(this.token, this.worldId, inviteFor, name, character);
        this.dismissLocked = false;
        this.renderMade(body, made, inviteFor, inviteFor === 'player' ? characterName : null);
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

  private renderMade(body: HTMLElement, made: MadeInvite, inviteFor: InviteFor, character: string | null): void {
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
    body.querySelector<HTMLElement>('[data-role="invite-lead"]')!.textContent = character
      ? `Your invite to ${this.worldName}, as a player reading as ${character}:`
      : `Your invite to ${this.worldName}, as ${FOR_WORDS[inviteFor].as}:`;
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
