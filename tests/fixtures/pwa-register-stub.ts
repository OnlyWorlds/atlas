/**
 * Test stand-in for vite-plugin-pwa's `virtual:pwa-register` (aliased in
 * vitest.config.ts). Records the options `registerServiceWorker` passes so a
 * test can fire the plugin's hooks.
 */
export let lastOptions: Record<string, (() => void) | unknown> | null = null;
export const updateCalls: boolean[] = [];

export function registerSW(opts: Record<string, unknown> = {}): (reload?: boolean) => Promise<void> {
  lastOptions = opts;
  return async (reload?: boolean) => { updateCalls.push(!!reload); };
}
