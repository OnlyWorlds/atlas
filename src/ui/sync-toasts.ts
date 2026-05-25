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
      toasts.info('No active world — pick one from the sidebar');
      return reason;
    case 'local-only':
      toasts.info('Sync is only available on API-linked worlds');
      return reason;
    case 'pin-missing':
      toasts.info('Enter your PIN in settings to enable sync');
      navigate(settingsHash(reason.worldId, 'account'));
      return reason;
    case 'attached-but-paused':
      toasts.info('Sync is paused — resume from settings');
      return reason;
    case 'engine-not-ready':
    default:
      toasts.info('Sync engine not ready — try again in a moment');
      return reason;
  }
}
