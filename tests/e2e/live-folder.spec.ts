/**
 * THE LIVE FOLDER, end to end in real Chromium over OPFS: another tool
 * writes the world folder while Atlas is open, and Atlas shows it when the
 * window comes back into focus. The "other tool" is a `page.evaluate` that
 * writes through the OPFS handle directly, bypassing the store, exactly as an
 * AI agent or a text editor would reach the files.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
}

async function setupWorld(page: Page, name: string): Promise<void> {
  await boot(page);
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await boot(page);
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('live-root', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const el = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return el.id as string;
  }, { type, data });
}

/** The other tool: rewrite an element's JSON file in place, bypassing Atlas. */
async function editFileOutside(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ id, patch }) => {
    const tail = id.slice(-8);
    async function find(dir: FileSystemDirectoryHandle): Promise<FileSystemFileHandle | null> {
      for await (const [name, h] of (dir as any).entries()) {
        if (h.kind === 'directory') { const f = await find(h); if (f) return f; }
        else if (name.endsWith(`--${tail}.json`)) return h;
      }
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const handle = await find(await root.getDirectoryHandle('live-root'));
    if (!handle) throw new Error('file not found');
    const body = JSON.parse(await (await handle.getFile()).text());
    const w = await handle.createWritable();
    await w.write(JSON.stringify({ ...body, ...patch }, null, 2) + '\n');
    await w.close();
  }, { id, patch });
}

async function comeBack(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
}

test('an edit made outside Atlas shows in the open element and the list when the window regains focus', async ({ page }) => {
  await setupWorld(page, 'live world');
  const id = await createElement(page, 'character', { name: 'Aldric', description: 'written in atlas' });
  await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/element/${id}`;
  }, id);
  await expect(page.locator('.atlas-middle-body')).toContainText('written in atlas');

  await editFileOutside(page, id, { name: 'Aldric the Grey', description: 'written by the agent' });
  await comeBack(page);

  await expect(page.locator('.atlas-middle-body')).toContainText('written by the agent');
  await expect(page.locator('.atlas-row[data-element-id="' + id + '"]')).toContainText('Aldric the Grey');
});

test('a file created and one deleted outside Atlas appear and disappear after a pass', async ({ page }) => {
  await setupWorld(page, 'live world 2');
  const gone = await createElement(page, 'character', { name: 'Gone Soon' });
  await createElement(page, 'character', { name: 'Stays' });
  const newId = '11111111-1111-4111-8111-111111111111';
  await page.evaluate(async ({ gone, newId }) => {
    const root = await navigator.storage.getDirectory();
    const liveRoot = await root.getDirectoryHandle('live-root');
    let charDir: FileSystemDirectoryHandle | null = null;
    async function walk(dir: FileSystemDirectoryHandle): Promise<void> {
      for await (const [name, h] of (dir as any).entries()) {
        if (h.kind !== 'directory') continue;
        if (name === 'character') charDir = h; else await walk(h);
      }
    }
    await walk(liveRoot);
    const dir = charDir as unknown as FileSystemDirectoryHandle;
    for await (const [name] of (dir as any).entries()) {
      if (name.endsWith(`--${gone.slice(-8)}.json`)) await dir.removeEntry(name);
    }
    const f = await dir.getFileHandle('new-arrival--11111111.json', { create: true });
    const w = await f.createWritable();
    await w.write(JSON.stringify({ id: newId, type: 'character', name: 'New Arrival' }, null, 2) + '\n');
    await w.close();
  }, { gone, newId });

  await page.evaluate(() => (window as any).__atlasTestApi.rescanNow());
  await expect(page.locator(`.atlas-row[data-element-id="${newId}"]`)).toContainText('New Arrival');
  await expect(page.locator(`.atlas-row[data-element-id="${gone}"]`)).toHaveCount(0);
  // Titus: a removal outside Atlas is said, not silent.
  await expect(page.locator('.atlas-disk-notice')).toContainText('1 removed on disk');
  await expect(page.locator('.atlas-disk-notice .atlas-disk-notice-warn', { hasText: 'removed on disk' })).toHaveAttribute('title', /Gone Soon/);
});

async function openScene(page: Page, id: string): Promise<void> {
  await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/writing/${id}`;
  }, id);
  await expect(page.locator('.atlas-writing-workspace-prose .ProseMirror')).toBeVisible({ timeout: 20000 });
}

async function storyOnDisk(page: Page, id: string): Promise<string> {
  return page.evaluate(async (id) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    return ((await store.getElement(id))?.story ?? '') as string;
  }, id);
}

test('the open scene reloads an outside edit to its story, even when Atlas keeps a rich-text copy', async ({ page }) => {
  test.slow(); // the editor chunk loads lazily
  await setupWorld(page, 'live scenes');
  const id = await createElement(page, 'narrative', { name: 'Scene', supertype: 'Book', story: 'The inn was quiet.' });
  await openScene(page, id);
  const pm = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await pm.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Rain fell.');
  // Atlas's save lands: story AND the rich-text copy now hold the typed text.
  await expect.poll(() => storyOnDisk(page, id), { timeout: 8000 }).toContain('Rain fell.');

  // The agent rewrites only `story`, the schema field it knows.
  await editFileOutside(page, id, { story: 'The inn burned down in the night.' });
  await comeBack(page);
  await expect(pm).toContainText('The inn burned down in the night.');
  await expect(pm).not.toContainText('Rain fell.');
});

test('typing that lands during the pass wins, and the room says so', async ({ page }) => {
  test.slow();
  await setupWorld(page, 'live scenes 2');
  const id = await createElement(page, 'narrative', { name: 'Scene', supertype: 'Book', story: 'First line.' });
  // A long debounce, so the typed text is still pending when the pass runs.
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = api.getState().registry;
    api.patchSlice('registry', { ...reg, sync_debounce_ms: 60_000 });
  });
  await openScene(page, id);
  await editFileOutside(page, id, { story: 'Written by the agent.' });
  const pm = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await pm.click();
  await page.keyboard.press('End');
  await page.keyboard.type(' Mine.');
  // Hold the flush so the typing counts as "during the pass": fire the pass
  // straight from the store (no flush) and the room's event, as the app does.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const r = await api.getActiveStore().rescanDisk();
    api.patchData(await api.getActiveStore().listElements());
    document.dispatchEvent(new CustomEvent('atlas:disk-changes', { detail: { changes: r.changes } }));
  });
  await expect(page.locator('.ow-toast', { hasText: 'also changed on disk' })).toBeVisible();
  await expect(pm).toContainText('Mine.');
});

test('the open knowledge entry reloads an outside edit', async ({ page }) => {
  test.slow();
  await setupWorld(page, 'live knowledge');
  const id = await createElement(page, 'narrative', { name: 'rumor', subtype: 'knowledge', story: 'The count is away.' });
  await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/knowledge/${id}`;
  }, id);
  const pm = page.locator('.atlas-knowledge-prose-rich .ProseMirror');
  await expect(pm).toContainText('The count is away.', { timeout: 20000 });
  await editFileOutside(page, id, { story: 'The count has returned.' });
  await comeBack(page);
  await expect(pm).toContainText('The count has returned.');
});

test('the element list marks what changed on disk: a count, a filter, a dot until opened', async ({ page }) => {
  await setupWorld(page, 'live marks');
  const a = await createElement(page, 'character', { name: 'Aster' });
  await createElement(page, 'character', { name: 'Birch' });
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await editFileOutside(page, a, { description: 'the agent was here' });
  await page.evaluate(() => (window as any).__atlasTestApi.rescanNow());

  const bar = page.locator('.atlas-disk-notice');
  await expect(bar).toHaveAttribute('data-active', 'true');
  await expect(bar).toContainText('1 changed on disk');
  await expect(page.locator(`.atlas-row[data-element-id="${a}"]`)).toHaveAttribute('data-disk-changed', 'true');

  // "show" narrows the list to what changed; "show all" brings the rest back.
  await bar.locator('[data-disk-action="show"]').click();
  await expect(page.locator('.atlas-list .atlas-row')).toHaveCount(1);
  await bar.locator('[data-disk-action="show"]').click();
  await expect(page.locator('.atlas-list .atlas-row')).toHaveCount(2);

  // Opening the element clears its mark, and with it the notice.
  await page.locator(`.atlas-row[data-element-id="${a}"]`).click();
  await expect(page.locator(`.atlas-row[data-element-id="${a}"]`)).not.toHaveAttribute('data-disk-changed', 'true');
  await expect(bar).toHaveAttribute('data-active', 'false');
});

// Convention 103: a thing a row reads joins the list memo's inputs. The arrival
// flash repaints the list on its own, so only a change to the marks ALONE
// (the dismiss) proves the marks are an input.
test('dismissing the notice clears the row marks, with nothing else changing', async ({ page }) => {
  await setupWorld(page, 'live dismiss');
  const b = await createElement(page, 'character', { name: 'Birch' });
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await editFileOutside(page, b, { description: 'outside' });
  await page.evaluate(() => (window as any).__atlasTestApi.rescanNow());
  const row = page.locator(`.atlas-row[data-element-id="${b}"]`);
  await expect(row).toHaveAttribute('data-disk-changed', 'true');
  await expect(row).not.toHaveAttribute('data-flash', 'true', { timeout: 5000 }); // the flash has ended
  await page.locator('.atlas-disk-notice [data-disk-action="dismiss"]').click();
  await expect(row).not.toHaveAttribute('data-disk-changed', 'true');
});

test('"reload from disk" in Ctrl+K runs a pass and says what it found', async ({ page }) => {
  await setupWorld(page, 'live command');
  const a = await createElement(page, 'character', { name: 'Cedar' });
  await editFileOutside(page, a, { description: 'outside' });
  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('reload');
  await expect(page.locator('.atlas-cmdk-row[data-kind="action"]')).toContainText('Reload from disk');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ow-toast', { hasText: '1 element changed on disk.' })).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('reload');
  await page.keyboard.press('Enter');
  await expect(page.locator('.ow-toast', { hasText: 'Nothing changed on disk.' })).toBeVisible();
});

// The world's notes travel in its folder.
async function prefsOnDisk(page: Page): Promise<any> {
  return page.evaluate(async () => {
    async function find(dir: FileSystemDirectoryHandle): Promise<FileSystemFileHandle | null> {
      for await (const [name, h] of (dir as any).entries()) {
        if (h.kind === 'directory') { const f = await find(h); if (f) return f; }
        else if (name === 'world-prefs.json') return h;
      }
      return null;
    }
    const root = await navigator.storage.getDirectory();
    const h = await find(await root.getDirectoryHandle('live-root'));
    return h ? JSON.parse(await (await h.getFile()).text()) : null;
  });
}

test('world notes are written to the folder, and a browser that lost them gets them back from it', async ({ page }) => {
  await setupWorld(page, 'noted world');
  await page.click('[data-action="open-notes"]');
  await page.locator('.atlas-notes-textarea').fill('The ferryman owes us two silver.');
  await expect.poll(async () => (await prefsOnDisk(page))?.notes, { timeout: 5000 }).toBe('The ferryman owes us two silver.');

  // This browser forgets (site data cleared for the registry's copy): the
  // folder still has them, and the next open brings them back.
  await page.evaluate(() => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    delete reg.worlds[0].notes;
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
    localStorage.removeItem('atlas_world_prefs_synced');
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("noted world")');
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds[0].notes), { timeout: 5000 })
    .toBe('The ferryman owes us two silver.');
});

// The reload remount keeps the writer's place.
test('a scene reloaded from disk keeps the editor focused', async ({ page }) => {
  test.slow();
  await setupWorld(page, 'live focus');
  const id = await createElement(page, 'narrative', { name: 'Scene', supertype: 'Book', story: 'Line one.' });
  await openScene(page, id);
  const pm = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await pm.click();
  await expect(pm).toBeFocused();
  await editFileOutside(page, id, { story: 'Line one, rewritten by the agent.' });
  await comeBack(page);
  await expect(pm).toContainText('rewritten by the agent');
  await expect(page.locator('.atlas-writing-workspace-prose .ProseMirror')).toBeFocused();
});
