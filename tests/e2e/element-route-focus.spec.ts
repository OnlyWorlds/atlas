/**
 * The element page follows the address while a field on it holds focus.
 *
 * The page holds a redraw while someone types in one of its fields (a rebuild would remove the
 * field and commit it half-typed). It held a route change too: Back with a field focused (the
 * mouse's back button moves no focus) drew the old element under the new address, its Delete
 * button included, until focus left. A route change now always redraws, and the focused field is
 * blurred first so its own commit runs (Firefox fires no blur or change for a removed input).
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
    const sub = await root.getDirectoryHandle('route-focus-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'rworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const created = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return created.id;
  }, { type, data });
}

async function go(page: Page, id: string) {
  const w = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate(({ w, id }) => { window.location.hash = `#/w/${w}/element/${id}`; }, { w, id });
}

/** A character, then a zone, in history: Back from the zone goes to the character. */
async function zoneAfterCharacter(page: Page): Promise<string> {
  await setupWorld(page);
  const z = await createElement(page, 'zone', { name: 'Zed Zone' });
  const c = await createElement(page, 'character', { name: 'Other One' });
  await go(page, c);
  await expect(page.locator('[data-role="element-name"]')).toHaveText('Other One');
  await go(page, z);
  await expect(page.locator('[data-role="element-name"]')).toHaveText('Zed Zone');
  return z;
}

for (const tag of ['', ' @firefox']) {
  for (const which of ['checkbox', 'text']) {
    test(`Back with a zone ${which} focused shows the element the address names${tag}`, async ({ page }) => {
      await zoneAfterCharacter(page);
      const sel = which === 'checkbox' ? 'input[data-field="atlas_label_visible"]' : 'input[data-field="atlas_color_text"]';
      const input = page.locator(sel);
      await input.scrollIntoViewIfNeeded();
      await input.focus();
      await page.goBack();
      await expect(page.locator('[data-role="element-name"]')).toHaveText('Other One');
    });
  }

  test(`a value typed but not committed is saved when Back leaves the page${tag}`, async ({ page }) => {
    const z = await zoneAfterCharacter(page);
    const input = page.locator('input[data-field="atlas_color_text"]');
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.fill('#ff0000');
    await page.goBack();
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Other One');
    await expect.poll(() => page.evaluate(async (z) => {
      const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
      return els.find((e: any) => e.id === z)?.atlas_color ?? null;
    }, z)).toBe('#ff0000');
  });

  // Back out of the element room altogether: the room is taken down before the page's own render
  // runs, so the take-down blurs the field itself.
  test(`a value typed but not committed is saved when Back leaves for Home${tag}`, async ({ page }) => {
    await setupWorld(page);
    const z = await createElement(page, 'zone', { name: 'Zed Zone' });
    const w = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
    await page.evaluate((w) => { window.location.hash = `#/w/${w}`; }, w);
    await expect(page.locator('[data-role="element-name"]')).toHaveCount(0);
    await go(page, z);
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Zed Zone');
    const input = page.locator('input[data-field="atlas_color_text"]');
    await input.scrollIntoViewIfNeeded();
    await input.click();
    await input.fill('#00ff00');
    await page.goBack();
    await expect(page.locator('[data-role="element-name"]')).toHaveCount(0);
    await expect.poll(() => page.evaluate(async (z) => {
      const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
      return els.find((e: any) => e.id === z)?.atlas_color ?? null;
    }, z)).toBe('#00ff00');
  });
}
