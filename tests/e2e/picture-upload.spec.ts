/**
 * "Upload picture" (Atlas #154) through the real page: an online world's
 * element offers the row under its image URL, a picked file goes to keel for
 * a ticket (with the world's own PIN: a seat's secret here) and to the edge
 * with only the ticket, and the picture's address becomes the image URL. A
 * local world's element has no row. keel, the edge and the media host are
 * mocked with page.route; the online world comes in through the #/join/ door.
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const WORLD_ID = '22222222-3333-4444-8555-666666666666';
const CHAR_ID = 'c0000000-0000-4000-8000-000000000001';
const CODE = 'ow_j_' + 'E'.repeat(32);
const SECRET = 'ow_s_' + 'S'.repeat(32);
const KEY = 'ow_w_' + 'K'.repeat(32);
const PICTURE = 'https://media.onlyworlds.com/u/w1/fluffington.png';
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

interface Seen { tickets: Array<{ key: string | null; pin: string | null }>; edge: Array<{ auth: string | null; key: string | null }>; patches: Array<Record<string, unknown>> }

async function onlineWorld(page: Page): Promise<Seen> {
  const seen: Seen = { tickets: [], edge: [], patches: [] };
  const now = '2026-10-10T00:00:00.000Z';
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    if (path === '/join/preview') return route.fulfill({ json: {
      world: { name: 'Moppetopia', description: '' }, invited_by: null, owner_character: null,
      role: 'contributor', with_character: false, expires_at: '2099-01-01T00:00:00Z' } });
    if (path === '/join') return route.fulfill({ status: 201, json: {
      world: { id: WORLD_ID, name: 'Moppetopia', description: '' }, seat: { id: 's1', role: 'contributor', agent_name: 'x' },
      with_character: false, character: null, key: KEY, pin: SECRET } });
    if (path === '/media/ticket') {
      seen.tickets.push({ key: req.headers()['api-key'] ?? null, pin: req.headers()['api-pin'] ?? null });
      return route.fulfill({ status: 201, json: { ticket: 'tkt-1', upload_url: 'https://upload.onlyworlds.com/v1/upload', prefix: 'u/w1/', max_bytes: 15728640, exp: 0, uses: 1 } });
    }
    if (path === '/world' || path === '/world/') return route.fulfill({ json: { id: WORLD_ID, name: 'Moppetopia', updated_at: now } });
    if (req.method() === 'PATCH') {
      seen.patches.push(req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ json: { id: CHAR_ID, type: 'character', name: 'Admiral Fluffington', updated_at: '2026-10-10T00:00:01.000Z', ...(req.postDataJSON() as object) } });
    }
    const type = path.split('/').filter(Boolean)[0];
    if (path.startsWith('/character/') && path.split('/').filter(Boolean).length === 2) {
      return route.fulfill({ json: { id: CHAR_ID, type: 'character', name: 'Admiral Fluffington', updated_at: now, created_at: now } });
    }
    const data = type === 'character' ? [{ id: CHAR_ID, type: 'character', name: 'Admiral Fluffington', updated_at: now, created_at: now }] : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  await page.route('https://upload.onlyworlds.com/**', async (route: Route) => {
    const h = route.request().headers();
    seen.edge.push({ auth: h['authorization'] ?? null, key: h['api-key'] ?? null });
    return route.fulfill({ status: 201, json: { url: PICTURE, key: 'u/w1/fluffington.png', bytes: PNG.length, type: 'image/png', etag: 'e' } });
  });
  await page.route('https://media.onlyworlds.com/**', (route: Route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));

  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);
  const modal = page.locator('[data-modal="join-world"]');
  await expect(modal).toBeVisible();
  const browserWhere = modal.locator('input[name="where"][value="browser"]');
  if (await browserWhere.count()) await browserWhere.check();
  await modal.locator('[data-action="open"]').click();
  await expect(modal).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(1);
  return seen;
}

test('an online world\'s element uploads a picture and sets it as the image URL', async ({ page }) => {
  const seen = await onlineWorld(page);
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate(([w, c]) => { window.location.hash = `#/w/${w}/element/${c}`; }, [worldId, CHAR_ID]);

  const row = page.locator('[data-field="upload_picture"]');
  await expect(row).toBeVisible();
  await expect(row).toContainText('Anyone with its link can see an uploaded picture');
  await row.locator('input[type="file"]').setInputFiles({ name: 'fluffington.png', mimeType: 'image/png', buffer: PNG });

  await expect(page.locator('.ow-toast', { hasText: 'Picture uploaded' })).toBeVisible();
  expect(seen.tickets).toEqual([{ key: KEY, pin: SECRET }]);
  expect(seen.edge).toEqual([{ auth: 'Bearer tkt-1', key: null }]);
  await expect.poll(() => page.evaluate((c) => {
    const el = (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === c);
    return el?.image_url ?? null;
  }, CHAR_ID)).toBe(PICTURE);
});

test('a local world\'s element has no upload row', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  // A local world, as knowledge.spec.ts's setupWorld makes one.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('picture-test-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Local');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await page.waitForSelector('[data-role="elements-search"]');
  const made = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const created = await api.getActiveStore().createElement('character', { name: 'Ana', description: 'here' });
    api.patchData(await api.getActiveStore().listElements());
    return { world: api.getState().active.worldId as string, el: created.id as string };
  });
  await page.evaluate(([w, c]) => { window.location.hash = `#/w/${w}/element/${c}`; }, [made.world, made.el]);
  await expect(page.locator('.atlas-detail-section-body').first()).toBeVisible();
  await expect(page.locator('[data-field="upload_picture"]')).toHaveCount(0);
});

test('an uploaded picture of this world can be removed: asked first, then the image URL is cleared', async ({ page }) => {
  const seen = await onlineWorld(page);
  const removable = `https://media.onlyworlds.com/u/${WORLD_ID}/fluffington.webp`;
  const removals: Array<{ body: unknown; pin: string | null }> = [];
  const edgeRemoves: Array<string | null> = [];
  await page.route(`${V2}/media/remove-ticket`, async (route: Route) => {
    removals.push({ body: route.request().postDataJSON(), pin: route.request().headers()['api-pin'] ?? null });
    return route.fulfill({ json: { ticket: 'd1.rm', exp: '2099-01-01T00:00:00Z', key: `u/${WORLD_ID}/fluffington.webp`, referenced: 1 } });
  });
  await page.route('https://upload.onlyworlds.com/v1/remove', async (route: Route) => {
    edgeRemoves.push(route.request().headers()['authorization'] ?? null);
    return route.fulfill({ json: { removed: `u/${WORLD_ID}/fluffington.webp`, bytes: 10, cache: 'may_linger' } });
  });
  const worldId = await page.evaluate(async ([c, url]) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(c, { image_url: url });
    api.patchData(await api.getActiveStore().listElements());
    return api.getState().active.worldId;
  }, [CHAR_ID, removable]);
  await page.evaluate(([w, c]) => { window.location.hash = `#/w/${w}/element/${c}`; }, [worldId, CHAR_ID]);

  const remove = page.locator('[data-action="remove-picture"]');
  await expect(remove).toBeVisible();
  // A no to the question asks nothing of keel.
  page.once('dialog', d => { void d.dismiss(); });
  await remove.click();
  await page.waitForTimeout(300);
  expect(removals).toEqual([]);

  let question = '';
  page.once('dialog', d => { question = d.message(); void d.accept(); });
  await remove.click();
  await expect(page.locator('.ow-toast', { hasText: 'Picture removed from OnlyWorlds' })).toBeVisible();
  expect(question).toContain('for good');
  expect(removals).toEqual([{ body: { key: `u/${WORLD_ID}/fluffington.webp` }, pin: SECRET }]);
  expect(edgeRemoves).toEqual(['Bearer d1.rm']);
  await expect.poll(() => page.evaluate((c) => {
    const el = (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === c);
    return el?.image_url ?? null;
  }, CHAR_ID)).toBeNull();
  await expect(remove).toHaveCount(0);
  expect(seen.tickets).toEqual([]); // nothing was uploaded on the way
});
