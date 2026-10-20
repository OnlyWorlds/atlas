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
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
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

test('a dateless chart still offers a droppable axis for the FIRST date', async ({ page }) => {
  await setupWorld(page);
  // NOTHING dated — the empty-chart case. Only an undated event to drag.
  const eventId = await createElement(page, 'event', { name: 'The Prophecy' });
  await openCharts(page);

  // The empty chart draws a droppable axis + the drag hint (not a dead end).
  const item = page.locator('.atlas-timeline-rail-undated-item', { hasText: 'The Prophecy' });
  await expect(item).toBeVisible();

  const ib = (await item.boundingBox())!;
  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  await page.mouse.move(ib.x + 20, ib.y + ib.height / 2);
  await page.mouse.down();
  await page.mouse.move(ib.x + 32, ib.y + ib.height / 2);
  await page.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height * 0.4, { steps: 6 });
  await page.mouse.up();

  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  const snapped = await input.inputValue();
  expect(Number.isFinite(Number(snapped))).toBe(true);
  await input.press('Enter');

  // The first date was placed on a previously-empty chart.
  await expect.poll(async () => page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.start_date ?? null;
  }, eventId)).toBe(Number(snapped));
});

// ====== Glyph re-dating (S264): drag a PLACED dot to a new start date ======

/** Canvas position of a point node's dot: x from the fitted view (symmetric
 *  2% pad → a node at the midpoint of the dated span sits at w/2); y = the
 *  beeswarm midline ((TOP_PAD + axisY - 8) / 2, axisY = h - 56). */
function bandMidY(cbHeight: number): number {
  return (20 + (cbHeight - 56 - 8)) / 2;
}

test('dragging a placed dot re-dates it (glyph drag → popover → write)', async ({ page }) => {
  await setupWorld(page);
  // -20 and 30 frame the fit; 5 is the exact midpoint → its dot sits at w/2.
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  const movableId = await createElement(page, 'event', { name: 'The Wandering', start_date: 5 });
  await openCharts(page);

  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  const dotX = cb.x + cb.width * 0.5;
  const dotY = cb.y + bandMidY(cb.height);
  await page.mouse.move(dotX, dotY);
  await page.mouse.down();
  await page.mouse.move(dotX + 12, dotY); // past the 4px threshold
  await page.mouse.move(dotX + 80, dotY, { steps: 5 });
  await page.mouse.up();

  // The confirm popover opens; type an explicit date and commit.
  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  await input.fill('12');
  await input.press('Enter');

  await expect.poll(async () => page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.start_date ?? null;
  }, movableId)).toBe(12);
  await expect(page.locator('.ow-toast', { hasText: 'Dated The Wandering to 12' })).toBeVisible();
});

test('a range start cannot pass its recorded end (popover rejects, nothing written)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  const siegeId = await createElement(page, 'event', { name: 'The Siege', start_date: 5, end_date: 8 });
  await openCharts(page);

  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  const dotX = cb.x + cb.width * 0.5; // start=5 is still the dated-span midpoint
  const dotY = cb.y + bandMidY(cb.height);
  await page.mouse.move(dotX, dotY);
  await page.mouse.down();
  await page.mouse.move(dotX + 12, dotY);
  await page.mouse.move(dotX + 60, dotY, { steps: 5 });
  await page.mouse.up();

  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  // The drag itself clamps live; the popover accepts free text — a start past
  // the recorded end must be rejected by the room, not written inverted.
  await input.fill('99');
  await input.press('Enter');

  await expect(page.locator('.ow-toast', { hasText: "the start cannot pass the end (8)" })).toBeVisible();
  expect(await page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.start_date ?? null;
  }, siegeId)).toBe(5);
});

test('a plain click on a dot still peeks (the drag threshold protects the click progression)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  await createElement(page, 'event', { name: 'The Wandering', start_date: 5 });
  await openCharts(page);

  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  await page.mouse.click(cb.x + cb.width * 0.5, cb.y + bandMidY(cb.height));
  await expect(page.locator('.atlas-timeline-card-title', { hasText: 'The Wandering' })).toBeVisible();
  // No popover, no write — a click is a peek.
  await expect(page.locator('.atlas-edit-popover')).toHaveCount(0);
});

test('dragging a range END cap stretches the end (S265, the other grip)', async ({ page }) => {
  await setupWorld(page);
  // TWO nodes only, far apart — three would fan into lanes on the small e2e
  // viewport and the range's y would leave the midline (failed-shot finding).
  // The range's END (5) is the exact midpoint of the fit (-20..30): the one
  // x every pad model agrees on (w/2, ±the pad skew the 12px grip covers).
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  const siegeId = await createElement(page, 'event', { name: 'The Siege', start_date: -20, end_date: 5 });
  await openCharts(page);

  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  const endX = cb.x + cb.width * 0.5;
  const dotY = cb.y + bandMidY(cb.height);
  await page.mouse.move(endX, dotY);
  await page.mouse.down();
  await page.mouse.move(endX + 12, dotY);
  await page.mouse.move(endX + 60, dotY, { steps: 5 });
  await page.mouse.up();

  // The confirm popover is edge-aware ("End date"); commit an explicit value.
  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  await expect(page.locator('.atlas-edit-popover')).toContainText(/end date/i);
  await input.fill('20');
  await input.press('Enter');

  await expect.poll(async () => page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.end_date ?? null;
  }, siegeId)).toBe(20);
  // The start is untouched — the grip moved only its own edge.
  expect(await page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.start_date ?? null;
  }, siegeId)).toBe(-20);
});

test('an end-stretch cannot precede the start (popover rejects, nothing written)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  const siegeId = await createElement(page, 'event', { name: 'The Siege', start_date: -20, end_date: 5 });
  await openCharts(page);

  const cb = (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
  const endX = cb.x + cb.width * 0.5;
  const dotY = cb.y + bandMidY(cb.height);
  await page.mouse.move(endX, dotY);
  await page.mouse.down();
  await page.mouse.move(endX + 12, dotY);
  await page.mouse.move(endX + 40, dotY, { steps: 4 });
  await page.mouse.up();

  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  await input.fill('-25');
  await input.press('Enter');

  await expect(page.locator('.ow-toast', { hasText: "the end cannot precede the start (-20)" })).toBeVisible();
  expect(await page.evaluate((id) => {
    return (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.end_date ?? null;
  }, siegeId)).toBe(5);
});
