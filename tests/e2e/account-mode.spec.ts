/**
 * Account mode — UI surfaces (session 260).
 *
 * Covers what a network-free e2e CAN honestly assert: the settings sign-in
 * block's states, the sidebar "On OnlyWorlds" section's gating, and the
 * offline-first law (a dead token never blocks local worlds). The full
 * mint → download open flow runs against a real backend in Captain's smoke
 * (and ran live against a local fake keel during the build, 2026-07-13);
 * the fetch/diff logic is vitest territory (account-worlds integration).
 *
 * The seeded token here is well-formed but bogus: the list fetch fails
 * (401 online, network-error offline) and either way the section renders
 * its quiet error state without touching local rendering.
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

async function setupAtlasRoot(page: Page, dirName: string = 'account-mode-root') {
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
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

const BOGUS_TOKEN = 'ow_a_e2e0bogus0token0000000000000000000000000';

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('signed out: settings shows the paste field, sidebar shows no remote section', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('input[name="account-token"]')).toBeVisible();
  await expect(page.locator('[data-action="account-sign-in"]')).toBeVisible();
  await expect(page.locator('.atlas-remote-worlds')).toBeEmpty();
});

test('the Account section says which way to sign in and where the PIN comes from (#282)', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('[data-role="account-lead"]')).toContainText('Sign in with an account token');
  // One sign-in, first: the token's field stands above the PIN and the email.
  const order = await page.evaluate(() => {
    const at = (sel: string) => document.querySelector(sel)!.getBoundingClientRect().top;
    return [at('input[name="account-token"]'), at('input[name="pin"]'), at('input[name="email"]')];
  });
  expect(order[0]).toBeLessThan(order[1]);
  expect(order[1]).toBeLessThan(order[2]);
  const pinHint = page.locator('[data-role="pin-hint"]');
  await expect(pinHint).toContainText('One PIN for all your worlds.');
  await expect(pinHint).toContainText('under World PIN');
  await expect(pinHint.locator('a[data-link="account-settings"]')).toHaveAttribute('href', 'https://www.onlyworlds.com/account/settings');
  await expect(page.locator('[data-role="email-hint"]')).toContainText('Make online asks for it');
});

test('sign-in rejects a token without the ow_a_ prefix inline, without storing it', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="open-settings"]');
  await page.fill('input[name="account-token"]', 'not-a-token');
  await page.click('[data-action="account-sign-in"]');
  await expect(page.locator('[data-role="account-token-error"]')).toBeVisible();
  await expect(page.locator('[data-role="account-token-error"]')).toContainText(/ow_a_/);
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas_worlds_registry')!).account_token ?? null
  );
  expect(stored).toBeNull();
});

test('offline-first: a dead seeded token shows the quiet section error and never blocks local worlds', async ({ page }) => {
  await setupAtlasRoot(page);
  await createLocalWorld(page, 'Local Anchor');
  // Seed a signed-in state the way sign-in would have stored it.
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.account_token = token;
    reg.account_username = 'e2e-probe';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, BOGUS_TOKEN);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  // The local world renders regardless of the account fetch's fate.
  await expect(page.locator('.atlas-row[data-world-id]:has-text("Local Anchor")')).toBeVisible();
  // The section resolves to its quiet error state (401 online / network
  // error offline — either way rows stay empty and the error box renders).
  await expect(page.locator('.atlas-remote-error')).toBeVisible({ timeout: 15_000 });
  // Settings reflects the seeded sign-in with the forget affordance.
  await page.click('[data-action="open-settings"]');
  await expect(page.locator('.atlas-account-status')).toContainText('e2e-probe');
  await expect(page.locator('[data-action="account-forget"]')).toBeVisible();
});

test('forget drops the token and the remote section disappears', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.account_token = token;
    reg.account_username = 'e2e-probe';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, BOGUS_TOKEN);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-action="account-forget"]');
  await expect(page.locator('input[name="account-token"]')).toBeVisible();
  await expect(page.locator('.atlas-remote-worlds')).toBeEmpty();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('atlas_worlds_registry')!).account_token ?? null
  );
  expect(stored).toBeNull();
});
