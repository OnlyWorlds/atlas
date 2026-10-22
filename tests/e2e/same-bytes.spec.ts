/**
 * #527, the first half: an unchanged world stays unchanged on disk. A world in
 * a folder is opened, every room is visited, every element is shown, the page
 * is reloaded twice, and no byte of the world's own files may move (what a
 * world in git would show in `git status`; `.atlas/` and the wrapper's marker
 * are dot paths, which the world-repo template ignores).
 */
import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('same-bytes-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Unchanged');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** Every file under the home folder that is not a dot path, with its text. */
async function snapshot(page: Page): Promise<Record<string, string>> {
  return page.evaluate(async () => {
    const out: Record<string, string> = {};
    async function walk(dir: FileSystemDirectoryHandle, at: string) {
      for await (const [name, h] of (dir as any).entries()) {
        if (name.startsWith('.')) continue;
        const p = at ? `${at}/${name}` : name;
        if (h.kind === 'directory') await walk(h, p);
        else out[p] = await (await h.getFile()).text();
      }
    }
    await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle('same-bytes-root'), '');
    return out;
  });
}

function changed(a: Record<string, string>, b: Record<string, string>): string[] {
  const paths = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...paths].filter(p => a[p] !== b[p]).sort();
}

async function settle(page: Page) {
  await page.evaluate(async () => { await (window as any).__atlasTestApi.flushAll?.(); });
  await page.waitForTimeout(1500);
}

test('an unchanged world, opened, visited room by room and reloaded, changes no byte on disk (#527)', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const place = await store.createElement('location', { name: 'Vallaki', description: 'A walled river town.' });
    await store.createElement('character', { name: 'Aralia', description: 'Keeps the ferry.', birthplace: place.id, birth_date: 312 });
    await store.createElement('narrative', { name: 'The crossing', description: 'Aralia takes the ferry to Vallaki.' });
    await store.createElement('event', { name: 'The flood', start_date: 314 });
    api.patchData(await store.listElements());
  });
  await settle(page);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await settle(page);
  const before = await snapshot(page);
  expect(Object.keys(before).filter(p => p.includes('/elements/')).length).toBe(4);

  // Every room, then every element shown, then two reloads.
  const rooms = await page.locator('.atlas-room-nav-btn[data-room]').evaluateAll(bs => bs.map(b => b.getAttribute('data-room')));
  expect(rooms.length).toBeGreaterThan(4);
  for (const room of rooms) {
    await page.click(`.atlas-room-nav-btn[data-room="${room}"]`);
    await page.waitForTimeout(600);
  }
  await page.click('[data-action="mode-elements"]').catch(() => {});
  const rows = page.locator('.atlas-list .atlas-row');
  const n = await rows.count();
  expect(n).toBe(4);
  for (let i = 0; i < n; i++) {
    await rows.nth(i).click();
    await page.waitForTimeout(500);
  }
  await settle(page);
  for (let r = 0; r < 2; r++) {
    await page.reload();
    await page.waitForSelector('.atlas-shell');
    await settle(page);
  }

  const after = await snapshot(page);
  expect(changed(before, after)).toEqual([]);

  // The instrument can move: an edit through the store changes its element's file.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const el = (await store.listElements('character'))[0];
    await store.updateElement(el.id, { description: 'Keeps the ferry, and the toll.' });
  });
  await settle(page);
  const edited = changed(after, await snapshot(page));
  expect(edited.length).toBe(1);
  expect(edited[0]).toMatch(/\/elements\/character\//);
});
