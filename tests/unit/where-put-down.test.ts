/**
 * The where-question of an open from onlyworlds.com's link (1.125.0, R2) goes down, as a Cancel, on the
 * tour's start and on a real move of the address; `navigate()` to the same hash fires a synthetic
 * hashchange, which is not a move. Without `putDownOnMove` (a row's click) nothing puts it down.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { askWhere } from '../../src/ui/where-choice';
import { TOUR_STARTED_EVENT } from '../../src/tour/tour-flag';
import type { ToastManager } from '../../src/ui/toast-manager';

const toasts = { info: () => {}, error: () => {}, success: () => {} } as unknown as ToastManager;
const up = () => document.querySelector('[data-modal="where-ask"]');
const ask = (putDownOnMove?: boolean) => askWhere({ title: 'Open "W", from your worlds on OnlyWorlds', action: 'Open', purpose: 'p', toasts, ...(putDownOnMove ? { putDownOnMove } : {}) });

beforeEach(() => {
  (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined;
  window.location.hash = '#/';
});
afterEach(() => {
  delete (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  document.body.innerHTML = '';
});

describe('the where-question from a link', () => {
  it('stays on a synthetic hashchange to the same hash, goes down on a real move', async () => {
    const answer = ask(true);
    await Promise.resolve();
    expect(up()).not.toBeNull();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(up()).not.toBeNull();
    window.location.hash = '#/settings/general';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(await answer).toBeNull();
    expect(up()).toBeNull();
  });

  it('goes down on the tour\'s start', async () => {
    const answer = ask(true);
    await Promise.resolve();
    document.dispatchEvent(new CustomEvent(TOUR_STARTED_EVENT));
    expect(await answer).toBeNull();
  });

  it('a row\'s click (no putDownOnMove) stays through both', async () => {
    void ask();
    await Promise.resolve();
    window.location.hash = '#/settings/general';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    document.dispatchEvent(new CustomEvent(TOUR_STARTED_EVENT));
    expect(up()).not.toBeNull();
  });
});
