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
  await page.click('.atlas-sidebar [data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: name })).toBeVisible();
}

test('timeline renders empty state when no events exist', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'world a');

  // After activation, the middle pane defaults to timeline (the "no element
  // selected" landing for an active world). The deprecated [data-action="open-
  // timeline"] button only ever rendered on the welcome panel and is no longer
  // part of the active-world flow.
  await expect(page.locator('.atlas-timeline')).toBeVisible();
  await expect(page.locator('.atlas-timeline-empty')).toContainText(/no events yet/i);
});

test('timeline route renders a dot per event element', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'world b');

  // Create three events via the elements sidebar.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  for (const name of ['first event', 'second event', 'third event']) {
    await page.click('[data-action="create-element"]');
    await page.fill('input[name="element-name"]', name);
    await page.click('.atlas-create-type-btn[data-type="event"]');
    await page.click('[data-modal="create-element"] [data-action="create"]');
    await expect(page.locator('.atlas-row[data-element-id]', { hasText: name })).toBeVisible();
  }

  // The middle defaults to timeline for an active world with no selection;
  // navigate to the bare worldId hash to clear any element selection and
  // confirm three event dots render.
  await page.evaluate(() => {
    const hash = window.location.hash;
    const m = hash.match(/#\/w\/([^/]+)/);
    if (m) window.location.hash = `#/w/${m[1]}`;
  });
  await expect(page.locator('.atlas-timeline')).toBeVisible();
  await expect(page.locator('.atlas-timeline-dot')).toHaveCount(3);
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
  // Middle defaults to timeline post-activation; the [+ Event] button lives
  // in the timeline header (timeline.ts), so it's already on-page.

  await page.click('[data-action="new-event"]');
  await expect(page.locator('[data-modal="create-element"]')).toBeVisible();

  // The type should be pre-selected to 'event'.
  await expect(page.locator('.atlas-create-type-btn[data-type="event"].active')).toBeVisible();

  await page.fill('input[name="element-name"]', 'battle of pelennor');
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);

  // After create, the URL navigates to the element detail (default behavior).
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/element\/[0-9a-f-]+$/);
});
