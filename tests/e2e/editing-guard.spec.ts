/**
 * S364 gate, lens C: typing survives background re-renders everywhere, not
 * only in the element name (the bout-1 A3 fix covered that one input).
 *   C3: the element editor's INLINE field editors (Settings, Elements, inline mode).
 *   C4: renaming a knower on its knowledge page.
 * A background tick (a sync publish, a pull, another room's save) used to
 * rebuild the surface under the focused input; Chromium blurs a removed
 * input, the blur commits, and the rest of the typing landed on the page.
 */
import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('guard-root', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'guard world');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const el = await api.getActiveStore().createElement(type, data);
    api.patchData(await api.getActiveStore().listElements());
    return el.id as string;
  }, { type, data });
}

const onDisk = (page: Page, id: string, field: string) => page.evaluate(
  async ({ id, field }) => (await (window as any).__atlasTestApi.getActiveStore().getElement(id))?.[field],
  { id, field },
);

test('C3: an inline field edit keeps typing through a sync publish', async ({ page }) => {
  await setupWorld(page);
  const id = await createElement(page, 'character', { name: 'Ireena', description: 'A noble' });
  await page.evaluate((eid) => {
    const api = (window as any).__atlasTestApi;
    const s = api.getState();
    api.patchSlice('registry', { ...s.registry, editor_settings: { ...(s.registry.editor_settings ?? {}), field_edit_mode: 'inline-multi' } });
    window.location.hash = `#/w/${s.active.worldId}/element/${eid}`;
  }, id);
  const value = page.locator('.atlas-middle-content [data-field="description"] .atlas-field-value').first();
  await expect(value).toBeVisible();
  await value.click();
  const ta = page.locator('.atlas-field-inline-textarea');
  await expect(ta).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' woman of Barov');
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    api.patchSlice('sync', { ...api.getState().sync });
  });
  await page.keyboard.type('ia');
  await expect(ta).toBeFocused();
  await expect(ta).toHaveValue('A noble woman of Barovia');
  await page.keyboard.press('Control+Enter');
  await expect.poll(() => onDisk(page, id, 'description')).toBe('A noble woman of Barovia');
});

test('C4: renaming a knower keeps typing through an elements swap', async ({ page }) => {
  await setupWorld(page);
  const ireena = await createElement(page, 'character', { name: 'Ireena' });
  await createElement(page, 'narrative', { name: 'fear', subtype: 'knowledge', story: 'x', narrator: ireena });
  await page.click('.atlas-room-nav-btn[data-room="knowledge"]');
  await page.click('.atlas-room-tab:has-text("Knowers")');
  await page.click('.atlas-knowledge-row:has-text("Ireena")');
  await expect(page.locator('.atlas-knowledge-knower-header h2')).toContainText('Ireena');
  await page.click('.atlas-knowledge-knower-header .atlas-element-name');
  const input = page.locator('.atlas-knowledge-knower-header input.atlas-element-name-input');
  await expect(input).toBeFocused();
  await page.keyboard.press('End');
  await page.keyboard.type(' Kolyan');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData(await api.getActiveStore().listElements());
  });
  await page.keyboard.type('a');
  await expect(input).toBeFocused();
  await page.keyboard.press('Enter');
  await expect.poll(() => onDisk(page, ireena, 'name')).toBe('Ireena Kolyana');
});
