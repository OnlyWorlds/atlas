/**
 * The owner's world from onlyworlds.com's Open in Atlas, with no PIN asked at opening (1.125.0, 2026-11-22, R2
 * and R3), through the real page: one named question, no PIN prompt, the world linked with no PIN kept,
 * Home's keep-safe card and the sidebar's chip saying it does not save to OnlyWorlds yet, the pill's Add
 * PIN, the first change said once, the World PIN dialog refusing a wrong PIN with nothing sent, and the
 * right one saving what waited. keel is played as it answers today: a keyless 404 for a private world,
 * `/me` proving a PIN with write scope, a 401 naming `API-Pin` for a wrong one.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_e2e0pinlater0token00000000000000000000';
const ID = '9a5bcca3-fa04-4580-b083-2649c9751d19';
const NAME = 'Tangle ground';
const PIN = '4242';
const KEY = 'ow_w_' + 'L'.repeat(32);

interface Keel { mints: number; mePins: Array<string | null>; writes: Array<{ call: string; pin: string | null; name?: unknown }> }

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function playKeel(page: Page): Promise<Keel> {
  const keel: Keel = { mints: 0, mePins: [], writes: [] };
  const now = '2026-11-22T00:00:00.000Z';
  // 25 characters: past the keep-safe card's threshold, so Home says where the world is kept.
  const characters = Array.from({ length: 25 }, (_, i) => ({
    id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`, type: 'character', name: `Walker ${i}`, updated_at: now, created_at: now,
  }));
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v2', '');
    const headers = req.headers();
    const pin = headers['api-pin'] ?? null;
    if (!headers['api-key'] && !headers['authorization'] && url.searchParams.get('world')) {
      return route.fulfill({ status: 404, headers: { 'Cache-Control': 'no-store' }, json: { error: { type: 'not_found', code: 'not_found', message: 'World not found.', param: null } } });
    }
    if (path === '/account') return route.fulfill({ json: { username: 'e2e-owner' } });
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: [{ id: ID, name: NAME, role: 'owner', member_role: null, public_read: false, keys: [] }] } });
    }
    if (path === `/account/worlds/${ID}/keys`) {
      keel.mints++;
      return route.fulfill({ status: 201, json: { id: 'k-1', last4: KEY.slice(-4), scope: 'WRITE', name: '', revoked: false, key: KEY } });
    }
    if (path === '/me' || path === '/me/') {
      keel.mePins.push(pin);
      if (pin && pin !== PIN) return route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' } } });
      return route.fulfill({ json: { world: { id: ID, name: NAME }, scope: 'write', kind: 'owner', role: 'owner', membership: null, character: null } });
    }
    if (path === '/members' || path === '/members/') return route.fulfill({ json: { data: [{ id: null, kind: 'owner', role: 'owner', character: null, status: 'active' }] } });
    if (req.method() !== 'GET') {
      // keel checks the PIN on every write.
      const body = req.postDataJSON?.() ?? {};
      const bulk = path.startsWith('/bulk') ? (body.items ?? []) as Array<{ element: { id: string; name?: unknown } }> : null;
      for (const one of bulk ?? [body]) keel.writes.push({ call: `${req.method()} ${path}`, pin, name: bulk ? (one as { element: { name?: unknown } }).element?.name : (one as { name?: unknown }).name });
      if (pin !== PIN) return route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Incorrect PIN.', param: 'API-Pin' } } });
      // keel's /bulk answer: a slot per item, its stamps echoed.
      if (bulk) return route.fulfill({ json: { errors: false, items: bulk.map(it => ({ status: 201, id: it.element.id, created_at: now, updated_at: now })) } });
      return route.fulfill({ status: req.method() === 'POST' ? 201 : 200, json: { ...body, id: body.id ?? path.split('/').filter(Boolean)[1], updated_at: now, created_at: now } });
    }
    if (path === '/world' || path === '/world/') return route.fulfill({ json: { id: ID, name: NAME, updated_at: now } });
    const type = path.split('/').filter(Boolean)[0];
    return route.fulfill({ json: { data: type === 'character' ? characters : [], has_more: false, next_cursor: null } });
  });
  return keel;
}

async function seedSignIn(page: Page) {
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{"worlds":[]}');
    reg.account_token = token;
    reg.account_username = 'e2e-owner';
    delete reg.pin;
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, TOKEN);
}

/** A fresh load at the link, a counter of every PIN prompt ever drawn installed first. */
async function arriveAt(page: Page, hash: string) {
  await page.addInitScript(() => {
    (window as any).__pinPrompts = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-form="pin-prompt"]')) (window as any).__pinPrompts++;
    }).observe(document, { childList: true, subtree: true });
  });
  await page.goto('about:blank');
  await page.goto('/' + hash);
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
}

const entry = (page: Page) => page.evaluate((id) => {
  const st = (window as any).__atlasTestApi.getState();
  const w = st.registry.worlds.find((x: any) => x.api?.world_id === id);
  return { found: !!w, pin: st.registry.pin ?? null, elements: st.data.elements.length };
}, ID);

async function opensWithNoPinAndAsksInTheWorld(page: Page, folderPicker: boolean) {
  const keel = await playKeel(page);
  await seedSignIn(page);
  await arriveAt(page, `#/open/${ID}`);
  if (folderPicker) {
    // The first and only question, named: where the world lives (no Open toast before it).
    const where = page.locator('[data-modal="where-ask"]');
    await expect(where).toBeVisible();
    await expect(where.locator('.atlas-modal-title')).toHaveText(`Open "${NAME}", from your worlds on OnlyWorlds`);
    await expect(page.locator('.ow-toast', { hasText: 'from your worlds on OnlyWorlds?' })).toHaveCount(0);
    expect(keel.mints).toBe(0);
    await where.locator('input[name="where"][value="browser"]').check();
    await where.locator('[data-action="go"]').click();
  } else {
    const card = page.locator('[data-modal="open-account"]');
    await expect(card).toContainText(`Open "${NAME}", from your worlds on OnlyWorlds?`);
    expect(keel.mints).toBe(0);
    await card.locator('[data-action="open"]').click();
  }
  await expect.poll(async () => (await entry(page)).elements).toBe(25);
  expect(keel.mints).toBe(1);
  expect(await page.evaluate(() => (window as any).__pinPrompts)).toBe(0);
  expect(keel.mePins).toEqual([]);
  expect((await entry(page)).pin).toBeNull();

  // Not online until it saves there: the pill, Home's card, the sidebar's chip.
  const pill = page.locator('.atlas-sync-pill');
  await expect(pill).toContainText('Add PIN');
  await expect(pill).toHaveAttribute('data-state', 'add-pin');
  await expect(pill).toHaveAttribute('title', 'Changes are kept here. Add your World PIN to save them to OnlyWorlds.');
  const card = page.locator('[data-role="keepsafe"]');
  await expect(card).toContainText('This world lives only in this browser');
  await expect(card).not.toContainText('Your OnlyWorlds account holds');
  await expect(card.locator('[data-action="keepsafe-add-pin"]')).toBeVisible();
  await expect(page.locator('.atlas-world-state-chip.pin-waits')).toHaveText(/not online yet/i);
  await expect(page.locator('.atlas-world-state-chip.api-linked')).toHaveCount(0);

  // The first change says so, once.
  const line = `Your change to "${NAME}" is kept here. Add your World PIN to save it to OnlyWorlds.`;
  for (const name of ['Made here', 'Made again']) {
    await page.click('.atlas-mode-btn[data-action="mode-elements"]');
    await page.click('[data-action="create-element"]');
    await page.fill('input[name="element-name"]', name);
    await page.click('[data-modal="create-element"] [data-action="create"]');
    await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);
  }
  await expect(page.locator('.ow-toast', { hasText: line })).toHaveCount(1);
  expect(keel.writes).toEqual([]);

  // The World PIN dialog: a wrong PIN is said in place, nothing kept, nothing sent.
  await pill.click();
  const dialog = page.locator('[data-modal="world-pin"]');
  await expect(dialog.locator('.atlas-modal-title')).toHaveText('World PIN');
  await expect(dialog).toContainText(`Your World PIN for "${NAME}": the four digits you chose on onlyworlds.com.`);
  await dialog.locator('input[name="pin"]').fill('1111');
  await dialog.locator('[data-action="confirm"]').click();
  await expect(dialog.locator('[data-role="error"]')).toHaveText('OnlyWorlds did not accept this PIN. Check it and try again.');
  await expect(dialog.locator('input[name="pin"]')).toHaveValue('');
  expect((await entry(page)).pin).toBeNull();
  expect(keel.writes).toEqual([]);

  // The right one: kept, the dialog closes, and what waited reaches OnlyWorlds.
  await dialog.locator('input[name="pin"]').fill(PIN);
  await dialog.locator('[data-action="confirm"]').click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await entry(page)).pin).toBe(PIN);
  await expect.poll(() => keel.writes.map(w => w.name), { timeout: 20_000 }).toEqual(expect.arrayContaining(['Made here', 'Made again']));
  expect(new Set(keel.writes.map(w => w.pin))).toEqual(new Set([PIN]));
  // The dialog's two questions came first; the engine's own rounds read /me after them.
  expect(keel.mePins.slice(0, 2)).toEqual(['1111', PIN]);
  await expect(pill).not.toContainText('Add PIN');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await expect(page.locator('.atlas-world-state-chip.api-linked')).toBeVisible();
  await expect(page.locator('.atlas-world-state-chip.pin-waits')).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('the owner\'s world opens from its link with no PIN asked, and asks for it in the world (2026-11-22)', async ({ page }) => {
  await opensWithNoPinAndAsksInTheWorld(page, true);
});

test('@firefox the owner\'s world opens from its link with no PIN asked, and asks for it in the world (2026-11-22)', async ({ page }) => {
  await opensWithNoPinAndAsksInTheWorld(page, false);
});
