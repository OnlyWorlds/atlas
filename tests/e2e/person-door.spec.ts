/**
 * The `#/join/` door for a person's code (keel #294's Atlas half; keel #212):
 * keel's /join page sends a person here with "Open in Atlas". The preview's
 * `reader: 'person'` turns the door: a person joins with their own account at
 * POST /account/join (never the agent route), then the world opens on a key
 * made for the member (#199). Signed out, the code waits through the sign-in
 * in Settings. keel's routes are mocked with page.route; the agent door's own
 * spec is `join-door.spec.ts`.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const WORLD_ID = '44444444-5555-4666-8777-888888888888';
const CODE = 'ow_j_' + 'P'.repeat(32);
const TOKEN = 'ow_a_e2e0person0token0000000000000000000000000';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
}

interface Keel { agentJoins: number; personJoins: Array<{ body: unknown; auth: string | null }>; mints: Array<Record<string, unknown>> }

async function mockKeel(page: Page, opts: { refuse?: boolean } = {}): Promise<Keel> {
  const now = '2026-10-15T00:00:00.000Z';
  const keel: Keel = { agentJoins: 0, personJoins: [], mints: [] };
  let joined = false;
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    if (path === '/join/preview') {
      return route.fulfill({ json: {
        reader: 'person', world: { name: 'Moppetopia', description: '' },
        invited_by: 'tmo', owner_character: 'Admiral Fluffington', role: 'contributor',
        with_character: false, expires_at: '2099-01-01T00:00:00Z',
      } });
    }
    if (path === '/join') {
      // A person's code at the agent route: keel's one 404.
      keel.agentJoins++;
      return route.fulfill({ status: 404, json: { error: { type: 'not_found', code: 'not_found', message: 'This join code is not valid.', param: null } } });
    }
    if (path === '/account') {
      return route.fulfill({ json: { id: 'u-p', username: 'e2e-person', email: '', date_joined: null } });
    }
    if (path === '/account/join') {
      const auth = req.headers()['authorization'] ?? null;
      keel.personJoins.push({ body: req.postDataJSON(), auth });
      // keel: the account token first (401), then the code (one 404 for any that will not open).
      if (auth !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Invalid account token.', param: null } } });
      if (opts.refuse) return route.fulfill({ status: 404, json: { error: { type: 'not_found', code: 'not_found', message: 'This join code is not valid.', param: null } } });
      joined = true;
      return route.fulfill({ status: 201, json: { id: 'g-1', world_id: WORLD_ID, world_name: 'Moppetopia', role: 'contributor', joined_at: now, roster_character: null } });
    }
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: joined
        ? [{ id: WORLD_ID, name: 'Moppetopia', role: 'collaborator', member_role: 'contributor', public_read: false, keys: [] }]
        : [] } });
    }
    if (path === `/account/worlds/${WORLD_ID}/keys`) {
      keel.mints.push((req.postDataJSON() ?? {}) as Record<string, unknown>);
      const key = 'ow_w_' + 'Q'.repeat(32);
      return route.fulfill({ status: 201, json: { id: 'k', last4: 'QQQQ', scope: 'WRITE', name: '', revoked: false, key } });
    }
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: { id: WORLD_ID, name: 'Moppetopia', updated_at: now } });
    }
    const type = path.split('/').filter(Boolean)[0];
    const data = type === 'character'
      ? [{ id: 'c0000000-0000-4000-8000-000000000077', type: 'character', name: 'Admiral Fluffington', updated_at: now, created_at: now }]
      : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  return keel;
}

async function seedSignIn(page: Page) {
  await page.evaluate(({ token }) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{"version":1,"worlds":[]}');
    reg.account_token = token;
    reg.account_username = 'e2e-person';
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, { token: TOKEN });
}

async function answerWhere(page: Page) {
  const where = page.locator('[data-modal="where-ask"]');
  await expect(where).toBeVisible();
  await where.locator('input[name="where"][value="browser"]').check();
  await where.locator('[data-action="go"]').click();
}

test('a person code, signed in: Join accepts it with the account, and the world opens on a key made for the member', async ({ page }) => {
  await freshBoot(page);
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);

  const modal = page.locator('[data-modal="person-join"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-role="world-name"]')).toHaveText('Moppetopia');
  await expect(modal.locator('[data-role="role"]')).toHaveText('You join as a contributor: you can see everything in this world and change what you create.');
  await expect(modal.locator('[data-role="account"]')).toContainText('(e2e-person)');
  // The agent dialog never opens for a person's code.
  await expect(page.locator('[data-modal="join-world"]')).toHaveCount(0);
  expect(keel.personJoins).toHaveLength(0);

  await modal.locator('[data-action="join"]').click();
  await expect(modal).toHaveCount(0);
  expect(keel.personJoins).toEqual([{ body: { code: CODE }, auth: `Bearer ${TOKEN}` }]);
  expect(keel.agentJoins).toBe(0);

  await answerWhere(page);
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(1);
  expect(keel.mints).toHaveLength(1);
  const entry = await page.evaluate((id) => {
    const w = (window as any).__atlasTestApi.getState().registry.worlds.find((x: any) => x.api?.world_id === id);
    return { found: !!w, seat: w?.api?.seat ?? null, readOnly: !!w?.api?.read_only };
  }, WORLD_ID);
  expect(entry).toEqual({ found: true, seat: null, readOnly: false });
  expect(page.url()).not.toContain(CODE);
});

test('a person code, signed out: it waits through the sign-in, then the invitation opens again', async ({ page }) => {
  await freshBoot(page);
  const keel = await mockKeel(page);
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);

  const modal = page.locator('[data-modal="person-join"]');
  await expect(modal.locator('[data-role="account"]')).toContainText('Sign in to Atlas with your OnlyWorlds account first');
  await modal.locator('[data-action="sign-in"]').click();
  await expect(modal).toHaveCount(0);
  expect(keel.personJoins).toHaveLength(0);
  expect(keel.agentJoins).toBe(0);
  expect(page.url()).not.toContain(CODE);

  // Settings, OnlyWorlds: the token, Sign in, and the invitation is back.
  await expect(page.locator('input[name="account-login"]')).toBeVisible();
  await page.click('[data-role="account-token-alt"] summary');
  const tokenInput = page.locator('input[name="account-token"]');
  await expect(tokenInput).toBeVisible();
  const ask = page.locator('.ow-toast', { hasText: 'Sign in under Account with your OnlyWorlds account' });
  await expect(ask).toBeVisible();
  await tokenInput.fill(TOKEN);
  await page.click('[data-action="account-sign-in"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-action="join"]')).toBeVisible();
  // The ask to sign in is answered, so it is gone (Kael's walk on the open door, h57 #5950).
  await expect(ask).toHaveCount(0);
  expect(keel.personJoins).toHaveLength(0);
});

test('a person code keel refuses: the refused line, and nothing opens', async ({ page }) => {
  await freshBoot(page);
  const keel = await mockKeel(page, { refuse: true });
  await seedSignIn(page);
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);
  const modal = page.locator('[data-modal="person-join"]');
  await modal.locator('[data-action="join"]').click();
  await expect(modal.locator('[data-role="error"]')).toHaveText('This link was already used or has expired. Ask for a new link.');
  await expect(modal.locator('[data-action="join"]')).toBeHidden();
  await expect(page.locator('[data-modal="where-ask"]')).toHaveCount(0);
  expect(keel.personJoins).toHaveLength(1);
  expect(keel.mints).toHaveLength(0);
});

test('joined, then the where-question cancelled: a toast keeps the way in, and Open it opens the world', async ({ page }) => {
  await freshBoot(page);
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);
  await page.locator('[data-modal="person-join"] [data-action="join"]').click();
  const where = page.locator('[data-modal="where-ask"]');
  await expect(where).toBeVisible();
  await where.locator('[data-action="cancel"]').click();
  const toast = page.locator('.ow-toast', { hasText: 'You are a member of Moppetopia now.' });
  await expect(toast).toBeVisible();
  expect(keel.mints).toHaveLength(0);
  await toast.getByRole('button', { name: 'Open it' }).click();
  await answerWhere(page);
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(1);
  expect(keel.personJoins).toHaveLength(1);
  expect(keel.mints).toHaveLength(1);
});
