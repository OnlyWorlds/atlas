/**
 * #760: in a synced world, the element page's footer says where the element has been on
 * OnlyWorlds: the tool of its newest write ("last shaped in Lantern"), then the others, from
 * keel's `doors`. A world on disk only says nothing (its fields may be from another time), nor
 * an element OnlyWorlds has said nothing of. Keel is routed: every read answers empty, every
 * write is refused, so nothing here reaches a real server.
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const SERVER_WORLD = '44444444-5555-4666-8777-888888888760';
const AT = '2026-10-29T12:00:00.000Z';

/** What the routed keel lists: the elements as pulled, so a round reads them as still there. */
const served: Record<string, unknown>[] = [];

async function setupWorld(page: Page) {
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace('/api/v2', '');
    if (req.method() !== 'GET') return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'routed', type: 'api_error' } } });
    if (p === '/world' || p === '/world/') return route.fulfill({ json: { id: SERVER_WORLD, name: 'trail', updated_at: AT } });
    if (p === '/members' || p === '/members/') return route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: 'routed', type: 'permission_error' } } });
    if (p === '/character' || p === '/character/') return route.fulfill({ json: { data: served, has_more: false, next_cursor: null } });
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('door-trail-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'trail');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** As a pull leaves it: synced, keel's fields on it. */
async function pulledElement(page: Page, id: string, name: string, fields: Record<string, unknown>): Promise<string> {
  await page.evaluate(async ({ id, name, fields, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    // The pull's own write: both stamps the server's, keel's fields as served.
    await store.applyServerRecord('character', { id, type: 'character', name, updated_at: at, ...fields }, at);
    api.patchData(await store.listElements());
  }, { id, name, fields, at: AT });
  served.push({ id, name, updated_at: AT, ...fields });
  return id;
}

async function linkWorld(page: Page) {
  await page.evaluate((sid) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: sid, api_key: 'ow_w_' + 'K'.repeat(32) };
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, SERVER_WORLD);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
}

async function openElement(page: Page, id: string, name: string) {
  await page.evaluate((id) => {
    const wid = JSON.parse(localStorage.getItem('atlas_worlds_registry')!).worlds[0].id;
    window.location.hash = `#/w/${wid}/element/${id}`;
  }, id);
  await expect(page.locator('[data-role="element-name"]')).toHaveText(name);
}

test.describe('where an element has been', () => {
  test('a synced world says the newest tool, then the rest; a world on disk only, an unsent element and an unwritten one say nothing', async ({ page }) => {
    await setupWorld(page);
    const doors = { atlas: '2026-10-20T09:00:00Z', lantern: AT, site: '2026-10-10T09:00:00Z', mcp: '2026-10-15T09:00:00Z' };
    const early = await pulledElement(page, '0192a000-0000-7000-8000-0000000a7600', 'Ada', { doors });
    const last = page.locator('.atlas-detail-meta [data-role="door-trail"]');
    const before = page.locator('.atlas-detail-meta [data-role="door-trail-before"]');

    // On disk only: keel's fields are there, and no trail.
    await openElement(page, early, 'Ada');
    await expect(page.locator('.atlas-detail-meta')).toBeVisible();
    expect(await last.count()).toBe(0);

    await linkWorld(page);
    await openElement(page, early, 'Ada');
    await expect(last).toHaveText(/^On OnlyWorlds: last shaped in Lantern, /);

    // No baseline: not on OnlyWorlds yet (the push is refused here), whatever old fields it carries.
    const unsent = '0192a000-0000-7000-8000-0000000a7604';
    await page.evaluate(async ({ id, doors }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElementVerbatim('character', { id, type: 'character', name: 'Dee', doors });
      api.patchData(await store.listElements());
    }, { id: unsent, doors });
    await openElement(page, unsent, 'Dee');
    await expect(page.locator('.atlas-detail-meta')).toContainText('Not synced');
    expect(await last.count()).toBe(0);

    const shaped = await pulledElement(page, '0192a000-0000-7000-8000-0000000a7601', 'Bea', { doors });
    const older = await pulledElement(page, '0192a000-0000-7000-8000-0000000a7602', 'Bram', { changed_via: 'site' });
    const unwritten = await pulledElement(page, '0192a000-0000-7000-8000-0000000a7603', 'Cass', { doors: null, changed_via: null });

    await openElement(page, shaped, 'Bea');
    await expect(last).toHaveText(/^On OnlyWorlds: last shaped in Lantern, /);
    await expect(before).toHaveText(/^Before that: in Atlas, .+ · with an AI, .+ · on onlyworlds\.com, /);

    await openElement(page, older, 'Bram');
    await expect(last).toHaveText(/^On OnlyWorlds: last shaped on onlyworlds\.com, /);
    expect(await before.count()).toBe(0);

    await openElement(page, unwritten, 'Cass');
    await expect(page.locator('.atlas-detail-meta')).toBeVisible();
    expect(await last.count()).toBe(0);
  });
});
