/**
 * The `#/join/` door (OW Infra #104, S385) through the real page: the code
 * leaves the address bar before keel answers (R2), the confirm screen names
 * the world, owner and role as text (R8, conv. 93), Open joins as a seat and
 * downloads, and the seat's secret stays out of world.json and the account
 * PIN. keel's /join, /join/preview and the element lists are mocked with
 * page.route (`tests/msw-handlers.ts` `joinV2Handlers` is the same contract
 * for vitest).
 */
import { test, expect, type Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const WORLD_ID = '22222222-3333-4444-8555-666666666666';
const CODE = 'ow_j_' + 'E'.repeat(32);
const SECRET = 'ow_s_' + 'S'.repeat(32);
const KEY = 'ow_w_' + 'K'.repeat(32);

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
}

interface Keel { previews: number; joins: Array<Record<string, unknown>>; releasePreview: () => void }

async function mockKeel(page: Page, opts: { worldName?: string; refuse?: boolean } = {}): Promise<Keel> {
  const now = '2026-10-10T00:00:00.000Z';
  const keel: Keel = { previews: 0, joins: [], releasePreview: () => {} };
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  keel.releasePreview = release;
  const notFound = { status: 404, json: { error: { type: 'not_found', code: 'not_found', message: 'This join code is not valid.', param: null } } };
  await page.route(`${V2}/**`, async (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v2', '');
    if (path === '/join/preview') {
      keel.previews++;
      await held;
      if (opts.refuse) return route.fulfill(notFound);
      return route.fulfill({ json: {
        world: { name: opts.worldName ?? 'Moppetopia', description: '' },
        invited_by: 'tmo', owner_character: 'Admiral Fluffington', role: 'contributor',
        with_character: false, expires_at: '2099-01-01T00:00:00Z',
      } });
    }
    if (path === '/join') {
      keel.joins.push(route.request().postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: 201, json: {
        world: { id: WORLD_ID, name: opts.worldName ?? 'Moppetopia', description: '' },
        seat: { id: 'seat-1', role: 'contributor', agent_name: 'Atlas (Chrome)' },
        with_character: false, character: null, key: KEY, pin: SECRET, env: '', next: [], members: [],
      } });
    }
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: { id: WORLD_ID, name: 'Moppetopia', updated_at: now } });
    }
    const type = path.split('/').filter(Boolean)[0];
    const data = type === 'character'
      ? [{ id: 'c0000000-0000-4000-8000-000000000001', type: 'character', name: 'Admiral Fluffington', updated_at: now, created_at: now }]
      : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
  return keel;
}

test('a join link: the code is gone before keel answers, the screen names the world, Open joins as a seat', async ({ page }) => {
  await freshBoot(page);
  const keel = await mockKeel(page);
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);
  await expect.poll(() => keel.previews).toBe(1);
  // R2: while the preview is still in flight, the address bar already lost the code.
  expect(page.url()).not.toContain(CODE);
  expect(await page.evaluate(() => location.hash)).toBe('#/');
  keel.releasePreview();

  const modal = page.locator('[data-modal="join-world"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-role="world-name"]')).toHaveText('Moppetopia');
  await expect(modal.locator('[data-role="who"]')).toHaveText('Owned by Admiral Fluffington.');
  await expect(modal.locator('[data-role="role"]')).toContainText('As a contributor');
  // Nothing spent until Open.
  expect(keel.joins).toHaveLength(0);

  await modal.locator('input[name="where"][value="browser"]').check();
  await modal.locator('[data-action="open"]').click();
  await expect(modal).toHaveCount(0);
  expect(keel.joins).toHaveLength(1);
  expect(keel.joins[0]).toMatchObject({ code: CODE, agent_name: 'Atlas (Chrome)' });

  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(1);
  const after = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const st = api.getState();
    const w = st.registry.worlds.find((x: any) => x.api?.world_id === '22222222-3333-4444-8555-666666666666');
    const meta = await api.getActiveStore().readWorldMeta();
    return { seat: w?.api?.seat, hasSecret: w?.api?.seat_secret?.startsWith('ow_s_'), pin: st.registry.pin ?? null, meta: JSON.stringify(meta) };
  });
  expect(after.seat).toEqual({ role: 'contributor' });
  expect(after.hasSecret).toBe(true);
  expect(after.pin).toBeNull();
  expect(after.meta).not.toContain(SECRET);
  expect(after.meta).toContain('"seat"');
});

test('a refused code says so once and opens nothing', async ({ page }) => {
  await freshBoot(page);
  const keel = await mockKeel(page, { refuse: true });
  keel.releasePreview();
  await page.goto('about:blank');
  await page.goto(`/#/join/${CODE}`);
  await expect(page.locator('.ow-toast', { hasText: 'This link was already used or has expired.' })).toBeVisible();
  await expect(page.locator('[data-modal="join-world"]')).toHaveCount(0);
  expect(keel.joins).toHaveLength(0);
});

test('a link opened into a running tab takes the same door, and a hostile world name stays text', async ({ page }) => {
  await freshBoot(page);
  const hostile = '<img src=x onerror="window.__pwned=1">';
  const keel = await mockKeel(page, { worldName: hostile });
  keel.releasePreview();
  await page.evaluate((c) => { location.hash = `#/join/${c}`; }, CODE);
  const modal = page.locator('[data-modal="join-world"]');
  await expect(modal.locator('[data-role="world-name"]')).toHaveText(hostile);
  expect(await page.evaluate(() => (window as any).__pwned ?? null)).toBeNull();
  expect(page.url()).not.toContain(CODE);
  await modal.locator('[data-action="cancel"]').click();
  await expect(modal).toHaveCount(0);
  expect(keel.joins).toHaveLength(0);
});
