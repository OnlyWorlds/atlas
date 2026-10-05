/**
 * Real Firefox (S366). Until now the only non-Chromium coverage was a
 * Chromium page with `showDirectoryPicker` deleted (tour.spec's
 * "Safari-shaped" boot). These run in the `firefox` and `firefox-private`
 * projects (playwright.config.ts) and nowhere else.
 *
 *   @firefox  the landing offers the tour and says why there is no folder
 *             door; the tour makes its world in browser storage and reaches
 *             the consul beat.
 *   @private  a private window refuses browser storage (getDirectory throws
 *             SecurityError), so the landing says so in one plain line and
 *             offers no door that would stall. Before S366 the tour started
 *             and stopped at its first create with the raw error.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
}

test('@firefox the landing offers the tour, and the tour builds its world in browser storage', async ({ page }) => {
  await boot(page);
  await expect(page.locator('[data-action="start-tour"]')).toBeVisible();
  await expect(page.locator('[data-action="setup-atlas"]')).toHaveCount(0);
  await expect(page.locator('.atlas-landing-note')).toContainText('Chromium');

  await page.click('[data-action="start-tour"]');
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toHaveAttribute('data-tour-step', '2');
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(bar).toHaveAttribute('data-tour-step', '3');
  await page.locator('[data-action="create-element"]').click();
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await expect(page.locator('.atlas-element-name').first()).toContainText('The Consul');
});

test('@private a private window says why there is no tour, and offers no door that would stall', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.atlas-landing-note')).toContainText('does not allow browser storage, so no world can live in this browser here');
  await expect(page.locator('[data-action="start-tour"]')).toHaveCount(0);
  // Any other door into the tour refuses with the same line.
  const refused = await page.evaluate(async () => {
    const engine = await import('/src/tour/tour-engine.ts');
    try { await (engine as any).launchTour(); return 'started'; } catch (e) { return String((e as Error).message); }
  });
  expect(refused).toContain('does not allow browser storage, so no world can live in this browser here');
});
