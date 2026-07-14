/**
 * Saved charts e2e (S264). Locks the applyChart fix: the default view (the
 * tableau) saves as a `selection` scope, and applying it must RESTORE that
 * scope — the old code refused selection kinds with an info toast, so the most
 * common save produced a chart that could never reopen (Captain's live find).
 * Also locks the rail heading naming the active chart, and rename flowing
 * through to it.
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
    const sub = await root.getDirectoryHandle('saved-charts-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'chartworld');
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

test('a chart saved from the default view can be reopened (the selection-scope fix)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Alpha', start_date: 10 });
  await createElement(page, 'event', { name: 'Beta', start_date: 20 });
  await createElement(page, 'character', { name: 'Gale', birth_date: 5 });
  await openCharts(page);

  // Save the default (tableau) view — a selection-scope chart.
  await page.click('[data-action="save-chart"]');
  const chip = page.locator('.atlas-saved-chart');
  await expect(chip).toHaveCount(1);
  // Member-derived name; exact order varies with timestamp ties, so capture it.
  const savedName = (await chip.locator('.atlas-saved-chart-name').textContent()) ?? '';
  expect(savedName).toMatch(/\+1$/); // members + overflow, not "Selection (3)"

  // Change the lens (narrow to events), then reopen the saved chart.
  await page.locator('.atlas-chart-type-chip', { hasText: 'characters' }).click();
  await page.locator('.atlas-chart-type-chip', { hasText: 'events' }).click();
  await chip.locator('.atlas-saved-chart-name').click();

  // No refusal toast; the chart applies, reads active, and the rail names it.
  await expect(page.locator('.ow-toast', { hasText: 'not supported' })).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'share view' })).toHaveCount(0);
  await expect(chip).toHaveClass(/active/);
  await expect(page.locator('.atlas-timeline-rail-head')).toHaveText(savedName);
});

test('renaming a chart renames the rail heading with it', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Alpha', start_date: 10 });
  await createElement(page, 'event', { name: 'Beta', start_date: 20 });
  await openCharts(page);

  await page.click('[data-action="save-chart"]');
  const chip = page.locator('.atlas-saved-chart');
  // Freshly saved from the live view → immediately active → the rail names it.
  // Member ORDER varies on local_updated_at timestamp ties (the S265 lesson —
  // this assertion missed that sweep and flaked under 4-worker load).
  await expect(page.locator('.atlas-timeline-rail-head')).toHaveText(/^(Alpha & Beta|Beta & Alpha)$/);

  await chip.hover();
  await chip.locator('.atlas-saved-chart-action').first().click(); // rename
  const input = chip.locator('.atlas-saved-chart-rename');
  await input.fill('the founding era');
  await input.press('Enter');

  await expect(page.locator('.atlas-saved-chart-name')).toHaveText('the founding era');
  await expect(page.locator('.atlas-timeline-rail-head')).toHaveText('the founding era');
});

test('a type-chip click releases an applied chart (the chart is a lens, not a lock)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Alpha', start_date: 10 });
  await createElement(page, 'character', { name: 'Gale', birth_date: 5 });
  await openCharts(page);

  await page.click('[data-action="save-chart"]');
  const chip = page.locator('.atlas-saved-chart');
  await chip.locator('.atlas-saved-chart-name').click();
  await expect(chip).toHaveClass(/active/);

  // Picking a type lens releases the chart: active mark drops, rail reverts.
  await page.locator('.atlas-chart-type-chip', { hasText: 'events' }).click();
  await expect(chip).not.toHaveClass(/active/);
  await expect(page.locator('.atlas-timeline-rail-head')).toHaveText('This chart');
});

test('deleting the applied chart releases its lens (S265, the ghost-scope bug)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Alpha', start_date: 10 });
  await createElement(page, 'event', { name: 'Beta', start_date: 20 });
  await openCharts(page);

  await page.click('[data-action="save-chart"]');
  const chip = page.locator('.atlas-saved-chart');
  // Applied: the rail names it (capture — member order varies on timestamp ties).
  const savedName = (await chip.locator('.atlas-saved-chart-name').textContent()) ?? '';
  await expect(page.locator('.atlas-timeline-rail-head')).toHaveText(savedName);

  await chip.hover();
  await chip.locator('.atlas-saved-chart-action[title="Delete chart"]').click();
  await expect(page.locator('.atlas-saved-chart')).toHaveCount(0);
  // The lens released with it — the rail no longer carries the dead chart's
  // name (a stale appliedSelection kept scoping the room invisibly).
  await expect(page.locator('.atlas-timeline-rail-head')).not.toHaveText(savedName);
});
