/**
 * Service-worker registration for offline support.
 *
 * Vite-plugin-pwa emits the SW at build time using Workbox precaching. Once
 * registered, the app shell + Material Symbols font + all bundled assets are
 * available offline after the first load. The user's worlds are already
 * folder-first (no network required for data), so with the shell cached the
 * tool works fully offline.
 *
 * The plugin's `virtual:pwa-register` module is generated at build time; in
 * dev (vite dev server without pwa devOptions enabled) the import resolves
 * to a no-op stub. Either way this function is safe to call unconditionally
 * from main.ts.
 */

import { flushBeforeLeavingWorld } from './leave-flush';
import { reloadAfterFlush, showReloadBanner } from './reload-offer';

export function registerServiceWorker(): void {
  // Dev-mode: vite-plugin-pwa is configured to not emit a SW unless
  // `devOptions.enabled` is true. Guard so dev reloads aren't slowed by SW
  // intercept or stale caches.
  if (import.meta.env.DEV) return;

  // Lazy-import the virtual module so it doesn't crash if the plugin isn't
  // wired (e.g. tests, raw vitest runs that don't transform main.ts).
  void import(/* @vite-ignore */ 'virtual:pwa-register')
    .then((mod) => {
      const register = (mod as { registerSW?: (opts?: unknown) => (reload?: boolean) => Promise<void> }).registerSW;
      if (typeof register === 'function') {
        const updateSW = register({
          immediate: true,
          // A new deploy is ready (registerType 'prompt'). Offer it;
          // never reload under the user.
          // Reload saves the rooms' pending text first (gate F9: the
          // reload discarded a debounced scene save; pagehide is only a
          // best-effort net for async writes).
          onNeedRefresh: () => showReloadBanner('A new version of Atlas is ready.', true, () => {
            void flushBeforeLeavingWorld().finally(() => { void updateSW(true); });
          }),
          // Once the new version takes control, EVERY open tab reloads, the
          // ones that said "Later" included (the old page cannot keep
          // running on the new version's files). The plugin's default is a
          // bare `location.reload()`, which dropped the other tabs' pending
          // text (lane C B2): save first, then reload.
          onNeedReload: () => { void reloadAfterFlush(); },
        });
      }
    })
    .catch((err) => {
      // Non-fatal: app still runs without offline support.
      console.warn('[atlas:offline] service worker registration skipped:', err);
    });
}
