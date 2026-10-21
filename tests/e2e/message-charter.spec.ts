/**
 * #526 e2e: a message reads as a message (From and To above its text, each a
 * link to its Character), and a world's charter (a Law with supertype Charter)
 * leads Home, its name a link and its first paragraph read there. The rules
 * themselves: tests/unit/message-and-charter.test.ts.
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

async function setupWorld(page: Page) {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('message-charter-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'mcworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) throw new Error('no active store');
    const created = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return created.id;
  }, { type, data });
}

async function worldId(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
}

test.describe('#526 messages and the charter', () => {
  test('a message shows From and To above its text, and a story does not', async ({ page }) => {
    await setupWorld(page);
    const codex = await createElement(page, 'character', { name: 'Codex' });
    const bb = await createElement(page, 'character', { name: 'BB' });
    const kael = await createElement(page, 'character', { name: 'Kael' });
    const msg = await createElement(page, 'narrative', {
      name: 'Re: the partner lines', supertype: 'Message', narrator: codex, characters: [bb, kael], story: 'Checked.',
    });
    const saga = await createElement(page, 'narrative', { name: 'A saga', narrator: codex, characters: [bb] });
    const w = await worldId(page);

    await page.evaluate(([w, id]) => { window.location.hash = `#/w/${w}/element/${id}`; }, [w, msg]);
    const line = page.locator('[data-role="message-parties"]');
    await expect(line).toHaveText('From Codex · To BB, Kael');
    await line.getByRole('link', { name: 'BB' }).click();
    await expect(page).toHaveURL(new RegExp(`#/w/${w}/element/${bb}$`));

    await page.evaluate(([w, id]) => { window.location.hash = `#/w/${w}/element/${id}`; }, [w, saga]);
    await expect(page.locator('[data-role="element-name"]')).toHaveText('A saga');
    await expect(page.locator('[data-role="message-parties"]')).toHaveCount(0);
  });

  test("a world's charter leads Home and opens from there", async ({ page }) => {
    await setupWorld(page);
    const w = await worldId(page);
    await page.evaluate((w) => { window.location.hash = `#/w/${w}`; }, w);
    await expect(page.locator('.atlas-home-world-name')).toBeVisible();
    await expect(page.locator('[data-role="charter"]')).toHaveCount(0);

    await createElement(page, 'law', { name: 'House rules', supertype: 'Regulation', description: 'Not the charter.' });
    const charter = await createElement(page, 'law', {
      name: 'Charter', supertype: 'Charter',
      description: 'What this world is\nThe team and its partners.\n\nWho is here\nThe owner and three agents.',
    });
    const card = page.locator('[data-role="charter"]');
    await expect(card).toBeVisible();
    await expect(card.locator('.atlas-home-charter-lead')).toHaveText('What this world is The team and its partners.');
    await card.getByRole('link', { name: 'Charter' }).click();
    await expect(page).toHaveURL(new RegExp(`#/w/${w}/element/${charter}$`));
  });
});
