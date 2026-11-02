/**
 * A new world's Home with the first steps retired (1.115.0): no card, ever. Since 1.120.0 a world
 * with nothing in it is the strand alone, no tab head, asking for its story, and under it the Quiet
 * ways to bring a world in. Once the world holds more than its strand, Home's next opening has the
 * two tabs. Bring in a file lands in the Data room.
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

/** Count every first-steps card drawn from now on: an end-state check cannot see a flash. */
async function watchCards(page: Page) {
  await page.evaluate(() => {
    (window as any).__cards = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-role="guide-block"]')) (window as any).__cards++;
    }).observe(document.body, { childList: true, subtree: true });
  });
}
const cardsDrawn = (page: Page): Promise<number> => page.evaluate(() => (window as any).__cards);

/** A new browser world, on its Home, every card counted from before it was made. */
async function setupWorld(page: Page, name = 'Strandfirst') {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('home-strand-first-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await watchCards(page);
  await page.click('[data-action="create-local"]');
  const dialog = page.locator('[data-modal="create-world"]');
  await page.locator('input[name="world-name"]').waitFor();
  // Firefox has no folder mode, so its dialog draws no choice: a browser world is the only kind there.
  const where = dialog.locator('input[name="where"][value="browser"]');
  if (await where.count()) await where.check();
  await page.fill('input[name="world-name"]', name);
  await dialog.locator('[data-action="pick"]').click();
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return !!s.active?.worldId && !s.data.loading;
  });
  expect(await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.registry.worlds.find((w: { id: string }) => w.id === s.active.worldId)?.where;
  })).toBe('browser');
  await goHome(page);
}

async function goHome(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/home`;
  });
  await expect(page.locator('.atlas-world-home')).toBeVisible();
}

async function createViaStore(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const el = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return el.id as string;
  }, { type, data });
}

const tabs = (page: Page) => page.locator('[data-role="home-tabs"] [data-tab]');
const bringIn = (page: Page) => page.locator('[data-role="home-bring-in"]');
const card = (page: Page) => page.locator('[data-role="strand-card"][data-mode="make"]');

test('a new world opens on the strand alone: no tab head, the story\'s card and the ways in, never a first-steps card; with two elements, Home opened again has both tabs', async ({ page }) => {
  await setupWorld(page);
  // No tab head (1.120.0, R1): an empty world's Home is the strand, asking for its story.
  await expect(page.locator('[data-role="home-tabs"]')).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-card-slot', 'narrative');
  // The grid's five cells, in the strand's order; only the story's is drawn.
  const slots = page.locator('[data-role="home-strand"] [data-slot]');
  await expect(slots).toHaveCount(5);
  expect(await slots.evaluateAll(els => els.map(e => e.getAttribute('data-slot')))).toEqual(['narrative', 'event', 'location', 'character', 'now']);
  // Under it, the ways in from what someone already has: Quiet, the card's Make the main act.
  await expect(bringIn(page)).toHaveCount(1);
  await expect(bringIn(page)).toContainText('Already have a world file or notes?');
  await expect(bringIn(page).locator('[data-bring-action="file"]')).toHaveText('Bring in a file');
  await expect(bringIn(page).locator('.atlas-btn-primary')).toHaveCount(0);
  expect(await cardsDrawn(page), 'no first-steps card, not for a frame').toBe(0);

  // Two elements made (a Character, an Event with no date): no head in this visit.
  await createViaStore(page, 'character', { name: 'Mira' });
  await createViaStore(page, 'event', { name: 'The Founding' });
  await expect(page.locator('[data-role="home-tabs"]')).toHaveCount(0);
  // Home opened again: the world holds more than a strand, so both tabs.
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/settings`;
  });
  await expect(page.locator('.atlas-world-home')).toHaveCount(0);
  await goHome(page);
  await expect(tabs(page)).toHaveCount(2);
  expect(await tabs(page).evaluateAll(els => els.map(e => e.getAttribute('data-tab')))).toEqual(['picture', 'strand']);
  // No longer empty: the ways in under the strand are gone.
  await expect(bringIn(page)).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(await cardsDrawn(page), 'no first-steps card once the world holds something').toBe(0);
  await expect(page.locator('[data-role="guide-block"]')).toHaveCount(0);
});

test('an empty world\'s Bring in a file lands in the Data room', async ({ page }) => {
  await setupWorld(page);
  await bringIn(page).locator('[data-bring-action="file"]').click();
  await expect(page).toHaveURL(/\/import$/);
  await goHome(page);
  // Back with nothing brought in: the same Home, the story's card and its ways in.
  await expect(page.locator('[data-role="home-tabs"]')).toHaveCount(0);
  await expect(card(page)).toHaveAttribute('data-card-slot', 'narrative');
  await expect(bringIn(page)).toHaveCount(1);
  expect(await cardsDrawn(page)).toBe(0);
});

test('an empty world\'s story made on the strand keeps Home on the strand, after the press and after Home is opened again', async ({ page }) => {
  await setupWorld(page);
  await card(page).locator('[data-field="name"]').fill('A Tale');
  await card(page).locator('[data-field="name"]').press('Enter');
  const story = page.locator('[data-role="home-strand"] [data-slot="narrative"]');
  await expect(story.locator('.atlas-home-strand-name')).toHaveText('A Tale');
  // The redraw between the make and the mark saw one element and no strand: it must not leave the strand.
  await expect(page.locator('[data-role="home-tabs"]')).toHaveCount(0);
  // The next question is who the story is about (1.121.0).
  await expect(card(page)).toHaveAttribute('data-card-slot', 'character');
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/settings`;
  });
  await expect(page.locator('.atlas-world-home')).toHaveCount(0);
  await goHome(page);
  // The world holds only its strand's story: still the strand alone, still asking.
  await expect(page.locator('[data-role="home-tabs"]')).toHaveCount(0);
  await expect(story.locator('.atlas-home-strand-name')).toHaveText('A Tale');
  await expect(card(page)).toHaveAttribute('data-card-slot', 'character');
});
