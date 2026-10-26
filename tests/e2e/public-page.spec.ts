/**
 * A linked world's public page (Skeld 2026-10-23): Settings'
 * OnlyWorlds tab reads keel's `GET /world` live and, when the owner turned the
 * page on, offers "View its public page" at `/w/<slug>` (else the world id).
 * Off, the tab says nothing about it. keel routed as it answers on 2026-10-23
 * (`public_page: { on, ... }` beside `slug`).
 */

import { test, expect, Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_e2e0publicpage0token000000000000000000';
const WORLD_ID = '55555555-6666-4777-8888-999999999999';
const KEY = 'ow_w_' + 'Q'.repeat(32);

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('public-page-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

/** keel with the page `on`, and a slug or none; `page.on` can change between reads. */
async function mockKeel(page: Page, state: { on: boolean; slug: string | null }) {
  const now = '2026-10-23T00:00:00.000Z';
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: [
        { id: WORLD_ID, name: 'Open Abbey', role: 'owner', public_read: false, keys: [] },
      ] } });
    }
    if (path === `/account/worlds/${WORLD_ID}/keys` && req.method() === 'POST') {
      return route.fulfill({ status: 201, json: { id: 'k-1', last4: KEY.slice(-4), scope: 'WRITE', name: '', revoked: false, key: KEY } });
    }
    if (path === '/me') return route.fulfill({ json: { role: 'owner' } });
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: {
        id: WORLD_ID, name: 'Open Abbey', updated_at: now, slug: state.slug,
        public_page: { on: state.on, palette: null, hero: '', sections: [], pin: null, index: false },
      } });
    }
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
}

async function signInAndOpen(page: Page) {
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.account_token = token;
    reg.account_username = 'e2e-owner';
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, TOKEN);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.locator(`[data-remote-world-id="${WORLD_ID}"]`).click();
  const where = page.locator('[data-modal="where-ask"]');
  await expect(where).toBeVisible();
  await where.locator('input[name="where"][value="browser"]').check();
  await where.locator('[data-action="go"]').click();
  await expect.poll(() => page.evaluate((id) => {
    const st = (window as any).__atlasTestApi.getState();
    return st.registry.worlds.find((x: any) => x.api?.world_id === id)?.api?.api_key ?? null;
  }, WORLD_ID)).toBe(KEY);
  // The door ends at Home: wait for it, or its landing takes the address the tab was given.
  await expect(page.getByText('What do you have?')).toBeVisible();
}

const openTab = (page: Page) =>
  page.evaluate(() => { window.location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/settings/onlyworlds`; });

test('a world whose page is on: the tab links to it by its slug, then by its id', async ({ page }) => {
  const state = { on: true, slug: 'open-abbey' as string | null };
  await boot(page);
  await mockKeel(page, state);
  await signInAndOpen(page);
  await openTab(page);
  const link = page.locator('[data-role="public-page"] a[data-public-page]');
  await expect(link).toHaveText('View its public page');
  await expect(link).toHaveAttribute('href', 'https://www.onlyworlds.com/w/open-abbey');
  await expect(link).toHaveAttribute('target', '_blank');

  state.slug = null;
  await page.evaluate(() => { window.location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/home`; });
  await openTab(page);
  await expect(link).toHaveAttribute('href', `https://www.onlyworlds.com/w/${WORLD_ID}`);
});

test('a world whose page is off: the tab says nothing about one', async ({ page }) => {
  await boot(page);
  await mockKeel(page, { on: false, slug: 'open-abbey' });
  await signInAndOpen(page);
  let worldReads = 0;
  page.on('request', (r) => { if (/\/api\/v2\/world\/?$/.test(new URL(r.url()).pathname)) worldReads++; });
  await openTab(page);
  await expect(page.locator('.atlas-settings h3', { hasText: 'Waypoints' })).toBeVisible();
  await expect.poll(() => worldReads).toBeGreaterThan(0);
  await expect(page.locator('[data-role="public-page"]')).toBeHidden();
  await expect(page.locator('a[data-public-page]')).toHaveCount(0);
});
