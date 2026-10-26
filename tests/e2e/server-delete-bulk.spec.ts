/**
 * #122: the server-delete review's "Delete all locally", clicked the
 * way a user meets it. A linked world of four characters; the server deletes
 * three; one of the three holds an edit made here that never synced. The one
 * step deletes the two clean copies, names the edited one and keeps it until
 * its box is ticked. Nothing is ever sent to the server.
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const API_WORLD = '11111111-2222-4333-8444-555555555555';

type Rec = Record<string, unknown> & { id: string; type: string };

/** A small keel: lists, /bulk, create, patch, get, and a /changes feed the test can feed deletes into. */
async function mockKeel(page: Page) {
  // The browser stamps local edits with the real clock, and the engine calls a
  // copy edited when local_updated_at is past server_updated_at, so the server
  // stamps with the real clock too, monotonic. A fixed date here went off at
  // 09:00 UTC on 2026-10-11 and made every copy read as edited (#202).
  let last = 0;
  const stamp = () => { last = Math.max(Date.now(), last + 1); return new Date(last).toISOString(); };
  const db = new Map<string, Rec>();
  const writes: string[] = [];
  const queued: Array<{ op: 'delete'; type: string; id: string; change_seq: number; deleted_at: string }> = [];
  let seq = 0;
  const put = (r: Rec) => { const now = stamp(); db.set(r.id, { ...(db.get(r.id) ?? {}), ...r, updated_at: now }); return db.get(r.id)!; };
  const notFound = { status: 404, json: { error: { type: 'invalid_request', code: 'not_found', message: 'not found' } } };
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const parts = url.pathname.replace('/api/v2', '').split('/').filter(Boolean);
    const method = req.method();
    if (parts[0] === 'me') return route.fulfill({ json: { role: 'owner' } });
    if (parts[0] === 'world') return route.fulfill({ json: { id: API_WORLD, name: 'Server World', updated_at: '2026-10-11T09:00:00.000Z' } });
    if (parts[0] === 'changes') {
      const changes = queued.splice(0);
      return route.fulfill({ json: { cursor: `c-${seq}`, changes, has_more: false, head: seq } });
    }
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
      writes.push(`update ${type} ${id}`);
      if (!db.has(id)) return route.fulfill(notFound);
      return route.fulfill({ json: put({ ...(req.postDataJSON() as Rec), id, type }) });
    }
    if (id && method === 'DELETE') {
      writes.push(`delete ${type} ${id}`);
      return route.fulfill({ status: 204, body: '' });
    }
    if (id && method === 'GET') {
      const r = db.get(id);
      return r ? route.fulfill({ json: r }) : route.fulfill(notFound);
    }
    return route.fulfill({ status: 405, json: {} });
  });
  /** The server deletes these: gone from the lists, and a delete op each on the feed. */
  const serverDelete = (ids: string[]) => {
    for (const id of ids) {
      const r = db.get(id)!;
      db.delete(id);
      queued.push({ op: 'delete', type: r.type, id, change_seq: ++seq, deleted_at: stamp() });
    }
  };
  return { db, writes, serverDelete };
}

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

test('Delete all locally clears the clean copies in one step and keeps the edited one until ticked', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('bulk-delete-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Sandbox');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();

  const ids = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const s = api.getActiveStore();
    const out: Record<string, string> = {};
    for (const name of ['Ada', 'Ben', 'Cy', 'Dot']) out[name] = (await s.createElement('character', { name })).id;
    api.patchData(await s.listElements());
    return out;
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
  await expect.poll(() => keel.db.size).toBe(4);
  await page.keyboard.press('Escape'); // settings

  // The server deletes Ada, Ben and Dot. Dot was edited here first and that
  // edit never reached the server (its PATCH meets the delete: a 404).
  keel.serverDelete([ids.Ada, ids.Ben, ids.Dot]);
  await page.evaluate(async (dot) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(dot, { description: 'written here, never synced' });
    const { getCurrentSyncEngine, pullNowAndRefresh } = await import('/src/sync/sync-attach.ts' as string);
    await getCurrentSyncEngine().pushOnce();
    await pullNowAndRefresh();
  }, ids.Dot);

  const modal = page.locator('[data-modal="server-delete-review"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.atlas-modal-title')).toHaveText('3 server-side deletes detected');
  // The edited copy is named, first, and not included by default.
  const first = modal.locator('[data-server-delete-id]').first();
  await expect(first).toHaveAttribute('data-server-delete-id', ids.Dot);
  await expect(first).toHaveAttribute('data-unsynced', '');
  await expect(first).toContainText('edited here since the last sync');
  await expect(first.locator('input[data-role="include"]')).not.toBeChecked();
  await expect(modal.locator('[data-unsynced]')).toHaveCount(1);

  // One click asks; the ask says what goes, that there is no undo, and what stays.
  await modal.locator('[data-action="bulk-delete"]').click();
  await expect(modal.locator('[data-role="bulk-confirm-text"]')).toHaveText(
    'Delete 2 local copies? The server no longer has them, so there is no undo. 1 with edits made here stays.');
  // Cancel changes nothing.
  await modal.locator('[data-action="bulk-cancel"]').click();
  await expect(modal.locator('[data-server-delete-id]')).toHaveCount(3);
  await modal.locator('[data-action="bulk-delete"]').click();
  await modal.locator('[data-action="bulk-confirm"]').click();

  await expect(page.locator('.ow-toast', { hasText: 'Deleted 2 local copies' })).toBeVisible();
  await expect(modal.locator('[data-server-delete-id]')).toHaveCount(1);
  await expect(modal.locator('.atlas-modal-title')).toHaveText('1 server-side delete detected');
  const left = await page.evaluate(async (ids) => {
    const s = (window as any).__atlasTestApi.getActiveStore();
    return {
      ada: !!(await s.getElement(ids.Ada)), ben: !!(await s.getElement(ids.Ben)),
      cy: !!(await s.getElement(ids.Cy)), dot: (await s.getElement(ids.Dot))?.description,
      tombs: (await s.listTombstonesSince(null)).length,
    };
  }, ids);
  expect(left).toEqual({ ada: false, ben: false, cy: true, dot: 'written here, never synced', tombs: 0 });

  // Only the edited copy is left: Delete all waits for its box.
  await expect(modal.locator('[data-action="bulk-delete"]')).toBeDisabled();
  await modal.locator('input[data-role="include"]').check();
  await modal.locator('[data-action="bulk-delete"]').click();
  await expect(modal.locator('[data-role="bulk-confirm-text"]')).toHaveText(
    'Delete 1 local copy? The server no longer has it, so there is no undo. That includes 1 with edits made here.');
  await modal.locator('[data-action="bulk-confirm"]').click();
  await expect(modal).toHaveCount(0);
  expect(await page.evaluate(async (dot) => !!(await (window as any).__atlasTestApi.getActiveStore().getElement(dot)), ids.Dot)).toBe(false);

  // The server was never asked to delete anything: these were its deletes.
  expect(keel.writes.filter(w => w.startsWith('delete'))).toEqual([]);
});
