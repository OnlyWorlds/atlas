/**
 * The World PIN, asked in the world (1.125.0, 2026-11-22, R3). An owner's world
 * opened from onlyworlds.com comes down with no PIN asked: keel reads its key
 * without one, and the site tells the person "When you first change the
 * world, it asks for your World PIN once". The pill's Add PIN, the first
 * change's toast and Refresh open this dialog, one at a time (a second press
 * brings the one already up).
 *
 * Continue keeps the dialog open and asks keel through `askAboutPin`
 * (`sync/pin-ask.ts`, Settings' own question: its 429 wait, its time limit,
 * one question per PIN). Only a PIN keel took is kept, with its proved state,
 * and the open world attaches; a refused one keeps nothing and sends no write;
 * a wait or no answer is said under the field, nothing kept. Cancel changes
 * nothing.
 */
import { BaseModal } from './modal-base';
import type { ToastManager } from './toast-manager';
import { getState, patchSlice } from '../core/state';
import { isSeatSecret, isSeatWorld, SEAT_SECRET_MISSING_LINE } from '../core/seat';
import { saveRegistry, setPin } from '../registry/registry';
import { notePinState } from '../registry/pin-proof';
import { askAboutPin } from '../sync/pin-ask';
import { attachOnPinAnswer } from '../sync/sync-attach';
import { pinAskWaitLine, rateWaitOf } from '../sync/rate-wait';
import { CANNOT_REACH_LINE } from '../setup/key-check-errors';

export const WORLD_PIN_TITLE = 'World PIN';
export const WORLD_PIN_REFUSED_LINE = 'OnlyWorlds did not accept this PIN. Check it and try again.';
export const WORLD_PIN_UNASKED_LINE = 'This world cannot be asked about a PIN just now. Open it again, then add your World PIN.';
const CONTINUE = 'Continue';
const ASKING = 'Checking with OnlyWorlds…';

/** The line under the title: what the PIN is, and what it does. */
export function worldPinLine(name: string): string {
  return `Your World PIN for "${name}": the four digits you chose on onlyworlds.com. Atlas saves your changes there with it.`;
}

/** The dialog on screen, so a second press brings it rather than stacking another. */
let shown: WorldPinModal | null = null;

/**
 * Open the question for the open world, or bring the one already up. `forWorld`: the press was made for that
 * world (the first change's line): nothing opens when another world is open now. A seat's world never asks
 * for the account PIN: its own secret is what it lacks, said in a seat's words.
 */
export function askWorldPin(toasts: ToastManager, forWorld?: string): void {
  if (shown?.overlay()?.isConnected) { shown.bring(); return; }
  const s = getState();
  const worldId = s.active?.worldId ?? null;
  const entry = worldId ? s.registry.worlds.find(w => w.id === worldId) : undefined;
  if (!worldId || !entry || (forWorld !== undefined && forWorld !== worldId)) return;
  if (isSeatWorld(entry)) { toasts.info(SEAT_SECRET_MISSING_LINE); return; }
  new WorldPinModal(worldId, entry.name, toasts).open();
}

class WorldPinModal extends BaseModal {
  private busy = false;
  private input: HTMLInputElement | null = null;

  constructor(private readonly worldId: string, private readonly name: string, private readonly toasts: ToastManager) {
    super();
  }

  open(): void {
    shown = this;
    const { overlay, body } = this.buildModalShell({ title: WORLD_PIN_TITLE, dataModal: 'world-pin' });
    body.innerHTML = `
      <form data-form="world-pin">
        <p class="atlas-modal-hint" data-role="line"></p>
        <label class="atlas-modal-field">
          <span>World PIN</span>
          <input class="atlas-input" type="password" name="pin" inputmode="numeric"
                 placeholder="Four digits" autocomplete="off" maxlength="64" />
        </label>
        <div class="atlas-modal-error" data-role="error" role="alert" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="confirm">${CONTINUE}</button>
        </div>
      </form>`;
    // The world's name is world data (conv. 93): text only, and this dialog collects the PIN.
    body.querySelector<HTMLElement>('[data-role="line"]')!.textContent = worldPinLine(this.name);
    const form = body.querySelector<HTMLFormElement>('form')!;
    const input = body.querySelector<HTMLInputElement>('input[name="pin"]')!;
    this.input = input;
    const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const go = body.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
    const say = (line: string): void => { errorEl.textContent = line; errorEl.hidden = !line; };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) return;
      const pin = input.value.trim();
      if (isSeatSecret(pin)) { say('That is a seat secret, which opens one world. Here Atlas needs your World PIN: four digits.'); return; }
      if (!/^\d{4}$/.test(pin)) { say('The World PIN is four digits.'); return; }
      say('');
      this.busy = true;
      this.dismissLocked = true;
      go.disabled = true;
      go.textContent = ASKING;
      input.disabled = true;
      void askAboutPin(pin).then((said) => {
        this.busy = false;
        this.dismissLocked = false;
        go.disabled = false;
        go.textContent = CONTINUE;
        input.disabled = false;
        if (!this.overlay()?.isConnected) return;
        if (said === 'proved') { this.keep(pin); return; }
        if (said === 'refused') {
          input.value = '';
          say(WORLD_PIN_REFUSED_LINE);
        } else if (said === 'waiting') {
          const key = getState().registry.worlds.find(w => w.id === this.worldId)?.api?.api_key;
          const wait = rateWaitOf(key);
          say(wait ? pinAskWaitLine(wait.pin, wait.until - Date.now()) : CANNOT_REACH_LINE);
        } else if (said === 'unasked') {
          say(WORLD_PIN_UNASKED_LINE);
        } else {
          say(CANNOT_REACH_LINE);
        }
        input.focus();
      });
    });
    body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => { if (!this.busy) this.hide(); });
    this.modal = overlay;
    this.show();
    queueMicrotask(() => input.focus());
  }

  /** Bring the dialog already up to the person's eye: its field takes focus. */
  bring(): void {
    this.input?.focus();
  }

  /** keel took it: kept as the account's PIN, proved, and the open world attaches on it. */
  private keep(pin: string): void {
    const now = getState().registry;
    const next = notePinState(setPin(now, pin), pin, 'proved');
    saveRegistry(next);
    patchSlice('registry', next);
    this.hide();
    attachOnPinAnswer(this.worldId, pin);
    this.toasts.success('World PIN saved. Your changes save to OnlyWorlds now.');
  }

  protected override hide(): void {
    if (shown === this) shown = null;
    super.hide();
  }
}
