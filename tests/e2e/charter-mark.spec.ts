/**
 * The charter profile (1.100): a Law with supertype Charter leads Home only
 * once it carries the mark `x_charter_of`. In a world on disk, an unmarked
 * Charter shows no charter on Home and offers its keeper the one write on its
 * page; the press writes the world's own id, and Home then shows it first. A
 * marked Charter's page offers nothing.
 */
import { test, expect, type Page } from '@playwright/test';

const AT = '2026-10-22T00:00:00.000Z';
const RULES = '0192a000-0000-7000-8000-000000100101';
const OLD = '0192a000-0000-7000-8000-000000100102';

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
    api.setNextDirectory(await root.getDirectoryHandle('charter-mark-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'harbour');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function put(page: Page, type: string, id: string, name: string, extra: Record<string, unknown> = {}) {
  await page.evaluate(async ({ type, id, name, extra, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim(type, { id, type, name, local_updated_at: at, ...extra });
    api.patchData(await store.listElements());
  }, { type, id, name, extra, at: AT });
}

test.describe('the charter by its mark, in a world on disk', () => {
  test('an unmarked Charter leads nothing until its keeper marks it; then Home shows it first', async ({ page }) => {
    await setupWorld(page);
    await put(page, 'law', RULES, 'House Rules', { supertype: 'Charter', description: 'Be kind to the harbour cats.' });
    const st = await page.evaluate(() => {
      const s = (window as any).__atlasTestApi.getState();
      return { wid: s.active.worldId as string, own: s.active.meta.id as string };
    });
    const go = (hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);

    await go(`#/w/${st.wid}`);
    await expect(page.locator('.atlas-home-statline')).toBeVisible();
    await expect(page.locator('[data-role="charter"]')).toHaveCount(0);

    await go(`#/w/${st.wid}/element/${RULES}`);
    const offer = page.locator('[data-role="charter-mark"]');
    await expect(offer).toContainText("Not this world's charter yet");
    await page.screenshot({ path: test.info().outputPath('charter-mark-offer.png') });
    await offer.locator('[data-role="charter-mark-btn"]').click();
    await expect(offer).toHaveCount(0);

    const written = await page.evaluate(async (id) => {
      const store = (window as any).__atlasTestApi.getActiveStore();
      const els = await store.listElements();
      return els.find((e: { id: string }) => e.id === id)?.x_charter_of ?? null;
    }, RULES);
    expect(written).toBe(st.own);

    await go(`#/w/${st.wid}`);
    await expect(page.locator('[data-role="charter"]')).toContainText('House Rules');
    await expect(page.locator('[data-role="charter"]')).toContainText('Be kind to the harbour cats.');
  });

  test('a marked Charter offers nothing; the newest marked one leads Home', async ({ page }) => {
    await setupWorld(page);
    const own = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.meta.id as string);
    await put(page, 'law', OLD, 'Old Rules', { supertype: 'Charter', x_charter_of: own, created_at: '2026-01-01T00:00:00Z' });
    await put(page, 'law', RULES, 'House Rules', { supertype: 'Charter', x_charter_of: own, created_at: '2026-10-01T00:00:00.123456+00:00' });
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await page.evaluate((h) => { window.location.hash = h; }, `#/w/${wid}/element/${RULES}`);
    await expect(page.locator('.atlas-middle-header [data-role="element-name"]')).toHaveText(/House Rules/);
    await expect(page.locator('[data-role="charter-mark"]')).toHaveCount(0);
    await page.evaluate((h) => { window.location.hash = h; }, `#/w/${wid}`);
    await expect(page.locator('[data-role="charter"]')).toContainText('House Rules');
  });
});
