/**
 * "Bring it down again" (1.17, contract §3.3): the Cleared row's door for a
 * linked world. Says what comes back and what does not (the account holds the
 * elements, not what Atlas keeps on its own), then runs the named restore
 * (`setup/bring-down-again.ts`) with progress, the dialog locked meanwhile.
 */
import { downloadingLine } from './download-progress';
import { BaseModal } from './modal-base';
import { askBrowserToKeepWorlds } from '../setup/world-parent';
import type { ToastManager } from './toast-manager';
import type { WorldRegistryEntry } from '../core/types';
import { problemFor } from '../core/problems';
import { bringDownAgain } from '../setup/bring-down-again';
import { homeHash, navigate } from '../core/router';

export class BringDownAgainModal extends BaseModal {
  constructor(private readonly world: WorldRegistryEntry, private readonly toasts: ToastManager) {
    super();
  }

  open(): void {
    const w = this.world;
    const { overlay, body } = this.buildModalShell({ title: `Download "${w.name}" again?`, dataModal: 'bring-down-again' });
    body.innerHTML = `
      <p class="atlas-modal-hint">This browser cleared the world from its storage. Atlas downloads it again from onlyworlds.com, into this browser, under the same row.</p>
      <p class="atlas-modal-hint">Your OnlyWorlds account holds the world's elements, not its pages, aliases, notes, writing formatting, saved charts or images kept in Atlas, so those do not come back. A world file of it would bring them too.</p>
      <div class="atlas-modal-progress" data-role="progress" hidden></div>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
        <button type="button" class="atlas-btn-primary" data-action="bring-down">Download it again</button>
      </div>`;
    this.modal = overlay;
    this.show();
    const cancel = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const go = body.querySelector<HTMLButtonElement>('[data-action="bring-down"]')!;
    const progress = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    go.focus();
    cancel.addEventListener('click', () => this.hide());
    go.addEventListener('click', async () => {
      // A cleared world is exactly the case for asking the browser to keep
      // worlds: inside the click, before the first await, never awaited
      // (contract §2.3, invariant 10).
      askBrowserToKeepWorlds(line => this.toasts.info(line, 10_000));
      go.disabled = true;
      cancel.disabled = true;
      this.dismissLocked = true;
      progress.hidden = false;
      progress.textContent = 'Asking OnlyWorlds for the world…';
      try {
        const out = await bringDownAgain(w.id, {
          onProgress: (p) => {
            progress.textContent = p.phase === 'list' ? 'Asking OnlyWorlds for the world…' : downloadingLine(p.done, p.total, 'browser');
          },
        });
        this.dismissLocked = false;
        this.hide();
        const missing = out.failures > 0 ? ` ${out.failures} element${out.failures === 1 ? '' : 's'} did not download. Refresh from OnlyWorlds brings ${out.failures === 1 ? 'it' : 'them'}.` : '';
        if (missing) this.toasts.error(`"${w.name}" is back in this browser.${missing}`);
        else this.toasts.success(`"${w.name}" is back in this browser.`);
        navigate(homeHash(w.id));
      } catch (err) {
        console.warn('[bring-down-again] failed:', err);
        this.dismissLocked = false;
        progress.textContent = problemFor(err, { doing: 'downloading the world', where: 'browser', inline: true }).sentence;
        cancel.disabled = false;
        cancel.textContent = 'Close';
        go.hidden = true;
        cancel.focus();
      }
    });
  }
}
