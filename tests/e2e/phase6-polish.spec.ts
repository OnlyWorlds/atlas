/**
 * Bout D — Timeline view + sync indicator pill + worlds favorites.
 *
 * Timeline: route + render + + Event button. Pill: shows "local" / "linked"
 * per active world. Favorites: toggle star → persists + sorts to top.
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

async function setupAtlasRoot(page: Page, dirName: string = 'polish-test-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  // Session 222 W2: setup-atlas button moved off the sidebar — welcome panel
  // is the single CTA. Drop the .atlas-sidebar prefix to find the button.
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  // Creating a world flips the sidebar to elements mode (S255v3). If a prior
  // world was already created in this test, switch back to worlds mode first
  // so the create-local button (worlds-mode only) is reachable again.
  const worldsModeBtn = page.locator('.atlas-mode-btn[data-action="mode-worlds"]');
  if (await worldsModeBtn.isVisible().catch(() => false)) {
    await worldsModeBtn.click();
  }
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

test('timeline route renders the interactive timeline-view', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'world a');

  // Session 223: default landing for active world is now `home`, not
  // `timeline`. Navigate explicitly to the timeline room.
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (m) window.location.hash = `#/w/${m[1]}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room')).toBeVisible();
  // Session 242: the room mounts the interactive canvas+DOM timeline-view.
  // See DESIGN_TIMELINE.md.
  await expect(page.locator('.atlas-timeline-view')).toBeVisible();
  await expect(page.locator('.atlas-timeline-view-canvas')).toBeVisible();
});

test('timeline canvas renders for worlds with temporal data', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'world b');

  // Create three events via the elements sidebar. Dot rendering is canvas-
  // based (session 242 interactive timeline-view); we verify the canvas mounts
  // and the data plumbing reaches it via the test API instead of DOM dots.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  for (const name of ['first event', 'second event', 'third event']) {
    await page.click('[data-action="create-element"]');
    await page.fill('input[name="element-name"]', name);
    await page.click('.atlas-create-type-btn[data-type="event"]');
    await page.click('[data-modal="create-element"] [data-action="create"]');
    await expect(page.locator('.atlas-row[data-element-id]', { hasText: name })).toBeVisible();
  }

  // Navigate to timeline room.
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (m) window.location.hash = `#/w/${m[1]}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-view-canvas')).toBeVisible();
  // Verify three event elements exist in state (the timeline-view's
  // multi-row binning + link resolution are exercised by unit tests in
  // tests/unit/timeline-axis.test.ts).
  const eventCount = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi.getState();
    return state.data.elements.filter((e: any) => e.type === 'event').length;
  });
  expect(eventCount).toBe(3);
});

test('sync pill shows "local" for a local-only world', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'local world');
  await expect(page.locator('[data-role="sync-pill"]')).toBeVisible();
  await expect(page.locator('[data-role="sync-pill"]')).toContainText(/local/i);
  await expect(page.locator('[data-role="sync-pill"]')).toHaveAttribute('data-state', 'local');
});

test('sync pill is hidden when no world is active', async ({ page }) => {
  await freshBoot(page);
  await expect(page.locator('[data-role="sync-pill"]')).toHaveAttribute('data-state', 'none');
});

test('favorite star toggles and sorts favorites to the top', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  // Create world A first, then world B. Default sort is alphabetical: A, B.
  await createWorld(page, 'alpha');
  await createWorld(page, 'bravo');
  // (after creating bravo, bravo becomes active. Now we have two worlds in sidebar.)

  // Creating bravo flipped the sidebar to elements mode; switch back to
  // worlds mode to see the world rows.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');

  // Both rows visible. Order: alpha, bravo.
  const rows = page.locator('.atlas-row[data-world-id]');
  await expect(rows).toHaveCount(2);
  expect(await rows.nth(0).innerText()).toContain('alpha');
  expect(await rows.nth(1).innerText()).toContain('bravo');

  // Favorite bravo. Click its star.
  const bravoRow = page.locator('.atlas-row[data-world-id]', { hasText: 'bravo' });
  await bravoRow.hover();
  await bravoRow.locator('[data-role="fav-toggle"]').click();

  // Bravo's star button now has is-fav class.
  await expect(bravoRow.locator('[data-role="fav-toggle"]')).toHaveClass(/is-fav/);

  // Order should now be: bravo (favorite), alpha.
  const rowsAfter = page.locator('.atlas-row[data-world-id]');
  expect(await rowsAfter.nth(0).innerText()).toContain('bravo');
  expect(await rowsAfter.nth(1).innerText()).toContain('alpha');

  // Persisted in localStorage.
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!));
  const bravoEntry = stored.worlds.find((w: any) => w.name === 'bravo');
  expect(bravoEntry.favorite).toBe(true);

  // Unfavorite — reverts to alphabetical.
  await bravoRow.hover();
  await bravoRow.locator('[data-role="fav-toggle"]').click();
  await expect(bravoRow.locator('[data-role="fav-toggle"]')).not.toHaveClass(/is-fav/);
});

test('timeline + event create from timeline header', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'world c');
  // Session 223: default landing is home, not timeline. Navigate to the
  // timeline room explicitly to access the [+ Event] header button.
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (m) window.location.hash = `#/w/${m[1]}/timeline`;
  });
  await page.waitForSelector('.atlas-timeline-room');

  await page.click('[data-action="new-event"]');
  await expect(page.locator('[data-modal="create-element"]')).toBeVisible();

  // The type should be pre-selected to 'event'.
  await expect(page.locator('.atlas-create-type-btn[data-type="event"].active')).toBeVisible();

  // Charts-context create (S263): a required Date field rides the modal
  // (prefilled — 0 on this dateless world) and dateless types are visible
  // but disabled, so everything created here lands ON the chart.
  const dateInput = page.locator('input[name="element-date"]');
  await expect(dateInput).toBeVisible();
  await expect(page.locator('.atlas-create-type-btn-dateless[data-type="species"]')).toBeDisabled();

  await page.fill('input[name="element-name"]', 'battle of pelennor');
  await dateInput.fill('3019');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);

  // Creating from the charts room STAYS in the room (Captain, 2026-07-10) —
  // the chart is the workspace; the element arrives dated and confirmed.
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/timeline$/);
  await expect(page.locator('.ow-toast', { hasText: 'Created battle of pelennor at 3019' })).toBeVisible();
});
