/**
 * ViewWorldModal — open an OnlyWorlds world VIEW-ONLY with a read key.
 *
 * The sister-and-her-DM flow: someone shares their world by minting a read
 * key on onlyworlds.com; the recipient pastes it here. No PIN exists or is
 * asked for anywhere. The world downloads into a normal folder, registers
 * api-linked with `api.read_only`, the engine attaches pull-only, and every
 * edit surface is blocked at the store seam ("This world is view-only").
 * Where it lands is the where-question (1.17, `where-choice.ts`).
 *
 * Sibling of LinkWorldModal — same download pipeline (`linkExistingApiWorldInRoot`
 * with `readOnly: true`), same activation-chain ride.
 */

import { progressLine } from './download-progress';
import { BaseModal } from './modal-base';
import { readyWhere, takeWhereInClick, whereChoiceHtml, wireWhereChoice } from './where-choice';
import { ToastManager } from './toast-manager';
import { navigate, homeHash } from '../core/router';
import { linkExistingApiWorldInRoot } from '../setup/atlas-root-flow';
import { enqueueActivationTask } from '../core/activation-chain';
import type { InitialDownloadProgress } from '../sync/initial-download';
import { problemFor } from '../core/problems';

export class ViewWorldModal extends BaseModal {
  private toasts: ToastManager;

  constructor(toasts: ToastManager) {
    super();
    this.toasts = toasts;
  }

  open(): void {
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const input = this.modal?.querySelector<HTMLInputElement>('input[name="api-key"]');
      input?.focus();
    });
  }

  private buildModal(): HTMLElement {
    const { overlay, body } = this.buildModalShell({
      title: 'View a world',
      dataModal: 'view-world',
    });

    body.innerHTML = `
      <form data-form="view-world">
        <label class="atlas-modal-field">
          <span>Read key</span>
          <input class="atlas-input" type="text" name="api-key" placeholder="A read key shared with you" autocomplete="off" spellcheck="false" />
        </label>
        <label class="atlas-modal-field">
          <span>Display name (optional)</span>
          <input class="atlas-input" type="text" name="display-name" placeholder="Defaults to the world's name" autocomplete="off" />
        </label>
        ${whereChoiceHtml({ online: true })}
        <p class="atlas-modal-hint">
          The world downloads and stays current as it changes. View only: you can read everything, edit nothing. No PIN needed.
        </p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-progress" data-role="progress" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="view">View</button>
        </div>
      </form>
    `;

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressBox = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="view"]')!;

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });
    wireWhereChoice(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      progressBox.hidden = true;

      // Taken synchronously, inside the click, before the first await.
      const where = takeWhereInClick(form);
      const ready = await readyWhere(where, this.toasts, 'Viewing a shared world downloads it into a new folder.');
      if (ready !== true) {
        errorBox.textContent = ready || '';
        errorBox.hidden = !ready;
        return;
      }

      const apiKey = (form.querySelector<HTMLInputElement>('input[name="api-key"]')!).value;
      const displayName = (form.querySelector<HTMLInputElement>('input[name="display-name"]')!).value;

      const inputs = form.querySelectorAll<HTMLInputElement>('input');
      inputs.forEach(i => (i.disabled = true));
      submitBtn.disabled = true;
      submitBtn.textContent = 'Downloading…';
      cancelBtn.hidden = true;
      // No outside-click or Escape close while the world downloads.
      this.dismissLocked = true;

      const renderProgress = (p: InitialDownloadProgress) => {
        if (p.phase === 'list') {
          progressBox.textContent = `Discovering ${p.currentType ?? ''}…`;
        } else {
          progressBox.textContent = p.total === 0 && p.phase !== 'open'
            ? 'World is empty; finishing up'
            : progressLine(p);
        }
        progressBox.hidden = false;
      };

      try {
        const result = await enqueueActivationTask(() =>
          linkExistingApiWorldInRoot({
            where,
            apiKey,
            apiPin: '',
            displayName,
            readOnly: true,
            onProgress: renderProgress,
          })
        );
        this.toasts.success(`Viewing ${result.entry.name} · ${result.downloaded} element${result.downloaded === 1 ? '' : 's'} downloaded`);
        this.hide();
        navigate(homeHash(result.entry.id));
      } catch (err) {
        // A refused key, an unknown world or no connection arrives worded
        // (keyCheckError); the rest is worded here.
        console.warn('[view-world] view failed:', err);
        const sentence = problemFor(err, { inline: true, doing: 'downloading the shared world', where }).sentence;
        errorBox.textContent = sentence;
        errorBox.hidden = !sentence;
        progressBox.hidden = true;
        inputs.forEach(i => (i.disabled = false));
        submitBtn.disabled = false;
        submitBtn.textContent = 'View';
        cancelBtn.hidden = false;
        this.dismissLocked = false;
      }
    });

    return overlay;
  }
}
