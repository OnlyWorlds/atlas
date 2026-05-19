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

export function registerServiceWorker(): void {
  // Dev-mode: vite-plugin-pwa is configured to not emit a SW unless
  // `devOptions.enabled` is true. Guard so dev reloads aren't slowed by SW
  // intercept or stale caches.
  if (import.meta.env.DEV) return;

  // Lazy-import the virtual module so it doesn't crash if the plugin isn't
  // wired (e.g. tests, raw vitest runs that don't transform main.ts).
  void import(/* @vite-ignore */ 'virtual:pwa-register')
    .then((mod) => {
      const register = (mod as { registerSW?: (opts?: unknown) => unknown }).registerSW;
      if (typeof register === 'function') {
        register({
          // Skip auto-prompting for SW updates — a hard reload always
          // updates atlas because the new bundle has new asset hashes.
          immediate: true,
        });
      }
    })
    .catch((err) => {
      // Non-fatal: app still runs without offline support.
      console.warn('[atlas:offline] service worker registration skipped:', err);
    });
}
