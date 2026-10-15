/**
 * #301: the chart on a touch screen. A finger pans it, two fingers pinch it
 * (the chart zooms, the page does not), a tapped dot slides to a new date, the
 * now-line slides, and a tap peeks once (the mouse events a browser makes up
 * after a tap must not run the click progression a second time).
 *
 * Real touches through Chromium's CDP `Input.dispatchTouchEvent`, at 412 wide
 * on a phone profile. Firefox is not driven here: Playwright can only tap in
 * Firefox, and a synthetic PointerEvent would test the handler, not the
 * browser's touch-action. The handlers are one path for both engines.
 */
import { test, expect, Page, CDPSession } from '@playwright/test';

// The firefox project runs only the @firefox test (the tap). isMobile, which
// lets a pinch zoom the page as a phone's does, is Chromium's alone.
test.use({
  viewport: { width: 412, height: 839 },
  hasTouch: true,
  isMobile: async ({ browserName }, use) => { await use(browserName === 'chromium'); },
});

async function setupWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    (window as any).__atlasTestApi.setNextDirectory(await root.getDirectoryHandle('chart-touch-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.tap('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'touchchart');
  await page.tap('[data-modal="create-world"] [data-action="pick"]');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi.getState().active?.worldId));
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

async function openCharts(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room h1')).toHaveText('Charts');
  await expect(page.locator('.atlas-timeline-view-canvas')).toHaveAttribute('data-window', /,/);
}

/** -20 and 30 frame the fit; 5 is the midpoint (its dot at w/2 on the midline). */
async function threeEvents(page: Page): Promise<string> {
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  return await createElement(page, 'event', { name: 'The Wandering', start_date: 5 });
}

async function windowOf(page: Page): Promise<{ start: number; end: number }> {
  const raw = await page.locator('.atlas-timeline-view-canvas').getAttribute('data-window');
  const [start, end] = (raw ?? '').split(',').map(Number);
  return { start, end };
}

async function canvasBox(page: Page) {
  return (await page.locator('.atlas-timeline-view-canvas').boundingBox())!;
}

/** The beeswarm midline: (TOP_PAD + axisY - 8) / 2, axisY = h - 56. */
const bandMidY = (h: number): number => (20 + (h - 56 - 8)) / 2;

/** The screen x of a date, through the chart's padded mapping (32 left, 16 right). */
async function xOfDate(page: Page, date: number): Promise<number> {
  const cb = await canvasBox(page);
  const { start, end } = await windowOf(page);
  return cb.x + 32 + ((date - start) / (end - start)) * (cb.width - 48);
}

type Pt = [number, number];
function finger(cdp: CDPSession) {
  const send = (type: string, pts: Pt[]) =>
    cdp.send('Input.dispatchTouchEvent', { type: type as any, touchPoints: pts.map(([x, y], id) => ({ x, y, id })) });
  return {
    async slide(from: Pt, to: Pt, steps = 8) {
      await send('touchStart', [from]);
      for (let i = 1; i <= steps; i++) {
        await send('touchMove', [[from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps]]);
      }
      await send('touchEnd', []);
    },
    async pinch(cx: number, cy: number, fromHalf: number, toHalf: number, steps = 8) {
      await send('touchStart', [[cx - fromHalf, cy], [cx + fromHalf, cy]]);
      for (let i = 1; i <= steps; i++) {
        const half = fromHalf + ((toHalf - fromHalf) * i) / steps;
        await send('touchMove', [[cx - half, cy], [cx + half, cy]]);
      }
      await send('touchEnd', []);
    },
  };
}

test('two fingers zoom the chart, not the page, and one finger pans it', async ({ page, context }) => {
  await setupWorld(page);
  await threeEvents(page);
  await openCharts(page);
  const f = finger(await context.newCDPSession(page));
  const cb = await canvasBox(page);
  const y = cb.y + cb.height * 0.25; // above the dots: nothing to grip

  const fit = await windowOf(page);
  await f.pinch(cb.x + cb.width / 2, y, 30, 130);
  await expect.poll(async () => { const w = await windowOf(page); return w.end - w.start; })
    .toBeLessThan((fit.end - fit.start) / 3);
  expect(await page.evaluate(() => window.visualViewport?.scale ?? 1)).toBe(1);

  // A finger moving left brings later dates in: the window slides right.
  const zoomed = await windowOf(page);
  await f.slide([cb.x + cb.width * 0.7, y], [cb.x + cb.width * 0.3, y]);
  await expect.poll(async () => (await windowOf(page)).start).toBeGreaterThan(zoomed.start + 1);
  const panned = await windowOf(page);
  expect(panned.end - panned.start).toBeCloseTo(zoomed.end - zoomed.start, 3); // a pan keeps the span
});

test('a tap peeks once; a finger slides only a dot it has tapped', async ({ page, context }) => {
  await setupWorld(page);
  const id = await threeEvents(page);
  await openCharts(page);
  const f = finger(await context.newCDPSession(page));
  const routeBefore = await page.evaluate(() => location.hash);

  // An untapped dot under a sliding finger pans the chart; no date is offered.
  let cb = await canvasBox(page);
  const dotY = cb.y + bandMidY(cb.height);
  await f.pinch(cb.x + cb.width / 2, cb.y + cb.height * 0.25, 30, 80); // room to pan
  let x = await xOfDate(page, 5);
  const before = await windowOf(page);
  await f.slide([x, dotY], [x + 60, dotY]);
  await expect.poll(async () => (await windowOf(page)).start).toBeLessThan(before.start - 1);
  await expect(page.locator('.atlas-edit-popover')).toHaveCount(0);

  // One tap peeks: the card shows The Wandering, and the route does not focus it.
  x = await xOfDate(page, 5);
  await page.touchscreen.tap(x, dotY);
  await expect(page.locator('.atlas-timeline-card')).toContainText('The Wandering');
  await page.waitForTimeout(900); // past the made-up mouse events' window
  expect(await page.evaluate(() => location.hash)).toBe(routeBefore);

  // The tapped dot slides to a new date: the popover offers it, Enter writes it.
  cb = await canvasBox(page); // the card docks beside the chart
  x = await xOfDate(page, 5);
  await f.slide([x, cb.y + bandMidY(cb.height)], [x + 50, cb.y + bandMidY(cb.height)]);
  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  await input.fill('12');
  await input.press('Enter');
  await expect.poll(async () => page.evaluate((eid) =>
    (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === eid)?.start_date ?? null, id)).toBe(12);
});

// A tap runs the click progression once. A browser also sends a tap as made-up
// mouse events (mousedown, mouseup), which would run it a second time (peek,
// then focus); the touch layer's cancelled pointerdown stops them. Tapping
// works in Firefox too, so this one runs in both engines.
for (const tag of ['', '@firefox ']) {
  test(`${tag}a tap on a dot sends the chart no mouse events, and peeks`, async ({ page }) => {
    await setupWorld(page);
    await threeEvents(page);
    await openCharts(page);
    await page.evaluate(() => {
      (window as any).__chartMouse = 0;
      const c = document.querySelector('.atlas-timeline-view-canvas')!;
      for (const t of ['mousedown', 'mouseup']) c.addEventListener(t, () => { (window as any).__chartMouse++; });
    });
    const cb = await canvasBox(page);
    await page.touchscreen.tap(await xOfDate(page, 5), cb.y + bandMidY(cb.height));
    await expect(page.locator('.atlas-timeline-card')).toContainText('The Wandering');
    expect(await page.evaluate(() => (window as any).__chartMouse)).toBe(0);
    expect(await page.evaluate(() => location.hash)).toMatch(/\/timeline$/);

    // A second tap on the peeked dot focuses the chart on it.
    const again = await canvasBox(page); // the card docks beside the chart
    await page.touchscreen.tap(await xOfDate(page, 5), again.y + bandMidY(again.height));
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/\/timeline\/[^/]+$/);
  });
}

test('a tapped range stretches by its end', async ({ page, context }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'event', { name: 'The Long War', start_date: 30 });
  const siegeId = await createElement(page, 'event', { name: 'The Siege', start_date: 5, end_date: 14 }); // the end 9 units off: clear of the start glyph's grip at 412
  await openCharts(page);
  const f = finger(await context.newCDPSession(page));
  let cb = await canvasBox(page);
  await page.touchscreen.tap(await xOfDate(page, 5), cb.y + bandMidY(cb.height));
  await expect(page.locator('.atlas-timeline-card')).toContainText('The Siege');
  cb = await canvasBox(page);
  const y = cb.y + bandMidY(cb.height);
  const endX = await xOfDate(page, 14);
  await f.slide([endX, y], [endX + 50, y]);
  const input = page.locator('.atlas-edit-popover input');
  await expect(input).toBeVisible();
  await input.fill('20');
  await input.press('Enter');
  await expect.poll(async () => page.evaluate((eid) =>
    (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === eid)?.end_date ?? null, siegeId)).toBe(20);
});

test('a finger slides the now-line', async ({ page, context }) => {
  await setupWorld(page);
  await threeEvents(page);
  await openCharts(page);
  await page.locator('.atlas-chart-now-set').tap();
  await expect(page.locator('.atlas-chart-now-chip')).toContainText('30');
  const f = finger(await context.newCDPSession(page));
  const cb = await canvasBox(page);
  const x = await xOfDate(page, 30);
  const y = cb.y + cb.height * 0.2; // on the line, above the dots
  await f.slide([x + 8, y], [x - 120, y]); // 8 px off the line: a finger's grip, not a cursor's
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__atlasTestApi.getState().active?.meta?.time_current ?? null)).toBeLessThan(25);
});
