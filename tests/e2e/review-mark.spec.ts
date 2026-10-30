/**
 * The review profile's reader rule, the half that shows a world to its people (conv. 168;
 * the contract's R2 and R3):
 * an element carrying the review profile's proposed mark shows the word
 * "Proposed" in the list, Search, Home's Recent and its own header, is never
 * counted as the world's own, and Home and the list say how many apart. A world
 * on disk: the mark is the element's own data, shown in every world state.
 */
import { test, expect, type Page } from '@playwright/test';

const AT = '2026-10-22T00:00:00.000Z';
const SEAT = '19e1c2e5-5e8e-4d46-8382-e5ad445d13a0';
const QUILL = '0192a000-0000-7000-8000-000000056501';
const QUAY = '0192a000-0000-7000-8000-000000056502';

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
    api.setNextDirectory(await root.getDirectoryHandle('review-mark-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'reviewed');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  // Past its first steps (as Done writes): while the path is open the cover holds back its cast
  // doors and count line, so nothing above the grid moves with an act.
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

const rowNames = (page: Page) => page.locator('.atlas-list .atlas-row .atlas-row-main');

test.describe('proposed, not yet reviewed', () => {
  test('a proposed element carries its word everywhere a person meets it, and is counted apart', async ({ page }) => {
    await setupWorld(page);
    await put(page, 'character', '0192a000-0000-7000-8000-000000056503', 'Ada');
    await put(page, 'character', '0192a000-0000-7000-8000-000000056504', 'Bo', { x_review_proposed: null });
    await put(page, 'character', QUILL, 'Quill', { x_review_proposed: { by: SEAT, evidence: 'seat', expires: '2099-11-22' } });
    await put(page, 'location', QUAY, 'Old Quay', { x_review_proposed: { by: SEAT, evidence: 'seat', expires: '2020-01-01' } });
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
    const go = (hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);

    // Home: the counts hold the settled world (Ada and Bo; a null mark is settled), the line says the rest.
    await go(`#/w/${wid}`);
    const statline = page.locator('.atlas-home-statline');
    await expect(statline).toContainText('2 characters');
    await expect(statline).not.toContainText('location');
    const homeLine = page.locator('[data-action="home-proposed"]');
    await expect(homeLine).toHaveText('2 proposed, not yet reviewed · Show them');
    // Recent names Quill with its word.
    await expect(page.locator('.atlas-home-continue-row', { hasText: 'Quill' }).locator('[data-role="proposed-word"]')).toHaveText('Proposed');

    // The list: each proposed row says so, a lapsed one says that too; Ada says nothing.
    const row = (name: string) => page.locator('.atlas-list .atlas-row', { hasText: name });
    await expect(row('Quill').locator('[data-role="proposed-word"]')).toHaveText('Proposed');
    await expect(row('Old Quay').locator('[data-role="proposed-word"]')).toHaveText('Proposed, lapsed');
    await expect(row('Ada').locator('[data-role="proposed-word"]')).toHaveCount(0);
    await expect(row('Bo').locator('[data-role="proposed-word"]')).toHaveCount(0);

    // Home's line lists only them, through the list's own chip, whatever search was left in the list (gate F6).
    await page.fill('[data-role="elements-search"]', 'Ada');
    await expect(rowNames(page)).toHaveText(['Ada']);
    await homeLine.click();
    const chip = page.locator('[data-action="proposed-only"]');
    await expect(chip).toHaveText('Proposed 2');
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
    await expect(rowNames(page)).toHaveText(['Old Quay', 'Quill']);
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'false');
    await expect(rowNames(page)).toHaveText(['Ada', 'Bo', 'Old Quay', 'Quill']);

    // Its own page: the word in the header, the line as its label.
    await go(`#/w/${wid}/element/${QUILL}`);
    const mark = page.locator('.atlas-middle-header [data-role="proposed-mark"]');
    await expect(mark).toHaveText('Proposed');
    await expect(mark).toHaveAttribute('aria-label', /^Proposed by a member and not yet reviewed: it is not part of the world, or its counts, until a keeper accepts it\. It lapses on 22 November 2099\.$/);
    // 1.84.1: the same said in a sentence under the name (Seethe 2026-10-23), and nothing on a settled page.
    await expect(page.locator('[data-role="proposed-note"]')).toHaveText(/not yet reviewed.*A keeper accepts or declines it on OnlyWorlds; a change made here is saved as any other\.$/);
    await go(`#/w/${wid}/element/0192a000-0000-7000-8000-000000056503`);
    await expect(page.locator('.atlas-middle-header')).toContainText('Ada');
    await expect(page.locator('[data-role="proposed-note"]')).toHaveCount(0);
    await go(`#/w/${wid}/element/${QUAY}`);
    await expect(page.locator('.atlas-middle-header [data-role="proposed-mark"]')).toHaveText('Lapsed');
    // A phone keeps the name its room (Seethe 2026-10-23: "Proposed, lapsed" left a name 8 px of 68
    // at 390; "Lapsed" alone still 15 px short, measured): the sentence under the name says it.
    const wide = page.viewportSize()!;
    await page.setViewportSize({ width: 390, height: 844 });
    const name = page.locator('.atlas-middle-header [data-role="element-name"]');
    await expect(name).toBeVisible();
    await expect.poll(() => name.evaluate(n => n.scrollWidth - n.clientWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('.atlas-middle-header [data-role="proposed-mark"]')).toBeHidden();
    await expect(page.locator('[data-role="proposed-note"]')).toContainText('The proposal lapsed on');
    await page.setViewportSize(wide);
    await expect(page.locator('.atlas-middle-header [data-role="proposed-mark"]')).toBeVisible();

    // Search.
    const cmdkInput = page.locator('.atlas-cmdk-input');
    await page.keyboard.press('Control+k');
    await expect(cmdkInput).toBeFocused();
    await page.keyboard.type('Quill');
    await expect(page.locator('.atlas-cmdk-row', { hasText: 'Quill' }).locator('[data-role="proposed-word"]')).toHaveText('Proposed');
    await page.keyboard.press('Escape');
    await expect(cmdkInput).toHaveCount(0);
  });
});
