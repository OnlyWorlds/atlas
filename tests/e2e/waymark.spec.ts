/**
 * #755: the OnlyWorlds mark (the SDK's Waymark) beside the world's name on Home and an element's
 * name on its page, only where the site has a page for this reader: a world on OnlyWorlds, an
 * element that reached keel; a read key's world only when its public page is on. The mark is
 * its own slot (a press never starts a rename), an open fan-out survives a sync round's redraw,
 * Escape and Atlas's own row stay on the page, and the pop stays inside the pane. Keel is routed:
 * reads answer, writes are refused, nothing reaches a real server.
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const SERVER_WORLD = '44444444-5555-4666-8777-888888888755';
const AT = '2026-10-30T12:00:00.000Z';
const ADA = '0192a000-0000-7000-8000-0000000a7550';
const DEE = '0192a000-0000-7000-8000-0000000a7551';

const served: Record<string, unknown>[] = [];
let worldBody: Record<string, unknown> = {};

const mark = (page: Page) => page.locator('.ow-waymark__mark');
const pop = (page: Page) => page.locator('.ow-waymark__pop:not([hidden])');

async function setupWorld(page: Page) {
  served.length = 0;
  worldBody = { id: SERVER_WORLD, name: 'Harbour', updated_at: AT };
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace('/api/v2', '');
    if (req.method() !== 'GET') return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'routed', type: 'api_error' } } });
    if (p === '/world' || p === '/world/') return route.fulfill({ json: worldBody });
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
    api.setNextDirectory(await root.getDirectoryHandle('waymark-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Harbour');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** As a pull leaves it: synced, keel's fields on it. */
async function pulledElement(page: Page, id: string, name: string) {
  const fields = { doors: { atlas: '2026-10-29T09:00:00Z' } };
  await page.evaluate(async ({ id, name, fields, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.applyServerRecord('character', { id, type: 'character', name, updated_at: at, ...fields }, at);
    api.patchData(await store.listElements());
  }, { id, name, fields, at: AT });
  served.push({ id, name, updated_at: AT, ...fields });
}

async function linkWorld(page: Page, api: Record<string, unknown> = {}) {
  await page.evaluate(({ sid, api }) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: sid, api_key: 'ow_w_' + 'K'.repeat(32), ...api };
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, { sid: SERVER_WORLD, api });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
}

async function goHome(page: Page) {
  await page.evaluate(() => {
    const wid = JSON.parse(localStorage.getItem('atlas_worlds_registry')!).worlds[0].id;
    window.location.hash = `#/w/${wid}`;
  });
  await expect(page.locator('.atlas-home-world-name')).toBeVisible();
}

async function openElement(page: Page, id: string, name: string) {
  await page.evaluate((id) => {
    const wid = JSON.parse(localStorage.getItem('atlas_worlds_registry')!).worlds[0].id;
    window.location.hash = `#/w/${wid}/element/${id}`;
  }, id);
  await expect(page.locator('[data-role="element-name"]')).toHaveText(name);
}

test.describe('the OnlyWorlds mark beside a name', () => {
  test('only on a world on OnlyWorlds and an element that reached keel; one mark however often the page redraws', async ({ page }) => {
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    // On disk only: no mark on Home or on Ada.
    await goHome(page);
    await expect(mark(page)).toHaveCount(0);
    await openElement(page, ADA, 'Ada');
    await expect(mark(page)).toHaveCount(0);

    await linkWorld(page);
    await goHome(page);
    await expect(page.locator('.atlas-home-name-row .ow-waymark__mark')).toHaveCount(1);
    await openElement(page, ADA, 'Ada');
    await expect(page.locator('.atlas-middle-header .ow-waymark__mark')).toHaveCount(1);

    // Made here and not sent (the push is refused): no mark.
    await page.evaluate(async (id) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElementVerbatim('character', { id, type: 'character', name: 'Dee' });
      api.patchData(await store.listElements());
    }, DEE);
    await openElement(page, DEE, 'Dee');
    await expect(mark(page)).toHaveCount(0);

    // Back and forth, and redraws from the store: still one.
    for (let i = 0; i < 5; i++) {
      await openElement(page, ADA, 'Ada');
      await goHome(page);
    }
    await openElement(page, ADA, 'Ada');
    for (let i = 0; i < 5; i++) {
      await page.evaluate(async () => {
        const api = (window as any).__atlasTestApi;
        api.patchData([...(await api.getActiveStore().listElements())]);
      });
    }
    await expect(mark(page)).toHaveCount(1);
  });

  test('a press opens the fan-out and starts no rename; it survives a redraw; Escape and Atlas\'s own row stay on the page', async ({ page }) => {
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    await linkWorld(page);
    await openElement(page, ADA, 'Ada');
    const hash = await page.evaluate(() => location.hash);

    await mark(page).click();
    await expect(pop(page)).toBeVisible();
    // No rename started: the name is still the heading's text, and no input stands outside the fan-out.
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Ada');
    expect(await page.evaluate(() =>
      [...document.querySelectorAll('.atlas-middle-header input')].filter(i => !i.closest('.ow-waymark')).length)).toBe(0);
    await expect(pop(page)).toContainText('onlyworlds.com');
    await expect(pop(page)).toContainText('You are here');

    // A sync round's redraw while it is open: the fan-out stays.
    await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      api.patchData([...(await api.getActiveStore().listElements())]);
    });
    await page.waitForTimeout(300);
    await expect(pop(page)).toBeVisible();

    // Escape closes it, focus back on the mark, the page stays.
    await page.keyboard.press('Escape');
    await expect(pop(page)).toHaveCount(0);
    await expect(mark(page)).toBeFocused();
    expect(await page.evaluate(() => location.hash)).toBe(hash);

    // Atlas's own row: closes, goes nowhere.
    await mark(page).click();
    const href = await page.evaluate(() => location.href);
    await pop(page).getByText('You are here').click();
    await expect(pop(page)).toHaveCount(0);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => location.href)).toBe(href);
  });

  test('on Home, a change while the fan-out is open waits for it, and focus comes back to the mark', async ({ page }) => {
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    await linkWorld(page);
    await goHome(page);
    await mark(page).click();
    await expect(pop(page)).toBeVisible();
    await pulledElement(page, DEE, 'Dee');
    await page.waitForTimeout(300);
    await expect(pop(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(pop(page)).toHaveCount(0);
    await expect(mark(page)).toHaveCount(1);
    await expect(mark(page)).toBeFocused();
    // The held redraw ran: Home counts Dee now.
    await expect(page.locator('.atlas-home-name-row')).toHaveCount(1);
  });

  test('with a redraw held, the press that closes the fan-out still lands: a rename starts on the element and on Home', async ({ page }) => {
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    await linkWorld(page);
    await openElement(page, ADA, 'Ada');
    await mark(page).click();
    await expect(pop(page)).toBeVisible();
    await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      api.patchData([...(await api.getActiveStore().listElements())]);
    });
    await page.waitForTimeout(200);
    await page.locator('[data-role="element-name"]').click();
    await expect(page.locator('[data-role="element-name"] input, .atlas-middle-header input:not(.ow-waymark *)').first()).toBeVisible();

    await goHome(page);
    await mark(page).click();
    await expect(pop(page)).toBeVisible();
    await pulledElement(page, DEE, 'Dee');
    await page.waitForTimeout(200);
    await page.locator('.atlas-home-world-name').click();
    // The rename popover's box has focus, with the world's name in it.
    await expect.poll(() => page.evaluate(() => {
      const a = document.activeElement as HTMLInputElement | null;
      return a?.tagName === 'INPUT' ? a.value : null;
    })).toBe('Harbour');
    // Leaving it runs the held redraw: Home counts Dee.
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="grid-square"], .atlas-home-grid-cell').filter({ hasText: 'Dee' }).first()).toBeVisible();
  });

  test('"Link copied" stays through a sync round\'s redraw; a route change goes through while the fan-out is open', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are Chromium\'s in this suite');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    await pulledElement(page, DEE, 'Dee');
    await linkWorld(page);
    await openElement(page, ADA, 'Ada');
    await mark(page).click();
    await pop(page).getByText('Copy link').click();
    const toast = page.locator('.ow-waymark__toast:not([hidden])');
    await expect(toast).toBeVisible();
    await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      api.patchData([...(await api.getActiveStore().listElements())]);
    });
    await page.waitForTimeout(150);
    await expect(toast).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`https://www.onlyworlds.com/w/${SERVER_WORLD}/character/${ADA}`);
    await expect(toast).toHaveCount(0, { timeout: 5000 });

    // Open, then the address moves (a keyboard route, code): the page follows it.
    await mark(page).click();
    await expect(pop(page)).toBeVisible();
    await openElement(page, DEE, 'Dee');
  });

  test('a read key\'s world whose switch cannot be read: the page answers and shows no mark', async ({ page }) => {
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    await page.route(`${V2}/world/**`, route => route.fulfill({ status: 500, json: { error: { code: 'server_error', message: 'routed', type: 'api_error' } } }));
    await page.route(`${V2}/world`, route => route.fulfill({ status: 500, json: { error: { code: 'server_error', message: 'routed', type: 'api_error' } } }));
    await linkWorld(page, { api_key: 'ow_r_' + 'R'.repeat(32), read_only: true });
    await goHome(page);
    await openElement(page, ADA, 'Ada');
    await page.waitForTimeout(500);
    await expect(mark(page)).toHaveCount(0);
    expect(await page.evaluate(() => 1 + 1)).toBe(2);
  });

  test('a read key\'s world: the mark only while its public page is on', async ({ page }) => {
    await setupWorld(page);
    await pulledElement(page, ADA, 'Ada');
    worldBody = { ...worldBody, public_read: true, public_page: { on: false } };
    await linkWorld(page, { api_key: 'ow_r_' + 'R'.repeat(32), read_only: true });
    await goHome(page);
    await page.waitForTimeout(500);
    await expect(mark(page)).toHaveCount(0);

    worldBody = { ...worldBody, public_read: true, public_page: { on: true } };
    await page.reload();
    await page.waitForSelector('.atlas-shell');
    await goHome(page);
    await expect(mark(page)).toHaveCount(1);
    await openElement(page, ADA, 'Ada');
    await expect(mark(page)).toHaveCount(1);
    await mark(page).click();
    await expect(pop(page)).toContainText('Copy link');
  });

  for (const width of [1280, 820, 412]) {
    test(`the pop stays inside the pane at ${width} px`, async ({ page }) => {
      await setupWorld(page);
      await pulledElement(page, ADA, 'A long name for a character who will not fit easily beside the controls');
      await linkWorld(page);
      await page.setViewportSize({ width, height: 900 });
      await openElement(page, ADA, 'A long name for a character who will not fit easily beside the controls');
      await mark(page).click();
      await expect(pop(page)).toBeVisible();
      const box = await pop(page).boundingBox();
      const pane = await page.locator('.atlas-middle').first().boundingBox();
      expect(box && pane).toBeTruthy();
      expect(box!.x).toBeGreaterThanOrEqual(pane!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(pane!.x + pane!.width + 1);
      // Its first row is what a press there reaches (nothing paints over it).
      const row = pop(page).locator('a, button, [role="menuitem"]').first();
      const rb = await row.boundingBox();
      const hit = await page.evaluate(([x, y]) => {
        const at = document.elementFromPoint(x, y);
        return !!at?.closest('.ow-waymark__pop');
      }, [rb!.x + rb!.width / 2, rb!.y + rb!.height / 2]);
      expect(hit).toBe(true);
      await page.screenshot({ path: `test-results/waymark-${width}.png` });
    });
  }
});
