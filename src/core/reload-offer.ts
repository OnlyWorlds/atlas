/**
 * The reload offer: one quiet banner, and a reload that saves first.
 * Split out of offline.ts so it carries no build-time virtual import.
 */

import { flushBeforeLeavingWorld } from './leave-flush';

/**
 * How long a reload waits for the rooms' saves. A save that
 * never settles must not leave the page running old code forever, which the
 * plugin's bare reload never could; past this, the reload goes ahead.
 */
export const RELOAD_FLUSH_LIMIT_MS = 5000;

/** Save the rooms' pending text, waiting at most `limitMs`: before anything that unloads the page (a reload, Sign in with OnlyWorlds). */
export async function flushBeforeUnloading(limitMs = RELOAD_FLUSH_LIMIT_MS): Promise<void> {
  await Promise.race([flushBeforeLeavingWorld(), new Promise<void>(r => setTimeout(r, limitMs))]);
}

/** Save the rooms' pending text, then reload (never the other way round). */
export async function reloadAfterFlush(limitMs = RELOAD_FLUSH_LIMIT_MS): Promise<void> {
  try {
    await flushBeforeUnloading(limitMs);
  } finally {
    window.location.reload();
  }
}

/**
 * A tab opened before a deploy asks for code files the deploy replaced.
 * Every lazy part of Atlas (the Writing room, the editors, help,
 * Ctrl+K, the tour) is such a file, so after any deploy an old tab failed each
 * one with a raw "Failed to fetch dynamically imported module". Vite reports
 * every failed lazy load as `vite:preloadError`; answer it with one plain
 * offer to reload. The error still reaches its caller (no preventDefault),
 * so nothing downstream runs on a module that never arrived.
 */
export function installStaleCodeRecovery(): void {
  window.addEventListener('vite:preloadError', () => {
    // A lazy load also fails with no network at all, and then
    // "Atlas was updated" is not true.
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    showReloadBanner(offline
      ? 'Part of Atlas could not load while offline. Reload once you are back online.'
      : 'Atlas was updated while this tab was open. Reload to keep going.', false,
    () => { void reloadAfterFlush(); });
  });
}

/**
 * Is this error a lazy code file that failed to load? The reload banner
 * already explains it, so a door that toasts its own errors skips this one
 * rather than printing the raw browser message beside the banner.
 */
export function isCodeLoadError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err); // raw-error-ok: matched against the browser's own wording, never shown
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS/i.test(msg);
}

/** One quiet banner: Reload, and (when optional) Later. Never automatic. */
export function showReloadBanner(message: string, optional: boolean, onReload: () => void): void {
  if (document.querySelector('.atlas-update-banner')) return;
  const bar = document.createElement('div');
  bar.className = 'atlas-update-banner';
  bar.setAttribute('role', 'status');
  const text = document.createElement('span');
  text.textContent = message;
  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'atlas-btn-primary';
  reload.textContent = 'Reload';
  reload.addEventListener('click', onReload);
  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'atlas-btn-ghost';
  later.textContent = 'Later';
  later.addEventListener('click', () => bar.remove());
  if (optional) bar.append(text, reload, later);
  else bar.append(text, reload);
  document.body.appendChild(bar);
}
