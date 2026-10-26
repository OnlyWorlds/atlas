/**
 * The tour in narrow windows. Below 1100px the right pane is a
 * drawer, below 820px the sidebar too, and both start closed. The tour was
 * written for the desktop shell and never opened a drawer (it also hid the
 * toggles), so in a narrow window step 2's "create local world" icon sat
 * off-screen in the closed sidebar (x=-311) and the pin beat's map sat in the
 * closed right drawer: the tour stopped there, on live 1.11 and on 1.12.
 * 1000px is a desktop width (a 1366 laptop at 125% scaling is ~1093px).
 *
 * Playwright calls an off-screen element "visible", so reach is asserted as
 * geometry plus a hit test: the element's centre is inside the viewport and
 * the topmost element there is the control itself (not a scrim or a drawer).
 */
import { test, expect, Page, Locator } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function expectReachable(page: Page, loc: Locator) {
  await expect(async () => {
    const box = await loc.boundingBox();
    expect(box, 'renders').toBeTruthy();
    const vw = page.viewportSize()!.width;
    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;
    expect(cx, 'centre inside the viewport horizontally').toBeGreaterThan(0);
    expect(cx).toBeLessThan(vw);
    const hit = await loc.evaluate((el, [x, y]) => {
      const top = document.elementFromPoint(x, y);
      return !!top && (top === el || el.contains(top));
    }, [cx, cy] as const);
    expect(hit, 'nothing covers it').toBe(true);
    // The page itself never scrolls sideways (conv. 174: run 40104361183 sat 273 px left, the sidebar off-screen).
    expect(await page.evaluate(() => document.body.scrollLeft + document.documentElement.scrollLeft), 'the page is not scrolled sideways').toBe(0);
  }).toPass({ timeout: 8_000 });
}

async function nextStep(page: Page, expectStep: number) {
  const next = page.locator('.atlas-tour-controls [data-tour-control="next"]');
  await expectReachable(page, next);
  await next.click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', String(expectStep));
}

for (const width of [1000, 800]) {
  test(`the tour reaches the pin beat and places the pin at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 860 });
    await freshBoot(page);
    await page.click('[data-action="start-tour"]');
    await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
    const bar = page.locator('.atlas-tour-bar');
    await expect(bar).toHaveAttribute('data-tour-step', '2');

    // Step 2: the icon the copy names is on screen and clickable.
    const create = page.locator('.atlas-worlds-header [data-action="create-local"]');
    await expectReachable(page, create);
    await create.click();
    await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
    await expect(bar).toHaveAttribute('data-tour-step', '3');

    // Step 3: the highlighted + above the element list.
    const plus = page.locator('[data-action="create-element"]');
    await expectReachable(page, plus);
    await plus.click();
    await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
    await expect(page.locator('.atlas-element-name').first()).toContainText('The Consul');

    await nextStep(page, 4);
    await nextStep(page, 5);
    await nextStep(page, 6); // the map + the pin beat

    // The pin beat starts at the element's own +pin in the middle pane...
    const pinBtn = page.locator('[data-action="pin-element"]');
    await expectReachable(page, pinBtn);
    await pinBtn.click();
    // ...and arming it brings the map into reach (the right drawer below 1100px).
    const map = page.locator('.atlas-map-tab-wrapper .leaflet-container');
    await expectReachable(page, map);
    await map.click({ position: { x: 120, y: 120 } });
    await expect.poll(async () => page.evaluate(async () => {
      const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
      return els.some((e: any) => e.type === 'pin');
    })).toBe(true);
    // With the pin down the beat is about the map: it stays in reach.
    await expectReachable(page, map);
  });
}

// Every step navigates, and the drawer layer closed drawers on
// hashchange, a tick AFTER the step had opened its pane, so steps 7, 8 and 14
// sat in closed drawers while the rows above stayed green (they stop at 6).
// The tour owns the drawers now; this walks the rest of the drawer steps.
test('at 800 the swamps map, every objects mint, back to the map, and the-rest sidebar stay in reach', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 860 });
  await freshBoot(page);
  await page.click('[data-action="start-tour"]');
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await page.locator('[data-action="create-element"]').click();
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await nextStep(page, 4); await nextStep(page, 5); await nextStep(page, 6);
  await page.locator('[data-action="pin-element"]').click();
  const map = page.locator('.atlas-map-tab-wrapper .leaflet-container');
  await map.click({ position: { x: 120, y: 120 } });
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.type === 'pin');
  })).toBe(true);
  // Onto the swamps (the soft gate's in-zone crossing), as tour.spec does.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi; const store = api.getActiveStore();
    const els = await store.listElements();
    const pin = els.find((e: any) => e.type === 'pin');
    const ms = els.filter((e: any) => e.type === 'marker');
    await store.updatePin(pin.id, { x: Math.round(ms.reduce((s: number, m: any) => s + m.x, 0) / ms.length), y: Math.round(ms.reduce((s: number, m: any) => s + m.y, 0) / ms.length) });
    api.patchSlice('data', { elements: await store.listElements() });
  });
  await nextStep(page, 7);                    // the-swamps: a map route, pane 'right'
  await expectReachable(page, map);
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '6');
  await expectReachable(page, map);           // the pin is down: the beat is about the map
  await nextStep(page, 7);
  await nextStep(page, 8);                    // objects: a creates run, pane 'sidebar'
  // conv. 174: here the tour lets the shell overflow and a drawer parked off to the right gave the
  // body room to scroll; a focus, a scroll into view or a test's click moved the whole page left and
  // the open sidebar off-screen (run 40104361183, 273 px). The page must refuse every sideways scroll.
  // The room appears once the step's drawers have settled: read at once it can be 0 on a fast runner
  // (run 40213694681, 94 ms after the step, 3 of 3), so wait for it before trying to scroll.
  await expect.poll(() => page.evaluate(() =>
    Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth),
  { message: 'the shell still overflows here (else this proves nothing)' }).toBeGreaterThan(0);
  const pushed = await page.evaluate(() => {
    const room = Math.max(document.body.scrollWidth, document.documentElement.scrollWidth) - innerWidth;
    document.body.scrollLeft = 400;
    document.documentElement.scrollLeft = 400;
    return { room, body: document.body.scrollLeft, root: document.documentElement.scrollLeft };
  });
  expect(pushed.room, 'the shell still overflows here (else this proves nothing)').toBeGreaterThan(0);
  expect([pushed.body, pushed.root], 'the page refuses a sideways scroll').toEqual([0, 0]);
  const plus = page.locator('[data-action="create-element"]');
  for (const phase of ['b', 'c', 'd']) {
    await expectReachable(page, plus);        // before EVERY mint, not only the first
    await plus.click();
    await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', phase);
  }
  await page.evaluate(async () => { const e = await import('/src/tour/tour-engine.ts'); await (e as any).enterStep(13); });
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '14');
  await expectReachable(page, page.locator('.atlas-sidebar .atlas-sidebar-content')); // the-rest: route elements
});

// Ending the tour at the finale landed on a screen whose only
// door was the sidebar; the tour had used up the once, and the exit
// navigation's hashchange closed what the screen opened. Since 1.17 the
// finale's Keep lands in the kept world: the way to its elements must be in
// reach at a narrow width too.
test('at 760 the finale’s keep lands with the sidebar in reach', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 820 });
  await freshBoot(page);
  await page.click('[data-action="start-tour"]');
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  await page.evaluate(async () => { const e = await import('/src/tour/tour-engine.ts'); await (e as any).enterStep(15); });
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '16');
  await page.locator('.atlas-tour-controls button', { hasText: /^Keep this world$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expectReachable(page, page.locator('.atlas-room-nav-drawer-btn.is-sidebar'));
});

test('a drawer closed by hand during the tour can be reopened from its toggle', async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 860 });
  await freshBoot(page);
  await page.click('[data-action="start-tour"]');
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '2');
  const create = page.locator('.atlas-worlds-header [data-action="create-local"]');
  await expectReachable(page, create);
  // Dismiss the drawer through its scrim, as a user would.
  await page.locator('.atlas-drawer-scrim').click({ position: { x: 700, y: 200 } });
  await expect.poll(() => page.evaluate(() => document.body.classList.contains('atlas-drawer-sidebar-open'))).toBe(false);
  // The sidebar toggle shows (the tour has revealed the shell); the right one
  // does not yet (the map act has not come).
  const sideToggle = page.locator('.atlas-room-nav-drawer-btn.is-sidebar');
  await expectReachable(page, sideToggle);
  await expect(page.locator('.atlas-room-nav-drawer-btn.is-right')).toBeHidden();
  await sideToggle.click();
  await expectReachable(page, create);
});
