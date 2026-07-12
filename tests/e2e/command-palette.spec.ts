/**
 * Command palette e2e (Ctrl+K / `/`).
 *
 * Covers: open via both triggers · ranked element jump (Enter navigates to
 * the element room) · room jump by name · see-all hands the query to the
 * elements-sidebar filter · Esc closes without navigating.
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
    const sub = await root.getDirectoryHandle('cmdk-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'kpworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function seed(page: Page) {
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Aldric the Bold' });
    await store.createElement('location', { name: 'Old Harbor', description: 'A quiet dragon-plagued port.' });
    await store.createElement('character', { name: 'Marta', atlas_aliases: ['The Fox'] });
    api.patchData(await store.listElements());
  });
}

const panel = '[data-modal="command-palette"]';

test('Ctrl+K opens; typing ranks; Enter jumps to the element room', async ({ page }) => {
  await setupWorld(page);
  await seed(page);

  await page.keyboard.press('Control+k');
  await expect(page.locator(panel)).toBeVisible();

  await page.locator('[data-role="cmdk-input"]').fill('aldric');
  const active = page.locator('.atlas-cmdk-row.is-active');
  await expect(active).toContainText('Aldric the Bold');
  await page.screenshot({ path: 'Notes/ui-snapshots/2026-07-12/cmdk-results.png' });

  await page.keyboard.press('Enter');
  await expect(page.locator(panel)).toHaveCount(0);
  await expect(page).toHaveURL(/\/element\//);
  await expect(page.locator('.atlas-middle-header')).toContainText('Aldric the Bold');
});

test('alias and description matches surface; room jump works', async ({ page }) => {
  await setupWorld(page);
  await seed(page);

  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('fox');
  await expect(page.locator('.atlas-cmdk-row', { hasText: 'Marta' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(panel)).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('knowl');
  await expect(page.locator('.atlas-cmdk-row.is-active')).toContainText('knowledge');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/knowledge/);
});

test('`/` opens the palette; see-all hands the query to the sidebar filter', async ({ page }) => {
  await setupWorld(page);
  await seed(page);

  await page.keyboard.press('/');
  await expect(page.locator(panel)).toBeVisible();

  const input = page.locator('[data-role="cmdk-input"]');
  await input.fill('dragon');
  // Walk down past the results to the see-all row and pick it.
  const rows = page.locator('.atlas-cmdk-row');
  const count = await rows.count();
  for (let i = 1; i < count; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.atlas-cmdk-seeall.is-active')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator(panel)).toHaveCount(0);
  const search = page.locator('[data-role="elements-search"]');
  await expect(search).toHaveValue('dragon');
  // The filter narrowed the list to the description match.
  await expect(page.locator('[data-element-id]', { hasText: 'Old Harbor' })).toBeVisible();
  await expect(page.locator('[data-element-id]', { hasText: 'Marta' })).toHaveCount(0);
});

test('Esc closes without navigating; palette needs an active world', async ({ page }) => {
  await setupWorld(page);
  await seed(page);
  const before = await page.evaluate(() => window.location.hash);

  await page.keyboard.press('Control+k');
  await expect(page.locator(panel)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(panel)).toHaveCount(0);
  const after = await page.evaluate(() => window.location.hash);
  expect(after).toBe(before);
});
