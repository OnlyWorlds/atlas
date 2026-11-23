/**
 * A world's open lands where the person is (1.125.8, conv. 195): Settings
 * pressed while the world in the address is still opening after a reload
 * stays Settings once it has opened, and never gives way to the world's Home.
 * The open is held at its commit by the DEV hold (`window.__atlasOpenHold`,
 * `src/core/open-place.ts`), so the press lands inside it every run, as it
 * did 5 to 45 ms after the open on a fast machine. Runs in Chromium and,
 * tagged @firefox, in real Firefox.
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

/** One browser world, registered as the app registers one, opened. */
async function seedAndOpen(page: Page): Promise<string> {
  const id = await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const root = await navigator.storage.getDirectory();
    const home = await root.getDirectoryHandle('browser-worlds', { create: true });
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
  const opened = await page.evaluate(async (wid) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    return (activateWorld as any)(wid, toastManager);
  }, id);
  expect(opened).toBe(true);
  await expect(page).toHaveURL(new RegExp(`#/w/${id}$`));
  return id;
}

const activeWorld = (page: Page) => page.evaluate(async () => (await import('/src/core/state.ts')).getState().active?.worldId ?? null);

async function settingsPressedWhileItOpens(page: Page) {
  await boot(page);
  const id = await seedAndOpen(page);

  // From the next load on, every open waits at its commit until released;
  // every Home drawn after the press is counted, a flash included.
  await page.addInitScript(() => {
    const w = window as any;
    w.__atlasOpenHold = new Promise<void>((r) => { w.__atlasOpenRelease = r; });
    w.__atlasHomesDrawn = 0;
    new MutationObserver((records) => {
      if (!w.__atlasPressed) return;
      for (const rec of records) {
        for (const n of Array.from(rec.addedNodes)) {
          if (n instanceof Element && (n.matches('.atlas-world-home') || n.querySelector('.atlas-world-home'))) w.__atlasHomesDrawn++;
        }
      }
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.waitForFunction(() => ((window as any).__atlasOpenHeld ?? 0) >= 1);
  expect(await activeWorld(page)).toBeNull();

  await page.evaluate(() => { (window as any).__atlasPressed = true; });
  await page.click('[data-action="open-settings"]');
  await expect(page).toHaveURL(/#\/settings/);
  await expect(page.locator('.atlas-settings')).toBeVisible();

  await page.evaluate(() => (window as any).__atlasOpenRelease());
  await expect.poll(() => activeWorld(page)).toBe(id);
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/settings`));
  await page.click('[data-settings-tab="world"]');
  await expect(page.locator('[data-settings-tab="world"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page).toHaveURL(new RegExp(`#/w/${id}/settings/world`));
  await expect(page.locator('.atlas-world-home')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__atlasHomesDrawn)).toBe(0);
}

test('Settings pressed while the world in the address opens stays Settings, of that world', async ({ page }) => {
  await settingsPressedWhileItOpens(page);
});

test('@firefox Settings pressed while the world in the address opens stays Settings, of that world', async ({ page }) => {
  await settingsPressedWhileItOpens(page);
});
