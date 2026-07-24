/**
 * Open-ended tenure spans + card temporal vocabulary e2e (Act 2A, Bout A).
 * The canvas render (fade-cap bar, lane claim, fit extension) is covered by
 * the effectiveEndDate / extendRangeForOpenEnds / computeBeeswarm unit tests;
 * this locks the DOM-observable half: the card meta speaking type vocabulary,
 * with and without a world now.
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
    const sub = await root.getDirectoryHandle('tenure-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'tenureworld');
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

async function focusInCharts(page: Page, elementId: string) {
  await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline/${id}`;
  }, elementId);
  await expect(page.locator('.atlas-timeline-room h1')).toHaveText('Charts');
}

test('tenure and life vocabulary on the chart card, with and without a now', async ({ page }) => {
  await setupWorld(page);
  // Dated spread: the set-now default is the LATEST recorded moment (S318,
  // Captain's rule — was the median): max over starts [5,12,28,38,38,48] and
  // the recorded revoke 31 is 48, so the real gesture lands the now there.
  const revoked = await createElement(page, 'title', { name: 'Warden', grant_date: 12, revoke_date: 31 });
  const ongoing = await createElement(page, 'title', { name: 'Chronicler', grant_date: 28 });
  const chara = await createElement(page, 'character', { name: 'Serra', birth_date: 5 });
  await createElement(page, 'event', { name: 'A', start_date: 38 });
  await createElement(page, 'event', { name: 'B', start_date: 38 });
  await createElement(page, 'event', { name: 'C', start_date: 48 });

  const meta = page.locator('.atlas-timeline-card-meta');

  // WITHOUT a now: an unrevoked tenure claims nothing beyond its grant, and a
  // character shows no age (nothing to compute it against).
  await focusInCharts(page, ongoing);
  await expect(meta).toHaveText('title · granted 28');
  await focusInCharts(page, chara);
  await expect(meta).toHaveText('character · born 5');

  // Establish the now via the real control (latest of the spread = 48).
  await page.locator('.atlas-chart-now-set').click();
  await expect(page.locator('.atlas-chart-now-chip')).toContainText('48'); // bare date (S263)

  // Ongoing tenure: held to the now. Closed tenure: recorded ends win, the now
  // is irrelevant. Character: age against the now.
  await focusInCharts(page, ongoing);
  await expect(meta).toHaveText('title · granted 28 · held 20 so far');
  await focusInCharts(page, revoked);
  await expect(meta).toHaveText('title · granted 12 · revoked 31 · held 19');
  await focusInCharts(page, chara);
  await expect(meta).toHaveText('character · born 5 · age 43');
});
