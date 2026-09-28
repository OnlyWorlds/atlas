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
 * Prereqs:
 *   - Atlas root must be configured (modal errors out otherwise).
 *   - Modal is opened from the sidebar header `+ link api` button.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { getState } from '../core/state';
import { navigate, homeHash } from '../core/router';
import { linkExistingApiWorldInRoot } from '../setup/atlas-root-flow';
import { enqueueActivationTask } from '../core/activation-chain';
import { completeWaypoint } from '../core/waypoints';
import { DownloadCancelledError, type InitialDownloadProgress, type DownloadStop } from '../sync/initial-download';
import { escapeAttr } from '../core/dom-utils';

export class LinkWorldModal extends BaseModal {
  private toasts: ToastManager;

  constructor(toasts: ToastManager) {
    super();
    this.toasts = toasts;
  }

  open(): void {
    if (!getState().atlasRoot) {
      this.toasts.error('Set up your OnlyWorlds folder first');
      return;
    }
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const input = this.modal?.querySelector<HTMLInputElement>('input[name="api-key"]');
      input?.focus();
    });
  }

  private buildModal(): HTMLElement {
    const { overlay, body } = this.buildModalShell({
      title: 'Link existing world',
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
          <span>PIN</span>
          <input class="atlas-input" type="password" name="api-pin" value="${escapeAttr(prefilledPin)}" placeholder="Four-digit PIN" autocomplete="off" maxlength="8" />
        </label>
        <label class="atlas-modal-field">
          <span>Display name (optional)</span>
          <input class="atlas-input" type="text" name="display-name" placeholder="Defaults to server world name" autocomplete="off" />
        </label>
        <p class="atlas-modal-hint">
          Atlas will download every element of this world into a new folder inside your OnlyWorlds folder. You can keep editing while offline; changes sync back next time you open it.
        </p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-progress" data-role="progress" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="link">Link</button>
        </div>
        <div class="atlas-modal-actions" data-role="busy-actions" hidden>
          <button type="button" class="atlas-btn-ghost" data-action="cancel-link" title="Stop now and remove the new folder; nothing is kept">Cancel link</button>
          <button type="button" class="atlas-btn-primary" data-action="finish-early" title="Stop now and open the world with what has downloaded; Refresh from API brings the rest">Stop and keep what's here</button>
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

    // The user's answer while the download runs (S360, Captain): polled by
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

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      progressBox.hidden = true;

      const apiKey = (form.querySelector<HTMLInputElement>('input[name="api-key"]')!).value;
      const apiPin = (form.querySelector<HTMLInputElement>('input[name="api-pin"]')!).value;
      const displayName = (form.querySelector<HTMLInputElement>('input[name="display-name"]')!).value;

      // Disable the form for the duration and swap the buttons for the two
      // honest exits (S360): Cancel link removes the new folder, Stop keeps
      // what has arrived. A click outside or Escape does nothing while this
      // runs; it used to close the modal and look like a cancel while the
      // download carried on out of sight.
      const inputs = form.querySelectorAll<HTMLInputElement>('input');
      inputs.forEach(i => (i.disabled = true));
      submitBtn.disabled = true;
      submitBtn.textContent = 'Linking…';
      stop = null;
      formActions.hidden = true;
      busyActions.hidden = false;
      cancelLinkBtn.disabled = finishBtn.disabled = false;
      this.dismissLocked = true;
      const restoreForm = () => {
        this.dismissLocked = false;
        busyActions.hidden = true;
        formActions.hidden = false;
        inputs.forEach(i => (i.disabled = false));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Link';
      };

      const renderProgress = (p: InitialDownloadProgress) => {
        if (p.phase === 'list') {
          progressBox.textContent = `Discovering ${p.currentType ?? ''}…`;
        } else {
          progressBox.textContent = p.total === 0
            ? 'World is empty; finishing up'
            : `Downloading ${p.done} of ${p.total} elements…`;
        }
        progressBox.hidden = false;
      };

      try {
        // On the activation chain (gate R2, 2026-07-13): a world click during
        // this multi-second download would otherwise close the download's
        // store mid-write, or the download's setActiveStore would clobber the
        // just-activated world.
        const result = await enqueueActivationTask(() =>
          linkExistingApiWorldInRoot({
            apiKey,
            apiPin,
            displayName,
            onProgress: (p) => { if (!stop) renderProgress(p); },
            shouldStop: () => stop,
          })
        );
        const failures = result.failures.length;
        if (result.stoppedEarly) {
          this.toasts.info(`Linked ${result.entry.name} with ${result.downloaded} of ${result.stoppedEarly.total} elements. Use Refresh from API (the refresh icon on the sync pill) to download the rest.`);
        } else if (failures > 0) {
          this.toasts.error(`Linked ${result.entry.name}, but ${failures} element${failures === 1 ? '' : 's'} failed (will retry on next sync)`);
        } else {
          this.toasts.success(`Linked ${result.entry.name} · ${result.downloaded} element${result.downloaded === 1 ? '' : 's'} downloaded`);
        }
        // Waypoint (hookmap wp8): linking counts UNGATED — spec-decided
        // ("linking the readonly demo world counts; never require an account
        // action to light a learning waypoint").
        completeWaypoint('ecosystem');
        this.hide();
        navigate(homeHash(result.entry.id));
      } catch (err) {
        if (err instanceof DownloadCancelledError) {
          this.toasts.info('Link cancelled. Nothing was kept.');
          this.hide();
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        errorBox.textContent = message;
        errorBox.hidden = false;
        progressBox.hidden = true;
        restoreForm();
      }
    });

    return overlay;
  }
}


