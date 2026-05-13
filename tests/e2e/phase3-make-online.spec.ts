/**
 * Phase 3 — Make-Online modal UI surface.
 *
 * Verifies the modal opens from settings, has both routes (create + link),
 * tab switching works, validation surfaces inline. Full network flow runs
 * in Captain's manual smoke (Bout I); see also the make-online vitest
 * integration tests for the underlying helpers.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    await (window as any).__atlasTestApi.resetAll();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupAtlasRoot(page: Page, dirName: string = 'make-online-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createLocalWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('Make Online button is shown in settings for a local-only world', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
});

test('Make Online modal opens with both route tabs', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-action="make-online"]');

  await expect(page.locator('[data-modal="make-online"]')).toBeVisible();
  await expect(page.locator('[data-route-tab="create"]')).toBeVisible();
  await expect(page.locator('[data-route-tab="link"]')).toBeVisible();
  // Default pane is "create new".
  await expect(page.locator('[data-route-tab="create"]')).toHaveClass(/active/);
  await expect(page.locator('[data-route-pane="create"]')).toBeVisible();
  await expect(page.locator('[data-route-pane="link"]')).toBeHidden();

  // Display name defaults to the world's name.
  await expect(page.locator('input[name="create-name"]')).toHaveValue('Sandbox');
});

test('Tab switching toggles the active route pane', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-action="make-online"]');

  await page.click('[data-route-tab="link"]');
  await expect(page.locator('[data-route-tab="link"]')).toHaveClass(/active/);
  await expect(page.locator('[data-route-tab="create"]')).not.toHaveClass(/active/);
  await expect(page.locator('[data-route-pane="link"]')).toBeVisible();
  await expect(page.locator('[data-route-pane="create"]')).toBeHidden();

  // Link route has the policy radios.
  await expect(page.locator('input[name="link-policy"][value="b"]')).toBeChecked();
  await expect(page.locator('input[name="link-policy"][value="c"]')).not.toBeChecked();
});

test('Cancel button closes the modal without side-effects', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-action="make-online"]');

  // Two cancel buttons (one per pane); the visible pane's button is what we click.
  await page.locator('[data-route-pane="create"] [data-action="cancel"]').click();
  await expect(page.locator('[data-modal="make-online"]')).toHaveCount(0);
});

test('Link route requires api key and pin', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-action="make-online"]');
  await page.click('[data-route-tab="link"]');

  // Both fields empty → click submit → inline error.
  await page.fill('input[name="link-pin"]', '');
  await page.click('[data-action="link-submit"]');
  await expect(page.locator('[data-role="link-error"]')).toBeVisible();
  await expect(page.locator('[data-role="link-error"]')).toContainText('api key');
});

test('Make Online button is hidden for an already-api-linked world', async ({ page }) => {
  // Create a local world, then mark it api-linked in the registry (no real
  // server attach — we just want the UI branch). This is a UI-only assertion.
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Already Online');
  await page.evaluate(() => {
    const raw = localStorage.getItem('atlas_worlds_registry')!;
    const reg = JSON.parse(raw);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: 'fake-server-id', api_key: 'fake-key' };
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  // Re-open the world (silent auto-activate from URL hash isn't set; click it).
  await page.click('.atlas-row[data-world-id]:has-text("Already Online")');
  // Now go to settings. Mode-elements is active after click; the gear is in
  // the sidebar footer.
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('[data-action="make-online"]')).toHaveCount(0);
});
