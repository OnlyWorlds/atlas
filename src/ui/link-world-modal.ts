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
import type { InitialDownloadProgress } from '../sync/initial-download';
import { escapeAttr } from '../core/dom-utils';

export class LinkWorldModal extends BaseModal {
  private toasts: ToastManager;

  constructor(toasts: ToastManager) {
    super();
    this.toasts = toasts;
  }

  open(): void {
    if (!getState().atlasRoot) {
      this.toasts.error('Set up your atlas folder first');
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
          <input class="atlas-input" type="text" name="api-pin" value="${escapeAttr(prefilledPin)}" placeholder="Four-digit PIN" autocomplete="off" maxlength="8" />
        </label>
        <label class="atlas-modal-field">
          <span>Display name (optional)</span>
          <input class="atlas-input" type="text" name="display-name" placeholder="Defaults to server world name" autocomplete="off" />
        </label>
        <p class="atlas-modal-hint">
          Atlas will download every element of this world into a new folder inside your atlas folder. You can keep editing while offline; changes sync back next time you open it.
        </p>
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-progress" data-role="progress" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="link">Link</button>
        </div>
      </form>
    `;

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const progressBox = body.querySelector<HTMLElement>('[data-role="progress"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="link"]')!;

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      progressBox.hidden = true;

      const apiKey = (form.querySelector<HTMLInputElement>('input[name="api-key"]')!).value;
      const apiPin = (form.querySelector<HTMLInputElement>('input[name="api-pin"]')!).value;
      const displayName = (form.querySelector<HTMLInputElement>('input[name="display-name"]')!).value;

      // Disable form for the duration. Cancel is hidden — interrupting a partial
      // initial download mid-flight leaves the folder in an inconsistent state.
      const inputs = form.querySelectorAll<HTMLInputElement>('input');
      inputs.forEach(i => (i.disabled = true));
      submitBtn.disabled = true;
      submitBtn.textContent = 'Linking…';
      cancelBtn.hidden = true;

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
            onProgress: renderProgress,
          })
        );
        const failures = result.failures.length;
        if (failures > 0) {
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
        const message = err instanceof Error ? err.message : String(err);
        errorBox.textContent = message;
        errorBox.hidden = false;
        progressBox.hidden = true;
        inputs.forEach(i => (i.disabled = false));
        submitBtn.disabled = false;
        submitBtn.textContent = 'Link';
        cancelBtn.hidden = false;
      }
    });

    return overlay;
  }
}


