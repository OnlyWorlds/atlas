/**
 * The sign-in card of the `#/open/<id>` door (1.125.0, 2026-11-22, R1): signed out,
 * a world the public cannot read. A card in the middle of the page on the
 * house dialog, as the public ask (`public-ask-modal.ts`), in place of the old
 * trip to Settings: one sentence that says what the link does, and the
 * sign-in.
 *
 * Buttons: Not now, Email and password, Sign in with OnlyWorlds (primary;
 * where it is not offered, Email and password is). Both sign-ins keep the
 * held id (the card goes down with its listeners first, so its own move of
 * the address drops nothing); every other way down drops it: Not now,
 * Escape, an outside click, a move of the address, the tour's start. A
 * second card replaces the first and keeps what the first held.
 *
 * Focus: the primary when no world is open; Not now when a world is open in
 * the tab, so a person typing never leaves for onlyworlds.com by their next
 * Enter.
 */
import { BaseModal } from './modal-base';
import { TOUR_STARTED_EVENT } from '../tour/tour-flag';

export interface OpenSignInCardOpts {
  line: string;
  /** A world is open in the tab: Not now takes focus. */
  focusNotNow: boolean;
  /** Present where Sign in with OnlyWorlds is offered: run inside its click, after the card is down. */
  onOnlyWorlds?: () => void;
  /** Email and password: run after the card is down and its listeners are gone. */
  onPassword: () => void;
  /** Every other way down: the held id goes. */
  onDrop: () => void;
}

/** The card on screen, so a second one replaces it rather than stacking. */
let shown: OpenSignInCard | null = null;
let lineSeq = 0;

/** The card on screen, if one is (tests, and the door's own re-show). */
export function openSignInCardShown(): boolean {
  return !!shown?.overlay()?.isConnected;
}

export class OpenSignInCard extends BaseModal {
  /** Set by a way down that keeps the held id (both sign-ins, a replacing card). */
  private keeps = false;

  constructor(private readonly opts: OpenSignInCardOpts) {
    super();
  }

  open(): void {
    if (shown) shown.replaced();
    shown = this;
    const { overlay, panel, body } = this.buildModalShell({ panelClass: 'atlas-public-ask-panel', dataModal: 'open-sign-in' });
    const lineId = `atlas-open-sign-in-line-${++lineSeq}`;
    const ow = !!this.opts.onOnlyWorlds;
    body.innerHTML = `
      <p class="atlas-public-ask-line" data-role="line" id="${lineId}"></p>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="not-now">Not now</button>
        <button type="button" class="${ow ? 'atlas-btn-ghost' : 'atlas-btn-primary'}" data-action="sign-in-password">Email and password</button>
        ${ow ? '<button type="button" class="atlas-btn-primary" data-action="sign-in-onlyworlds">Sign in with OnlyWorlds</button>' : ''}
      </div>`;
    // A world's name is world data (conv. 93): text only.
    body.querySelector<HTMLElement>('[data-role="line"]')!.textContent = this.opts.line;
    panel.setAttribute('aria-labelledby', lineId);
    this.modal = overlay;
    this.show();
    const notNow = body.querySelector<HTMLButtonElement>('[data-action="not-now"]')!;
    const password = body.querySelector<HTMLButtonElement>('[data-action="sign-in-password"]')!;
    const onlyWorlds = body.querySelector<HTMLButtonElement>('[data-action="sign-in-onlyworlds"]');
    notNow.addEventListener('click', () => this.hide());
    password.addEventListener('click', () => {
      this.keeps = true;
      this.hide();
      this.opts.onPassword();
    });
    onlyWorlds?.addEventListener('click', () => {
      this.keeps = true;
      this.hide();
      this.opts.onOnlyWorlds?.();
    });
    (this.opts.focusNotNow ? notNow : (onlyWorlds ?? password)).focus();
    window.addEventListener('hashchange', this.putDown);
    document.addEventListener(TOUR_STARTED_EVENT, this.putDown);
  }

  /** The page moved on, or the tour began: down, and the id goes. */
  private readonly putDown = (): void => { this.hide(); };

  /** Another card takes its place: down, keeping what it held. */
  private replaced(): void {
    this.keeps = true;
    this.hide();
  }

  /** Every way down passes here: the listeners go first, then the held id unless a sign-in or a new card keeps it. */
  protected override hide(): void {
    if (!this.modal) return;
    if (shown === this) shown = null;
    window.removeEventListener('hashchange', this.putDown);
    document.removeEventListener(TOUR_STARTED_EVENT, this.putDown);
    super.hide();
    if (!this.keeps) this.opts.onDrop();
  }
}
