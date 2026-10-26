/**
 * Shared UI helper: surface a useful toast (and optional deep-link) when a
 * sync action can't run because the engine isn't attached.
 *
 * Found by Titus: multiple UI sites toasted "Engine not ready" /
 * "Refresh is only available on API-linked worlds" when the actual problem
 * was a missing PIN on an api-linked world. Users were left guessing where
 * to fix it. This helper consolidates the diagnosis so every surface
 * (pill, sidebar refresh, settings test connection, conflict modal,
 * server-delete modal, filter chip refresh) emits a precise message.
 */

import { navigate, settingsHash } from '../core/router';
import { diagnoseSyncUnavailable } from '../sync/sync-attach';
import { SEAT_SECRET_MISSING_LINE } from '../core/seat';
import type { ToastManager } from './toast-manager';
import type { SyncResult } from '../core/types';
import { getState } from '../core/state';
import { isPartialSlice } from '../core/provenance';

/**
 * True when a refresh may say "Already up to date": the round reached
 * OnlyWorlds and nothing moved, clashed or failed. A refused key, a busy or
 * unreachable OnlyWorlds and a failed write each have their own line, so a
 * round that met one is not up to date (#198's live walk heard "Sync
 * paused" and "Already up to date" from one press).
 */
export function upToDate(result: SyncResult): boolean {
  if (result.auth_blocked || result.transient_blocked) return false;
  if (result.conflicts.length > 0 || result.failures.length > 0) return false;
  const moved = result.pulled.creates + result.pulled.updates + result.pulled.deletes
    + result.pushed.creates + result.pushed.updates + result.pushed.deletes
    + (result.meta_pulled?.length ?? 0) + (result.meta_pushed?.length ?? 0);
  return moved === 0;
}

/**
 * Inspect why sync is unavailable and toast accordingly. Returns the reason
 * for caller logging/branching, or null if the engine is actually attached
 * (caller's gate failed for an unrelated reason).
 *
 * For the pin-missing case, also navigates to the settings account tab
 * since that's where the fix lives.
 */
export function surfaceSyncUnavailable(toasts: ToastManager): ReturnType<typeof diagnoseSyncUnavailable> {
  const reason = diagnoseSyncUnavailable();
  if (!reason) return null;
  switch (reason.kind) {
    case 'no-active-world':
      toasts.info('No world open. Pick one from the sidebar.');
      return reason;
    case 'local-only':
      // This branch once NAMED a fix and left the user to find it, while
      // `pin-missing` two lines below already navigated to the fix.
      // The file exists to stop exactly that ("users were left guessing where
      // to fix it") — the pattern was just never applied across its own switch.
      if (isPartialSlice(getState().active?.meta)) {
        // One Character's view never goes online (folder spec §4.2).
        toasts.info('This world is local: one view of a world, which can\'t go online.');
        return reason;
      }
      toasts.info('This world is local. Use Make online in Settings to sync it.');
      navigate(settingsHash(reason.worldId, 'world'));
      return reason;
    case 'pin-missing':
      toasts.info('Enter your PIN in Settings, under OnlyWorlds, to sync.');
      navigate(settingsHash(reason.worldId, 'onlyworlds'));
      return reason;
    case 'seat-secret-missing':
      toasts.info(SEAT_SECRET_MISSING_LINE);
      navigate(settingsHash(reason.worldId, 'world'));
      return reason;
    // ('attached-but-paused' was declared in the union and handled here, but
    //  `diagnoseSyncUnavailable` never constructed it — the branch could not
    //  fire, so its toast had never once been shown. Deleted with the variant
    //  rather than left as decoration. If pause ever needs its own
    //  diagnosis, add it to the producer FIRST and this switch will fail to
    //  compile until it is handled.)
    case 'engine-not-ready':
    default:
      toasts.info('Sync is still starting. Try again in a moment.');
      return reason;
  }
}
