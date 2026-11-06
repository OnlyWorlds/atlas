/**
 * The public door's ask (1.123.1): a link that carries a world asks in the
 * middle of the page, on the house dialog (`BaseModal`), with the page behind
 * dimmed and inert. A corner toast over the welcome left a stranger reading
 * "Create a world" first and the ask small in a corner.
 *
 * One sentence (`publicAskLine` / `publicAskSignedInLine`, the dialog's
 * accessible name), and its actions: Open, Sign in when signed out, Not now.
 * Not now, Escape and a full outside click dismiss it: nothing made, nothing
 * held. Open runs inside its own click (the storage request needs the
 * gesture); focus goes to Open when the card shows and back when it closes.
 */
import { BaseModal } from './modal-base';

export interface PublicAskOpts {
  line: string;
  /** Run inside the click, after the card is down. */
  onOpen: () => void;
  /** Present only signed out: the door's own sign-in. */
  onSignIn?: () => void;
}

/** The card on screen, so a second ask replaces it rather than stacking. */
let shown: PublicAskModal | null = null;

let lineSeq = 0;

export class PublicAskModal extends BaseModal {
  constructor(private readonly opts: PublicAskOpts) {
    super();
  }

  open(): void {
    shown?.close();
    shown = this;
    const { overlay, panel, body } = this.buildModalShell({ panelClass: 'atlas-public-ask-panel', dataModal: 'public-ask' });
    const lineId = `atlas-public-ask-line-${++lineSeq}`;
    body.innerHTML = `
      <p class="atlas-public-ask-line" data-role="line" id="${lineId}"></p>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="not-now">Not now</button>
        ${this.opts.onSignIn ? '<button type="button" class="atlas-btn-ghost" data-action="sign-in">Sign in</button>' : ''}
        <button type="button" class="atlas-btn-primary" data-action="open">Open</button>
      </div>`;
    // The world's name is world data (conv. 93): text only.
    body.querySelector<HTMLElement>('[data-role="line"]')!.textContent = this.opts.line;
    panel.setAttribute('aria-labelledby', lineId);
    this.modal = overlay;
    this.show();
    const open = body.querySelector<HTMLButtonElement>('[data-action="open"]')!;
    body.querySelector<HTMLButtonElement>('[data-action="not-now"]')!.addEventListener('click', () => this.close());
    body.querySelector<HTMLButtonElement>('[data-action="sign-in"]')?.addEventListener('click', () => {
      this.close();
      this.opts.onSignIn?.();
    });
    open.addEventListener('click', () => {
      this.close();
      this.opts.onOpen();
    });
    open.focus();
  }

  close(): void {
    this.hide();
  }

  /** Every way down (a button, Escape, an outside click) passes here. */
  protected override hide(): void {
    if (shown === this) shown = null;
    super.hide();
  }
}
