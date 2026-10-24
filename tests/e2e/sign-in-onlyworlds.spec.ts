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
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ token: 'ow_a_minted465', token_type: 'bearer', account: { id: 'acc-1', username: 'wren' } }) });
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
