/**
 * The exit confirm — what you saw, what you did not, and a way back.
 *
 * Captain's design (S301): the reworked tour gates every beat on a user action,
 * so the exit has to be a real door rather than a trapdoor. Rather than a bare
 * "are you sure", leaving shows a small summary of the app scoped to rooms, so
 * someone who bails at minute twelve still walks away knowing what the tool
 * has in it.
 *
 * Only the mid-tour EXIT routes through here. The finale's Finish does not: at
 * that point the user has seen the whole thing and a screen listing what they
 * missed would be both wrong and slightly rude.
 *
 * The room data is derived by the pure `tour-exit-summary` kernel; this file is
 * only presentation and wiring.
 */

import { escapeText } from '../core/dom-utils';
import { BaseModal } from '../ui/modal-base';
import { tourExitSummary, type TourRoom } from './tour-exit-summary';

function roomRow(room: TourRoom, seen: boolean): string {
  return `
    <li class="atlas-tour-exit-room${seen ? ' is-seen' : ''}">
      <span class="material-symbols-outlined" aria-hidden="true">${escapeText(room.icon)}</span>
      <span class="atlas-tour-exit-room-text">
        <span class="atlas-tour-exit-room-label">${escapeText(room.label)}</span>
        <span class="atlas-tour-exit-room-blurb">${escapeText(room.blurb)}</span>
      </span>
    </li>`;
}

class TourExitModal extends BaseModal {
  open(stepIndex: number, onConfirm: () => void): void {
    // No title (Captain, S318): the room summary IS the screen; a "leave the
    // tour" heading above it duplicated the confirm button's own label.
    const { overlay, body } = this.buildModalShell({
      dataModal: 'tour-exit',
      panelClass: 'atlas-tour-exit-panel',
    });
    const { seen, unseen } = tourExitSummary(stepIndex);

    // The unseen list is the point of the screen, so it leads when there is
    // one. A user who has somehow reached every room still gets a clean
    // confirm rather than an empty heading.
    const unseenBlock = unseen.length
      ? `<p class="atlas-tour-exit-heading">Rooms you have not opened yet</p>
         <ul class="atlas-tour-exit-rooms">${unseen.map(r => roomRow(r, false)).join('')}</ul>`
      : '';
    const seenBlock = seen.length
      ? `<p class="atlas-tour-exit-heading">Rooms you have been in</p>
         <ul class="atlas-tour-exit-rooms">${seen.map(r => roomRow(r, true)).join('')}</ul>`
      : '';

    body.innerHTML = `
      ${unseenBlock}
      ${seenBlock}
      <p class="atlas-tour-exit-replay atlas-tour-exit-loss" data-role="tour-exit-loss">Leaving deletes the tour world and everything you made in it. To keep it, go on to the end of the tour.</p>
      <p class="atlas-tour-exit-replay">Replay the tour any time from the settings.</p>
      <div class="atlas-modal-actions">
        <button type="button" class="atlas-btn-ghost" data-action="tour-exit-cancel">Keep going</button>
        <button type="button" class="atlas-btn-primary" data-action="tour-exit-confirm">Exit tour</button>
      </div>`;

    body.querySelector<HTMLButtonElement>('[data-action="tour-exit-cancel"]')
      ?.addEventListener('click', () => this.hide());
    body.querySelector<HTMLButtonElement>('[data-action="tour-exit-confirm"]')
      ?.addEventListener('click', () => {
        // Hide FIRST: teardown unmounts the tour bar and returns to the launch
        // route, and an overlay still attached at that point would outlive the
        // tour it belongs to.
        this.hide();
        onConfirm();
      });

    this.modal = overlay;
    this.show();
  }
}

/** Open the exit confirm. `onConfirm` runs only if the user goes through with it. */
export function confirmExitTour(stepIndex: number, onConfirm: () => void): void {
  new TourExitModal().open(stepIndex, onConfirm);
}
