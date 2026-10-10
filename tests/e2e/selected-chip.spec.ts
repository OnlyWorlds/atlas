/**
 * #175 (found S387 by the #139 e2e): the selected chip's × on an element page
 * cleared the selection, but the route still named the element and selected
 * it straight back, so the chip never left. On an element page × now leaves
 * the page the way Esc does (conv. 32, home); elsewhere it clears in place.
 */
import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page): Promise<{ worldId: string; heroId: string }> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('chip-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Chip World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  return page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const hero = await store.createElement('character', { name: 'Hero' });
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId as string, heroId: hero.id as string };
  });
}

const chip = (page: Page) => page.locator('.atlas-room-nav-selected');

test("on an element page the chip's × clears the selection and it stays clear", async ({ page }) => {
  const { worldId, heroId } = await setupWorld(page);
  await page.evaluate(([w, h]) => { location.hash = `#/w/${w}/element/${h}`; }, [worldId, heroId]);
  await expect(chip(page)).toContainText('Hero');

  await chip(page).locator('[data-action="clear-selection"]').click();
  await expect(chip(page)).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
  // It used to come straight back on the next render: give it one.
  await page.waitForTimeout(500);
  await expect(chip(page)).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().ui.selectedElementId)).toBeNull();
});

test('on an element page Esc clears the selection and it stays clear (conv. 32)', async ({ page }) => {
  const { worldId, heroId } = await setupWorld(page);
  await page.evaluate(([w, h]) => { location.hash = `#/w/${w}/element/${h}`; }, [worldId, heroId]);
  await expect(chip(page)).toContainText('Hero');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur()); // focus off any field
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(new RegExp(`#/w/${worldId}$`));
  await page.waitForTimeout(500);
  await expect(chip(page)).toHaveCount(0);
});

test("in another room the chip's × clears the selection and stays in the room", async ({ page }) => {
  const { worldId, heroId } = await setupWorld(page);
  await page.evaluate(([w, h]) => { location.hash = `#/w/${w}/element/${h}`; }, [worldId, heroId]);
  await expect(chip(page)).toContainText('Hero');
  await page.evaluate((w) => { location.hash = `#/w/${w}/settings`; }, worldId);
  await expect(chip(page)).toContainText('Hero'); // the selection outlives the room change
  const before = page.url();

  await chip(page).locator('[data-action="clear-selection"]').click();
  await expect(chip(page)).toHaveCount(0);
  expect(page.url()).toBe(before);
});
