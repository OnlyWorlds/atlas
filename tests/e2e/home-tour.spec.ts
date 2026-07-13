/**
 * The home tour e2e (S264). Drives the real tutorial flow: empty world →
 * highlighted core pair (+ room links) → stay-on-home create → first-element
 * highlight → next wave after both cores → create→CTA flip → dismissal
 * persists across re-render.
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
  await page.click('[data-action="setup-atlas"]');
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

test('empty world: highlighted core pair + anything else + room links', async ({ page }) => {
  await setupWorld(page);
  await expect(page.locator('.atlas-home-onboarding')).toContainText('Your world is empty');
  await expect(page.locator('[data-create-type="character"].atlas-home-tile-core')).toBeVisible();
  await expect(page.locator('[data-create-type="location"].atlas-home-tile-core')).toBeVisible();
  await expect(page.locator('[data-create-type="event"]')).toHaveCount(0); // next wave waits
  await expect(page.locator('[data-create-any]')).toBeVisible();
  // The empty-world room links.
  await expect(page.locator('.atlas-home-tour-link', { hasText: 'Write' })).toBeVisible();
  await expect(page.locator('.atlas-home-tour-link', { hasText: 'Chart' })).toBeVisible();
  await expect(page.locator('.atlas-home-tour-link', { hasText: 'Import' })).toBeVisible();
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
  // The character card is done; location still shows highlighted.
  await expect(page.locator('[data-create-type="character"]')).toHaveCount(0);
  await expect(page.locator('[data-create-type="location"].atlas-home-tile-core')).toBeVisible();
});

test('both cores → the next wave; a created type flips to its room CTA; dismissal persists', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Gale' });
  await createViaStore(page, 'location', { name: 'Old Harbor' });

  // The quiet next wave (no highlights), event card present.
  await expect(page.locator('[data-create-type="event"]')).toBeVisible();
  await expect(page.locator('.atlas-home-tile-core')).toHaveCount(0);

  // Create an event → its card becomes the Chart CTA.
  await createViaStore(page, 'event', { name: 'The Sundering', start_date: 3 });
  const cta = page.locator('[data-tour-cta="event"]');
  await expect(cta).toBeVisible();
  await expect(cta).toContainText('Chart');
  await expect(page.locator('[data-create-type="event"]')).toHaveCount(0);

  // Dismiss the narrative create card — it stays gone after a re-render.
  const narrative = page.locator('[data-create-type="narrative"]');
  await narrative.hover();
  await narrative.locator('.atlas-home-tile-dismiss').click();
  await expect(page.locator('[data-create-type="narrative"]')).toHaveCount(0);
  await createViaStore(page, 'object', { name: 'The Astrolabe' }); // forces re-render
  await expect(page.locator('[data-create-type="narrative"]')).toHaveCount(0);

  // Clicking a CTA navigates to its room and retires the card.
  await page.locator('[data-tour-cta="event"]').click();
  await expect(page.locator('.atlas-timeline-room')).toBeVisible();
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/home`;
  });
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await expect(page.locator('[data-tour-cta="event"]')).toHaveCount(0);
});
