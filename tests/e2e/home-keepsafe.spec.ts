/**
 * The keep-safe card on a browser world's home (1.17 bout 5, contract §6.1):
 * shown past the threshold, × hides it for a week (across a reload), and a
 * download from the card hides it while nothing changed since. The rules
 * themselves are the unit's (`tests/unit/home-keepsafe.test.ts`); this is
 * the room.
 */
import { test, expect, Page } from '@playwright/test';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
}

/** A browser world holding `n` characters, registered as the app registers one. */
async function seed(page: Page, n: number): Promise<string> {
  return page.evaluate(async (count) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const worldId = '0192a000-0000-7000-8000-00000000aaaa';
    const dirName = 'alpha-0192a000-1a2b';
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds', { create: true });
    const dir = await home.getDirectoryHandle(dirName, { create: true });
    const write = async (d: FileSystemDirectoryHandle, file: string, body: unknown) => {
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(JSON.stringify(body, null, 2) + '\n');
      await w.close();
    };
    await write(dir, 'world.json', { id: worldId, name: 'Alpha' });
    const chars = await (await dir.getDirectoryHandle('elements', { create: true })).getDirectoryHandle('character', { create: true });
    const at = '2026-10-01T00:00:00.000Z';
    for (let i = 0; i < count; i++) {
      const id = `0192c000-0000-7000-8000-${String(i).padStart(12, '0')}`;
      await write(chars, `c${i}--${id.slice(-8)}.json`, { id, name: `C${i}`, type: 'character', local_updated_at: at });
    }
    const { next, entry } = (reg as any).createLocalWorld(getState().registry, { name: 'Alpha', folderName: dirName, handleKey: `world-${worldId}`, pathHint: `browser storage/${dirName}` });
    const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
    (reg as any).saveRegistry(withWhere);
    patchSlice('registry', withWhere);
    return entry.id as string;
  }, n);
}

async function openHome(page: Page, id: string) {
  await page.evaluate(async (wid) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    await (activateWorld as any)(wid, toastManager);
    window.location.hash = `#/w/${wid}`;
  }, id);
}

test('the keep-safe card: shown past the threshold, × hides it for a week across a reload', async ({ page }) => {
  await boot(page);
  const id = await seed(page, 25);
  await openHome(page, id);
  const card = page.locator('[data-role="keepsafe"]');
  await expect(card.locator('h2')).toHaveText('This world lives only in this browser');
  await expect(card).toContainText('Download a copy, or move it to a folder on your drive.');
  await expect(card.locator('.atlas-home-keepsafe-actions button')).toHaveText(['Download the whole world', 'Move to a folder', 'Take it online']);
  await expect(card.locator('[data-action="keepsafe-hide"]')).toHaveAttribute('aria-label', 'Hide for a week');
  await card.locator('[data-action="keepsafe-hide"]').click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await openHome(page, id);
  await expect(page.locator('.atlas-home-cover, .atlas-home-section-title').first()).toBeVisible();
  await expect(page.locator('[data-role="keepsafe"]')).toHaveCount(0);
});

test('the keep-safe card: below the threshold it stays away; a download from it hides it', async ({ page }) => {
  await boot(page);
  const id = await seed(page, 24);
  await openHome(page, id);
  await expect(page.locator('.atlas-home-cover, .atlas-home-section-title').first()).toBeVisible();
  await expect(page.locator('[data-role="keepsafe"]')).toHaveCount(0);

  await boot(page);
  const id2 = await seed(page, 30);
  await openHome(page, id2);
  const card = page.locator('[data-role="keepsafe"]');
  await expect(card).toBeVisible();
  await page.evaluate(() => {
    (window as any).showSaveFilePicker = async () => (await navigator.storage.getDirectory()).getFileHandle('kept.zip', { create: true });
  });
  await card.locator('[data-action="keepsafe-download"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Keep it: it brings this world back.' })).toBeVisible();
  await expect(card).toHaveCount(0);
});
