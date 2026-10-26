/**
 * Conv. 176 (Seethe 2026-10-24): a world whose folder holds a file that will
 * not read as an element opens without it, as before, and now says so in the
 * live folder's line ("1 cannot be read", the file named in its title). Before
 * 1.89.0 the world opened one element short with no word.
 */
import { test, expect, Page } from '@playwright/test';

const WID = '0192a000-0000-7000-8000-00000000c0c0';

async function boot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
}

/** A browser world written raw: Ada, and a character file cut short mid-name. */
async function seedWorldWithBrokenFile(page: Page, broken: boolean): Promise<string> {
  return page.evaluate(async ({ worldId, broken }) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const dirName = 'cleft-0192a000-c0c0';
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds', { create: true });
    const dir = await home.getDirectoryHandle(dirName, { create: true });
    const write = async (d: FileSystemDirectoryHandle, file: string, body: string) => {
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(body);
      await w.close();
    };
    await write(dir, 'world.json', JSON.stringify({ id: worldId, name: 'Cleft' }, null, 2) + '\n');
    const chars = await (await dir.getDirectoryHandle('elements', { create: true })).getDirectoryHandle('character', { create: true });
    await write(chars, 'ada--0000ada0.json', JSON.stringify({ id: `${worldId.slice(0, -4)}ada0`, name: 'Ada', type: 'character' }, null, 2) + '\n');
    if (broken) await write(chars, 'broken.json', `{"id": "${worldId.slice(0, -4)}b0b0", "name": "Broken`);
    const { next, entry } = (reg as any).createLocalWorld(getState().registry, {
      name: 'Cleft', folderName: dirName, handleKey: `world-${worldId}`, pathHint: `browser storage/${dirName}`,
    });
    const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
    (reg as any).saveRegistry(withWhere);
    patchSlice('registry', withWhere);
    return entry.id as string;
  }, { worldId: WID, broken });
}

async function open(page: Page, worldId: string) {
  expect(await page.evaluate(async (id) => {
    const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    return (activateWorld as any)(id, toastManager);
  }, worldId)).toBe(true);
  await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    patchSlice('ui', { ...getState().ui, sidebarMode: 'elements' });
  });
}

test('a folder file that will not read is left out and said: "1 cannot be read", the file named', async ({ page }) => {
  await boot(page);
  await open(page, await seedWorldWithBrokenFile(page, true));
  const line = page.locator('.atlas-disk-notice-warn', { hasText: '1 cannot be read' });
  await expect(line).toBeVisible();
  await expect(line).toHaveAttribute('title', /character\/broken\.json/);
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.map((e: any) => e.name))).toEqual(['Ada']);
});

test('a world with every file readable says nothing', async ({ page }) => {
  await boot(page);
  await open(page, await seedWorldWithBrokenFile(page, false));
  await expect(page.getByText('Ada').first()).toBeVisible();
  await expect(page.locator('.atlas-disk-notice-warn', { hasText: 'cannot be read' })).toHaveCount(0);
});
