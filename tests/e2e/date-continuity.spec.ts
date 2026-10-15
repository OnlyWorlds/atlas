/**
 * #281: Home's loose threads list the dates to check (two kinds cannot both be
 * true; links across a birth can), one sentence with both dates, each element a way to it.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

test('Home lists the dates to check, and each name opens its element (#281)', async ({ page }) => {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('dates-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'contradictions');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();

  const ids = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const ireena = await store.createElement('character', { name: 'Ireena', birth_date: 120 });
    const battle = await store.createElement('event', { name: 'The Battle', start_date: 100, end_date: 105, characters: [ireena.id] });
    await store.createElement('title', { name: 'The Mitre', grant_date: 90, revoke_date: 40 });
    await store.createElement('event', { name: 'The Feast', start_date: 130, characters: [ireena.id] });
    api.patchData(await store.listElements());
    const w = api.getState().active.worldId;
    location.hash = `#/w/${w}/home`;
    return { ireena: ireena.id, battle: battle.id };
  });

  const thread = page.locator('.atlas-home-thread', { hasText: 'dates to check' });
  await expect(thread).toHaveText('2 dates to check');
  await thread.click();
  const rows = page.locator('.atlas-home-thread-conflict');
  // The sentences as read: the icon glyphs' ligature text left out.
  const sentences = () => rows.evaluateAll(els => els.map(e => {
    const c = e.cloneNode(true) as HTMLElement;
    c.querySelectorAll('.material-symbols-outlined').forEach(i => i.remove());
    return c.textContent;
  }));
  await expect.poll(sentences).toEqual([
    'The Mitre is revoked (40) before it is granted (90)',
    'Ireena (born 120) is linked to The Battle (ended 105)',
  ]);
  // The feast came after her birth: nothing to say.
  await expect(page.locator('.atlas-home-thread-conflicts')).not.toContainText('The Feast');

  await rows.nth(1).locator('.atlas-home-thread-chip', { hasText: 'The Battle' }).click();
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(ids.battle);
});
