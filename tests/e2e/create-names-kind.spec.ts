/**
 * The + beside the element list says its word and the kind it makes, and New element says when the list's
 * one filter chose the kind (a creator's walk: an unlabelled + and a kind preselected with no word for why).
 */
import { test, expect, Page } from '@playwright/test';

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
    api.setNextDirectory(await root.getDirectoryHandle('create-names-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'namesworld');
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi.getState().active?.worldId));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Mara Venn' });
    api.patchData(await store.listElements());
  });
}

test('the + says New and the kind it makes; New element says why a kind is chosen, until another is picked', async ({ page }) => {
  await setupWorld(page);
  const plus = page.locator('[data-action="create-element"]');
  await expect(plus).toBeVisible();
  // On screen and by name.
  await expect(plus).toHaveText(/New/);
  await expect(plus).toHaveAttribute('aria-label', 'New element');

  // One filter: the name says the kind it makes.
  await page.locator('[data-filter-type="location"]').click();
  await expect(plus).toHaveAttribute('aria-label', 'New location');
  if (process.env.SHOT_CREATE) await page.locator('.atlas-search-row').screenshot({ path: `${process.env.SHOT_CREATE}-plus.png` });
  await plus.click();
  const modal = page.locator('[data-modal="create-element"]');
  const why = modal.locator('[data-role="type-from-filter"]');
  await expect(why).toBeVisible();
  if (process.env.SHOT_CREATE) await page.screenshot({ path: `${process.env.SHOT_CREATE}-modal.png` });
  await expect(why).toHaveText('A location, since the list shows only locations. Pick another type above to change it.');
  await expect(modal.locator('input[name="element-type"]')).toHaveValue('location');
  // Another kind picked: the line goes, since it no longer says why.
  await modal.locator('.atlas-create-type-btn[data-type="event"]').click();
  await expect(why).toBeHidden();
  await modal.locator('[data-action="cancel"]').click();

  // An article that is "an": the filter on Objects.
  await page.locator('[data-filter-type="location"]').click();
  await page.locator('[data-filter-type="object"]').click();
  await expect(plus).toHaveAttribute('aria-label', 'New object');
  await plus.click();
  await expect(why).toHaveText(/^An object, since the list shows only objects\./);
  await modal.locator('[data-action="cancel"]').click();

  // A typed type that is none: no type chosen, so the line goes (the gate's SHOULD).
  await page.locator('[data-filter-type="object"]').click();
  await page.locator('[data-filter-type="location"]').click();
  await plus.click();
  await expect(why).toBeVisible();
  await modal.locator('input[name="element-type"]').fill('zzz');
  await expect(why).toBeHidden();
  await modal.locator('[data-action="cancel"]').click();
  await page.locator('[data-filter-type="location"]').click();

  // A type New element cannot make (Zones are made on a map): the + names none, and no line (the gate's MUST).
  await page.locator('[data-filter-type="zone"]').click();
  await expect(plus).toHaveAttribute('aria-label', 'New element');
  await plus.click();
  await expect(why).toBeHidden();
  await modal.locator('[data-action="cancel"]').click();
  await page.locator('[data-filter-type="zone"]').click();

  // No filter: no line, the plain name.
  await expect(plus).toHaveAttribute('aria-label', 'New element');
  await plus.click();
  await expect(why).toBeHidden();
});
