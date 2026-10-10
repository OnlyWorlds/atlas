/**
 * Fully forget (Atlas #140) through the real page: Settings, Storage names
 * the world that exists only here, the button waits for the word, another
 * open Atlas tab stops it (it would put the list of worlds back), and with
 * that tab closed the forget leaves nothing: the reload is the first-visit
 * landing, browser storage and both storages empty.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';

// As browser-worlds.spec.ts boots and opens the create dialog.
async function freshBoot(page: Page) {
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

async function browserWorld(page: Page, name: string): Promise<string> {
  await page.evaluate(async () => {
    const { runAddWorldAction } = await import('/src/setup/world-doors.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    void (runAddWorldAction as any)('create-local', toastManager);
  });
  await page.waitForSelector('[data-modal="create-world"]');
  const browser = page.locator('[data-modal="create-world"] input[name="where"][value="browser"]');
  if (await browser.count()) await browser.check();
  await page.fill('[data-modal="create-world"] input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await page.waitForSelector('[data-role="elements-search"]');
  return page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
}

async function forgetFlow(page: Page, context: BrowserContext): Promise<void> {
  await freshBoot(page);
  const worldId = await browserWorld(page, 'Lonely Reach');
  // A remembered folder, so the vault check below has something to clear.
  await page.evaluate(async () => {
    const { storeHandle } = await import('/src/store/handle-vault.ts');
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('a-picked-folder', { create: true });
    await storeHandle('probe-folder', dir);
  });
  expect(await page.evaluate(async () => (await import('/src/store/handle-vault.ts')).listHandleKeys())).toContain('probe-folder');
  await page.evaluate((w) => { window.location.hash = `#/w/${w}/settings/storage`; }, worldId);
  await page.click('[data-action="forget-browser"]');

  const modal = page.locator('[data-modal="forget-browser"]');
  await expect(modal.locator('[data-role="lost"]')).toContainText('Gone for good');
  await expect(modal.locator('[data-role="lost"]')).toContainText('Lonely Reach');
  const go = modal.locator('[data-action="forget"]');
  await expect(go).toBeDisabled();
  await modal.locator('input[name="confirm-word"]').fill('forget');
  await expect(go).toBeEnabled();

  // A second Atlas tab answers the roll call: nothing is removed.
  const other = await context.newPage();
  await other.goto('/');
  await other.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await go.click();
  await expect(modal.locator('[data-role="error"]')).toContainText("Close Atlas's other tab first");
  expect(await page.evaluate(() => localStorage.getItem('atlas_worlds_registry'))).toContain('Lonely Reach');
  await other.close();

  await go.click();
  await page.waitForURL(/\/$/);
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await expect(page.locator('[data-action="start-world"]')).toBeVisible(); // the first-visit landing
  const left = await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const names: string[] = [];
    for await (const n of (root as any).keys()) names.push(n);
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry') ?? '{"worlds":[]}');
    // The fresh boot may open the vault again (an empty one): what counts is
    // that no remembered folder survived.
    const { listHandleKeys } = await import('/src/store/handle-vault.ts');
    return { opfs: names, worlds: reg.worlds?.length ?? 0, handles: await listHandleKeys() };
  });
  // The fresh boot's own storage probe (capabilities.ts) writes and removes
  // one `.atlas-storage-probe-*` file; a read can land between the two
  // (Firefox, 2 runs in 6). Wait for the root to settle empty.
  await expect.poll(() => page.evaluate(async () => {
    const names: string[] = [];
    for await (const n of ((await navigator.storage.getDirectory()) as any).keys()) names.push(n);
    return names;
  }), { timeout: 5000 }).toEqual([]);
  expect(left.opfs.filter(n => !n.startsWith('.atlas-storage-probe-'))).toEqual([]);
  expect(left.worlds).toBe(0);
  expect(left.handles).toEqual([]);
}

const TITLE = 'forget: the world kept only here is named, another tab stops it, then the reload is a first visit';
test(TITLE, async ({ page, context }) => { await forgetFlow(page, context); });
test(`@firefox ${TITLE}`, async ({ page, context }) => { await forgetFlow(page, context); });
