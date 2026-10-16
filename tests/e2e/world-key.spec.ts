/**
 * #198, a linked world takes a new key in place (the Captain's go, 2026-10-16).
 * keel routed as it answers since #357 (Skeld h16 #6018): a key it does not
 * know (a removed member's, a deleted world's) is 401 invalid_credentials with
 * no param; the member's next mint makes a key that works.
 *
 * - Signed in, a refused key is replaced by Atlas itself and the waiting edit
 *   goes up on the new one (#294's walk, P3: a member removed and invited
 *   back kept a copy whose key was gone).
 * - Signed out, Settings, This world takes a pasted key; a key for another
 *   world is refused in the dialog.
 */

import { test, expect, Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_e2e0worldkey0token0000000000000000000000';
const WORLD_ID = '44444444-5555-4666-8777-888888888888';
const FIRST = 'ow_w_' + 'F'.repeat(32);
const SECOND = 'ow_w_' + 'S'.repeat(32);
const PASTED = 'ow_w_' + 'P'.repeat(32);
const OTHER = 'ow_w_' + 'O'.repeat(32);

interface Keel {
  live: Set<string>;
  mints: number;
  created: Array<{ key: string; name: string }>;
  nextMint: string[];
}

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
    api.setNextDirectory(await root.getDirectoryHandle('world-key-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

async function mockKeel(page: Page): Promise<Keel> {
  const keel: Keel = { live: new Set(), mints: 0, created: [], nextMint: [FIRST, SECOND] };
  const now = '2026-10-16T00:00:00.000Z';
  const unknownKey = (route: Route) => route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null } } });
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: [
        { id: WORLD_ID, name: 'Keyed Realm', role: 'collaborator', member_role: 'co_builder', public_read: false, keys: [] },
      ] } });
    }
    if (path === `/account/worlds/${WORLD_ID}/keys` && req.method() === 'POST') {
      keel.mints++;
      const key = keel.nextMint.shift()!;
      keel.live.add(key);
      return route.fulfill({ status: 201, json: { id: `k-${keel.mints}`, last4: key.slice(-4), scope: 'WRITE', name: '', revoked: false, key } });
    }
    const key = req.headers()['api-key'] ?? '';
    if (key === OTHER) {
      return route.fulfill({ json: { id: '99999999-0000-4000-8000-000000000000', name: 'Elsewhere', updated_at: now } });
    }
    if (!keel.live.has(key)) return unknownKey(route);
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: { id: WORLD_ID, name: 'Keyed Realm', updated_at: now } });
    }
    if (req.method() === 'POST') {
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      keel.created.push({ key, name: String(body.name ?? '') });
      return route.fulfill({ status: 201, json: { ...body, updated_at: now, created_at: now } });
    }
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
  return keel;
}

async function signIn(page: Page) {
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.account_token = token;
    reg.account_username = 'e2e-member';
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, TOKEN);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
}

async function openKeyedRealm(page: Page) {
  await page.locator(`[data-remote-world-id="${WORLD_ID}"]`).click();
  const where = page.locator('[data-modal="where-ask"]');
  await expect(where).toBeVisible();
  await where.locator('input[name="where"][value="browser"]').check();
  await where.locator('[data-action="go"]').click();
  await expect.poll(() => worldKey(page)).toBe(FIRST);
}

function worldKey(page: Page): Promise<string | null> {
  return page.evaluate((id) => {
    const st = (window as any).__atlasTestApi.getState();
    return st.registry.worlds.find((x: any) => x.api?.world_id === id)?.api?.api_key ?? null;
  }, WORLD_ID);
}

async function addAndPush(page: Page, name: string) {
  await page.evaluate(async (n) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    await store.createElement('character', { name: n });
    const { getCurrentSyncEngine } = await import('/src/sync/sync-attach.ts' as string);
    await getCurrentSyncEngine()?.pushOnce();
  }, name);
}

test.beforeEach(async ({ page }) => {
  await boot(page);
});

test('signed in, a key keel no longer knows is replaced in place, and the waiting edit goes up on the new one (#198, P3)', async ({ page }) => {
  const keel = await mockKeel(page);
  await signIn(page);
  await openKeyedRealm(page);

  // Removed and invited back: keel forgot the first key.
  keel.live.delete(FIRST);
  await addAndPush(page, 'Written while away');

  await expect(page.locator('.ow-toast', { hasText: 'so Atlas made a new one from your account' })).toBeVisible();
  await expect.poll(() => worldKey(page)).toBe(SECOND);
  expect(keel.mints).toBe(2);
  // The fresh engine flushes what waited, on the new key.
  await expect.poll(() => keel.created).toEqual([{ key: SECOND, name: 'Written while away' }]);
  await expect(page.locator('.ow-toast', { hasText: /unlink/i })).toHaveCount(0);
});

test('signed out, a refused key says its cause, and Settings, This world takes a pasted one in place', async ({ page }) => {
  const keel = await mockKeel(page);
  await signIn(page);
  await openKeyedRealm(page);
  // Sign out: Atlas can no longer make a key itself.
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = { ...api.getState().registry, account_token: undefined };
    api.patchSlice('registry', reg);
  });
  keel.live.delete(FIRST);
  await addAndPush(page, 'Kept here');
  await expect(page.locator('.ow-toast', { hasText: 'OnlyWorlds no longer knows this world\'s key' })).toBeVisible();
  expect(keel.mints).toBe(1);

  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate((id) => { location.hash = `#/w/${id}/settings/world`; }, worldId);
  const keyLine = page.locator('[data-role="key-line"]');
  await expect(keyLine).toContainText('ends in FFFF');
  await expect(page.locator('[data-action="make-new-key"]')).toHaveCount(0);

  await page.click('[data-action="put-new-key"]');
  const dialog = page.locator('[data-modal="new-world-key"]');
  await dialog.locator('input[name="world-key"]').fill(OTHER);
  await dialog.locator('[data-action="use-key"]').click();
  await expect(dialog.locator('[data-role="error"]')).toContainText('That key is for another world, "Elsewhere"');
  expect(await worldKey(page)).toBe(FIRST);

  keel.live.add(PASTED);
  await dialog.locator('input[name="world-key"]').fill(PASTED);
  await dialog.locator('[data-action="use-key"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'has a new key. Sync is on again.' })).toBeVisible();
  await expect.poll(() => worldKey(page)).toBe(PASTED);
  await expect(keyLine).toContainText('ends in PPPP');
  // The edit made while the key was dead goes up on the pasted key: nothing was unlinked.
  await expect.poll(() => keel.created).toEqual([{ key: PASTED, name: 'Kept here' }]);
});
