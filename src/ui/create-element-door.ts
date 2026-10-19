/**
 * THE create-element door — the one funnel every free-create entry point in
 * the app goes through (elements sidebar +, Ctrl+E, the Charts room's
 * + Element).
 *
 * WHY IT EXISTS (S301): the guided tour scripts creation, and it used to do so
 * by branching inside the elements-sidebar's click handler alone. DESIGN_TOUR
 * claimed "during this beat EVERY create door is scripted" while Ctrl+E and
 * the Charts room opened a free-form modal right beside the scripted one. That
 * was harmless while the tour only locked a single beat, and stops being
 * harmless the moment `+` starts minting scripted elements one at a time:
 * the step's gate reads element existence, so an unscripted create sitting
 * next to it is a hole in the railroad.
 *
 * One wall per funnel. Contextual creates (create-from-selection, create-for-
 * this-link-field) deliberately do NOT come through here: they are answers to
 * a question the user already asked, not a free "make something".
 */

import { getActiveStore } from '../core/active-store';
import { getState } from '../core/state';
import { worldIsViewOnly } from '../core/view-only';
import { isTourFlagActive } from '../tour/tour-flag';
import { ElementCreateModal, type ElementCreateOptions } from './element-create-modal';
import type { ToastManager } from './toast-manager';

/**
 * Open the create surface appropriate to the moment. During a scripted tour
 * step this is the tour's own door (a locked modal, or a silent mint of the
 * next scripted element); everywhere else it is the ordinary create modal.
 *
 * The tour branch FALLS THROUGH to the normal modal whenever it declines
 * (gate R8) — it must never be a silently dead button, which is exactly what
 * a world-blind hijack produces when the user has switched to their own world.
 */
export function openCreateDoor(toasts: ToastManager, opts: ElementCreateOptions = {}): void {
  // A view-only world shows no + (conv. 149); a hotkey that reaches here says why once.
  if (worldIsViewOnly()) {
    toasts.info('This world is view-only, so nothing can be added here.');
    return;
  }
  if (!isTourFlagActive()) {
    new ElementCreateModal(toasts, opts).open();
    return;
  }
  void import('../tour/tour-door').then(async ({ handleTourCreate }) => {
    const handled = await handleTourCreate(toasts);
    if (!handled) openFallthrough(toasts, opts);
  }).catch(() => {
    // The tour chunk failing to load must not cost the user their create.
    openFallthrough(toasts, opts);
  });
}

/**
 * The ordinary modal, guarded at the OPEN moment rather than at dispatch.
 *
 * Two hazards, both from the async window the tour branch adds (close gate,
 * MED x2): `Ctrl+E`'s `disabledInModal` check reads the DOM at keydown and
 * sees no overlay yet, so a repeat during the dynamic import stacks a second
 * modal; and the user can hit Exit tour while the import is in flight, so the
 * modal would open over the landing page with no active store and Create would
 * be a raw null dereference.
 *
 * The guard is deliberately HERE and not on the dispatch: a blanket in-flight
 * guard also swallowed the second click of a scripted run, and a run is
 * supposed to take rapid clicks — one element per click is the whole rhythm.
 * (Caught by the double-mint spec, which is exactly what it is for.)
 */
function openFallthrough(toasts: ToastManager, opts: ElementCreateOptions): void {
  if (!getState().active || !getActiveStore()) return;
  if (document.querySelector('.atlas-modal-overlay')) return;
  new ElementCreateModal(toasts, opts).open();
}
