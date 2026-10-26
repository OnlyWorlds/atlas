/**
 * NewKeyModal: put a new key in place for a linked world (#198), from
 * Settings, This world. A modal, not an inline field: the settings panel
 * rebuilds on every state change and would take a half-pasted key with it.
 *
 * The key is read once against keel (`checkNewKey`: it must name this world),
 * then swapped under the world (`putKeyInPlace`): same folder, same edits
 * waiting, nothing unlinked.
 */

import { BaseModal } from './modal-base';
import { PinPromptModal } from './pin-prompt-modal';
import { showProblem } from './problem-fixes';
import type { ToastManager } from './toast-manager';
import { PlainError } from '../core/plain-error';
import { getState, patchSlice } from '../core/state';
import { worldPin } from '../core/seat';
import { saveRegistry, setPin } from '../registry/registry';
import type { WorldRegistryEntry } from '../core/types';
import { checkNewKey, putKeyInPlace } from '../sync/world-key';

export class NewKeyModal extends BaseModal {
  private busy = false;

  constructor(private readonly world: WorldRegistryEntry, private readonly toasts: ToastManager) {
    super();
  }

  open(): void {
    const { overlay, body } = this.buildModalShell({ title: 'Put in a new key', dataModal: 'new-world-key' });
    body.innerHTML = `
      <form data-form="new-world-key">
        <p class="atlas-modal-hint" data-role="context"></p>
        <label class="atlas-modal-field">
          <span>Key</span>
          <input class="atlas-input" type="password" name="world-key"
                 placeholder="ow_w_… or ow_r_…" autocomplete="off" spellcheck="false" maxlength="200" />
        </label>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="use-key">Use this key</button>
        </div>
      </form>
    `;
    // TEXT, never markup: the world's name is the user's (conv. 93).
    body.querySelector<HTMLElement>('[data-role="context"]')!.textContent =
      `A key from ${this.world.name}'s page on onlyworlds.com takes the place of the one this world has now. Everything here stays as it is, edits not yet sent included.`;
    const form = body.querySelector<HTMLFormElement>('form')!;
    const input = body.querySelector<HTMLInputElement>('input[name="world-key"]')!;
    const errorEl = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const useBtn = body.querySelector<HTMLButtonElement>('[data-action="use-key"]')!;
    const say = (line: string | null): void => {
      errorEl.textContent = line ?? '';
      errorEl.hidden = !line;
    };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (this.busy) return;
      void this.use(input.value, say, useBtn);
    });
    body.querySelector('[data-action="cancel"]')?.addEventListener('click', () => { if (!this.busy) this.hide(); });
    this.modal = overlay;
    this.show();
    queueMicrotask(() => input.focus());
  }

  private async use(raw: string, say: (line: string | null) => void, useBtn: HTMLButtonElement): Promise<void> {
    this.busy = true;
    this.dismissLocked = true;
    useBtn.disabled = true;
    useBtn.textContent = 'Checking…';
    say(null);
    try {
      const entry = getState().registry.worlds.find(w => w.id === this.world.id) ?? this.world;
      const { readOnly } = await checkNewKey(entry, raw);
      if (!readOnly && !worldPin(entry, getState().registry)) {
        const pin = await new PinPromptModal().prompt(
          `A write key saves your edits with your OnlyWorlds PIN. It is the one PIN of your account, set on onlyworlds.com in Account settings under World PIN.`
        );
        if (!pin) return;
        const next = setPin(getState().registry, pin);
        saveRegistry(next);
        patchSlice('registry', next);
      }
      // The key was read against this online world; it lands only if the
      // world is still linked to it (another tab could
      // relink it during the PIN question).
      const latest = getState().registry.worlds.find(w => w.id === this.world.id);
      if (!latest?.api || latest.api.world_id !== entry.api?.world_id) {
        throw new PlainError('This world was unlinked or linked to another online world meanwhile, so the key was not put in.');
      }
      await putKeyInPlace(latest, raw.trim(), readOnly);
      this.busy = false;
      this.dismissLocked = false;
      this.hide();
      this.toasts.success(readOnly
        ? `${this.world.name} has a new key. It can only read, so the world opens to read.`
        : `${this.world.name} has a new key. Sync is on again.`);
    } catch (err) {
      if (err instanceof PlainError) say(err.message);
      else showProblem(err, { doing: 'checking the new key', worldId: this.world.id, toasts: this.toasts });
    } finally {
      this.busy = false;
      this.dismissLocked = false;
      useBtn.disabled = false;
      useBtn.textContent = 'Use this key';
    }
  }
}
