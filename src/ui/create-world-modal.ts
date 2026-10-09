/**
 * Create-Local-World modal.
 *
 * Where the world lives (1.17, ruling 2, conv. 129): on a browser with the
 * folder picker the dialog asks, folder first and browser second; the folder
 * row is pre-selected when a home folder is set (and shows its path), else
 * the user's last pick decides. Choosing the folder with no home folder asks
 * for one inside the click (`ensureAtlasRoot`). A browser without the picker
 * makes the world in this browser and says so.
 *
 * Test seam: directory-picker.pickDirectory() is overridable via
 * `window.__atlasTestApi.pickDirectory` so Playwright can inject an OPFS handle
 * without needing a real user-gesture file picker.
 */

import { BaseModal } from './modal-base';
import { ToastManager } from './toast-manager';
import { nowIso } from '../store/folder-store';
import { getState, patchSlice } from '../core/state';
import { setSidebarModePref } from '../core/ui-prefs';
import { importHash, navigate, worldHash } from '../core/router';
import { markNewcomerAnswered } from '../core/newcomer';
import { createWorldInRoot } from '../setup/atlas-root-flow';
import { readyWhere, takeWhereInClick, whereChoiceHtml, wireWhereChoice } from './where-choice';
import { completeWaypoint } from '../core/waypoints';
import { escapeText } from '../core/dom-utils';
import { problemFor } from '../core/problems';
import type { WorldRegistryEntry } from '../core/types';

export interface CreateWorldResult {
  entry: WorldRegistryEntry;
}

/**
 * Tour mode: the REAL dialog shown once with the script locked — name fixed,
 * a teaching hint replacing the folder line, and Create handing off to the
 * tour engine (browser-storage world) instead of createWorldInRoot.
 */
export interface CreateWorldTourOptions {
  lockedName: string;
  hint: string;
  overrideCreate: () => Promise<void>;
}

/**
 * A world started from a deep link (#127): the visitor already answered
 * "What do you have?" on onlyworlds.com, so the new world is marked answered,
 * and `bring-in` lands in its Data room instead of its home.
 */
export interface CreateWorldLinkOptions {
  then: 'home' | 'bring-in';
}

export class CreateWorldModal extends BaseModal {
  private onCreated?: (result: CreateWorldResult) => void;
  private toasts: ToastManager;
  private tour?: CreateWorldTourOptions;
  private link?: CreateWorldLinkOptions;

  constructor(
    toasts: ToastManager,
    onCreated?: (r: CreateWorldResult) => void,
    tour?: CreateWorldTourOptions,
    link?: CreateWorldLinkOptions,
  ) {
    super();
    this.toasts = toasts;
    this.onCreated = onCreated;
    this.tour = tour;
    this.link = link;
  }

  open(): void {
    this.modal = this.buildModal();
    this.show();
    queueMicrotask(() => {
      const input = this.modal?.querySelector<HTMLInputElement>('input[name="world-name"]');
      input?.focus();
    });
  }

  private buildModal(): HTMLElement {
    const { overlay, body } = this.buildModalShell({
      title: 'Start a world',
      dataModal: 'create-world',
    });

    const tour = this.tour;
    const whereBlock = tour ? '' : whereChoiceHtml();
    const hint = tour ? escapeText(tour.hint) : '';
    body.innerHTML = `
      <form data-form="create-world">
        <label class="atlas-modal-field">
          <span>Name</span>
          <input class="atlas-input" type="text" name="world-name" placeholder="Untitled world" autocomplete="off"
            ${tour ? `value="${escapeText(tour.lockedName)}" readonly` : ''} />
        </label>
        ${hint ? `<p class="atlas-modal-hint">${hint}</p>` : ''}
        ${whereBlock}
        <div class="atlas-modal-error" data-role="error" hidden></div>
        <div class="atlas-modal-actions">
          <button type="button" class="atlas-btn-ghost" data-action="cancel">Cancel</button>
          <button type="submit" class="atlas-btn-primary" data-action="pick">Create</button>
        </div>
      </form>
    `;

    const form = body.querySelector<HTMLFormElement>('form')!;
    const errorBox = body.querySelector<HTMLElement>('[data-role="error"]')!;
    const cancelBtn = body.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    const submitBtn = body.querySelector<HTMLButtonElement>('[data-action="pick"]')!;

    cancelBtn.addEventListener('click', (e) => { e.preventDefault(); this.hide(); });
    wireWhereChoice(form);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorBox.hidden = true;
      const nameInput = form.querySelector<HTMLInputElement>('input[name="world-name"]')!;
      const name = nameInput.value.trim() || 'Untitled world';

      // Tour mode: hand the create to the tour engine and close. No folder,
      // no waypoint, no navigation of our own — the tour routes.
      if (this.tour) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Creating…';
        cancelBtn.hidden = true;
        try {
          await this.tour.overrideCreate();
          this.hide();
        } catch (err) {
          console.warn('[create-world] tour create failed:', err);
          this.showError(errorBox, problemFor(err, { inline: true, doing: 'creating the tour world', where: 'browser' }).sentence);
          submitBtn.disabled = false;
          submitBtn.textContent = 'Create';
          cancelBtn.hidden = false;
        }
        return;
      }

      // Taken synchronously, inside the click, before the first await.
      const where = takeWhereInClick(form);
      const ready = await readyWhere(where, this.toasts, 'A new world is a new folder.');
      if (ready !== true) {
        if (ready) this.showError(errorBox, ready);
        return;
      }

      submitBtn.disabled = true;
      submitBtn.textContent = 'Creating…';
      // Hide cancel during the in-flight operation so the user can't cancel
      // mid-creation (the FS work isn't safely interruptable). Restored on
      // failure below; not needed on success since the modal closes.
      cancelBtn.hidden = true;
      try {
        const link = this.link;
        const { entry } = await createWorldInRoot(name, {
          where,
          // Before activation (gate S383 A2): a world from a Start-page link
          // never draws the question it was answered, not even under this dialog.
          beforeActivate: link ? markNewcomerAnswered : undefined,
        });
        // Waypoint: the created world is non-demo by construction — ungated
        // even when the sample world is active at click time (hookmap wp1).
        // No toast lands on the empty home this opens (#127): the home's core
        // pair is first-world's receipt.
        completeWaypoint('first-world');
        this.toasts.success(`Created ${entry.name}`);
        this.hide();
        this.onCreated?.({ entry });
        // Land in world view: sidebar flips to the elements list so the new
        // world's (empty) contents are the visible surface (S255v3).
        patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
        setSidebarModePref('elements');
        navigate(this.link?.then === 'bring-in' ? importHash(entry.id) : worldHash(entry.id));
      } catch (err) {
        // A refusal (no home folder, no permission) reads as itself; the rest
        // is worded (S369).
        console.warn('[create-world] create failed:', err);
        this.showError(errorBox, problemFor(err, { inline: true, doing: 'creating the world', where }).sentence);
        submitBtn.disabled = false;
        submitBtn.textContent = 'Create';
        cancelBtn.hidden = false;
      }
    });

    return overlay;
  }

  private showError(box: HTMLElement, message: string): void {
    box.textContent = message;
    // A cancelled step has nothing to say (an empty problem sentence).
    box.hidden = !message;
  }
}

// Re-exported timestamp helper for test code paths.
export { nowIso };
