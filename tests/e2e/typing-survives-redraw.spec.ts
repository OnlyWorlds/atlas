/**
 * Typing survives a redraw (S452). A data tick or a world change can land while
 * someone types in a search; a surface that rebuilds its own search field must
 * hand the fresh field the focus and the caret, so the next key lands in it
 * (`keepingFocus`, `src/ui/render-gate.ts`). The census that found two: the
 * writing and map searches kept their text and lost focus on a tick; the
 * elements search is built once and never had the problem (its row stays here
 * as the control that cannot move). Settings waits instead: its own test.
 */
import { test, expect, Page } from '@playwright/test';

async function world(page: Page): Promise<string> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.setNextDirectory(await (await navigator.storage.getDirectory()).getDirectoryHandle('typing-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Typing');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  return page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    for (const n of ['Aralia', 'Bram', 'Cass']) await store.createElement('character', { name: n });
    for (const n of ['Arrow Isle', 'South', 'East', 'West']) await store.createElement('map', { name: n });
    for (const n of ['Arrival', 'The crossing']) await store.createElement('narrative', { name: n, supertype: 'Book' });
    api.patchData(await store.listElements());
    return api.getState().active.worldId as string;
  });
}

/** Type, land a data tick and a world change, type on: the same keys must end in the field. */
async function typeThroughTick(page: Page, sel: string): Promise<void> {
  const field = page.locator(sel).first();
  await field.click();
  await field.pressSequentially('Ar');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData([...(await api.getActiveStore().listElements())]);
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const active = getState().active!;
    patchSlice('active', { ...active, meta: { ...active.meta, description: 'a tick landed' } });
  });
  await page.waitForTimeout(300);
  await expect(page.locator(sel).first()).toBeFocused();
  await page.keyboard.type('r');
  await expect(page.locator(sel).first()).toHaveValue('Arr');
}

test('the elements search keeps typing through a tick (control: built once)', async ({ page }) => {
  await world(page);
  await typeThroughTick(page, '[data-role="elements-search"]');
});

test('the writing search keeps its focus and caret through a tick, and still filters as you type', async ({ page }) => {
  const w = await world(page);
  await page.evaluate((id) => { location.hash = `#/w/${id}/writing`; }, w);
  await page.waitForSelector('[data-role="writing-search"]');
  await typeThroughTick(page, '[data-role="writing-search"]');
  const body = page.locator('[data-role="writing-search"]').locator('xpath=../..'); // the search row's parent, the list's body
  await expect(body).toContainText('Arrival');
  await expect(body).not.toContainText('The crossing');
});

test('the map search keeps its focus and caret through a tick, and still filters as you type', async ({ page }) => {
  await world(page);
  await page.waitForSelector('[data-role="map-search"]', { timeout: 10000 });
  await typeThroughTick(page, '[data-role="map-search"]');
  const index = page.locator('.atlas-map-index-pane');
  await expect(index).toContainText('Arrow Isle');
  await expect(index).not.toContainText('South');
});
