/**
 * Refresh from OnlyWorlds says what came
 * down once. The pull itself toasts the counts; Settings' Refresh button
 * toasted them a second time in other words ("Pulled 1 new + 0 updated" under
 * "Pulled 1 new from OnlyWorlds"). A linked world on a small keel, one new
 * element put on the server's feed, the button pressed: one toast with the
 * count. With nothing new, the button's own "Already up to date".
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const API_WORLD = '11111111-2222-4333-8444-555555555556';

type Rec = Record<string, unknown> & { id: string; type: string };

/** A small keel: lists, /bulk, patch, and a /changes feed the test puts upserts on. */
async function mockKeel(page: Page) {
  let last = 0;
  const stamp = () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString(); };
  const db = new Map<string, Rec>();
  const queued: Array<Record<string, unknown>> = [];
  let seq = 0;
  const put = (r: Rec) => { db.set(r.id, { ...(db.get(r.id) ?? {}), ...r, updated_at: stamp() }); return db.get(r.id)!; };
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const parts = new URL(req.url()).pathname.replace('/api/v2', '').split('/').filter(Boolean);
    const method = req.method();
    if (parts[0] === 'me') return route.fulfill({ json: { role: 'owner' } });
    if (parts[0] === 'world') return route.fulfill({ json: { id: API_WORLD, name: 'Server World', updated_at: '2026-10-11T09:00:00.000Z' } });
    if (parts[0] === 'changes') return route.fulfill({ json: { cursor: `c-${seq}`, changes: queued.splice(0), has_more: false, head: seq } });
    if (parts[0] === 'bulk' && method === 'POST') {
      const body = req.postDataJSON() as { items: Array<{ type: string; element: Rec }> };
      const items = body.items.map(it => { const r = put({ ...it.element, type: it.type }); return { status: 201, id: r.id, updated_at: r.updated_at }; });
      return route.fulfill({ json: { errors: false, items } });
    }
    const [type, id] = parts;
    if (!id && method === 'GET') return route.fulfill({ json: { data: [...db.values()].filter(r => r.type === type), has_more: false, next_cursor: null } });
    if (!id && method === 'POST') return route.fulfill({ status: 201, json: put({ ...(req.postDataJSON() as Rec), type }) });
    if (id && method === 'PATCH') return route.fulfill({ json: put({ ...(req.postDataJSON() as Rec), id, type }) });
    if (id && method === 'GET') { const r = db.get(id); return r ? route.fulfill({ json: r }) : route.fulfill({ status: 404, json: {} }); }
    return route.fulfill({ status: 405, json: {} });
  });
  /** Someone else makes an element on the server: in the lists, and an upsert on the feed. */
  const serverCreate = (r: Rec) => {
    const rec = put(r);
    queued.push({ op: 'upsert', type: r.type, id: r.id, change_seq: ++seq, updated_at: rec.updated_at, element: rec });
  };
  return { db, serverCreate };
}

async function linkedWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('refresh-toast-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Sandbox');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().createElement('character', { name: 'Ada' });
    api.patchData(await api.getActiveStore().listElements());
  });
  const keel = await mockKeel(page);
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
  await page.click('[data-action="make-online"]');
  await page.click('[data-route-tab="link"]');
  await page.fill('input[name="link-api-key"]', 'ow_w_testkey');
  await page.fill('input[name="link-pin"]', '1234');
  await page.click('[data-action="link-submit"]');
  await expect(page.locator('[data-modal="make-online"]')).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(() => keel.db.size).toBe(1);
  return keel;
}

/** Every toast drawn from now on, counted as it is added (a toast that leaves early still counts). */
async function countToasts(page: Page) {
  await page.evaluate(() => {
    // Distinct nodes: the manager may move a toast it already drew (a move is an add too).
    const seen = new Set<Node>();
    (window as any).__toastNodes = seen;
    const box = document.getElementById('toast-container')!;
    new MutationObserver(muts => {
      for (const m of muts) for (const n of m.addedNodes) if (n instanceof HTMLElement) seen.add(n);
    }).observe(box, { childList: true });
  });
  return () => page.evaluate(() => [...((window as any).__toastNodes as Set<HTMLElement>)].map(n => n.innerText));
}

test('Refresh from OnlyWorlds says what came down once', async ({ page }) => {
  const keel = await linkedWorld(page);
  const refresh = page.locator('[data-action="refresh-from-api"]');
  await expect(refresh).toBeVisible();

  // Nothing new: the button's own line.
  let texts = await countToasts(page);
  await refresh.click();
  await expect.poll(texts).toContainEqual(expect.stringContaining('Already up to date'));

  // One new element from elsewhere: one toast with the count, not two.
  keel.serverCreate({ id: '0e1e0000-0000-4000-8000-000000000001', type: 'character', name: 'Eve' });
  texts = await countToasts(page);
  await expect(refresh).toBeEnabled();
  await refresh.click();
  await expect.poll(texts).toContainEqual(expect.stringMatching(/1 new/));
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(2);
  await page.waitForTimeout(1500); // anything else the click sets off is drawn by now
  const said = (await texts()).filter(t => /\bnew\b|updated/.test(t));
  expect(said, said.join(' | ')).toHaveLength(1);
});
