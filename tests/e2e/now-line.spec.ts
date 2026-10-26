/**
 * Now-line control e2e (Act 1, Bout 1.0). The canvas render (the seam, forward
 * dimming, straddle split) is covered by the rangeVsNow unit tests; this locks
 * the DOM-observable half: the charts control bar's now control + the persisted
 * World.time_current round-trip.
 *
 * Flow: dated world → charts room → "Set now" establishes time_current (median)
 * and the button becomes a "now · N" chip → the chip's × clears it and the
 * button returns.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupWorld(page: Page) {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('now-line-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'nowworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) throw new Error('no active store');
    const created = await store.createElement(type, data);
    const all = await store.listElements();
    api.patchData(all);
    return created.id;
  }, { type, data });
}

async function openCharts(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room h1')).toHaveText('Charts');
}

async function timeCurrent(page: Page): Promise<number | null | undefined> {
  return await page.evaluate(() => (window as any).__atlasTestApi.getState().active?.meta?.time_current ?? null);
}

test('Set now establishes time_current and toggles to a now chip; clear resets', async ({ page }) => {
  await setupWorld(page);
  // A small dated spread: the LATEST of [0,10,30] is 30 (the set-now
  // default is the latest recorded moment, Titus's rule; was the median).
  await createElement(page, 'event', { name: 'First', start_date: 0 });
  await createElement(page, 'event', { name: 'Middle', start_date: 10 });
  await createElement(page, 'event', { name: 'Last', start_date: 30 });
  await openCharts(page);

  // Unset: the ghost "Set now" button shows, no chip, no persisted now.
  const setBtn = page.locator('.atlas-chart-now-set');
  await expect(setBtn).toBeVisible();
  await expect(page.locator('.atlas-chart-now-chip')).toHaveCount(0);
  expect(await timeCurrent(page)).toBeNull();

  // Establish: the now lands ON the latest element (30), chip replaces the button.
  await setBtn.click();
  const chip = page.locator('.atlas-chart-now-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('30'); // bare date — the gold chip IS the "now"
  await expect(page.locator('.atlas-chart-now-set')).toHaveCount(0);
  expect(await timeCurrent(page)).toBe(30);

  // Clear: the × removes the now and the ghost button returns.
  await page.locator('.atlas-chart-now-clear').click();
  await expect(page.locator('.atlas-chart-now-set')).toBeVisible();
  await expect(page.locator('.atlas-chart-now-chip')).toHaveCount(0);
  expect(await timeCurrent(page)).toBeNull();
});
