/**
 * Sign in with OnlyWorlds end to end (Keel #515, S465; contract
 * `Forge/Notes/2026-10-24-s465-sign-in-with-onlyworlds-contract.md`). The real
 * SDK runs against the production constants: Playwright serves
 * `https://atlas.onlyworlds.com` from the dev server, and plays keel's
 * answering page (a 302 back with the state the SDK sent) and its token
 * exchange. Asserts the button only on that origin, the token kept, the route
 * resumed, a door reopened, a cancel said, and the exchange as the first
 * request to keel after the return.
 */
import { test, expect, type Page } from '@playwright/test';

const ORIGIN = 'https://atlas.onlyworlds.com';
const CALLBACK = `${ORIGIN}/signin/callback`;
const LOCAL = 'http://localhost:3045';

interface Keel { tokenBodies: Array<Record<string, unknown>>; keelOrder: string[] }

async function serveAtlasAtItsOrigin(page: Page, answer: 'code' | 'cancel'): Promise<Keel> {
  const keel: Keel = { tokenBodies: [], keelOrder: [] };
  // Everything else at keel answers empty, so nothing waits on a real server.
  await page.route('https://www.onlyworlds.com/**', async (route) => {
    keel.keelOrder.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[]}' });
  });
  await page.route('https://www.onlyworlds.com/signin/authorize**', async (route) => {
    const q = new URL(route.request().url()).searchParams;
    expect(q.get('client_id')).toBe('atlas');
    expect(q.get('redirect_uri')).toBe(CALLBACK);
    const back = answer === 'code' ? `code=c0de-465&state=${q.get('state')}` : `error=access_denied&state=${q.get('state')}`;
    // keel answers with a 302; a redirect a route fulfils is followed outside the
    // routes (to the real host), so the stand-in sends the page back by script.
    await route.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(`${CALLBACK}?${back}`)})</script>` });
  });
  await page.route('https://www.onlyworlds.com/api/v2/auth/token', async (route) => {
    keel.keelOrder.push('POST /api/v2/auth/token');
    keel.tokenBodies.push(JSON.parse(route.request().postData() ?? '{}'));
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'ow_a_minted465', token_id: '5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d', token_type: 'bearer', account: { id: 'acc-1', username: 'wren' } }) });
  });
  await page.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    // The edge's rewrite: the return address is the app (public/_redirects).
    const path = url.pathname === '/signin/callback' ? '/' : url.pathname;
    const res = await route.fetch({ url: `${LOCAL}${path}${url.search}` });
    await route.fulfill({ response: res });
  });
  return keel;
}

async function boot(page: Page, hash: string): Promise<void> {
  await page.goto(`${ORIGIN}/${hash}`);
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

test('the button is not offered off its registered origin', async ({ page }) => {
  await page.goto('/#/settings/onlyworlds');
  await page.waitForSelector('[data-role="account-password-form"]');
  await expect(page.locator('[data-action="sign-in-onlyworlds"]')).toHaveCount(0);
});

test('Settings: signed in with no password typed, back on the same route, the exchange first', async ({ page }) => {
  const keel = await serveAtlasAtItsOrigin(page, 'code');
  await boot(page, '#/settings/onlyworlds');
  await page.locator('[data-action="sign-in-onlyworlds"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Signed in as wren' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
  expect(new URL(page.url()).search).toBe('');
  expect(new URL(page.url()).hash).toBe('#/settings/onlyworlds');
  const reg = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry);
  expect(reg.account_token).toBe('ow_a_minted465');
  expect(reg.account_token_id).toBe('5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d'); // kept so Forget can revoke it (S475)
  expect(reg.account_username).toBe('wren');
  expect(keel.tokenBodies).toHaveLength(1);
  expect(keel.tokenBodies[0]).toMatchObject({ grant_type: 'authorization_code', code: 'c0de-465', client_id: 'atlas', redirect_uri: CALLBACK });
  expect(keel.keelOrder[0]).toBe('POST /api/v2/auth/token');
  // The settings block flips to signed in, and the button is gone (R8).
  await expect(page.locator('[data-action="sign-in-onlyworlds"]')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('atlas-signin-resume'))).toBeNull();
});

test('cancelled on onlyworlds.com: said as a cancel, nothing kept, back on the same route', async ({ page }) => {
  const keel = await serveAtlasAtItsOrigin(page, 'cancel');
  await boot(page, '#/settings/onlyworlds');
  await page.locator('[data-action="sign-in-onlyworlds"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Sign in with OnlyWorlds was cancelled' })).toBeVisible();
  expect(new URL(page.url()).hash).toBe('#/settings/onlyworlds');
  expect(keel.tokenBodies).toHaveLength(0);
  const reg = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry);
  expect(reg.account_token ?? null).toBeNull();
  await expect(page.locator('[data-action="sign-in-onlyworlds"]')).toBeVisible();
});

test('New world on OnlyWorlds comes back open, signed in', async ({ page }) => {
  await serveAtlasAtItsOrigin(page, 'code');
  await boot(page, '#/');
  await page.locator('[data-door="other-ways-in"]').first().click();
  await page.locator('[data-choice="new-api"]').click();
  const modal = page.locator('.atlas-create-api-panel');
  await expect(modal.locator('[data-action="sign-in-onlyworlds"]')).toBeVisible();
  await modal.locator('[data-action="sign-in-onlyworlds"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Signed in as wren' })).toBeVisible();
  const back = page.locator('.atlas-create-api-panel');
  await expect(back).toBeVisible();
  await expect(back.locator('[data-action="sign-in-onlyworlds"]')).toHaveCount(0);
  await expect(back.locator('input[name="signin-password"]')).toHaveCount(0);
});

// A sign-in that returns over a token Atlas minted (another tab signed in meanwhile) lets the old
// one go: revoked by the id recorded beside it, with the old token as its bearer, once the new one
// is kept (2026-10-26; conv. 179). The sign-in is started from the module, since a signed-in
// Settings offers no button.
test('a sign-in over a token Atlas minted revokes the old one by its id', async ({ page }) => {
  const keel = await serveAtlasAtItsOrigin(page, 'code');
  const revokes: Array<{ path: string; auth: string | null }> = [];
  await page.route('https://www.onlyworlds.com/api/v2/account/tokens/**', async (route) => {
    revokes.push({ path: new URL(route.request().url()).pathname, auth: route.request().headers()['authorization'] ?? null });
    await route.fulfill({ status: 204, body: '' });
  });
  await boot(page, '#/settings/onlyworlds');
  await page.evaluate(() => {
    const reg = { ...(window as any).__atlasTestApi.getState().registry };
    reg.account_token = 'ow_a_OLDERTABTOKEN1';
    reg.account_token_id = '0f1e2d3c-4b5a-4968-8776-655443322110';
    reg.account_token_id_tail = reg.account_token.slice(-8);
    reg.account_username = 'wren';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const m = await import('/src/sync/onlyworlds-sign-in.ts');
    await m.beginOnlyWorldsSignIn({ hash: '#/settings/onlyworlds' });
  });
  await expect(page.locator('.ow-toast', { hasText: 'Signed in as wren' })).toBeVisible();
  await expect.poll(() => revokes.length).toBe(1);
  expect(revokes[0]).toEqual({ path: '/api/v2/account/tokens/0f1e2d3c-4b5a-4968-8776-655443322110', auth: 'Bearer ow_a_OLDERTABTOKEN1' });
  const reg = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry);
  expect(reg.account_token).toBe('ow_a_minted465');
  expect(reg.account_token_id).toBe('5a4b3c2d-1e0f-4a9b-8c7d-6e5f4a3b2c1d');
  expect(keel.tokenBodies).toHaveLength(1);
});
