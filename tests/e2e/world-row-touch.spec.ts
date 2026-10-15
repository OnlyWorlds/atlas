/**
 * #303, from the Captain's own phone (Boss h11 #4777, #4792): the world row
 * was a control (`role="button"`) holding the star and sync buttons, axe's
 * nested-interactive; and with the Worlds drawer open, the update banner
 * covered the drawer's footer row. The row's name is now its one button, and
 * the banner rises above the footer while the drawer is open.
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

async function makeWorld(page: Page, name: string): Promise<void> {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a world flips the sidebar into elements mode (S255v3).
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** Two worlds in one home folder, the sidebar back on the worlds list (the phase4-elements recipe). */
async function twoWorlds(page: Page): Promise<void> {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('world-row-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await makeWorld(page, 'rowone');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await makeWorld(page, 'rowtwo');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await expect(page.locator('.atlas-sidebar .atlas-row[data-world-id]')).toHaveCount(2);
}

test('a world row holds no control inside a control, and its name opens it from the keyboard', async ({ page }) => {
  await twoWorlds(page);
  const nested = await page.evaluate(() => {
    const out: string[] = [];
    for (const c of document.querySelectorAll('.atlas-sidebar [data-world-id] button, .atlas-sidebar [data-world-id] a')) {
      const outer = c.parentElement?.closest('button, a, [role="button"], [tabindex="0"]');
      if (outer && outer.closest('.atlas-sidebar')) out.push(`${c.getAttribute('data-role') ?? c.className} in ${outer.className}`);
    }
    return out;
  });
  expect(nested).toEqual([]);

  const other = page.locator('.atlas-sidebar .atlas-row[data-world-id]', { hasText: 'rowone' });
  const id = await other.getAttribute('data-world-id');
  await other.locator('[data-role="open-world"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction((wid) => (window as any).__atlasTestApi.getState().active?.worldId === wid, id);
});

test.describe('on a phone', () => {
  test.use({ hasTouch: true });

  test('the update banner clears the open drawer\'s footer row', async ({ page }) => {
    await twoWorlds(page);
    await page.setViewportSize({ width: 412, height: 839 });
    await page.locator('.atlas-room-nav-drawer-btn').first().tap();
    await expect(page.locator('.atlas-sidebar-footer')).toBeVisible();
    await page.evaluate(async () => {
      const m = await import('/src/core/reload-offer.ts');
      m.showReloadBanner('A new version of Atlas is ready.', true, () => {});
    });
    const banner = page.locator('.atlas-update-banner');
    await expect(banner).toBeVisible();
    const b = (await banner.boundingBox())!;
    const f = (await page.locator('.atlas-sidebar-footer').boundingBox())!;
    expect(b.y + b.height).toBeLessThanOrEqual(f.y);
  });
});
