/**
 * A finger's target on the first screen (#948): on a phone the line of links
 * under the doors (Watch how it works, Other ways in) answers a thumb over
 * at least 44 px, centred on the words, without taking a press from the door
 * above it. Hit-tested down each link's middle, the way a thumb lands.
 */

import { test, expect, type Page } from '@playwright/test';

test.use({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });

async function freshBoot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForSelector('.atlas-landing-more-link');
}

/** The y values down the target's middle whose topmost element is inside it, 40 px either side of its box. */
async function strip(page: Page, selector: string): Promise<{ top: number; bottom: number; on: number[] }> {
  return page.evaluate((sel) => {
    const target = document.querySelector(sel)!;
    const box = target.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const on: number[] = [];
    for (let y = Math.floor(box.top) - 40; y <= Math.ceil(box.bottom) + 40; y++) {
      const el = document.elementFromPoint(x, y);
      if (el && target.contains(el)) on.push(y);
    }
    return { top: box.top, bottom: box.bottom, on };
  }, selector);
}

test('the first screen\'s links answer a thumb over 44 px, centred on their words', async ({ page }) => {
  await freshBoot(page);
  for (const action of ['start-tour', 'other-ways-in']) {
    const s = await strip(page, `.atlas-landing-more-link[data-action="${action}"]`);
    expect(s.on.length, `${action}: strip`).toBeGreaterThanOrEqual(44);
    // One run of rows, reaching both sides of the words.
    expect(Math.max(...s.on) - Math.min(...s.on) + 1, `${action}: contiguous`).toBe(s.on.length);
    expect(s.top - Math.min(...s.on), `${action}: above`).toBeGreaterThanOrEqual(10);
    expect(Math.max(...s.on) - s.bottom, `${action}: below`).toBeGreaterThanOrEqual(10);
  }
  // The demo door above keeps every row of its own.
  const door = await strip(page, '.atlas-landing-btn[data-action="try-demo"]');
  expect(door.on.length).toBeGreaterThanOrEqual(Math.floor(door.bottom - door.top));
});

test('a tap above Other ways in\'s words opens the ways in', async ({ page }) => {
  await freshBoot(page);
  const box = (await page.locator('[data-action="other-ways-in"]').boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y - 10);
  await expect(page.locator('[data-modal="add-world"]')).toBeVisible();
});
