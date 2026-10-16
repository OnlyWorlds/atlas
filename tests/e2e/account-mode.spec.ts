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

interface SharedKeel { mints: Array<Record<string, unknown>>; revokes: string[] }

async function mockSharedKeel(page: Page, opts: { memberRole: 'contributor' | 'guest'; accountHasPin: boolean }): Promise<SharedKeel> {
  const keel: SharedKeel = { mints: [], revokes: [] };
  const now = '2026-10-15T00:00:00.000Z';
  await page.route(`${V2}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v2', '');
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: [
        { id: SHARED_ID, name: 'Shared Realm', role: 'collaborator', member_role: opts.memberRole, public_read: false, keys: [] },
      ] } });
    }
    const revoke = path.match(new RegExp(`^/account/worlds/${SHARED_ID}/keys/([^/]+)$`));
    if (revoke && route.request().method() === 'DELETE') {
      keel.revokes.push(revoke[1]);
      return route.fulfill({ status: 204, body: '' });
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

test('a member whose account has no PIN opens to read, and is never asked for one (#199, #294 walk)', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockSharedKeel(page, { memberRole: 'contributor', accountHasPin: false });
  await signInWith(page, null);
  await openSharedRow(page);
  await expect.poll(async () => (await sharedEntry(page)).elements).toBe(1);
  // The write mint is refused (409 pin_required), then a read key; no question in between.
  expect(keel.mints.map(m => m.scope ?? 'write')).toEqual(['write', 'read']);
  await expect(page.locator('[data-modal="pin-prompt"]')).toHaveCount(0);
  expect(keel.revokes).toEqual([]);
  expect(await sharedEntry(page)).toMatchObject({ found: true, readOnly: true, pin: null });
  await expect(page.locator('.ow-toast', { hasText: 'needs a PIN on your account' })).toBeVisible();
});

test('a member whose account has a PIN, none saved here, is asked after the key is made, and the PIN is kept', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockSharedKeel(page, { memberRole: 'contributor', accountHasPin: true });
  await signInWith(page, null);
  await openSharedRow(page);
  const prompt = page.locator('[data-modal="pin-prompt"]');
  await expect(prompt.locator('[data-role="context"]')).toContainText('shared with you');
  expect(keel.mints).toHaveLength(1);
  // The loading overlay stands aside for the question.
  await expect(page.locator('[data-role="loading-overlay"]')).toBeHidden();
  await prompt.locator('input[name="pin"]').fill('4242');
  await prompt.locator('[data-action="confirm"]').click();
  await expect.poll(async () => (await sharedEntry(page)).elements).toBe(1);
  expect(keel.mints).toHaveLength(1);
  expect(keel.revokes).toEqual([]);
  expect(await sharedEntry(page)).toMatchObject({ found: true, readOnly: false, pin: '4242' });
});

test('a member who cancels the PIN question opens nothing, and the key made for them is taken back', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockSharedKeel(page, { memberRole: 'contributor', accountHasPin: true });
  await signInWith(page, null);
  await openSharedRow(page);
  const prompt = page.locator('[data-modal="pin-prompt"]');
  await expect(prompt).toBeVisible();
  await prompt.locator('[data-action="cancel"]').click();
  await expect.poll(() => keel.revokes).toEqual(['k-1']);
  await expect(page.locator('[data-role="loading-overlay"]')).toHaveCount(0);
  expect(await sharedEntry(page)).toMatchObject({ found: false });
});

// ---- The first screen offers a signed-in account's worlds (S414) ----
// A browser with no world and no home folder shows the landing, which has no
// sidebar: signed in, the account's worlds are listed under its doors.

async function seedTokenOnLanding(page: Page, token: string) {
  await page.evaluate((t) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{"worlds":[]}');
    reg.account_token = t;
    reg.account_username = 'e2e-member';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, token);
  await page.reload();
  await page.waitForSelector('.atlas-landing-compact');
}

test('signed out, the first screen lists no account worlds (S414)', async ({ page }) => {
  await expect(page.locator('.atlas-landing-compact')).toBeVisible();
  await expect(page.locator('[data-role="landing-worlds"]')).toBeHidden();
});

test('signed in, the first screen lists the account worlds and a row opens one (S414)', async ({ page }) => {
  await mockSharedKeel(page, { memberRole: 'contributor', accountHasPin: true });
  await seedTokenOnLanding(page, TOKEN);
  const row = page.locator(`[data-landing-world-id="${SHARED_ID}"]`);
  await expect(row).toBeVisible();
  await expect(row).toContainText('Shared Realm');
  await expect(row.locator('.atlas-world-state-chip')).toHaveText('shared');
  await expect(page.locator('.atlas-landing-worlds-head')).toHaveText('Your worlds on OnlyWorlds');
  await row.click();
  const where = page.locator('[data-modal="where-ask"]');
  await expect(where).toBeVisible();
  await where.locator('input[name="where"][value="browser"]').check();
  await where.locator('[data-action="go"]').click();
  const prompt = page.locator('[data-modal="pin-prompt"]');
  await prompt.locator('input[name="pin"]').fill('4242');
  await prompt.locator('[data-action="confirm"]').click();
  await expect.poll(async () => (await sharedEntry(page)).elements).toBe(1);
  await expect(page.locator('.atlas-landing-compact')).toHaveCount(0);
});

test('the list arriving repaints only its block: the landing stays the same page (S414)', async ({ page }) => {
  // Mark the first screen before the list comes, then look again after: a
  // whole re-render would restart the sigil and undo the storage probe's edits.
  let release!: () => void;
  const gate = new Promise<void>(r => { release = r; });
  await page.route(`${V2}/account/worlds`, async (route) => {
    await gate;
    await route.fulfill({ json: { data: [
      { id: SHARED_ID, name: 'Shared Realm', role: 'collaborator', member_role: 'guest', public_read: false, keys: [] },
    ] } });
  });
  await seedTokenOnLanding(page, TOKEN);
  await expect(page.locator('.atlas-landing-worlds-head')).toBeVisible();
  await page.evaluate(() => { (document.querySelector('.atlas-landing-sigil') as any).__mark = 1; });
  release();
  await expect(page.locator(`[data-landing-world-id="${SHARED_ID}"]`)).toBeVisible();
  expect(await page.evaluate(() => (document.querySelector('.atlas-landing-sigil') as any)?.__mark ?? null)).toBe(1);
});

test('a notify leaves a focused row focused: the rows are not rebuilt (S414 gate H1)', async ({ page }) => {
  await mockSharedKeel(page, { memberRole: 'guest', accountHasPin: true });
  await seedTokenOnLanding(page, TOKEN);
  const row = page.locator(`[data-landing-world-id="${SHARED_ID}"]`);
  await row.focus();
  await page.evaluate(() => { (document.activeElement as any).__mark = 1; });
  // Any state change notifies every subscriber; this one changes nothing the landing shows.
  await page.evaluate(() => (window as any).__atlasTestApi.patchSlice('busy', false));
  await page.evaluate(() => (window as any).__atlasTestApi.patchSlice('busy', false));
  expect(await page.evaluate(() => (document.activeElement as any)?.__mark ?? null)).toBe(1);
});

test('a token keel refuses on the first screen says so and offers Settings, not a retry; the doors stay (S414)', async ({ page }) => {
  await page.route(`${V2}/account/worlds`, route => route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Invalid token.', param: null } } }));
  await seedTokenOnLanding(page, BOGUS_TOKEN);
  await expect(page.locator('.atlas-landing-worlds-error')).toContainText('Account token not recognized');
  await expect(page.locator('[data-role="landing-worlds-retry"]')).toHaveCount(0);
  await expect(page.locator('[data-action="start-world"]')).toBeVisible();
  await page.locator('[data-role="landing-worlds-settings"]').click();
  // The account block, where the dead token is forgotten and a new one pasted.
  await expect(page.locator('[data-action="account-forget"]')).toBeVisible();
});

test('a list that failed for another reason offers Try again, and Try again asks again (S414)', async ({ page }) => {
  let calls = 0;
  await page.route(`${V2}/account/worlds`, (route) => {
    calls++;
    if (calls === 1) return route.fulfill({ status: 503, json: { error: { type: 'api_error', code: 'unavailable', message: 'Down.', param: null } } });
    return route.fulfill({ json: { data: [
      { id: SHARED_ID, name: 'Shared Realm', role: 'collaborator', member_role: 'guest', public_read: false, keys: [] },
    ] } });
  });
  await seedTokenOnLanding(page, TOKEN);
  await page.locator('[data-role="landing-worlds-retry"]').click();
  await expect(page.locator(`[data-landing-world-id="${SHARED_ID}"]`)).toBeVisible();
  expect(calls).toBe(2);
});

async function signInFromSettings(page: Page) {
  await page.route(`${V2}/account`, route => route.fulfill({ json: { username: 'e2e-member', email: null } }));
  await page.evaluate(() => { location.hash = '#/settings/onlyworlds'; });
  await page.fill('input[name="account-token"]', TOKEN);
  await page.click('[data-action="account-sign-in"]');
  await expect(page.locator('.ow-toast', { hasText: 'Signed in as e2e-member' })).toBeVisible();
}

test('signing in on a browser with no world points at the first screen, which lists the worlds (S414)', async ({ page }) => {
  await mockSharedKeel(page, { memberRole: 'guest', accountHasPin: true });
  await signInFromSettings(page);
  const toast = page.locator('.ow-toast', { hasText: 'listed on the first screen' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Show them' }).click();
  await expect(page.locator(`[data-landing-world-id="${SHARED_ID}"]`)).toBeVisible();
});

test('signing in with an account that has no worlds promises no list (S414 gate M2)', async ({ page }) => {
  await page.route(`${V2}/account/worlds`, route => route.fulfill({ json: { data: [] } }));
  await signInFromSettings(page);
  await page.waitForFunction(() => (window as any).__atlasTestApi.getState().accountWorlds.status === 'ready');
  await page.waitForTimeout(300);
  await expect(page.locator('.ow-toast', { hasText: 'listed on the first screen' })).toHaveCount(0);
});

test('signing in where a world already is says nothing of the first screen (S414)', async ({ page }) => {
  await setupAtlasRoot(page);
  await mockSharedKeel(page, { memberRole: 'guest', accountHasPin: true });
  await signInFromSettings(page);
  await page.waitForFunction(() => (window as any).__atlasTestApi.getState().accountWorlds.status === 'ready');
  await page.waitForTimeout(300);
  await expect(page.locator('.ow-toast', { hasText: 'listed on the first screen' })).toHaveCount(0);
});
