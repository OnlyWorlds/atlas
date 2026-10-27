/**
 * The `#/open/<world id>` door through the real page: a
 * world page's Open in Atlas opens that world on the signed-in account, after
 * the person says Open; a copy already here opens without a second key; signed
 * out, the id waits for the sign-in in Settings; a world not on the account's
 * list, or a truncated id, is said. keel's account routes and the element
 * lists are routed (the mint follows keel's rule, as account-mode.spec.ts).
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_e2e0open00token0000000000000000000000000';
const ID = '33333333-4444-4555-8666-777777777777';
const OTHER_ID = '44444444-5555-4666-8777-888888888888';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupAtlasRoot(page: Page) {
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('open-door-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

interface Keel { mints: number; lists: number }

async function mockKeel(page: Page): Promise<Keel> {
  const keel: Keel = { mints: 0, lists: 0 };
  const now = '2026-10-16T00:00:00.000Z';
  await page.route(`${V2}/**`, async (route: Route) => {
    const path = new URL(route.request().url()).pathname.replace('/api/v2', '');
    if (path === '/account') return route.fulfill({ json: { username: 'e2e-owner' } });
    if (path === '/account/worlds') {
      keel.lists++;
      return route.fulfill({ json: { data: [
        { id: ID, name: 'Open Realm', role: 'owner', member_role: null, public_read: false, keys: [] },
      ] } });
    }
    if (path === `/account/worlds/${ID}/keys`) {
      keel.mints++;
      const key = 'ow_w_' + 'M'.repeat(32);
      return route.fulfill({ status: 201, json: { id: 'k-1', last4: key.slice(-4), scope: 'WRITE', name: '', revoked: false, key } });
    }
    if (path === '/world' || path === '/world/') return route.fulfill({ json: { id: ID, name: 'Open Realm', updated_at: now } });
    const type = path.split('/').filter(Boolean)[0];
    const data = type === 'character'
      ? [{ id: 'c0000000-0000-4000-8000-000000000077', type: 'character', name: 'Open Hero', updated_at: now, created_at: now }]
      : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  return keel;
}

async function seedSignIn(page: Page) {
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{"worlds":[]}');
    reg.account_token = token;
    reg.account_username = 'e2e-owner';
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, TOKEN);
}

/** A fresh load of the app at a hash, the way a link from another site arrives. */
async function arriveAt(page: Page, hash: string) {
  await page.goto('about:blank');
  await page.goto('/' + hash);
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
}

function entryFor(page: Page) {
  return page.evaluate((id) => {
    const st = (window as any).__atlasTestApi.getState();
    const w = st.registry.worlds.find((x: any) => x.api?.world_id === id);
    return { found: !!w, localId: w?.id ?? null, active: st.active?.worldId ?? null, elements: st.data.elements.length };
  }, ID);
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

/**
 * With a home folder (Chromium) the where-question follows Open; with none
 * (Firefox) the world lands in this browser, and the toast's click is the
 * only gesture the storage request gets.
 */
async function opensAndReopens(page: Page, folder: boolean) {
  if (folder) await setupAtlasRoot(page);
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await arriveAt(page, `#/open/${ID}`);
  // The id left the address bar before anything else.
  expect(await page.evaluate(() => location.hash)).not.toContain('/open/');
  const ask = page.locator('.ow-toast', { hasText: 'Open "Open Realm", from your worlds on OnlyWorlds?' });
  await expect(ask).toBeVisible();
  expect(keel.mints).toBe(0);
  await ask.locator('.ow-toast-action', { hasText: 'Open' }).click();
  const where = page.locator('[data-modal="where-ask"]');
  if (folder) {
    await expect(where).toContainText('Open Realm');
    await where.locator('input[name="where"][value="browser"]').check();
    await where.locator('[data-action="go"]').click();
  }
  await expect.poll(async () => (await entryFor(page)).elements).toBe(1);
  await expect(where).toHaveCount(0);
  expect(keel.mints).toBe(1);

  // The same link again, into this running tab, from another room:
  // the copy here opens, with no second key and no question.
  await page.evaluate(() => { location.hash = '#/settings/general'; });
  await page.evaluate((id) => { location.hash = `#/open/${id}`; }, ID);
  const entry = await entryFor(page);
  await expect.poll(async () => page.evaluate(() => location.hash)).toBe(`#/w/${entry.localId}`);
  await expect.poll(async () => (await entryFor(page)).active).toBe(entry.localId);
  await expect(page.locator('.ow-toast', { hasText: 'from your worlds on OnlyWorlds?' })).toHaveCount(0);
  expect(keel.mints).toBe(1);

  if (folder) {
    // In another world, a link never moves the person out of it without
    // their click (Kael, 2026-10-16): it asks, and Open it opens.
    await page.click('[data-action="create-local"]');
    await page.fill('input[name="world-name"]', 'Other Desk');
    await page.click('[data-modal="create-world"] [data-action="pick"]');
    await expect.poll(async () => (await entryFor(page)).active).not.toBe(entry.localId);
    const other = (await entryFor(page)).active;
    await page.evaluate((id) => { location.hash = `#/open/${id}`; }, ID);
    const ask = page.locator('.ow-toast', { hasText: 'Open "Open Realm" here?' });
    await expect(ask).toBeVisible();
    expect((await entryFor(page)).active).toBe(other);
    await ask.locator('.ow-toast-action', { hasText: 'Open it' }).click();
    await expect.poll(async () => (await entryFor(page)).active).toBe(entry.localId);
  }

  // Signed out since, the copy here still opens: no sign-in asked for.
  await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    delete reg.account_token;
    delete reg.account_username;
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  // A fresh load opens on no world; the door activates the copy itself.
  await arriveAt(page, `#/open/${ID}`);
  await expect.poll(async () => (await entryFor(page)).active).toBe(entry.localId);
  await expect.poll(async () => (await entryFor(page)).elements).toBe(1);
  await expect(page.locator('.ow-toast', { hasText: 'sign in to Atlas with your OnlyWorlds account' })).toHaveCount(0);
  expect(keel.mints).toBe(1);
}

test('signed in, a world page link opens the world after Open, and again opens the copy here (#104)', async ({ page }) => {
  await opensAndReopens(page, true);
});

test('@firefox signed in, a world page link opens the world after Open, and again opens the copy here (#104)', async ({ page }) => {
  await opensAndReopens(page, false);
});

test('a world not on the signed-in account is said, and nothing is made (#104)', async ({ page }) => {
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await arriveAt(page, `#/open/${OTHER_ID}`);
  await expect(page.locator('.ow-toast', { hasText: 'not among the worlds of e2e-owner on OnlyWorlds' })).toBeVisible();
  expect(keel.lists).toBeGreaterThan(0);
  expect(keel.mints).toBe(0);
});

test('signed out, the link waits for the sign-in in Settings, then asks to open (#104)', async ({ page }) => {
  const keel = await mockKeel(page);
  await arriveAt(page, `#/open/${ID}`);
  await expect(page.locator('.ow-toast', { hasText: 'sign in to Atlas with your OnlyWorlds account' })).toBeVisible();
  await expect(page.locator('input[name="account-login"]')).toBeVisible();
  await page.click('[data-role="account-token-alt"] summary');
  const token = page.locator('input[name="account-token"]');
  await expect(token).toBeVisible();
  expect(keel.lists).toBe(0);
  await token.fill(TOKEN);
  await page.click('[data-action="account-sign-in"]');
  await expect(page.locator('.ow-toast', { hasText: 'Open "Open Realm", from your worlds on OnlyWorlds?' })).toBeVisible();
  // The ask to sign in is answered, so it is gone (Kael's walk, 2026-10-16).
  await expect(page.locator('.ow-toast', { hasText: 'sign in to Atlas with your OnlyWorlds account' })).toHaveCount(0);
  expect(keel.mints).toBe(0);
});

test('a truncated link is said, and the address bar is cleared (#104)', async ({ page }) => {
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await arriveAt(page, `#/open/${ID.slice(0, 20)}`);
  await expect(page.locator('.ow-toast', { hasText: 'This link to open a world is not complete' })).toBeVisible();
  expect(await page.evaluate(() => location.hash)).not.toContain('/open');
  await expect(page.locator('.ow-toast', { hasText: 'from your worlds on OnlyWorlds?' })).toHaveCount(0);
  expect(keel.mints).toBe(0);
});

const SITE = 'https://www.onlyworlds.com/w/';

async function toClipboard(page: Page, text: string) {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.evaluate((t) => navigator.clipboard.writeText(t), text);
}

/** A real paste (Ctrl+V) with nothing focused, the address on the clipboard. */
async function pasteOnPage(page: Page, text: string) {
  await toClipboard(page, text);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await page.keyboard.press('ControlOrMeta+V');
}

test('a pasted site address, outside a text field, goes through the same door (#755)', async ({ page }) => {
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await arriveAt(page, '#/');
  await page.waitForSelector('.atlas-shell');
  await pasteOnPage(page, `Look: ${SITE}${ID}/character/c0000000-0000-4000-8000-000000000077.`);
  await expect(page.locator('.ow-toast', { hasText: 'Open "Open Realm", from your worlds on OnlyWorlds?' })).toBeVisible();
  expect(keel.mints).toBe(0);
  // A world named by its page name is said, and nothing is asked.
  await pasteOnPage(page, `${SITE}open-realm`);
  await expect(page.locator('.ow-toast', { hasText: 'names the world by its page name' })).toBeVisible();
  expect(keel.mints).toBe(0);
});

test('the palette opens a pasted address by the same door, and a field keeps its paste (#755)', async ({ page }) => {
  await setupAtlasRoot(page);
  const keel = await mockKeel(page);
  await seedSignIn(page);
  await arriveAt(page, '#/');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Paste Desk');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect.poll(async () => (await entryFor(page)).active).not.toBeNull();
  await page.keyboard.press('ControlOrMeta+K');
  const input = page.locator('.atlas-cmdk-input, [data-role="cmdk-input"]').first();
  await expect(input).toBeFocused();
  // A paste into the palette's field is the field's: it fills, and the row offers the link.
  await toClipboard(page, `${SITE}${ID}`);
  await input.focus();
  await page.keyboard.press('ControlOrMeta+V');
  await expect(input).toHaveValue(`${SITE}${ID}`);
  const row = page.locator('.atlas-cmdk-row[data-kind="action"]', { hasText: 'Open this link' });
  await expect(row).toBeVisible();
  await expect(page.locator('[data-action="cmdk-see-all"]')).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'from your worlds on OnlyWorlds?' })).toHaveCount(0);
  await page.keyboard.press('Enter');
  await expect(page.locator('.ow-toast', { hasText: 'Open "Open Realm", from your worlds on OnlyWorlds?' })).toBeVisible();
  expect(keel.mints).toBe(0);
});
