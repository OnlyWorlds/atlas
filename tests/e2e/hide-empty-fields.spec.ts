/**
 * #24 (lane U, S368): a new character was ~25 empty rows. "Hide empty fields"
 * shows only what an element holds; the switch sits under the fields and in
 * Settings, Elements.
 */
import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page): Promise<{ worldId: string; heroId: string; blankId: string }> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('empty-fields-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Fields World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  return page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const hero = await store.createElement('character', { name: 'Hero', description: 'Tall and wiry.', physicality: 'Wiry' });
    const blank = await store.createElement('character', { name: 'Blank' });
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId as string, heroId: hero.id as string, blankId: blank.id as string };
  });
}

const rows = (page: Page) => page.locator('.atlas-detail .atlas-detail-section [data-field]');

test('Hide empty fields shows only what the element holds, and Show them brings the rest back', async ({ page }) => {
  const { worldId, heroId } = await setupWorld(page);
  await page.evaluate(([w, h]) => { location.hash = `#/w/${w}/element/${h}`; }, [worldId, heroId]);
  const hide = page.locator('[data-action="hide-empty-fields"]');
  await expect(hide).toBeVisible();
  const all = await rows(page).count();
  expect(all).toBeGreaterThan(10);

  await hide.click();
  await expect(page.locator('[data-action="show-empty-fields"]')).toBeVisible();
  const shown = await rows(page).evaluateAll(rs => rs.map(r => (r as HTMLElement).dataset.field).sort());
  expect(shown).toEqual(['description', 'physicality']);
  await expect(page.locator('.atlas-empty-fields-toggle')).toContainText(`${all - 2} empty fields hidden`);

  // The setting holds across elements and reloads of the page; Settings says the same.
  await page.evaluate((w) => { location.hash = `#/w/${w}/settings/elements`; }, worldId);
  await expect(page.locator('.atlas-settings input[name="hide-empty-fields"]')).toBeChecked();
  await page.evaluate(([w, h]) => { location.hash = `#/w/${w}/element/${h}`; }, [worldId, heroId]);

  await page.locator('[data-action="show-empty-fields"]').click();
  await expect(rows(page)).toHaveCount(all);
});

test('an element with nothing filled keeps its first section whole', async ({ page }) => {
  const { worldId, blankId } = await setupWorld(page);
  await page.evaluate(([w, b]) => { location.hash = `#/w/${w}/element/${b}`; }, [worldId, blankId]);
  await page.locator('[data-action="hide-empty-fields"]').click();
  const sections = page.locator('.atlas-detail > .atlas-detail-section[data-section]:not([data-section="Custom fields"])');
  await expect(page.locator('[data-action="show-empty-fields"]')).toBeVisible();
  const names = await sections.evaluateAll(s => s.map(x => (x as HTMLElement).dataset.section));
  expect(names[0]).toBe('Base');
  expect(await page.locator('.atlas-detail-section[data-section="Base"] [data-field]').count()).toBeGreaterThan(1);
});
