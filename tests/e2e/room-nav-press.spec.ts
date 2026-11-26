/**
 * A room pressed straight after a new world opens: the room nav settles in (its labels collapse,
 * then a clean pass draws it without them), and a press held across that (a person's press lasts
 * about 100 ms) must still open the room. Before: the clean pass replaced the button under the
 * press, or the collapse slid it away, and the click was lost (Chromium lost 5 of 8 such presses).
 */
import { test, expect, Page } from '@playwright/test';

async function freshWorld(page: Page, dir: string): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    (window as any).__atlasTestApi.setNextDirectory(await root.getDirectoryHandle(name, { create: true }));
  }, dir);
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Pressed World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function pressPagesAfterCreate(page: Page): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await freshWorld(page, `nav-press-${i}`);
    await page.click('.atlas-room-nav-btn[data-room="share"]', { delay: 100 });
    await expect(page.locator('button.atlas-share-new'), `world ${i}`).toBeVisible({ timeout: 3000 });
  }
}

/** A press held on Pages while something else redraws the strip (here a route change to the Data room). */
async function pressAcrossARedraw(page: Page): Promise<void> {
  await freshWorld(page, 'nav-press-redraw');
  await page.waitForTimeout(1500); // the settle-in is done: only the redraw below can move anything
  const box = (await page.locator('.atlas-room-nav-btn[data-room="share"]').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => { location.hash = location.hash.replace(/^#\/w\/([^/]+).*$/, '#/w/$1/import'); });
  await page.waitForTimeout(150);
  await page.mouse.up();
  await expect(page.locator('button.atlas-share-new')).toBeVisible({ timeout: 3000 });
}

test.describe('the room nav after a new world opens', () => {
  test('a press held across a redraw of the strip still opens its room', async ({ page }) => {
    await pressAcrossARedraw(page);
  });
  test('a press held across a redraw of the strip still opens its room @firefox', async ({ page }) => {
    await pressAcrossARedraw(page);
  });
  test('a held press on Pages, straight after Create, opens Pages every time', async ({ page }) => {
    await pressPagesAfterCreate(page);
  });
  test('a held press on Pages, straight after Create, opens Pages every time @firefox', async ({ page }) => {
    await pressPagesAfterCreate(page);
  });
});
