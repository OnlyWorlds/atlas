/**
 * Shared UI helper: surface a useful toast (and optional deep-link) when a
 * sync action can't run because the engine isn't attached.
 *
 * Captain session 221: multiple UI sites toasted "Engine not ready" /
 * "Refresh is only available on API-linked worlds" when the actual problem
 * was a missing PIN on an api-linked world. Users were left guessing where
 * to fix it. This helper consolidates the diagnosis so every surface
 * (pill, sidebar refresh, settings test connection, conflict modal,
 * server-delete modal, filter chip refresh) emits a precise message.
 */

import { navigate, settingsHash } from '../core/router';
import { diagnoseSyncUnavailable } from '../sync/sync-attach';
import type { ToastManager } from './toast-manager';

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
      toasts.info('No active world. Pick one from the sidebar');
      return reason;
    case 'local-only':
      // S307: this branch NAMED a fix and left the user to find it, while
      // `pin-missing` two lines below has navigated to the fix since S221.
      // The file exists to stop exactly that ("users were left guessing where
      // to fix it") — the pattern was just never applied across its own switch.
      toasts.info('This world is local-only. Connect it to OnlyWorlds to sync');
      navigate(settingsHash(reason.worldId, 'world'));
      return reason;
    case 'pin-missing':
      toasts.info('Enter your PIN in settings to enable sync');
      navigate(settingsHash(reason.worldId, 'onlyworlds'));
      return reason;
    // ('attached-but-paused' was declared in the union and handled here, but
    //  `diagnoseSyncUnavailable` never constructed it — the branch could not
    //  fire, so its toast had never once been shown. Deleted with the variant
    //  in S307 rather than left as decoration. If pause ever needs its own
    //  diagnosis, add it to the producer FIRST and this switch will fail to
    //  compile until it is handled.)
    case 'engine-not-ready':
    default:
      toasts.info('Sync engine not ready. Try again in a moment');
      return reason;
  }
}
