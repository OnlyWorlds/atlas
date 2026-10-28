/**
 * LinkWorldModal — link an existing OnlyWorlds API world to atlas.
 *
 * Flow:
 *   1. User enters api_key + pin (pre-filled from registry.pin) + optional display name.
 *   2. Submit triggers `linkExistingApiWorldInRoot` — validates creds,
 *      creates a subfolder under the atlas root, downloads all elements,
 *      registers as api-linked, attaches SyncEngine.
 *   3. During download, the form is replaced with a progress indicator
 *      ("downloading 47 of 412 elements…").
 *   4. On success: toast + close + navigate to the world's elements view.
 *   5. On error: form re-enabled with the error message inline.
 *
 * Where it lands (1.17, conv. 129): the dialog asks the where-question
 * (`where-choice.ts`); a folder answer with no home folder asks for one
 * inside the click.
 */

import { progressLine } from './download-progress';
import { BaseModal } from './modal-base';
import { readyWhere, takeWhereInClick, whereChoiceHtml, wireWhereChoice } from './where-choice';
import { ToastManager } from './toast-manager';
import { getState } from '../core/state';
import { navigate, homeHash } from '../core/router';
import { linkExistingApiWorldInRoot } from '../setup/atlas-root-flow';
import { enqueueActivationTask } from '../core/activation-chain';
import { DownloadCancelledError, type InitialDownloadProgress, type DownloadStop } from '../sync/initial-download';
import { escapeAttr } from '../core/dom-utils';
import { problemFor } from '../core/problems';

export class LinkWorldModal extends BaseModal {
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
      title: 'Download a world from OnlyWorlds',
      dataModal: 'link-world',
    });

    const prefilledPin = getState().registry.pin ?? '';
    body.innerHTML = `
      <form data-form="link-world">
        <label class="atlas-modal-field">
          <span>API key</span>
          <input class="atlas-input" type="text" name="api-key" placeholder="From onlyworlds.com" autocomplete="off" spellcheck="false" />
        </label>
        <label class="atlas-modal-field">
          <span>PIN, or a seat secret</span>
          <input class="atlas-input" type="password" name="api-pin" value="${escapeAttr(prefilledPin)}" placeholder="Four digits, or ow_s_…" autocomplete="off" maxlength="64" />
        </label>
        <label class="atlas-modal-field">
          <span>Display name (optional)</span>
          <input class="atlas-input" type="text" name="display-name" placeholder="Defaults to the name on onlyworlds.com" autocomplete="off" />
        </label>
        ${whereChoiceHtml({ online: true })}
        <p class="atlas-modal-hint">
          Atlas downloads every element of this world. You can keep editing while offline; changes sync back the next time you open it.
        </p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-progress" data-role="progress" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="link">Download</button>
        </div>
        <div class="atlas-modal-actions" data-role="busy-actions" hidden>
          <button type="button" class="atlas-btn-ghost" data-action="cancel-link" title="Stop now and remove what was downloaded; nothing is kept">Cancel download</button>
          <button type="button" class="atlas-btn-primary" data-action="finish-early" title="Stop now and open the world with what has downloaded; Refresh from OnlyWorlds brings the rest">Stop and keep what's here</button>
        </div>
      </form>
    `;

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressBox = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="link"]')!;
    const formActions = cancelBtn.parentElement as HTMLElement;
    const busyActions = body.querySelector<HTMLElement>('[data-role="busy-actions"]')!;
    const cancelLinkBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel-link"]')!;
    const finishBtn = body.querySelector<HTMLButtonElement>('[data-action="finish-early"]')!;

    // The user's answer while the download runs (Titus): polled by
    // the download between elements, so a large world stops within one write.
    let stop: DownloadStop = null;
    cancelLinkBtn.addEventListener('click', () => {
      stop = 'cancel';
      cancelLinkBtn.disabled = finishBtn.disabled = true;
      progressBox.textContent = 'Cancelling…';
    });
    finishBtn.addEventListener('click', () => {
      stop = 'finish';
      cancelLinkBtn.disabled = finishBtn.disabled = true;
      progressBox.textContent = 'Stopping; keeping what has downloaded…';
    });

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });
    wireWhereChoice(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      progressBox.hidden = true;

      // Taken synchronously, inside the click, before the first await.
      const where = takeWhereInClick(form);
      const ready = await readyWhere(where, this.toasts, 'Downloading a world puts it in a new folder.');
      if (ready !== true) {
        errorBox.textContent = ready || '';
        errorBox.hidden = !ready;
        return;
      }

      const apiKey = (form.querySelector<HTMLInputElement>('input[name="api-key"]')!).value;
      const apiPin = (form.querySelector<HTMLInputElement>('input[name="api-pin"]')!).value;
      const displayName = (form.querySelector<HTMLInputElement>('input[name="display-name"]')!).value;

      // Disable the form for the duration and swap the buttons for the two
      // honest exits: Cancel link removes the new folder, Stop keeps
      // what has arrived. A click outside or Escape does nothing while this
      // runs; it used to close the modal and look like a cancel while the
      // download carried on out of sight.
      const inputs = form.querySelectorAll<HTMLInputElement>('input');
      inputs.forEach(i => (i.disabled = true));
      submitBtn.disabled = true;
      submitBtn.textContent = 'Downloading…';
      stop = null;
      formActions.hidden = true;
      busyActions.hidden = false;
      cancelLinkBtn.disabled = finishBtn.disabled = false;
      finishBtn.hidden = false;
      this.dismissLocked = true;
      const restoreForm = () => {
        this.dismissLocked = false;
        busyActions.hidden = true;
        formActions.hidden = false;
        inputs.forEach(i => (i.disabled = false));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Download';
      };

      const renderProgress = (p: InitialDownloadProgress) => {
        if (p.phase === 'list') {
          progressBox.textContent = `Discovering ${p.currentType ?? ''}…`;
        } else {
          progressBox.textContent = p.total === 0
            ? 'World is empty; finishing up'
            : progressLine(p, where);
        }
        progressBox.hidden = false;
      };

      try {
        // On the activation chain (2026-07-13): a world click during
        // this multi-second download would otherwise close the download's
        // store mid-write, or the download's setActiveStore would clobber the
        // just-activated world.
        const result = await enqueueActivationTask(() =>
          linkExistingApiWorldInRoot({
            where,
            apiKey,
            apiPin,
            displayName,
            // Saving what downloaded: nothing is left to keep or stop early, and
            // the saving speaks even after Stop and keep (it is what runs then).
            onProgress: (p) => {
              // Once the last file has landed the world is being registered: a
              // cancel could no longer undo it, so the button stops offering one.
              const saving = p.phase === 'land' || p.phase === 'open';
              if (saving) finishBtn.hidden = true;
              if ((p.phase === 'land' && p.done >= p.total) || p.phase === 'open') cancelLinkBtn.disabled = true;
              if (!stop || (saving && stop !== 'cancel')) renderProgress(p);
            },
            shouldStop: () => stop,
          })
        );
        const failures = result.failures.length;
        if (result.stoppedEarly) {
          this.toasts.info(`Linked ${result.entry.name} with ${result.downloaded} of ${result.stoppedEarly.total} elements. Use Refresh from OnlyWorlds to download the rest.`);
        } else if (failures > 0) {
          this.toasts.error(`Linked ${result.entry.name}. ${failures} element${failures === 1 ? '' : 's'} did not download. Refresh from OnlyWorlds brings ${failures === 1 ? 'it' : 'them'}.`);
        } else {
          this.toasts.success(`Linked ${result.entry.name} · ${result.downloaded} element${result.downloaded === 1 ? '' : 's'} downloaded`);
        }
        this.hide();
        navigate(homeHash(result.entry.id));
      } catch (err) {
        if (err instanceof DownloadCancelledError) {
          this.toasts.info('Download cancelled. Nothing was kept.');
          this.hide();
          return;
        }
        // A refused key, an unknown world or no connection arrives worded
        // (keyCheckError); the rest is worded here.
        console.warn('[link-world] link failed:', err);
        const sentence = problemFor(err, { inline: true, doing: 'downloading the world', where }).sentence;
        errorBox.textContent = sentence;
        errorBox.hidden = !sentence;
        progressBox.hidden = true;
        restoreForm();
      }
    });

    return overlay;
  }
}


