/**
 * A world's own words for the types (the names profile, 1.81.0; the names-profile
 * contract).
 *
 * A work world's world.json carries x_names; the words arrive after the
 * elements (as a pull would bring them), so the sidebar's list and type strip
 * must redraw on the words alone (both were left on the standard's words
 * until the words joined their keys). One word is hostile markup: it
 * prints as text everywhere it shows.
 */

import { test, expect, Page } from '@playwright/test';

const HOSTILE = '<img src=x onerror="window.__pwned=1">';
const X_NAMES = {
  version: 1,
  types: {
    character: { one: 'Employee', many: 'Employees' },
    institution: { one: 'Team', many: 'Teams' },
    law: { one: HOSTILE },
  },
  supertypes: { character: { Agent: { one: 'AI agent', many: 'AI agents' } } },
};

async function setupWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('type-words-root', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Work');
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

/** Elements first, then the words, as a pull that brings only the map would. */
async function seed(page: Page, withMap: boolean) {
  await page.evaluate(async ({ xNames, withMap }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Ada' });
    await store.createElement('character', { name: 'Bot', supertype: 'Agent' });
    await store.createElement('institution', { name: 'Ops' });
    await store.createElement('law', { name: 'Leave policy' });
    api.patchData(await store.listElements());
    if (!withMap) return;
    await store.writeWorldMeta({ x_names: xNames });
    const { getState, patchSlice } = await import('/src/core/state.ts');
    patchSlice('active', { ...getState().active, meta: await store.readWorldMeta() });
  }, { xNames: X_NAMES, withMap });
}

const rowMeta = (page: Page, name: string) =>
  page.locator('.atlas-row', { hasText: name }).locator('.atlas-row-meta');

test('a work world shows its own words in the sidebar, its supertype word, and markup as text', async ({ page }) => {
  await setupWorld(page);
  await seed(page, true);
  await expect(rowMeta(page, 'Ada')).toHaveText('Employee');
  await expect(rowMeta(page, 'Bot')).toHaveText('AI agent');
  await expect(rowMeta(page, 'Ops')).toHaveText('Team');
  await expect(rowMeta(page, 'Leave policy')).toHaveText(HOSTILE);
  await expect(page.locator('[data-filter-type="character"]')).toHaveAttribute('aria-label', 'Employees');
  await expect(page.locator('.atlas-home-statline')).toContainText('2 Employees');
  expect(await page.evaluate(() => (window as any).__pwned ?? null)).toBeNull();
  expect(await page.locator('img[src="x"]').count()).toBe(0);
});

// Seethe 2026-10-23: the supertype chip says the world's word as the rows do, and search says it once.
for (const own of [true, false]) {
  test(`the supertype chip and search's hint, ${own ? 'in the world\'s words' : 'without them'}`, async ({ page }) => {
    await setupWorld(page);
    await seed(page, own);
    await page.locator('[data-filter-type="character"]').click();
    await expect(page.locator('.atlas-subfilter-chip').first()).toHaveText(own ? 'AI agent' : 'Agent');
    await page.keyboard.press('Control+k');
    await page.locator('[data-role="cmdk-input"]').fill('Bot');
    await expect(page.locator('.atlas-cmdk-row', { hasText: 'Bot' }).locator('.atlas-cmdk-rowhint').first())
      .toHaveText(own ? 'AI agent' : 'character · Agent');
  });
}

test('a world without its own words prints the standard names, as before', async ({ page }) => {
  await setupWorld(page);
  await seed(page, false);
  await expect(rowMeta(page, 'Ada')).toHaveText('character');
  await expect(rowMeta(page, 'Bot')).toHaveText('character');
  await expect(page.locator('[data-filter-type="character"]')).toHaveAttribute('aria-label', 'characters');
  await expect(page.locator('.atlas-home-statline')).toContainText('2 characters');
});
