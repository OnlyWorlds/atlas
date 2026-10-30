/**
 * Folder spec §4.8, the viewer's half and the page's (conv. 170; contract
 * H2 and H3): in a world
 * on disk, an element whose file carries the hidden mark shows the word Hidden
 * in the list, Home's Recent and Search, the glyph with the folder line on its
 * page, and stays counted; a page that shows it publishes without it, and the
 * builder says so.
 */
import { test, expect, type Page } from '@playwright/test';

const AT = '2026-10-22T00:00:00.000Z';
const WREN = '0192a000-0000-7000-8000-000000058701';
const ADA = '0192a000-0000-7000-8000-000000058702';
const PAGE = '0192a000-0000-7000-8000-000000058703';
const FOLDER_LINE = 'Hidden: shown to you here, and left out of a published page.';

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
    api.setNextDirectory(await root.getDirectoryHandle('hidden-mark-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'harbour');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  // Past its first steps (as Done writes): while the path is open the cover holds back its count
  // line, so nothing above the grid moves with an act.
  await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const s = getState();
    const next = (reg as any).updateWorldEntry(s.registry, s.active!.worldId, { guide_step: 'done' });
    (reg as any).saveRegistry(next);
    patchSlice('registry', next);
  });
}

async function put(page: Page, type: string, id: string, name: string, extra: Record<string, unknown> = {}) {
  await page.evaluate(async ({ type, id, name, extra, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim(type, { id, type, name, local_updated_at: at, ...extra });
    api.patchData(await store.listElements());
  }, { type, id, name, extra, at: AT });
}

test.describe('hidden, in a world on disk', () => {
  test('the holder sees the word everywhere, the count keeps it, and a page leaves it out', async ({ page }) => {
    await setupWorld(page);
    await put(page, 'character', ADA, 'Ada', { friends: [WREN] });
    await put(page, 'character', WREN, 'Wren', { hidden: true, description: 'Opens the gate at dawn.' });
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
    const go = (hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);

    // Home: counted (a hidden element is the world's own), and Recent says the word.
    await go(`#/w/${wid}`);
    await expect(page.locator('.atlas-home-statline')).toContainText('2 characters');
    const recent = page.locator('.atlas-home-continue-row', { hasText: 'Wren' }).locator('[data-role="hidden-word"]');
    await expect(recent).toHaveText('Hidden');
    await expect(recent).toHaveAttribute('title', FOLDER_LINE);

    // The list: Wren says it, Ada does not.
    const row = (name: string) => page.locator('.atlas-list .atlas-row', { hasText: name });
    await expect(row('Wren').locator('[data-role="hidden-word"]')).toHaveText('Hidden');
    await expect(row('Ada').locator('[data-role="hidden-word"]')).toHaveCount(0);

    // Its page: the folder line in a sentence under the name, and no glyph in the header,
    // so the name keeps its room (Seethe 2026-10-23); Ada's page says nothing.
    await go(`#/w/${wid}/element/${WREN}`);
    await expect(page.locator('[data-role="hidden-note"]')).toHaveText(FOLDER_LINE);
    await expect(page.locator('.atlas-middle-header [data-role="hidden-mark"]')).toHaveCount(0);
    await go(`#/w/${wid}/element/${ADA}`);
    await expect(page.locator('.atlas-middle-header [data-role="element-name"]')).toHaveText(/Ada/);
    await expect(page.locator('[data-role="hidden-note"]')).toHaveCount(0);

    // Search.
    const cmdkInput = page.locator('.atlas-cmdk-input');
    await page.keyboard.press('Control+k');
    await expect(cmdkInput).toBeFocused();
    await page.keyboard.type('Wren');
    await expect(page.locator('.atlas-cmdk-row', { hasText: 'Wren' }).locator('[data-role="hidden-word"]')).toHaveText('Hidden');
    await page.keyboard.press('Escape');
    await expect(cmdkInput).toHaveCount(0);

    // A page with both on it: the builder says what publishing leaves out.
    await put(page, 'narrative', PAGE, 'Harbour primer', {
      subtype: 'page', atlas_page_intent: 'reference',
      atlas_page_blocks: [
        { id: 'b1', kind: 'element-card', elementId: ADA, variant: 'full', fields: ['friends'] },
        { id: 'b2', kind: 'element-card', elementId: WREN, variant: 'full', fields: ['description'] },
      ],
    });
    await go(`#/w/${wid}/share/${PAGE}`);
    await expect(page.locator('[data-role="share-proposed-note"]')).toHaveText('Wren is hidden, so the published page leaves it out.');
  });
});
