/**
 * The tour's half of the create door (see `src/ui/create-element-door.ts`).
 *
 * Two scripted shapes live here:
 *   - the LOCKED MODAL beat (the Consul): the real create dialog with its type
 *     grid collapsed to one type and its name read-only, so the user's first
 *     element is made through the app's actual dialog;
 *   - the SILENT MINT beat (`step.creates`): the app's real `+` puts the next
 *     scripted element into the world, one per click, with no dialog at all.
 *     Titus's call — the narrator narrates, the app is where you act, and
 *     three modals in a row for three objects reads as paperwork.
 *
 * THE GUARD IS THE POINT. Every one of these conditions must hold
 * or we return false and the caller opens the ordinary modal: a tour flag left
 * in localStorage, a user who switched to their own world mid-tour, a step
 * with nothing left to mint — each of those used to produce a `+` that did
 * NOTHING. A dead button is worse than an unscripted one.
 */

import {
  consulCreated,
  createConsul,
  currentStep,
  isTourActive,
  mintNextCreate,
  tourWorldIsActive,
} from './tour-engine';
import { ElementCreateModal } from '../ui/element-create-modal';
import type { ToastManager } from '../ui/toast-manager';

/**
 * Handle a create gesture during the tour. Returns true when the tour took
 * the gesture; false means "not mine, open the normal modal".
 */
export async function handleTourCreate(toasts: ToastManager): Promise<boolean> {
  if (!isTourActive() || !tourWorldIsActive()) return false;

  const step = currentStep();

  // The Consul: the REAL element dialog, locked to the script this once.
  if (step.handsOn === 'create-consul') {
    if (consulCreated()) return false; // done — the sandbox is free again
    new ElementCreateModal(toasts, {
      initialType: 'character',
      initialName: 'The Consul',
      lockAll: true,
      overrideCreate: async () => { await createConsul(); },
      suppressToast: true,
    }).open();
    return true;
  }

  // A scripted run: mint the next un-minted ref. `mintNextCreate` resolves
  // false when the bundle has not loaded or everything is already present,
  // and the caller then falls through to the ordinary modal.
  if (step.creates && step.creates.length > 0) {
    return await mintNextCreate();
  }

  return false;
}
