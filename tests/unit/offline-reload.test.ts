/**
 * Reloading after a deploy (lane C B2 + B3).
 *
 * B3: a tab opened before a deploy asks for code files the deploy replaced;
 * Vite reports each failed lazy load as `vite:preloadError`, and Atlas now
 * answers with one plain offer to reload. B2: the reload always saves the
 * rooms' pending text first (the plugin's default reload did not).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const flush = vi.fn(async () => {});
vi.mock('../../src/core/leave-flush', () => ({ flushBeforeLeavingWorld: () => flush() }));

import { installStaleCodeRecovery, isCodeLoadError, reloadAfterFlush } from '../../src/core/reload-offer';

const reload = vi.fn();
// jsdom's location.reload cannot be spied on, so the test swaps `location`
// for a stand-in AND PUTS THE REAL ONE BACK: left in place, the stand-in
// leaked into later files in the same worker (rekey-route's history tests).
const realLocation = Object.getOwnPropertyDescriptor(window, 'location')!;
beforeEach(() => {
  flush.mockClear();
  reload.mockClear();
  Object.defineProperty(window, 'location', { value: { ...window.location, reload }, writable: true, configurable: true });
  document.querySelectorAll('.atlas-update-banner').forEach(b => b.remove());
});
afterEach(() => {
  Object.defineProperty(window, 'location', realLocation);
  document.querySelectorAll('.atlas-update-banner').forEach(b => b.remove());
});

describe('reload after a deploy', () => {
  it('a failed lazy load shows ONE reload offer, with no "Later"', () => {
    installStaleCodeRecovery();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    const bars = document.querySelectorAll('.atlas-update-banner');
    expect(bars.length).toBe(1);
    expect(bars[0].textContent).toContain('Atlas was updated while this tab was open');
    expect([...bars[0].querySelectorAll('button')].map(b => b.textContent)).toEqual(['Reload']);
  });

  it('offline, the offer does not claim an update happened', () => {
    const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    try {
      installStaleCodeRecovery();
      window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
      const text = document.querySelector('.atlas-update-banner')!.textContent!;
      expect(text).toContain('could not load while offline');
      expect(text).not.toContain('updated');
    } finally {
      online.mockRestore();
    }
  });

  it('a code-load error is recognised in the wording of each browser, other errors are not', () => {
    expect(isCodeLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a.js'))).toBe(true); // Chromium
    expect(isCodeLoadError(new TypeError('error loading dynamically imported module: https://x/assets/a.js'))).toBe(true); // Firefox
    expect(isCodeLoadError(new TypeError('Importing a module script failed.'))).toBe(true); // Safari
    expect(isCodeLoadError(new Error('This window does not allow the browser storage the tour needs.'))).toBe(false);
  });

  it('the error still reaches its caller (the event is not cancelled)', () => {
    installStaleCodeRecovery();
    const e = new Event('vite:preloadError', { cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  it('Reload saves pending text before reloading', async () => {
    installStaleCodeRecovery();
    window.dispatchEvent(new Event('vite:preloadError', { cancelable: true }));
    const order: string[] = [];
    flush.mockImplementation(async () => { order.push('flush'); });
    reload.mockImplementation(() => { order.push('reload'); });
    document.querySelector<HTMLButtonElement>('.atlas-update-banner button')!.click();
    await vi.waitFor(() => expect(order).toEqual(['flush', 'reload']));
  });

  it('a save that never settles still reloads, after the limit', async () => {
    vi.useFakeTimers();
    try {
      flush.mockImplementation(() => new Promise<void>(() => {}));
      const done = reloadAfterFlush(5000);
      await vi.advanceTimersByTimeAsync(4999);
      expect(reload).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      await done;
      expect(reload).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('the new version taking control reloads every tab through the save (onNeedReload)', async () => {
    vi.stubEnv('DEV', false);
    try {
      const stub = await import('../fixtures/pwa-register-stub');
      const { registerServiceWorker } = await import('../../src/core/offline');
      registerServiceWorker();
      await vi.waitFor(() => expect(stub.lastOptions).not.toBeNull());
      const order: string[] = [];
      flush.mockImplementation(async () => { order.push('flush'); });
      reload.mockImplementation(() => { order.push('reload'); });
      (stub.lastOptions!.onNeedReload as () => void)();
      await vi.waitFor(() => expect(order).toEqual(['flush', 'reload']));
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('a failing flush still reloads (the page cannot stay on missing code)', async () => {
    flush.mockImplementation(async () => { throw new Error('disk gone'); });
    await reloadAfterFlush().catch(() => {});
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
