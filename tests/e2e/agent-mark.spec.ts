/**
 * #347: in a synced world, an element whose last write keel recorded through an agent door
 * (`changed_via` seat, mcp or declared) carries a quiet mark after its name; a
 * person's carries none, and a world on disk only shows none (its fields may be from another
 * time). The line is the mark's label, and a click or tap says it. A local edit is the person's,
 * so the mark leaves. Keel is routed: every read answers empty, every write is refused, so
 * nothing here reaches a real server. (An agent seat's name from the roster:
 * tests/unit/agent-mark.test.ts and the walk on a routed keel.)
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const SERVER_WORLD = '44444444-5555-4666-8777-888888888347';
const AT = '2026-10-16T00:00:00.000Z';

async function setupWorld(page: Page) {
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace('/api/v2', '');
    if (req.method() !== 'GET') return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'routed', type: 'api_error' } } });
    if (p === '/world' || p === '/world/') return route.fulfill({ json: { id: SERVER_WORLD, name: 'marks', updated_at: AT } });
    if (p === '/members' || p === '/members/') return route.fulfill({ status: 403, json: { error: { code: 'forbidden', message: 'routed', type: 'permission_error' } } });
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
    api.setNextDirectory(await root.getDirectoryHandle('agent-mark-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'marks');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** As a pull leaves it: synced (server stamp = local stamp), keel's door on it. */
async function pulledElement(page: Page, id: string, name: string, door: Record<string, unknown>): Promise<string> {
  await page.evaluate(async ({ id, name, door, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim('character', { id, type: 'character', name, local_updated_at: at, server_updated_at: at, ...door });
    api.patchData(await store.listElements());
  }, { id, name, door, at: AT });
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

test.describe('the quiet agent mark', () => {
  test('a synced world marks an agent\'s last write, not a person\'s; a click says it; an edit takes it away; a world on disk only marks nothing', async ({ page }) => {
    await setupWorld(page);
    const seat = await pulledElement(page, '0192a000-0000-7000-8000-0000000a3471', 'Glanton', { changed_by: 'b1c2d3e4-0000-4000-8000-000000000001', changed_via: 'seat' });
    const person = await pulledElement(page, '0192a000-0000-7000-8000-0000000a3472', 'Holden', { changed_by: null, changed_via: 'api' });
    const mcp = await pulledElement(page, '0192a000-0000-7000-8000-0000000a3473', 'Toadvine', { changed_by: null, changed_via: 'mcp' });
    const mark = page.locator('.atlas-middle-header [data-role="agent-mark"]');

    // On disk only: keel's fields are there, and no mark.
    await openElement(page, seat, 'Glanton');
    await expect(page.locator('[data-role="element-name"]')).toBeVisible();
    expect(await mark.count()).toBe(0);

    await linkWorld(page);
    await openElement(page, person, 'Holden');
    expect(await mark.count()).toBe(0);

    await openElement(page, mcp, 'Toadvine');
    await expect(mark).toHaveAttribute('aria-label', 'Last changed by an agent, through MCP');

    // The roster is refused here (403): the seat still marks, unnamed.
    await openElement(page, seat, 'Glanton');
    await expect(mark).toHaveAttribute('aria-label', 'Last changed by an agent');
    await expect(mark).toHaveAttribute('title', 'Last changed by an agent');
    await mark.click();
    await expect(page.locator('.ow-toast').filter({ hasText: 'Last changed by an agent' })).toBeVisible();

    // A rename by hand is this person's: the mark leaves with the next paint.
    await page.locator('[data-role="element-name"]').click();
    const input = page.locator('[data-role="element-name"] input');
    await input.fill('Glanton the scalper');
    await input.press('Enter');
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Glanton the scalper');
    await expect(mark).toHaveCount(0);
    const onDisk = await page.evaluate(async (id) => (window as any).__atlasTestApi.getActiveStore().getElement(id), seat);
    expect(onDisk.changed_via).toBeUndefined();
  });
});
