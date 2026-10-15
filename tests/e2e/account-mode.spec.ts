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

import { test, expect, Page, type Route } from '@playwright/test';

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

// ---- A shared world opens like an owned one (#199) ----
// keel's account routes and the world's element lists, routed: the mint follows
// keel's rule (accounts/api.py mint_world_key, membership.mint_member_key): a
// member's key is their own, `{scope:'read'}` mints a read key, and a member's
// write key needs an account PIN (409 pin_required).

const V2 = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_e2e0shared0token000000000000000000000000';
const SHARED_ID = '33333333-4444-4555-8666-777777777777';

interface SharedKeel { mints: Array<Record<string, unknown>> }

async function mockSharedKeel(page: Page, opts: { memberRole: 'contributor' | 'guest'; accountHasPin: boolean }): Promise<SharedKeel> {
  const keel: SharedKeel = { mints: [] };
  const now = '2026-10-15T00:00:00.000Z';
  await page.route(`${V2}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v2', '');
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: [
        { id: SHARED_ID, name: 'Shared Realm', role: 'collaborator', member_role: opts.memberRole, public_read: false, keys: [] },
      ] } });
    }
    if (path === `/account/worlds/${SHARED_ID}/keys`) {
      const body = (route.request().postDataJSON() ?? {}) as Record<string, unknown>;
      keel.mints.push(body);
      const read = body.scope === 'read';
      if (!read && !opts.accountHasPin) {
        return route.fulfill({ status: 409, json: { error: { type: 'invalid_request', code: 'pin_required', message: 'Set an account PIN first.', param: null } } });
      }
      const key = (read ? 'ow_r_' : 'ow_w_') + 'M'.repeat(32);
      return route.fulfill({ status: 201, json: { id: 'k-1', last4: key.slice(-4), scope: read ? 'READ' : 'WRITE', name: '', revoked: false, key } });
    }
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: { id: SHARED_ID, name: 'Shared Realm', updated_at: now } });
    }
    const type = path.split('/').filter(Boolean)[0];
    const data = type === 'character'
      ? [{ id: 'c0000000-0000-4000-8000-000000000099', type: 'character', name: 'Shared Hero', updated_at: now, created_at: now }]
      : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  return keel;
}

async function signInWith(page: Page, pin: string | null) {
  await page.evaluate(({ token, pin }) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.account_token = token;
    reg.account_username = 'e2e-member';
    if (pin) reg.pin = pin;
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, { token: TOKEN, pin });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
}

async function openSharedRow(page: Page) {
  await page.locator(`[data-remote-world-id="${SHARED_ID}"]`).click();
  const where = page.locator('[data-modal="where-ask"]');
  await expect(where).toBeVisible();
  await where.locator('input[name="where"][value="browser"]').check();
  await where.locator('[data-action="go"]').click();
}

async function sharedEntry(page: Page) {
  return page.evaluate((id) => {
    const st = (window as any).__atlasTestApi.getState();
    const w = st.registry.worlds.find((x: any) => x.api?.world_id === id);
    return { found: !!w, readOnly: !!w?.api?.read_only, pin: st.registry.pin ?? null, elements: st.data.elements.length };
  }, SHARED_ID);
}

test('a contributor opens a shared world on a write key made for them, no paste (#199)', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockSharedKeel(page, { memberRole: 'contributor', accountHasPin: true });
  await signInWith(page, '4242');
  await openSharedRow(page);
  await expect.poll(async () => (await sharedEntry(page)).elements).toBe(1);
  expect(keel.mints).toHaveLength(1);
  expect(keel.mints[0].scope).toBeUndefined();
  const entry = await sharedEntry(page);
  expect(entry).toMatchObject({ found: true, readOnly: false, pin: '4242' });
  await expect(page.locator('.ow-toast', { hasText: 'As a contributor in Shared Realm' })).toBeVisible();
  // The old door's paste dialog never opens.
  await expect(page.locator('[data-modal="link-world"]')).toHaveCount(0);
});

test('a guest opens a shared world to read, with no PIN asked (#199)', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockSharedKeel(page, { memberRole: 'guest', accountHasPin: true });
  await signInWith(page, null);
  await openSharedRow(page);
  await expect.poll(async () => (await sharedEntry(page)).elements).toBe(1);
  await expect(page.locator('[data-modal="pin-prompt"]')).toHaveCount(0);
  expect(keel.mints).toEqual([expect.objectContaining({ scope: 'read' })]);
  expect(await sharedEntry(page)).toMatchObject({ found: true, readOnly: true, pin: null });
  await expect(page.locator('.ow-toast', { hasText: 'you are a guest in it' })).toBeVisible();
});

test('a member whose account has no PIN opens to read, and the PIN they typed is not kept (#199)', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockSharedKeel(page, { memberRole: 'contributor', accountHasPin: false });
  await signInWith(page, null);
  await openSharedRow(page);
  const prompt = page.locator('[data-modal="pin-prompt"]');
  await expect(prompt.locator('[data-role="context"]')).toContainText('shared with you');
  await prompt.locator('input[name="pin"]').fill('4242');
  await prompt.locator('[data-action="confirm"]').click();
  await expect.poll(async () => (await sharedEntry(page)).elements).toBe(1);
  // The write mint is refused (409 pin_required), then a read key.
  expect(keel.mints.map(m => m.scope ?? 'write')).toEqual(['write', 'read']);
  expect(await sharedEntry(page)).toMatchObject({ found: true, readOnly: true, pin: null });
  await expect(page.locator('.ow-toast', { hasText: 'needs a PIN on your account' })).toBeVisible();
});
