/**
 * Drag-to-date e2e (Act 1, Bout 1.2). Drives a real mouse drag of an undated
 * rail item onto the axis, confirms the drop popover, and asserts the element's
 * start-date field is written + it leaves the undated backlog. The canvas render
 * (guide-line, ghost) is verified by inspection; this locks the write + handoff.
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
    const sub = await root.getDirectoryHandle('drag-to-date-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'dragworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) throw new Error('no active store');
    const created = await store.createElement(type, data);
    const all = await store.listElements();
    api.patchData(all);
    return created.id;
  }, { type, data });
}

async function openCharts(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room h1')).toHaveText('Charts');
}

test('dragging an undated item onto the axis writes its date and moves it out of the backlog', async ({ page }) => {
  await setupWorld(page);
  // A couple dated (so the chart + axis render) + one undated event to drag.
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  const prophecyId = await createElement(page, 'event', { name: 'The Prophecy' });
  await openCharts(page);

  // Precondition: The Prophecy is in the undated backlog, no start_date.
  await expect(page.locator('.atlas-timeline-rail-undated-item', { hasText: 'The Prophecy' })).toBeVisible();
  expect(await page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.start_date ?? null;
  }, prophecyId)).toBeNull();

  // Drag it onto the axis band.
  const item = page.locator('.atlas-timeline-rail-undated-item', { hasText: 'The Prophecy' });
  const ib = (await item.boundingBox())!;
  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  await page.mouse.move(ib.x + 20, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(ib.x + 32, ib.y + ib.height / 2); // pass the drag threshold
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.4, { steps: 6 });
  await page.mouse.up();

  // The drop popover appears pre-filled with the snapped date; accept it.
  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  const snapped = await input.inputValue();
  expect(Number.isFinite(Number(snapped))).toBe(true);
  await input.press('Enter');

  // The element is now dated (start_date is the snapped number) and has left the
  // undated backlog. It's peeked/focused so its card confirms the placement.
  await expect.poll(async () => page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.start_date ?? null;
  }, prophecyId)).toBe(Number(snapped));
  await expect(page.locator('.atlas-timeline-rail-undated-item', { hasText: 'The Prophecy' })).toHaveCount(0);
});
