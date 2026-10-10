/**
 * PinPromptModal — one-field prompt for the OnlyWorlds PIN.
 *
 * Account-mode precondition surface (gate R1, 2026-07-13): flows that need
 * the PIN before touching the server (open an account world, create one)
 * call `promptForPin()` when the registry has none. The resolved PIN is
 * saved to the registry by the CALLER (keeps this modal a dumb input).
 *
 * Resolves the entered PIN, or null on cancel/escape/overlay-click.
 */

import { BaseModal } from './modal-base';
import { isSeatSecret } from '../core/seat';

export class PinPromptModal extends BaseModal {
  private resolve: ((pin: string | null) => void) | null = null;

  /** Opens the modal; resolves the PIN or null on cancel. */
  prompt(context: string): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      const { overlay, body } = this.buildModalShell({
        title: 'OnlyWorlds PIN',
        dataModal: 'pin-prompt',
      });
      body.innerHTML = `
        <form data-form="pin-prompt">
          <p class="atlas-modal-hint" data-role="context"></p>
          <label class="atlas-modal-field">
            <span>PIN</span>
            <input class="atlas-input" type="password" name="pin"
                   placeholder="Four digits"
                   autocomplete="off" maxlength="64" />
          </label>
          <div class="atlas-modal-error" data-role="error" hidden></div>
          <div class="atlas-modal-actions">
            <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
            <button type="submit" class="atlas-btn-primary" data-action="confirm">Continue</button>
          </div>
        </form>
      `;
      // TEXT, never markup (S361, gate F5): `context` carries a world name from
      // the account API, and this is the one modal that collects the PIN. A
      // name holding a <form action> would re-parent the PIN input off-origin;
      // the CSP has no form-action to stop it.
      body.querySelector<HTMLElement>('[data-role="context"]')!.textContent = context;
      const form = body.querySelector<HTMLFormElement>('form')!;
      const input = body.querySelector<HTMLInputElement>('input[name="pin"]')!;
      const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        const pin = input.value.trim();
        // The account PIN, four digits: it is saved for every account world.
        // A seat secret (ow_s_) opens one world and never becomes the account
        // PIN (conv. 132, R1; S386 gate).
        if (isSeatSecret(pin)) {
          errorEl.textContent = 'That is a seat secret, which opens one world. Here Atlas needs your account PIN: four digits.';
          errorEl.hidden = false;
          return;
        }
        if (!/^\d{4}$/.test(pin)) {
          errorEl.textContent = 'The PIN is four digits.';
          errorEl.hidden = false;
          return;
        }
        this.settle(pin);
      });
      body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => this.settle(null));
      this.modal = overlay;
      this.show();
      queueMicrotask(() => input.focus());
    });
  }

  private settle(pin: string | null): void {
    const r = this.resolve;
    this.resolve = null;
    this.hide();
    r?.(pin);
  }

  /** Overlay-click / Escape route through hide() — treat as cancel. */
  protected hide(): void {
    super.hide();
    if (this.resolve) {
      const r = this.resolve;
      this.resolve = null;
      r(null);
    }
  }
}
