/**
 * The home onboarding e2e (the cards; #127 the question; 1.20 cards kept,
 * done). Drives the real flow: an empty world asks "What do you have?" (three
 * quiet rows, nothing blocking) → stay-on-home create → the made card stays,
 * done, and the question with it → after both cores, "Grow your world": more
 * types, each opening its room, done ones kept in place → the × hides the
 * cards for this world. Plus the two Start-page links, #/start and #/bring-in.
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
    const sub = await root.getDirectoryHandle('home-tour-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'tourworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  // Land on home.
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/home`;
  });
  await expect(page.locator('.atlas-world-home')).toBeVisible();
}

async function createViaStore(page: Page, type: string, data: Record<string, unknown>) {
  await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement(type, data);
    api.patchData(await store.listElements());
  }, { type, data });
}

/**
 * A waypoint toast waits while an input has focus (the sidebar search often
 * does) and drains on the next click. So a "no toast" check first takes focus
 * away and clicks something inert, or it passes for that reason alone.
 */
async function letToastsDrain(page: Page, inert: string) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.locator(inert).click();
  await page.waitForTimeout(400);
}

/** One look, no retry: a retrying toHaveCount(0) outwaits a toast's 7 s life and passes anyway. */
const toastsNow = (page: Page) => page.locator('.atlas-waypoint-toast').count();
/** The cards in order: a done one carries a "+" (it stays in place, 1.20). */
const cardOrder = (page: Page) => page.locator('.atlas-home-onboarding-tile[data-done-type], .atlas-home-onboarding-tile[data-create-type]')
  .evaluateAll(els => els.map(e => e.getAttribute('data-done-type') ? `${e.getAttribute('data-done-type')}+` : e.getAttribute('data-create-type')));

test('empty world: "What do you have?" with three rows, the core pair under the first', async ({ page }) => {
  await setupWorld(page);
  const home = page.locator('.atlas-home-have');
  await expect(home).toContainText('What do you have?');
  await expect(home.locator('[data-have]')).toHaveCount(3);
  const nothing = home.locator('[data-have="nothing"]');
  await expect(nothing.locator('.atlas-home-have-label')).toHaveText('Nothing yet');
  await expect(nothing.locator('.atlas-home-have-line')).toHaveText('Start with a character and a location.');
  await expect(nothing.locator('[data-create-type="character"].atlas-home-tile-core')).toBeVisible();
  await expect(nothing.locator('[data-create-type="location"].atlas-home-tile-core')).toBeVisible();
  await expect(nothing.locator('[data-create-any]')).toBeVisible();
  // Nothing blocks: the sidebar + still creates.
  await expect(page.locator('[data-action="create-element"]')).toBeEnabled();
  // No toast speaks over the question (first-world completes silently).
  await letToastsDrain(page, '.atlas-home-have-title');
  expect(await toastsNow(page)).toBe(0);
  // "Bring it in" opens this world's Data room.
  await home.locator('[data-have-action="bring-in"]').click();
  await expect(page).toHaveURL(/\/import$/);
});

test('creating from a home tile stays on home; the first element row is highlighted', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-create-type="character"]');
  const modal = page.locator('[data-modal="create-element"]');
  await page.fill('input[name="element-name"]', 'Gale');
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toHaveCount(0);

  // Still home — no jump to the element room.
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/home$/);
  // The first element rides Recent, highlighted, and routes to the editor.
  const first = page.locator('.atlas-home-first-element');
  await expect(first).toBeVisible();
  await expect(first).toContainText('Gale');
  await expect(first).toContainText('your first element');
  // The block holds its shape (2026-10-09): the question stays, the character
  // card stays in its place, done; location still shows highlighted.
  await expect(page.locator('.atlas-home-have-title')).toHaveText('What do you have?');
  await expect(page.locator('[data-done-type="character"].atlas-home-tile-done')).toBeVisible();
  await expect(page.locator('[data-create-type="character"]')).toHaveCount(0);
  await expect(page.locator('[data-create-type="location"].atlas-home-tile-core')).toBeVisible();
  expect(await cardOrder(page)).toEqual(['character+', 'location']);
  // Its words follow the world (F-67): no "Nothing yet" over a character, only what is missing.
  const nothing = page.locator('[data-have="nothing"]');
  await expect(nothing.locator('.atlas-home-have-label')).toHaveText('Next');
  await expect(nothing.locator('.atlas-home-have-line')).toHaveText('Add a location.');
});

test('both cores → "Grow your world": done cards stay in place and open their room; × persists', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Gale' });
  await createViaStore(page, 'location', { name: 'Old Harbor' });

  // The pair stays, done; the grow wave follows, each type with its room.
  await expect(page.locator('.atlas-home-have-title')).toHaveText('Grow your world');
  await expect(page.locator('[data-have]')).toHaveCount(0);
  await expect.poll(() => cardOrder(page)).toEqual(['character+', 'location+', 'event', 'narrative', 'map', 'collective']);

  // A made type stays where it was, done.
  await createViaStore(page, 'event', { name: 'The Sundering', start_date: 3 });
  await expect.poll(() => cardOrder(page)).toEqual(['character+', 'location+', 'event+', 'narrative', 'map', 'collective']);

  // A card not yet made creates that type, staying on home.
  await page.locator('[data-create-type="narrative"]').click();
  const modal = page.locator('[data-modal="create-element"]');
  await expect(modal).toBeVisible();
  await modal.locator('[data-action="cancel"]').click();
  await expect(modal).toHaveCount(0);

  // A done card opens the room its type introduces.
  await page.locator('[data-done-type="event"]').click();
  await expect(page.locator('.atlas-timeline-room')).toBeVisible();
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/home`;
  });
  await expect(page.locator('.atlas-world-home')).toBeVisible();

  // The × hides the cards for this world, and they stay hidden after a re-render.
  await page.locator('[data-action="cards-dismiss"]').click();
  await expect(page.locator('.atlas-home-onboarding')).toHaveCount(0);
  await createViaStore(page, 'object', { name: 'The Astrolabe' }); // forces re-render
  await expect(page.locator('.atlas-home-onboarding')).toHaveCount(0);

  // The control for the "no toast" check in the first test: away from home, a
  // completion does toast in this harness.
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room')).toBeVisible();
  await page.evaluate(async () => {
    const m = await import('/src/core/waypoints.ts');
    m.completeWaypoint('council');
  });
  await letToastsDrain(page, '.atlas-timeline-room h1');
  await expect(page.locator('.atlas-waypoint-toast')).toHaveCount(1);
});

test('the Start-page links: #/start asks nothing; #/bring-in lands in the Data room', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/start');
  await page.waitForSelector('.atlas-shell');
  const dialog = page.locator('[data-modal="create-world"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Start a world');
  // The hash went first: a reload does not ask again.
  expect(await page.evaluate(() => window.location.hash)).toBe('#/');
  // Count every moment the question is in the page, not just the end state
  // (it drew once under the dialog before the mark landed).
  await page.evaluate(() => {
    (window as any).__sawQuestion = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-have="elsewhere"]')) (window as any).__sawQuestion++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const rows = dialog.locator('.atlas-where-row input');
  if (await rows.count() > 1) await rows.nth(1).check();
  await page.fill('input[name="world-name"]', 'From the site');
  await dialog.locator('[data-action="pick"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  // Answered on onlyworlds.com: the tiles, and the question never drawn.
  await expect(page.locator('[data-create-type="character"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__sawQuestion)).toBe(0);

  await page.goto('/#/bring-in');
  await page.waitForSelector('.atlas-shell');
  await expect(dialog).toBeVisible();
  const rows2 = dialog.locator('.atlas-where-row input');
  if (await rows2.count() > 1) await rows2.nth(1).check();
  await page.fill('input[name="world-name"]', 'Notes from elsewhere');
  await dialog.locator('[data-action="pick"]').click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.locator('.atlas-import-ai')).toContainText('add nothing your notes do not say');
});

test('desk map rows: imageless map opens its flat canvas tab (was a divert)', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'map', { name: 'Blank Atlas' });
  const mapRow = page.locator('.atlas-home-continue-row', { hasText: 'Blank Atlas' });
  await expect(mapRow).toBeVisible();
  await mapRow.click();
  // Imageless maps are first-class: the tab opens and renders the sized flat
  // canvas (no toast, no divert — DESIGN_MAPS.md §4.2).
  await expect(page.locator('.atlas-tab.active', { hasText: 'Blank Atlas' })).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: 'set a map image' })).toHaveCount(0);
});

test('desk map rows: an already-open background map tab re-activates on click', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'map', { name: 'Alpha Map', image_url: 'https://example.invalid/a.png' });
  const mapRow = page.locator('.atlas-home-continue-row', { hasText: 'Alpha Map' });
  await expect(mapRow).toBeVisible();
  await mapRow.click();
  // First click: tab opens and is active.
  await expect(page.locator('.atlas-tab.active', { hasText: 'Alpha Map' })).toBeVisible();
  // Background the tab (switch to the map index), then click the row again.
  await page.click('.atlas-tab[data-tab-kind="map-index"]');
  await expect(page.locator('.atlas-tab[data-tab-kind="map-index"]')).toHaveClass(/active/);
  await mapRow.click();
  // The fix: the existing tab ACTIVATES instead of nothing happening.
  await expect(page.locator('.atlas-tab.active', { hasText: 'Alpha Map' })).toBeVisible();
});
