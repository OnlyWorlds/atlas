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
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

async function createLocalWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a local world flips the sidebar to elements mode automatically
  // (S255v3) — wait for the elements body rather than a worlds-list row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('Make Online button is shown in settings for a local-only world', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  await expect(page.locator('[data-action="make-online"]')).toBeVisible();
});

test('Make Online modal opens with both route tabs', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  await page.click('[data-action="make-online"]');

  await expect(page.locator('[data-modal="make-online"]')).toBeVisible();
  await expect(page.locator('[data-route-tab="create"]')).toBeVisible();
  await expect(page.locator('[data-route-tab="link"]')).toBeVisible();
  // Default pane is "create new".
  await expect(page.locator('[data-route-tab="create"]')).toHaveClass(/active/);
  await expect(page.locator('[data-route-pane="create"]')).toBeVisible();
  await expect(page.locator('[data-route-pane="link"]')).toBeHidden();
  // No account yet (S407): where to make one and set its PIN.
  const noAccount = page.locator('[data-route-pane="create"] [data-role="no-account"]');
  await expect(noAccount.locator('a[data-link="signup"]')).toHaveAttribute('href', 'https://www.onlyworlds.com/accounts/signup/');
  await expect(noAccount.locator('a[data-link="set-pin"]')).toHaveAttribute('href', 'https://www.onlyworlds.com/account/settings/pin');

  // Display name defaults to the world's name.
  await expect(page.locator('input[name="create-name"]')).toHaveValue('Sandbox');
});

// The journey's A7 (S427): signed in, the account makes the world, so Make online
// asks no email and says whose account; the PIN alone goes with it.
test('Signed in, Make online asks only the PIN and makes the world on the account', async ({ page }) => {
  const V2 = 'https://www.onlyworlds.com/api/v2';
  let made: unknown = null;
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    if (path === '/account/worlds' && req.method() === 'POST') {
      made = req.postDataJSON();
      return route.fulfill({ status: 201, json: { id: '0e2e0000-0000-4000-8000-0000000000a7', name: 'Sandbox', key: 'ow_w_' + 'a'.repeat(40) } });
    }
    if (path === '/account') return route.fulfill({ json: { username: 'e2e-member', email: null } });
    return route.fulfill({ json: { data: [] } });
  });
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.account_token = 'ow_a_' + 'e'.repeat(40);
    reg.account_username = 'e2e-member';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  await page.click('[data-action="make-online"]');
  const pane = page.locator('[data-route-pane="create"]');
  await expect(pane).toBeVisible();
  await expect(pane.locator('input[name="create-email"]')).toHaveCount(0);
  await expect(pane.locator('[data-role="no-account"]')).toHaveCount(0);
  await expect(pane.locator('[data-role="signed-in"]')).toContainText('e2e-member');
  await pane.locator('input[name="create-pin"]').fill('1234');
  await pane.locator('[data-action="create-submit"]').click();
  await expect(page.locator('[data-modal="make-online"]')).toHaveCount(0, { timeout: 15_000 });
  expect(made).toEqual(expect.objectContaining({ name: 'Sandbox' }));
});

test('Tab switching toggles the active route pane', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
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
  await page.click('[data-settings-tab="world"]');
  await page.click('[data-action="make-online"]');

  // Two cancel buttons (one per pane); the visible pane's button is what we click.
  await page.locator('[data-route-pane="create"] [data-action="cancel"]').click();
  await expect(page.locator('[data-modal="make-online"]')).toHaveCount(0);
});

test('Link route requires api key and pin', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Sandbox');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  await page.click('[data-action="make-online"]');
  await page.click('[data-route-tab="link"]');

  // Both fields empty → click submit → inline error.
  await page.fill('input[name="link-pin"]', '');
  await page.click('[data-action="link-submit"]');
  await expect(page.locator('[data-role="link-error"]')).toBeVisible();
  await expect(page.locator('[data-role="link-error"]')).toContainText(/api key/i);
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
  // The world was left active (in elements mode) before reload, and that
  // state persists across reload (S255v3) — swap back to worlds mode first,
  // then re-open the world via its row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("Already Online")');
  // Now go to settings → World tab. Make-online is hidden for api-linked worlds.
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  await expect(page.locator('[data-action="make-online"]')).toHaveCount(0);
});
