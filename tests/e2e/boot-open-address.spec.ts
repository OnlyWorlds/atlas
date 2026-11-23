/**
 * Settings pressed while the world in the address is still opening after a
 * reload stays Settings (1.125.8): the open used to finish by putting the
 * world's Home in its place. The spec holds the open itself, by making its
 * read of the world's `elements` directory wait in browser storage, so the
 * press lands inside it every run. Runs in Chromium and, tagged @firefox, in
 * real Firefox.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  // The boot reconciliation runs first on the activation chain; a seed
  // written while it runs is adopted twice. A no-op task queued behind it
  // waits it out (as `browser-worlds.spec.ts` does).
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
}

/** One browser world, registered as the app registers one, and opened. */
async function seedAndOpen(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds', { create: true });
    const dirName = 'lands-0192c000-5e6f';
    const worldId = '0192c000-0000-7000-8000-00000000cccc';
    const dir = await home.getDirectoryHandle(dirName, { create: true });
    const w = await (await dir.getFileHandle('world.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ id: worldId, name: 'Landing' }, null, 2) + '\n');
    await w.close();
    const { next, entry } = (reg as any).createLocalWorld(getState().registry, {
      name: 'Landing', folderName: dirName, handleKey: `world-${worldId}`, pathHint: `browser storage/${dirName}`,
    });
    const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
    (reg as any).saveRegistry(withWhere);
    patchSlice('registry', withWhere);
    return entry.id as string;
  });
  expect(await page.evaluate(async (wid) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    return (activateWorld as any)(wid, toastManager);
  }, id)).toBe(true);
  await expect(page).toHaveURL(new RegExp(`#/w/${id}$`));
  return id;
}

const activeWorld = (page: Page) => page.evaluate(async () => (await import('/src/core/state.ts')).getState().active?.worldId ?? null);

async function settingsPressedWhileItOpens(page: Page) {
  await boot(page);
  const id = await seedAndOpen(page);
  await page.addInitScript(() => {
    const w = window as any;
    const hold = new Promise<void>((r) => { w.__release = r; });
    const proto = FileSystemDirectoryHandle.prototype as any;
    const real = proto.getDirectoryHandle;
    proto.getDirectoryHandle = async function (name: string, opts: unknown) {
      if (name === 'elements') { w.__held = true; await hold; }
      return real.call(this, name, opts);
    };
    // Every Home drawn after the press counts, a flash included.
    w.__homes = 0;
    new MutationObserver((records) => {
      if (!w.__pressed) return;
      for (const rec of records) for (const n of Array.from(rec.addedNodes)) {
        if (n instanceof Element && (n.matches('.atlas-world-home') || n.querySelector('.atlas-world-home'))) w.__homes++;
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.waitForFunction(() => (window as any).__held === true);
  expect(await activeWorld(page)).toBeNull();

  await page.evaluate(() => { (window as any).__pressed = true; });
  await page.click('[data-action="open-settings"]');
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.locator('.atlas-settings')).toBeVisible();

  await page.evaluate(() => (window as any).__release());
  await expect.poll(() => activeWorld(page)).toBe(id);
  // The open's last steps done: a task queued behind it on the chain has run.
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
  expect(new URL(page.url()).hash).toMatch(/^#\/settings/);
  await expect(page.locator('.atlas-settings')).toBeVisible();

  // The world is open behind it: its tab is live, and leads to its address.
  await page.click('[data-settings-tab="world"]');
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/settings/world$`));
  await expect(page.locator('[data-settings-tab="world"]')).toHaveAttribute('aria-selected', 'true');
  expect(await page.evaluate(() => (window as any).__homes)).toBe(0);
}

test('Settings pressed while the world in the address opens stays Settings', async ({ page }) => {
  await settingsPressedWhileItOpens(page);
});

test('@firefox Settings pressed while the world in the address opens stays Settings', async ({ page }) => {
  await settingsPressedWhileItOpens(page);
});
