/**
 * Route 2 end to end (S367): the Make Online modal's "link existing" on a
 * local world, against an in-memory keel fake behind page.route. Until now no
 * e2e ran a merge (phase3-make-online checks the form only), so the path a
 * user actually clicks (modal → runner → kernel → server phase → link →
 * attach) was only ever composed in vitest.
 *
 * The world: a local Alice the server also has under another id, a scene
 * that links and mentions her, and a local Bob the server lacks.
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const API_WORLD = '11111111-2222-4333-8444-555555555555';
const N = '99999999-0000-4000-8000-000000000001'; // the server's Alice

type Rec = Record<string, unknown> & { id: string; type: string };

/** A small keel: lists, /bulk, create, patch, get, an empty /changes. Records every write. */
async function mockKeel(page: Page) {
  let t = 0;
  const stamp = () => new Date(Date.UTC(2026, 8, 29, 12, 0, t++)).toISOString();
  const db = new Map<string, Rec>();
  const writes: string[] = [];
  const put = (r: Rec) => { const now = stamp(); db.set(r.id, { ...(db.get(r.id) ?? {}), ...r, updated_at: now }); return db.get(r.id)!; };
  put({ id: N, type: 'character', name: 'Alice', description: 'server', created_at: '2026-01-01T00:00:00.000Z' });
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const parts = url.pathname.replace('/api/v2', '').split('/').filter(Boolean);
    const method = req.method();
    if (parts[0] === 'world') return route.fulfill({ json: { id: API_WORLD, name: 'Server World', updated_at: stamp() } });
    if (parts[0] === 'changes') return route.fulfill({ json: { cursor: 'c-0', changes: [], has_more: false } });
    if (parts[0] === 'bulk' && method === 'POST') {
      const body = req.postDataJSON() as { items: Array<{ type: string; element: Rec }> };
      const items = body.items.map(it => {
        const r = put({ ...it.element, type: it.type });
        writes.push(`create ${it.type} ${r.id}`);
        return { status: 201, id: r.id, updated_at: r.updated_at };
      });
      return route.fulfill({ json: { errors: false, items } });
    }
    const [type, id] = parts;
    if (!id && method === 'GET') {
      return route.fulfill({ json: { data: [...db.values()].filter(r => r.type === type), has_more: false, next_cursor: null } });
    }
    if (!id && method === 'POST') {
      const r = put({ ...(req.postDataJSON() as Rec), type });
      writes.push(`create ${type} ${r.id}`);
      return route.fulfill({ status: 201, json: r });
    }
    if (id && method === 'PATCH') {
      if (!db.has(id)) return route.fulfill({ status: 404, json: { error: { type: 'invalid_request', code: 'not_found', message: 'not found' } } });
      const r = put({ ...(req.postDataJSON() as Rec), id, type });
      writes.push(`update ${type} ${id}`);
      return route.fulfill({ json: r });
    }
    if (id && method === 'GET') {
      const r = db.get(id);
      return r ? route.fulfill({ json: r }) : route.fulfill({ status: 404, json: { error: { type: 'invalid_request', code: 'not_found', message: 'not found' } } });
    }
    return route.fulfill({ status: 405, json: {} });
  });
  return { db, writes };
}

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

test('linking a local world to a server world moves every link onto the server ids', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('route2-root', { create: true }));
  });
  await page.click('[data-action="setup-atlas"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Sandbox');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();

  const { worldId, O } = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const s = api.getActiveStore();
    const alice = await s.createElement('character', { name: 'Alice', description: 'local' });
    await s.createElement('character', { name: 'Bob' });
    await s.createElement('narrative', {
      name: 'Tale', supertype: 'Scene', characters: [alice.id],
      story: `[Alice](ow://character/${alice.id}) met Bob.`,
    });
    api.patchData(await s.listElements());
    return { worldId: api.getState().active.worldId, O: alice.id as string };
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
  await expect(page.locator('.ow-toast', { hasText: 'Linked to Server World' })).toBeVisible();

  const after = await page.evaluate(async ({ O, N }) => {
    const api = (window as any).__atlasTestApi;
    const st = api.getState();
    const s = api.getActiveStore();
    const tale = await s.listElements().then((all: any[]) => all.find(e => e.name === 'Tale'));
    return {
      linked: st.registry.worlds.find((w: any) => w.id === st.active.worldId)?.state,
      inMemory: st.data.elements.map((e: any) => e.id),
      oOnDisk: !!(await s.getElement(O)),
      nOnDisk: (await s.getElement(N))?.description,
      taleChars: tale?.characters,
      taleStory: tale?.story,
      journal: await s.hasRekeyJournal(),
    };
  }, { O, N });
  expect(after.linked).toBe('api-linked');
  expect(after.inMemory).not.toContain(O);
  expect(after.inMemory).toContain(N);
  expect(after.oOnDisk).toBe(false);
  expect(after.nOnDisk).toBe('local'); // policy b: the local text went up and came back
  expect(after.taleChars).toEqual([N]);
  expect(after.taleStory).toContain(`ow://character/${N}`);
  expect(after.taleStory).not.toContain(O);
  expect(after.journal).toBe(false);

  // The server: one Alice (the local text), Bob and the scene created, the
  // scene naming the server's Alice, and nothing ever sent under O.
  const alices = [...keel.db.values()].filter(r => r.type === 'character' && r.name === 'Alice');
  expect(alices.map(a => a.id)).toEqual([N]);
  expect(alices[0].description).toBe('local');
  const tale = [...keel.db.values()].find(r => r.name === 'Tale')!;
  expect(tale.characters).toEqual([N]);
  expect(String(tale.story)).toContain(`ow://character/${N}`);
  expect(keel.writes.some(w => w.endsWith(O))).toBe(false);
  expect(JSON.stringify([...keel.db.values()])).not.toContain(O);
  void worldId;
});
