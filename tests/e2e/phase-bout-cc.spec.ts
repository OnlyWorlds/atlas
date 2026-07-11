/**
 * Bout CC — Sidebar tabs + selection UX + instant-feel world switch.
 *
 * Tests:
 *   1. Right tab shows world name (not "elements").
 *   2. Right tab hidden when no world is active (covered in phase4-elements
 *      via toHaveCount(0); reasserted here in the BoutCC context).
 *   3. Gear toggles Settings open/close.
 *   4. Gear-close restores selected element if there was one.
 *   5. Right-tab click from settings restores selected element if there was one.
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

async function setupAtlasRoot(page: Page, dirName: string = 'bout-cc-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

test.describe('Bout CC — sidebar toggle + gear + selection UX', () => {
  test('right tab label is the active world name (not "elements")', async ({ page }) => {
    await freshBoot(page);
    await setupAtlasRoot(page);
    await createWorld(page, 'Middle-earth');

    // After createWorld, the new world is active. The right tab should show
    // its name. The Worlds tab always shows "worlds".
    const worldsBtn = page.locator('[data-action="mode-worlds"]');
    const rightBtn = page.locator('[data-action="mode-elements"]');
    await expect(worldsBtn).toContainText('Worlds');
    await expect(rightBtn).toContainText('Middle-earth');
  });

  test('right tab is hidden when no world is active', async ({ page }) => {
    await freshBoot(page);
    // Pre-root the whole sidebar header is silent (S255v3) — the toggle only
    // exists once an atlas root is set. Set one up (no world) so the test's
    // real subject — no right tab without an active world — is observable.
    await setupAtlasRoot(page);
    await expect(page.locator('[data-action="mode-elements"]')).toHaveCount(0);
    await expect(page.locator('[data-action="mode-worlds"]')).toBeVisible();
  });

  test('gear toggles settings open and closed', async ({ page }) => {
    await freshBoot(page);
    await setupAtlasRoot(page);
    await createWorld(page, 'world c');
    // Switch to elements mode (state-driven since session 223 decoupling).
    await page.click('[data-action="mode-elements"]');
    await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveClass(/active/);

    // Open settings.
    await page.click('[data-action="open-settings"]');
    await expect(page.locator('.atlas-settings')).toBeVisible();
    expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings/);

    // Click gear again → closes settings. With no element selection set,
    // gear-toggle falls back to the world's home URL (session 223: was
    // /elements). Sidebar mode stays as the user left it (elements).
    await page.click('[data-action="open-settings"]');
    await expect(page.locator('.atlas-settings')).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).toMatch(/#\/w\/[0-9a-f-]+$/);
    await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveClass(/active/);
  });

  test('gear-close restores selected element when one was set', async ({ page }) => {
    await freshBoot(page);
    await setupAtlasRoot(page);
    await createWorld(page, 'world d');
    await page.click('[data-action="mode-elements"]');

    // Create an element so we have a selection.
    await page.click('[data-action="create-element"]');
    await page.fill('input[name="element-name"]', 'Bilbo');
    await page.click('[data-modal="create-element"] [data-action="create"]');
    // Wait for modal close + URL to update to /element/<id> (creation is async).
    await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);
    await expect.poll(async () => await page.evaluate(() => window.location.hash))
      .toMatch(/\/element\/[0-9a-f-]+$/);
    const elementHash = await page.evaluate(() => window.location.hash);

    // Open settings — URL flips away.
    await page.click('[data-action="open-settings"]');
    expect(await page.evaluate(() => window.location.hash)).toMatch(/\/settings/);

    // Close settings via gear — should restore the element URL.
    await page.click('[data-action="open-settings"]');
    await expect(page.locator('.atlas-settings')).toHaveCount(0);
    expect(await page.evaluate(() => window.location.hash)).toBe(elementHash);
    // Middle pane shows the element again.
    await expect(page.locator('.atlas-middle-header h2')).toContainText('Bilbo');
  });

  test('right-tab click from settings only changes sidebar mode (decoupled)', async ({ page }) => {
    await freshBoot(page);
    await setupAtlasRoot(page);
    await createWorld(page, 'world e');
    await page.click('[data-action="mode-elements"]');

    await page.click('[data-action="create-element"]');
    await page.fill('input[name="element-name"]', 'Frodo');
    await page.click('[data-modal="create-element"] [data-action="create"]');
    // Wait for modal close + URL to update to /element/<id> (creation is async).
    await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);
    await expect.poll(async () => await page.evaluate(() => window.location.hash))
      .toMatch(/\/element\/[0-9a-f-]+$/);

    // Open settings.
    await page.click('[data-action="open-settings"]');
    const settingsHash = await page.evaluate(() => window.location.hash);
    expect(settingsHash).toMatch(/\/settings/);

    // Session 223 decoupling: sidebar mode toggle clicks no longer navigate
    // the URL. Clicking mode-elements from settings just confirms elements
    // mode; URL stays on settings until the user uses gear or room nav to
    // leave settings. Selected element is preserved in state.
    await page.click('[data-action="mode-elements"]');
    expect(await page.evaluate(() => window.location.hash)).toBe(settingsHash);
    await expect(page.locator('.atlas-mode-btn[data-action="mode-elements"]')).toHaveClass(/active/);
  });
});
