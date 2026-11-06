/**
 * The open door for a public world (1.123): a visitor with no account opens
 * `#/open/<world>/writing/<chapter>`, says Open to the ask, and lands in a
 * view-only copy's writing room on that chapter, its scenes in order, no
 * setup and no edit control; the same link again opens the copy with one
 * keyless world read; the owner signed in takes the account path; a held
 * seat for the world stays held; a world the public cannot read keeps the
 * sign-in line. keel is played as its public reader answers today (its
 * api-v2-spec, "the public reader"): `?world=` on every keyless read,
 * `counts` on GET /world, `no-store`, one 404 for a world the public cannot
 * read, 401 on a keyless /changes. The narratives are Blood Meridian's
 * shape as keel serves it.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const PUB = '721d154b-43f3-4cc1-b7b4-7ea2b83c401e';
const PRIVATE = '33333333-4444-4555-8666-777777777777';
const TOKEN = 'ow_a_e2e0public0token00000000000000000000000';
const T = '2026-11-06T10:00:00.000Z';
const BOOK = '01a13c6f-8806-7cb5-b60e-b2e8c5787b33';
const CH1 = '01a1b17c-f4a2-7537-ba96-b51d6eb4cc6c';
const SCENES = ['The child', 'The night he was born', 'The way south', 'New Orleans', 'Divested', 'Texas'];
const SCENE_IDS = [
  '01a1b17c-f4a2-707d-bfa1-d6c78ef5f03e', '01a1b17c-f4a2-7d71-b2e6-0118c5e9d652', '01a1b17c-f4a2-761d-8c85-563aa9c6905c',
  '01a1b17c-f4a2-7d8b-b3ed-d9cd00a6b35a', '01a1b17c-f4a2-7e64-9a1b-735272ac08fb', '01a1b17c-f4a2-7349-b13b-75466eff3048',
];

const narr = (id: string, name: string, supertype: string, parent: string | null, order: number | null) =>
  ({ id, type: 'narrative', name, supertype, subtype: 'fictional', parent_narrative: parent, order, story: `${name}.`, updated_at: T, created_at: T });
// Keel's order is not the book's: the scenes come back shuffled, and their `order` sorts them.
const NARRATIVES = [
  narr('01a13c6f-8808-750f-8419-5cd103331b7b', 'My Confession', 'Memoir', null, null),
  narr(BOOK, 'Blood Meridian (the novel)', 'Book', null, null),
  narr('01a1942b-4e87-7c55-998b-72e1347d0ce5', "Green's revival in the rain", 'First page', null, null),
  narr(CH1, 'Chapter I', 'Chapter', BOOK, 1),
  ...[3, 0, 5, 1, 4, 2].map(i => narr(SCENE_IDS[i], SCENES[i], 'Scene', CH1, i + 1)),
  narr('01a1b17c-f4a2-722c-bce6-c9aa9d92ca06', "The father's telling", 'Telling', SCENE_IDS[1], 1),
];
const CHARACTERS = [{ id: '01a1b17c-0000-7000-8000-000000000001', type: 'character', name: 'The kid', updated_at: T, created_at: T }];

interface Keel { worldReads: number; lists: number; keyed: number; requests: Array<{ method: string; url: string; key: boolean }> }

async function playKeel(page: Page, opts: { ownerRows?: boolean; readerOff?: boolean } = {}): Promise<Keel> {
  const keel: Keel = { worldReads: 0, lists: 0, keyed: 0, requests: [] };
  const noStore = { 'Cache-Control': 'no-store' };
  const notFound = (route: Route) => route.fulfill({ status: 404, headers: noStore, json: { error: { type: 'not_found', code: 'not_found', message: 'World not found.', param: null } } });
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname.replace('/api/v2', '').replace(/\/$/, '');
    const headers = req.headers();
    const keyless = !headers['api-key'] && !headers['authorization'];
    keel.requests.push({ method: req.method(), url: req.url(), key: !keyless });
    if (keyless) {
      // keel with PUBLIC_READER off: a keyless `world` is today's 401 (api-v2-spec, "the public reader").
      if (opts.readerOff) return route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null, doc_url: 'https://onlyworlds.github.io/api/errors/#invalid_credentials' } } });
      const world = url.searchParams.get('world');
      if (!world || path === '/changes' || path === '/members' || path === '/me') {
        return route.fulfill({ status: 401, headers: noStore, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null } } });
      }
      if (req.method() !== 'GET') return route.fulfill({ status: 401, headers: noStore, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'No valid API-Key.', param: null } } });
      if (world !== PUB) return notFound(route);
      if (path === '/world') {
        keel.worldReads++;
        return route.fulfill({ headers: noStore, json: {
          id: PUB, name: 'Blood Meridian', description: 'The scalp country.', time_basic_unit: 'Year', time_range_current: 1850,
          public_read: true, owner_character: null, created_at: T, updated_at: T,
          counts: { total: NARRATIVES.length + CHARACTERS.length, types: { narrative: NARRATIVES.length, character: CHARACTERS.length } },
        } });
      }
      keel.lists++;
      const type = path.split('/').filter(Boolean)[0];
      const data = type === 'narrative' ? NARRATIVES : type === 'character' ? CHARACTERS : [];
      return route.fulfill({ headers: noStore, json: { data, has_more: false, next_cursor: null } });
    }
    keel.keyed++;
    if (path === '/account') return route.fulfill({ json: { username: 'e2e-owner' } });
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: opts.ownerRows
        ? [{ id: PUB, name: 'Blood Meridian', role: 'owner', member_role: null, public_read: true, keys: [] }]
        : [] } });
    }
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
  return keel;
}

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

/** A fresh load of the app at a hash, the way a link from another site arrives. */
async function arriveAt(page: Page, hash: string) {
  await page.goto('about:blank');
  await page.goto('/' + hash);
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
}

function copies(page: Page) {
  return page.evaluate((id) => {
    const st = (window as any).__atlasTestApi.getState();
    const all = st.registry.worlds.filter((w: any) => w.copy_of?.world_id === id);
    return { count: all.length, ids: all.map((w: any) => w.id), active: st.active?.worldId ?? null, worlds: st.registry.worlds.length };
  }, PUB);
}

const ASK = 'Open a view-only copy of "Blood Meridian" in this browser?';

test.beforeEach(async ({ page }) => { await freshBoot(page); });

for (const tag of ['', ' @firefox']) {
  test(`signed out, a public world's writing link opens a view-only copy on Chapter I, and again with one world read${tag}`, async ({ page }) => {
    const keel = await playKeel(page);
    await arriveAt(page, `#/open/${PUB}/writing/${CH1}`);
    expect(await page.evaluate(() => location.hash)).not.toContain('/open/');
    const ask = page.locator('.ow-toast', { hasText: ASK });
    await expect(ask).toBeVisible();
    await expect(ask.locator('.ow-toast-action', { hasText: 'Sign in' })).toBeVisible();
    // Nothing made before Open: one world read, no list, no copy.
    expect(keel.worldReads).toBe(1);
    expect(keel.lists).toBe(0);
    expect((await copies(page)).count).toBe(0);
    await ask.locator('.ow-toast-action', { hasText: /^Open$/ }).click();

    await expect.poll(async () => (await copies(page)).count).toBe(1);
    const { ids: [copyId] } = await copies(page);
    expect(copyId).not.toBe(PUB);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/w/${copyId}/writing/${CH1}`);
    await expect(page.locator('.ow-toast', { hasText: /Opened a copy of Blood Meridian from .*, view only\./ })).toBeVisible();

    // The room reads with the default labels: no setup, Chapter I chosen, its six scenes in order.
    await expect(page.getByRole('heading', { name: 'Set up writing' })).toHaveCount(0);
    const rows = page.locator('.atlas-writing-tree-row');
    await expect(rows.filter({ hasText: 'Chapter I' })).toHaveClass(/active/);
    await expect.poll(async () => {
      const names = await rows.allInnerTexts();
      return names.map(s => s.trim()).filter(s => SCENES.some(n => s.includes(n))).map(s => SCENES.find(n => s.includes(n)));
    }).toEqual(SCENES);
    // The Telling, the Memoir and the First page are not in the tree.
    await expect(rows.filter({ hasText: "The father's telling" })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'My Confession' })).toHaveCount(0);
    // View only: no create in the tree, no add on a row, no label edit.
    await expect(page.locator('.atlas-writing-sidebar-create-row')).toHaveCount(0);
    await expect(page.locator('.atlas-writing-tree-row-add')).toHaveCount(0);
    await expect(page.locator('.atlas-writing-landing-labels-edit')).toHaveCount(0);
    const entry = await page.evaluate((id) => (window as any).__atlasTestApi.getState().registry.worlds.find((w: any) => w.id === id), copyId);
    expect(entry.copy_of.world_id).toBe(PUB);
    expect(entry.api).toBeUndefined();

    // Nothing went up: every request to keel was a keyless GET naming the world.
    for (const r of keel.requests) {
      expect(r.method).toBe('GET');
      expect(r.key).toBe(false);
      expect(new URL(r.url).searchParams.get('world')).toBe(PUB);
    }
    // One type at a time, one page each: the world read twice (the ask, the build) and 22 lists.
    expect(keel.lists).toBe(22);
    expect(keel.worldReads).toBe(2);

    // The same link again opens the copy as it is: exactly one world read, no list, no second copy.
    await page.evaluate(async () => { await (window as any).__atlasTestApi.landed(); });
    const before = { reads: keel.worldReads, lists: keel.lists };
    await page.evaluate(() => { location.hash = '#/settings/general'; });
    await page.evaluate((id) => { location.hash = `#/open/${id}`; }, PUB);
    await expect.poll(() => page.evaluate(() => location.hash)).toBe(`#/w/${copyId}`);
    expect(keel.worldReads - before.reads).toBe(1);
    expect(keel.lists - before.lists).toBe(0);
    expect((await copies(page)).count).toBe(1);
    await expect(page.locator('.ow-toast', { hasText: ASK })).toHaveCount(0);
  });
}

test('signed in as the owner, the account path opens it, and no copy is offered', async ({ page }) => {
  const keel = await playKeel(page, { ownerRows: true });
  await page.evaluate((token) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{"worlds":[]}');
    reg.account_token = token;
    reg.account_username = 'e2e-owner';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, TOKEN);
  await arriveAt(page, `#/open/${PUB}/writing/${CH1}`);
  await expect(page.locator('.ow-toast', { hasText: 'Open "Blood Meridian", from your worlds on OnlyWorlds?' })).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: ASK })).toHaveCount(0);
  expect(keel.worldReads).toBe(0);
  expect((await copies(page)).count).toBe(0);
});

test('a held seat for the world stays held beside a public copy of it', async ({ page }) => {
  await playKeel(page);
  const seatKey = `atlas-held-seat:${PUB}`;
  const seat = { v: 1, world_id: PUB, world_name: 'Blood Meridian', kind: 'player', key: 'ow_r_' + 'P'.repeat(32), character: { id: CHARACTERS[0].id, name: 'The kid' }, held_at: T, code_tail: 'ab12' };
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [seatKey, JSON.stringify(seat)] as const);
  await arriveAt(page, `#/open/${PUB}`);
  const ask = page.locator('.ow-toast', { hasText: ASK });
  await expect(ask).toBeVisible();
  await ask.locator('.ow-toast-action', { hasText: /^Open$/ }).click();
  await expect.poll(async () => (await copies(page)).count).toBe(1);
  await page.evaluate(async () => { await (window as any).__atlasTestApi.landed(); });
  // A fresh load settles held seats again against the registry with the copy in it.
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  expect(await page.evaluate((k) => localStorage.getItem(k), seatKey)).toBe(JSON.stringify(seat));
  await expect(page.locator('.ow-toast', { hasText: 'is unused now' })).toHaveCount(0);
});

test('a world the public cannot read keeps the sign-in line, and nothing is made', async ({ page }) => {
  const keel = await playKeel(page);
  await arriveAt(page, `#/open/${PRIVATE}/writing`);
  await expect(page.locator('.ow-toast', { hasText: 'sign in to Atlas with your OnlyWorlds account' })).toBeVisible();
  await expect(page.locator('input[name="account-login"]')).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: 'view-only copy' })).toHaveCount(0);
  expect(keel.lists).toBe(0);
  expect((await copies(page)).worlds).toBe(0);
});

test('with keel\'s public reader switched off, a signed-out link keeps the sign-in line', async ({ page }) => {
  const keel = await playKeel(page, { readerOff: true });
  await arriveAt(page, `#/open/${PUB}/writing/${CH1}`);
  await expect(page.locator('.ow-toast', { hasText: 'sign in to Atlas with your OnlyWorlds account' })).toBeVisible();
  await expect(page.locator('input[name="account-login"]')).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: 'view-only copy' })).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'could not reach OnlyWorlds' })).toHaveCount(0);
  expect(keel.lists).toBe(0);
  expect((await copies(page)).worlds).toBe(0);
});
