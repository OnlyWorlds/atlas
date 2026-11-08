/**
 * A press on the element page while the world changes underneath it.
 *
 * The page rebuilds on every real change to the world's elements (another element saved, a
 * round's stamps, a folder edited outside Atlas). A rebuild between a press and its release
 * replaces the pressed node, so the click never lands: a rename, a field or a link pressed at
 * that moment does nothing. The page now waits for the press before it rebuilds, and a handler
 * on the held picture reads the element as it is now, never as the held picture drew it.
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
    const sub = await root.getDirectoryHandle('element-press-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'pworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const created = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return created.id;
  }, { type, data });
}

/** Another writer saves element `id` (the folder written outside this page, then read back). */
async function writeElsewhere(page: Page, id: string, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ id, patch }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.updateElement(id, patch);
    api.patchData(await store.listElements());
  }, { id, patch });
}

async function openElement(page: Page, id: string, name: string) {
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate(({ w, id }) => { window.location.hash = `#/w/${w}/element/${id}`; }, { w: worldId, id });
  await expect(page.locator('[data-role="element-name"]')).toHaveText(name);
}

/** Press on the element's name, let `during` run with the finger down, then lift. */
async function pressName(page: Page, during: () => Promise<void>) {
  const name = page.locator('[data-role="element-name"]');
  await name.scrollIntoViewIfNeeded();
  const box = (await name.boundingBox())!;
  await page.mouse.move(box.x + 8, box.y + box.height / 2);
  await page.mouse.down();
  await during();
  // The rebuild runs on the store's notify, inside the evaluate above; give any trailing task a turn.
  await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
  await page.mouse.up();
}

for (const tag of ['', ' @firefox']) {
  // The instrument's own control: the same press with nothing changing opens the rename.
  test(`a press on the name opens the rename when nothing changes${tag}`, async ({ page }) => {
    await setupWorld(page);
    const a = await createElement(page, 'character', { name: 'Ada' });
    await openElement(page, a, 'Ada');
    await pressName(page, async () => {});
    await expect(page.locator('[data-role="element-name"] input')).toBeVisible();
  });

  test(`a press on the name lands while another element is saved${tag}`, async ({ page }) => {
    await setupWorld(page);
    const a = await createElement(page, 'character', { name: 'Ada' });
    const b = await createElement(page, 'character', { name: 'Bo' });
    await openElement(page, a, 'Ada');
    await pressName(page, () => writeElsewhere(page, b, { description: 'moved while Ada was pressed' }));
    await expect(page.locator('[data-role="element-name"] input')).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test(`a press on the name lands while a round stamps the element itself${tag}`, async ({ page }) => {
    await setupWorld(page);
    const a = await createElement(page, 'character', { name: 'Ada' });
    await openElement(page, a, 'Ada');
    const meta = () => page.evaluate(() => document.body.textContent ?? '');
    expect(await meta()).toContain('Not synced');
    await pressName(page, () => page.evaluate(async (id) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.stampServerUpdatedAt(id, 'character', new Date().toISOString());
      api.patchData(await store.listElements());
    }, a));
    await expect(page.locator('[data-role="element-name"] input')).toBeVisible();
    await page.keyboard.press('Escape');
    // The held redraw ran once the press landed: the page now says the element is on OnlyWorlds.
    await expect.poll(meta).not.toContain('Not synced');
  });

  // A change to the element itself is not held: the held picture's rename would start from the
  // old name and write it over the new one. The page rebuilds at once (the press is lost, as before).
  test(`no rename starts from a name another writer has just changed${tag}`, async ({ page }) => {
    await setupWorld(page);
    const a = await createElement(page, 'character', { name: 'Ada' });
    await openElement(page, a, 'Ada');
    await pressName(page, () => writeElsewhere(page, a, { name: 'Ada Lovelace' }));
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Ada Lovelace');
    const input = page.locator('[data-role="element-name"] input');
    if (await input.count()) await expect(input).toHaveValue('Ada Lovelace');
  });

  // A held picture's offer was drawn from the world as it was: the Mark press asks again, so a charter
  // marked elsewhere during the press never leaves two marked with this one not leading.
  test(`a Mark pressed on a held page asks again before it writes${tag}`, async ({ page }) => {
    await setupWorld(page);
    const own = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.meta.id as string);
    const put = (id: string, name: string, created: string) => page.evaluate(async ({ id, name, created }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElementVerbatim('law', { id, type: 'law', name, supertype: 'Charter', created_at: created, local_updated_at: created });
      api.patchData(await store.listElements());
    }, { id, name, created });
    const R1 = '0192a000-0000-7000-8000-000000575001';
    const R2 = '0192a000-0000-7000-8000-000000575002';
    await put(R1, 'Old Rules', '2026-10-01T00:00:00.000Z');
    await put(R2, 'New Rules', '2026-10-02T00:00:00.000Z');
    await openElement(page, R1, 'Old Rules');
    const btn = page.locator('[data-role="charter-mark-btn"]');
    await expect(btn).toBeVisible();
    await btn.scrollIntoViewIfNeeded();
    const box = (await btn.boundingBox())!;
    await page.mouse.move(box.x + 8, box.y + box.height / 2);
    await page.mouse.down();
    await writeElsewhere(page, R2, { x_charter_of: own });
    await page.evaluate(() => new Promise(r => setTimeout(r, 50)));
    await page.mouse.up();
    // The held redraw draws the blocked line at once; a write the press made would land after it.
    await page.waitForTimeout(1500);
    await expect(page.locator('[data-role="charter-mark-blocked"]')).toBeVisible();
    const written = await page.evaluate(async (id) => {
      const store = (window as any).__atlasTestApi.getActiveStore();
      return (await store.listElements()).find((e: { id: string }) => e.id === id)?.x_charter_of ?? null;
    }, R1);
    expect(written).toBeNull();
  });

  // The same for "+ Add field": Escape removed its input while focused, and Firefox then sends no
  // focusout at all.
  test(`a change held while a field name is typed shows once Escape closes it${tag}`, async ({ page }) => {
    await setupWorld(page);
    const a = await createElement(page, 'character', { name: 'Ada' });
    await openElement(page, a, 'Ada');
    await page.locator('.atlas-custom-add-btn').click();
    const input = page.locator('.atlas-custom-add-input');
    await expect(input).toBeFocused();
    await input.fill('mood');
    const body = () => page.evaluate(() => document.body.textContent ?? '');
    expect(await body()).toContain('Not synced');
    await page.evaluate(async (id) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.stampServerUpdatedAt(id, 'character', new Date().toISOString());
      api.patchData(await store.listElements());
    }, a);
    await input.press('Escape');
    await expect(input).toHaveCount(0);
    await expect.poll(body).not.toContain('Not synced');
  });

  // A change that lands while a rename is open waits for the rename to end; a rename ended with
  // Escape took its input off the page before the page heard focus leave, so the change was lost.
  test(`a change held during an open rename shows once the rename is escaped${tag}`, async ({ page }) => {
    await setupWorld(page);
    const a = await createElement(page, 'character', { name: 'Ada' });
    await openElement(page, a, 'Ada');
    await page.locator('[data-role="element-name"]').click();
    await expect(page.locator('[data-role="element-name"] input')).toBeFocused();
    const body = () => page.evaluate(() => document.body.textContent ?? '');
    expect(await body()).toContain('Not synced');
    await page.evaluate(async (id) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.stampServerUpdatedAt(id, 'character', new Date().toISOString());
      api.patchData(await store.listElements());
    }, a);
    await page.keyboard.press('Escape');
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Ada');
    await expect.poll(body).not.toContain('Not synced');
  });
}
