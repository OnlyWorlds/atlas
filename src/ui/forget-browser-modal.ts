/**
 * The confirm screen for Fully forget (Atlas #140; logic and order in
 * `setup/forget-browser.ts`). It names what goes for good (worlds that exist
 * only in this browser, by name), what goes here but stays online, and what
 * is never touched, and asks for the word "forget" before the button wakes.
 */

import { BaseModal } from './modal-base';
import { getState } from '../core/state';
import { enqueueActivationTask } from '../core/activation-chain';
import { awaitEviction, evictParkedStore } from '../core/active-store';
import { releasePriorWorld } from '../setup/atlas-root-flow';
import { detachSyncEngine } from '../sync/sync-attach';
import { isPlainError } from '../core/plain-error';
import { forgetEverything, forgetInventory, otherAtlasTabs } from '../setup/forget-browser';

const names = (list: string[]): string => list.length <= 1 ? (list[0] ?? '')
  : `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;

export class ForgetBrowserModal extends BaseModal {
  open(): void {
    const inv = forgetInventory(getState().registry);
    const { overlay, body } = this.buildModalShell({ title: 'Forget everything in this browser', dataModal: 'forget-browser' });
    body.innerHTML = `
      <form data-form="forget-browser">
        <p class="atlas-modal-hint">Atlas removes everything it keeps in this browser, and the page starts over as on a first visit.</p>
        <p class="atlas-modal-hint atlas-forget-lost" data-role="lost" hidden></p>
        <p class="atlas-modal-hint" data-role="online" hidden></p>
        <p class="atlas-modal-hint" data-role="also"></p>
        <p class="atlas-modal-hint" data-role="kept"></p>
        <label class="atlas-modal-field">
          <span>Type forget to confirm</span>
          <input class="atlas-input" name="confirm-word" autocomplete="off" spellcheck="false" />
        </label>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-danger" data-action="forget" disabled>Forget everything</button>
        </div>
      </form>
    `;
    // World names are user text (conv. 93): set as text, never markup.
    const lost = body.querySelector<HTMLElement>('[data-role="lost"]')!;
    if (inv.browserOnly.length) {
      lost.textContent = `Gone for good, because ${inv.browserOnly.length === 1 ? 'it exists' : 'they exist'} only in this browser: ${names(inv.browserOnly)}. Download ${inv.browserOnly.length === 1 ? 'it' : 'them'} first (Settings, This world) to keep a copy.`;
      lost.hidden = false;
    }
    const online = body.querySelector<HTMLElement>('[data-role="online"]')!;
    if (inv.browserOnline.length) {
      // Kept online is only what reached it: a paused, offline or held change
      // has not (S386 gate).
      online.textContent = `Removed here, and onlyworlds.com keeps what reached it: ${names(inv.browserOnline)}. Changes not yet synced there are lost.`;
      online.hidden = false;
    }
    body.querySelector<HTMLElement>('[data-role="also"]')!.textContent = inv.seatWorlds > 0
      ? `Also removed: your PIN and sign-in, the secret of each world opened on a seat (${inv.seatWorlds === 1 ? 'it stops' : 'they stop'} syncing), the folders Atlas remembers, and every setting.`
      : 'Also removed: your PIN and sign-in, the folders Atlas remembers, and every setting.';
    body.querySelector<HTMLElement>('[data-role="kept"]')!.textContent = inv.folderWorlds > 0
      ? `Never touched: your ${inv.folderWorlds === 1 ? 'world' : `${inv.folderWorlds} worlds`} in folders on your drive, and your worlds on onlyworlds.com. Open a folder again afterwards to bring ${inv.folderWorlds === 1 ? 'it' : 'them'} back.`
      : 'Never touched: folders on your drive and your worlds on onlyworlds.com.';

    const form = body.querySelector<HTMLFormElement>('form')!;
    const word = body.querySelector<HTMLInputElement>('input[name="confirm-word"]')!;
    const go = body.querySelector<HTMLButtonElement>('[data-action="forget"]')!;
    const cancel = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const say = (s: string) => { errorBox.textContent = s; errorBox.hidden = !s; };
    word.addEventListener('input', () => { go.disabled = word.value.trim().toLowerCase() !== 'forget'; });
    cancel.addEventListener('click', () => this.hide());

    let running = false;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (running || word.value.trim().toLowerCase() !== 'forget') return;
      running = true;
      say('');
      go.disabled = cancel.disabled = word.disabled = true;
      this.dismissLocked = true;
      const unlock = () => { running = false; go.disabled = false; cancel.disabled = word.disabled = false; this.dismissLocked = false; };
      go.textContent = 'Forgetting…';
      let left = false;
      try {
        // On the activation chain, roll call included: a tab opened while a
        // long download held the chain is still asked (S386 gate).
        const others = await enqueueActivationTask(async () => {
          const n = await otherAtlasTabs();
          if (n > 0) return n;
          detachSyncEngine();
          await releasePriorWorld();
          left = true;
          // Parked worlds close first, so no store of this tab still holds a
          // file in what is about to go (the delete path's quiet-down).
          for (const w of getState().registry.worlds) evictParkedStore(w.id);
          for (const w of getState().registry.worlds) await awaitEviction(w.id);
          await forgetEverything();
          return 0;
        });
        if (others > 0) {
          say(`Close Atlas's other ${others === 1 ? 'tab' : `${others} tabs`} first, then forget. ${others === 1 ? 'It' : 'They'} would put the list of worlds back.`);
          go.textContent = 'Forget everything';
          unlock();
        }
      } catch (err) {
        console.warn('[forget] failed:', err);
        say(isPlainError(err) ? err.message : 'Atlas could not finish forgetting. Reload the page and try again.');
        if (left) {
          // The open world was already closed: this page has no store behind
          // it now, so the one way on is a reload (S386 gate).
          go.hidden = true;
          cancel.disabled = false;
          cancel.textContent = 'Reload';
          cancel.onclick = () => location.reload();
        } else {
          go.textContent = 'Forget everything';
          unlock();
        }
      }
    });

    this.modal = overlay;
    this.show();
    queueMicrotask(() => word.focus());
  }
}
