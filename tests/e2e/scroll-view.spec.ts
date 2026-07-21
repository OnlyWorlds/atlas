/**
 * Scroll view e2e (2C, S13 — 2026-07-14). Locks the document view's spine:
 * the control-bar toggle swaps the canvas for the scrolling document (cards +
 * era seams + the now seam + the sticky date readout, all speaking the lens) →
 * a chart saved in scroll mode reopens in scroll mode → clicking a card peeks
 * (expands) it → toggling back restores the canvas.
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
    const sub = await root.getDirectoryHandle('scroll-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'scrollworld');
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

/** A calendar Construct minted directly (the builder flow is calendar.spec's
 *  lock) — one era, two 90-day months, so the document can speak it. The
 *  world CLOCK goes through the real modal: a bare store.writeWorldMeta never
 *  patches state.active.meta, so the room would keep a null now. */
async function mintCalendar(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('construct', {
      name: 'The Almanac',
      supertype: 'calendar',
      atlas_calendar: {
        version: 1,
        grain: 'day',
        eras: [{ name: 'Freehold Tally', abbrev: 'FT', start: 0, restart: true }],
        bundles: { months: { names: ['Sowmarch', 'Greening'], lengths: [90, 90] } },
        format: '{day} {month}, Year {year} {era}',
      },
    });
    api.patchData(await store.listElements());
  });
  await openCharts(page);
  // The clock through the user path (unit + now land on disk AND in state).
  await page.click('.atlas-cal-chip');
  await page.locator('.atlas-cal-menu-item', { hasText: 'world clock' }).click();
  await expect(page.locator('[data-modal="world-clock"]')).toBeVisible();
  await page.fill('#wc-unit', 'day');
  await page.fill('#wc-now', '400');
  await page.click('[data-action="save-clock"]');
  // No lens selection step: this world holds exactly ONE calendar and its owner
  // has never opened the lens menu, so the room already speaks it (S305). The
  // menu still offers an explicit "no calendar", which is why the fallback keys
  // on never-chosen rather than on falsiness.
  await expect(page.locator('.atlas-cal-chip')).toContainText('The Almanac');
}

test('the toggle swaps to the document view: cards, era seam, now seam, readout — all speaking the lens', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Founding', start_date: 0 });
  await createElement(page, 'event', { name: 'The Cracking', start_date: 380 });
  await createElement(page, 'event', { name: 'Harvest Pact', start_date: 500 });
  await mintCalendar(page);

  await page.click('[data-action="chart-mode-scroll"]');
  await expect(page.locator('.atlas-scroll-view')).toBeVisible();

  // Cards speak the calendar (0 → "1 Sowmarch, Year 1 FT").
  const founding = page.locator('.atlas-scroll-card', { hasText: 'Founding' });
  await expect(founding).toBeVisible();
  await expect(founding).toContainText('1 Sowmarch, Year 1 FT');

  // The era sections the document; the now (400) seams between 380 and 500.
  await expect(page.locator('.atlas-scroll-era')).toHaveText('Freehold Tally');
  await expect(page.locator('.atlas-scroll-now')).toBeVisible();

  // The sticky readout tracks the viewport through the lens.
  await expect(page.locator('.atlas-scroll-datebox')).toContainText('FT');

  // Clicking a card peeks it: expands in place with actions.
  await founding.click();
  await expect(founding).toHaveClass(/selected/);
  await expect(founding.locator('.atlas-scroll-card-actions')).toContainText('Open');

  // Toggling back restores the canvas.
  await page.click('[data-action="chart-mode-canvas"]');
  await expect(page.locator('canvas.atlas-timeline-view-canvas')).toBeVisible();
  await expect(page.locator('.atlas-scroll-view')).toHaveCount(0);
});

test('a chart saved in scroll mode reopens in scroll mode', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Founding', start_date: 0 });
  await createElement(page, 'event', { name: 'The Cracking', start_date: 380 });
  await openCharts(page);

  await page.click('[data-action="chart-mode-scroll"]');
  await expect(page.locator('.atlas-scroll-view')).toBeVisible();
  await page.click('[data-action="save-chart"]');
  await expect(page.locator('.atlas-saved-chart')).toHaveCount(1);

  // Back to canvas, then apply the saved chart — the mode is part of the chart.
  await page.click('[data-action="chart-mode-canvas"]');
  await expect(page.locator('canvas.atlas-timeline-view-canvas')).toBeVisible();
  await page.locator('.atlas-saved-chart-name').click();
  await expect(page.locator('.atlas-scroll-view')).toBeVisible();

  // The persisted config carries render:'scroll'.
  const saved = await page.evaluate(async () => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const charts = await store.readCharts();
    return charts.map((c: any) => c.render);
  });
  expect(saved).toEqual(['scroll']);
});
