/**
 * A day's world file beside the world it copies (#527's second half, conv.
 * 177): the world is already here, so the toast offers Open a copy beside
 * it; the copy opens view-only under its own id, both rows carry the world's
 * name and the copy's says so with its day, Home and the pill say what it is,
 * nothing offers to edit it or take it online, and a reload keeps it a copy.
 */
import { test, expect, Page } from '@playwright/test';
import { zipSync, strToU8 } from 'fflate';

const WID = '0192a000-0000-7000-8000-00000000cccc';
const AT = '2026-10-24T03:30:00+00:00';
const j = (v: unknown) => JSON.stringify(v, null, 2) + '\n';
const DAY_FILE = Buffer.from(zipSync({
  'hollow-reach/world.json': strToU8(j({ id: WID, name: 'Hollow Reach', source: { server: 'https://www.onlyworlds.com', world: WID, at: AT } })),
  'hollow-reach/elements/character/ana--0000ana0.json': strToU8(j({ id: '0192a000-0000-7000-8000-00000000a0a0', name: 'Ana' })),
}));

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

const activeId = (page: Page) => page.evaluate(() => location.hash.match(/#\/w\/([^/]+)/)?.[1] ?? null);

async function dropInData(page: Page, worldId: string) {
  await page.evaluate((wid) => { window.location.hash = `#/w/${wid}/import`; }, worldId);
  await page.locator('[data-role="file"]').setInputFiles({ name: 'hollow-reach-2026-10-24.owworld', mimeType: '', buffer: DAY_FILE });
}

for (const engine of ['chromium', 'firefox'] as const) {
  test(`${engine === 'firefox' ? '@firefox ' : ''}a world file whose world is here opens beside it as a view-only copy`, async ({ page }) => {
    await boot(page);
    // The world itself, from the same file (a browser world under its own id).
    const firstId = await page.evaluate(async (bytes) => {
      const { openWorldFile } = await import('/src/setup/world-file-open.ts');
      const out = await (openWorldFile as any)(new Uint8Array(bytes));
      const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
      const { toastManager } = await import('/src/ui/toast-manager.ts');
      await (activateWorld as any)(out.worldId, toastManager);
      return out.worldId as string;
    }, [...DAY_FILE]);

    await dropInData(page, firstId);
    const toast = page.locator('.ow-toast', { hasText: 'This world is already in Atlas.' });
    await expect(toast).toBeVisible();
    await toast.getByRole('button', { name: 'Open a copy beside it' }).click();
    await expect(page.locator('.ow-toast', { hasText: /Opened a copy of Hollow Reach from .*2026, view only\./ })).toBeVisible();
    await expect.poll(() => activeId(page)).not.toBe(firstId);
    const copyId = (await activeId(page))!;

    // Both rows carry the world's name; the copy's says so, with its day.
    const rows = page.locator('.atlas-row', { hasText: 'Hollow Reach' });
    await expect(rows).toHaveCount(2);
    await expect(page.locator('.atlas-world-state-chip', { hasText: /^copy, / })).toHaveCount(1);

    // Home and the pill say what it is and where the world itself is; nothing offers an edit or Make online.
    await page.evaluate((wid) => { window.location.hash = `#/w/${wid}`; }, copyId);
    const note = page.locator('[data-role="copy-note"]');
    await expect(note).toHaveText(/^A copy of Hollow Reach from .*2026, view only\. The world itself is Hollow Reach in your list of worlds\.$/);
    await expect(page.locator('.atlas-home-world-name[data-edit]')).toHaveCount(0);
    await expect(page.locator('[data-action="keepsafe-online"]')).toHaveCount(0);
    await expect(page.locator('.atlas-sync-pill', { hasText: 'Copy, view only' })).toBeVisible();

    // The store refuses a write, in the copy's own words; the world itself is untouched.
    const refused = await page.evaluate(async () => {
      const { getActiveStore } = await import('/src/core/active-store.ts');
      try { await (getActiveStore() as any).writeWorldMeta({ name: 'Renamed' }); return null; } catch (e) { return String((e as Error).message); }
    });
    expect(refused).toBe('This is a view-only copy, so it cannot be changed here. Edit the world itself, in your list of worlds.');

    // A reload keeps it a copy.
    await page.reload();
    await page.waitForSelector('.atlas-shell');
    await page.evaluate((wid) => { window.location.hash = `#/w/${wid}`; }, copyId);
    await expect(page.locator('[data-role="copy-note"]')).toBeVisible();
    const entries = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.map((w: any) => ({ id: w.id, copy_of: w.copy_of ?? null })));
    expect(entries).toEqual(expect.arrayContaining([
      { id: firstId, copy_of: null },
      { id: copyId, copy_of: { world_id: WID, at: AT } },
    ]));
  });
}
