/**
 * THE FRONT DOOR (S365): a world folder opens on the very first visit.
 *
 * The OnlyWorlds toolkit tells people "open Atlas and pick the world folder
 * your AI made". Before S365 a first-visit pick of a world folder answered
 * with a hint naming a sidebar button that was not on screen yet. Now a world
 * folder opens in place from the landing, with no home folder; the home
 * folder is asked for when the user first makes a NEW world.
 */

import { test, expect, type Page } from '@playwright/test';

const WORLD_ID = '00000000-0000-4000-8000-00000000f00d';

async function freshBoot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

/** A world folder as another tool writes it (world.json + one element), handed to the next picker. */
async function seedWorldFolderForPicker(page: Page, dirName: string): Promise<void> {
  await page.evaluate(async ({ dirName, worldId }) => {
    const api = (window as any).__atlasTestApi;
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry(dirName, { recursive: true }); } catch { /* fresh */ }
    const dir = await opfs.getDirectoryHandle(dirName, { create: true });
    const put = async (d: FileSystemDirectoryHandle, name: string, body: unknown) => {
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(JSON.stringify(body, null, 2) + '\n');
      await w.close();
    };
    await put(dir, 'world.json', { id: worldId, name: 'Agent World' });
    const chars = await (await dir.getDirectoryHandle('elements', { create: true }))
      .getDirectoryHandle('character', { create: true });
    await put(chars, 'gil.json', { id: '00000000-0000-4000-8000-0000000000a1', name: 'Gil the Agent' });
    api.setNextDirectory(dir);
  }, { dirName, worldId: WORLD_ID });
}

test('first visit: "open a world folder" opens the world in place, no home folder asked', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world');
  await page.click('[data-action="open-world-folder"]');

  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await expect(page.getByText('Gil the Agent').first()).toBeVisible();
  const root = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot);
  expect(root).toBeNull();
});

test('first visit: the setup door, pointed at a world folder, opens it instead of refusing', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-2');
  await page.click('[data-action="setup-atlas"]');

  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await expect(page.getByText('Gil the Agent').first()).toBeVisible();
  // It opened the WORLD; it did not make a home folder inside someone's world.
  const root = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot);
  expect(root).toBeNull();
});

test('a world opened without a home folder: a reload shows the world list, not the landing', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-3');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();

  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('[data-action="open-world-folder"]')).toHaveCount(0);
  await expect(page.locator('.atlas-sidebar').getByText('Agent World').first()).toBeVisible();
});

test('the first NEW world asks where worlds live, then creates it there', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-4');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();

  await page.goto('/#/');
  await page.waitForSelector('.atlas-shell');
  // 1.17: the create dialog asks where first; the folder row asks for a home
  // folder inside the Create click, then makes the world there.
  await page.locator('[data-action="create-local"]').click();
  const dialog = page.locator('[data-modal="create-world"]');
  await dialog.locator('input[name="where"][value="folder"]').check();
  await dialog.locator('input[name="world-name"]').fill('Folder World');
  await dialog.locator('[data-action="pick"]').click();
  const ask = page.locator('[data-modal="home-folder"]');
  await expect(ask).toBeVisible();

  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const home = await opfs.getDirectoryHandle('front-door-home', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(home);
  });
  await ask.locator('[data-action="choose"]').click();
  await expect(dialog).toHaveCount(0);
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    const w = s.registry.worlds.find((x: any) => x.name === 'Folder World');
    return { root: s.atlasRoot, where: w ? (w.where ?? 'folder') : null };
  });
  expect(after.root).not.toBeNull();
  expect(after.where).toBe('folder');
});

test('cancelling the home-folder question creates nothing', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-5');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.goto('/#/');
  await page.waitForSelector('.atlas-shell');
  await page.locator('[data-action="create-local"]').click();
  const dialog = page.locator('[data-modal="create-world"]');
  await dialog.locator('input[name="where"][value="folder"]').check();
  await dialog.locator('[data-action="pick"]').click();
  await page.locator('[data-modal="home-folder"] [data-action="cancel"]').click();
  await expect(page.locator('[data-modal="home-folder"]')).toHaveCount(0);
  // The create dialog stays, so the user can choose again (1.17); nothing is made.
  await expect(dialog).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { root: s.atlasRoot, worlds: s.registry.worlds.length };
  });
  expect(after.root).toBeNull();
  expect(after.worlds).toBe(1); // only the world opened in place above
});

test('"add a world" opens the chooser; its open-a-world row opens a picked world', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-6');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();

  // A second world folder, through the chooser this time.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const dir = await opfs.getDirectoryHandle('agent-world-7', { create: true });
    const w = await (await dir.getFileHandle('world.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ id: '00000000-0000-4000-8000-00000000f00e', name: 'Second World' }));
    await w.close();
    (window as any).__atlasTestApi.setNextDirectory(dir);
  });
  await page.locator('[data-action="add-world"]').click();
  const chooser = page.locator('[data-modal="add-world"]');
  await expect(chooser.locator('[data-choice]')).toHaveCount(5);
  await chooser.locator('[data-choice="open-folder"]').click();
  await expect(page.locator('h1', { hasText: 'Second World' })).toBeVisible();
});

test('Settings can hide the add-world icons; "add a world" stays, across a reload', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-8');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toBeVisible();

  // Through the real toggle (S365 gate lens C M8: the old test patched state).
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/general`; }, worldId);
  const toggle = page.locator('input[name="worlds-add-icons"]');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.evaluate((id) => { window.location.hash = `#/w/${id}`; }, worldId);
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toHaveCount(0);
  await expect(page.locator('.atlas-worlds-header [data-action="add-world"]')).toBeVisible();

  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.atlas-worlds-header [data-action="add-world"]')).toBeVisible();
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toHaveCount(0);
});

test('the open-a-world door does not switch an existing home folder', async ({ page }) => {
  await freshBoot(page);
  // A home folder first.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const home = await opfs.getDirectoryHandle('door-home-1', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(home);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForFunction(() => !!(window as any).__atlasTestApi.getState().atlasRoot);
  const before = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot.folderName);

  // Then the open-a-world door pointed at ANOTHER folder that keeps worlds.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const other = await opfs.getDirectoryHandle('door-home-2', { create: true });
    const wrap = await other.getDirectoryHandle('onlyworlds-atlas', { create: true });
    const w = await (await wrap.getFileHandle('.atlas-root', { create: true })).createWritable();
    await w.write('{"version":1}'); await w.close();
    (window as any).__atlasTestApi.setNextDirectory(other);
  });
  await page.locator('.atlas-worlds-header [data-action="open-folder"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Settings, then Storage' })).toBeVisible();
  const after = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot);
  expect(after.folderName).toBe(before);
});
