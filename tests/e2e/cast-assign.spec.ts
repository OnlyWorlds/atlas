/**
 * Cast assignment mode e2e (session 252's last wave; test-locked session 254).
 *
 * The flow: a home ghost card ("choose a protagonist" / "choose a home")
 * enters `ui.castAssign` — the elements sidebar shows the assign banner and
 * the NEXT click on a matching row assigns the world favorite, toasts, and
 * returns home where the cast card now stands. The × on the banner cancels.
 * A mismatched-type click falls through to a normal element open.
 *
 * Spans: world-home.ts (ghost click) + elements-sidebar.ts (banner +
 * row-click interception) + registry favorites.
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
    const sub = await root.getDirectoryHandle('cast-assign-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'castworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'castworld' })).toBeVisible();
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

async function goHome(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}`;
  });
  await expect(page.locator('.atlas-home-cast')).toBeVisible();
}

async function favorites(page: Page): Promise<{ protagonist_id?: string; nexus_id?: string } | undefined> {
  return await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.registry.worlds.find((w: any) => w.id === s.active.worldId)?.favorites;
  });
}

test('ghost card → banner → character click assigns the protagonist and returns home', async ({ page }) => {
  await setupWorld(page);
  const heroId = await createElement(page, 'character', { name: 'Ostana' });
  await createElement(page, 'location', { name: 'Vell Harbor' });
  await goHome(page);

  // Both slots unset + candidates exist → two ghosts.
  await page.locator('.atlas-home-cast-ghost', { hasText: 'choose a protagonist' }).click();

  // Assignment mode: sidebar flips to elements, banner states the next click.
  const banner = page.locator('.atlas-cast-assign-banner');
  await expect(banner).toHaveAttribute('data-active', 'true');
  await expect(page.locator('.atlas-cast-assign-label')).toHaveText('Click a character to set your protagonist');

  await page.locator(`[data-element-id="${heroId}"]`).click();

  // Assigned + mode cleared + back home with the real card (ghost gone for this kind).
  await expect(banner).toHaveAttribute('data-active', 'false');
  await expect(page.locator('.atlas-home-cast-card:not(.atlas-home-cast-ghost)', { hasText: 'Ostana' })).toBeVisible();
  expect((await favorites(page))?.protagonist_id).toBe(heroId);
});

test('home ghost assigns a location as the world home', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'character', { name: 'Ostana' });
  const homeId = await createElement(page, 'location', { name: 'Vell Harbor' });
  await goHome(page);

  await page.locator('.atlas-home-cast-ghost', { hasText: 'choose a home' }).click();
  await expect(page.locator('.atlas-cast-assign-label')).toHaveText('Click a location to set your home');

  await page.locator(`[data-element-id="${homeId}"]`).click();

  await expect(page.locator('.atlas-home-cast-card:not(.atlas-home-cast-ghost)', { hasText: 'Vell Harbor' })).toBeVisible();
  expect((await favorites(page))?.nexus_id).toBe(homeId);
});

test('banner × cancels; a mismatched-type click falls through to a normal open', async ({ page }) => {
  await setupWorld(page);
  const heroId = await createElement(page, 'character', { name: 'Ostana' });
  const homeId = await createElement(page, 'location', { name: 'Vell Harbor' });
  await goHome(page);

  // Cancel path: enter the mode, × exits it, nothing assigned.
  await page.locator('.atlas-home-cast-ghost', { hasText: 'choose a protagonist' }).click();
  const banner = page.locator('.atlas-cast-assign-banner');
  await expect(banner).toHaveAttribute('data-active', 'true');
  await page.locator('.atlas-cast-assign-off').click();
  await expect(banner).toHaveAttribute('data-active', 'false');
  expect((await favorites(page))?.protagonist_id).toBeFalsy();

  // Fall-through path: protagonist mode, but the user clears the filter and
  // clicks a LOCATION — normal element open, mode stays armed.
  await goHome(page);
  await page.locator('.atlas-home-cast-ghost', { hasText: 'choose a protagonist' }).click();
  // Clear the type filter the ghost applied (the user can do this via the strip).
  await page.locator('.atlas-filter-btn[data-filter-type="character"].active').click();
  await page.locator(`[data-element-id="${homeId}"]`).click();
  await expect(page).toHaveURL(new RegExp(`element/${homeId}`));
  // Mode is still armed (fall-through does not consume it) and the favorite is untouched.
  expect((await favorites(page))?.protagonist_id).toBeFalsy();
  void heroId;
});
