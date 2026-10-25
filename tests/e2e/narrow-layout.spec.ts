/**
 * The narrow-window layer (S323).
 *
 * Before this layer the three-pane shell had a ~706px hard floor of pane
 * min-widths and no media query touching it, inside containers that hide
 * overflow at every level. Panes did not shrink below the floor, they LEFT
 * THE SCREEN, with no scrollbar and no affordance: 768 clipped the map pane,
 * 640 lost the entire right pane, 390 collapsed the guided tour into
 * unreadable overlap.
 *
 * Every other e2e spec in this suite runs at exactly one viewport width, so
 * the whole class was invisible to 273 passing tests. These assert the thing
 * that actually matters at each width: is any of it OFF SCREEN, and can the
 * user still reach it.
 *
 * Note what is NOT asserted: that anything "looks right". Playwright counts
 * off-screen elements as visible, which is precisely how the tour suite ran
 * green at 390px on a screen no human could read. The assertions here are
 * geometric (measured boxes against the viewport), and the look was checked
 * by keeper own-eyes at 1440 / 1024 / 760 / 390 (Notes/ui-snapshots/).
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

/**
 * Boot and create a world at DESKTOP width, then narrow to the target.
 *
 * Setting up inside a narrow viewport means driving the sidebar controls
 * while the sidebar is a closed drawer. That is not the story under test:
 * the real user shrinks a window (or opens a phone) on a world that already
 * exists. Build wide, then narrow.
 */
async function bootThenNarrow(page: Page, root: string, width: number, height: number) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await freshBoot(page);
  await setupWorld(page, root);
  await page.setViewportSize({ width, height });
  // One frame for the resize listener to stamp the breakpoint classes.
  await page.waitForTimeout(150);
}

async function setupWorld(page: Page, root: string) {
  await page.evaluate(async (dir) => {
    const api = (window as any).__atlasTestApi;
    const fsRoot = await navigator.storage.getDirectory();
    api.setNextDirectory(await fsRoot.getDirectoryHandle(dir, { create: true }));
  }, root);
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'narrow world');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/**
 * The right edge of a locator's box, polled until the 160ms drawer slide has
 * settled. Reading a boundingBox the instant a class lands measures the
 * animation's FIRST frame, which reported the drawer still parked off-screen
 * even though it arrives correctly.
 */
async function settledBox(page: Page, selector: string) {
  let last = { x: NaN, width: NaN };
  await expect.poll(async () => {
    const b = await page.locator(selector).boundingBox();
    if (!b) return 'none';
    const stable = Math.abs(b.x - last.x) < 0.5;
    last = { x: b.x, width: b.width };
    return stable ? 'settled' : 'moving';
  }, { timeout: 5000, intervals: [80, 80, 80, 120, 200] }).toBe('settled');
  return last;
}

/** Nothing anywhere in the shell may sit outside the viewport horizontally. */
async function horizontalOverflow(page: Page): Promise<number> {
  return await page.evaluate(() => {
    const de = document.documentElement;
    return de.scrollWidth - de.clientWidth;
  });
}

test.describe('narrow windows', () => {
  test('at 1024 the right pane becomes a reachable drawer', async ({ page }) => {
    await bootThenNarrow(page, 'narrow-1024-root', 1024, 768);

    await expect(page.locator('body')).toHaveClass(/atlas-narrow/);
    // The sidebar is still a column at this width.
    await expect(page.locator('body')).not.toHaveClass(/atlas-narrow-sidebar/);
    expect(await horizontalOverflow(page)).toBe(0);

    const toggle = page.locator('.atlas-room-nav-drawer-btn.is-right');
    await expect(toggle).toBeVisible();

    // Closed: the pane is parked off the right edge.
    const closed = await settledBox(page, '.atlas-right');
    expect(closed.x).toBeGreaterThanOrEqual(1024);

    // Open: fully on screen.
    await toggle.click();
    await expect(page.locator('body')).toHaveClass(/atlas-drawer-right-open/);
    const open = await settledBox(page, '.atlas-right');
    expect(open.x).toBeGreaterThanOrEqual(0);
    expect(open.x + open.width).toBeLessThanOrEqual(1024 + 1);

    // Escape closes it, like every other dismissible surface.
    await page.keyboard.press('Escape');
    await expect(page.locator('body')).not.toHaveClass(/atlas-drawer-right-open/);
  });

  test('at 760 both side panes are drawers and the middle keeps the window', async ({ page }) => {
    await bootThenNarrow(page, 'narrow-760-root', 760, 800);

    await expect(page.locator('body')).toHaveClass(/atlas-narrow-sidebar/);
    expect(await horizontalOverflow(page)).toBe(0);

    const middle = await page.locator('.atlas-middle').boundingBox();
    expect(Math.round(middle!.width)).toBe(760);

    const sidebarToggle = page.locator('.atlas-room-nav-drawer-btn.is-sidebar');
    await expect(sidebarToggle).toBeVisible();
    await sidebarToggle.click();
    const drawer = await settledBox(page, '.atlas-sidebar');
    expect(drawer.x).toBeGreaterThanOrEqual(-1);

    // With a drawer open the scrim covers the nav, so the other toggle is
    // deliberately not clickable: you dismiss first. (Discovered by this test
    // timing out on that click, which is the design answering back.)
    await page.locator('.atlas-drawer-scrim').click();
    await expect(page.locator('body')).not.toHaveClass(/atlas-drawer-sidebar-open/);

    // Only ONE drawer at a time: two overlapping drawers on a small screen
    // would leave no middle pane visible at all.
    await page.locator('.atlas-room-nav-drawer-btn.is-right').click();
    await expect(page.locator('body')).toHaveClass(/atlas-drawer-right-open/);
    await expect(page.locator('body')).not.toHaveClass(/atlas-drawer-sidebar-open/);
  });

  test('at 390 both drawer toggles stay on screen', async ({ page }) => {
    // The first build of this layer pushed the right toggle to x=404 on a
    // 390px screen, which would have been this layer reintroducing its own
    // bug: a control you cannot reach.
    await bootThenNarrow(page, 'narrow-390-root', 390, 780);

    expect(await horizontalOverflow(page)).toBe(0);

    for (const which of ['is-sidebar', 'is-right']) {
      const box = await page.locator(`.atlas-room-nav-drawer-btn.${which}`).boundingBox();
      expect(box, which).not.toBeNull();
      expect(box!.x, which).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, which).toBeLessThanOrEqual(390);
    }
  });

  test('at 390 the strip is a thumb strip: finger-sized controls, the other rooms under More (#244)', async ({ page }) => {
    // The Captain's phone (h37 #4223): "the top bar is buggy; too many things in it". Six room
    // icons, the label expander, a selected-element chip and search at 28px each.
    await bootThenNarrow(page, 'narrow-phone-root', 390, 780);

    for (const room of ['knowledge', 'timeline', 'share', 'import']) {
      await expect(page.locator(`.atlas-room-nav-strip [data-room="${room}"]`), room).toBeHidden();
    }
    await expect(page.locator('.atlas-room-nav-expand')).toBeHidden();
    const small = await page.evaluate(() => [...document.querySelectorAll('.atlas-room-nav-strip button')]
      .filter((b) => {
        const r = b.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40);
      })
      .map((b) => b.getAttribute('aria-label') ?? b.className));
    expect(small).toEqual([]);

    const more = page.getByRole('button', { name: 'More rooms' });
    await more.click();
    await expect(page.getByRole('menuitem')).toHaveCount(4);
    await page.getByRole('menuitem', { name: 'Charts' }).click();
    await expect(page).toHaveURL(/\/timeline$/);
    await expect(page.getByRole('menuitem')).toHaveCount(0);
    await expect(more).toHaveClass(/active/);
    expect(await horizontalOverflow(page)).toBe(0);
  });

  test("at 360 a map's tools are finger-sized and a submap's way up keeps its name (S471)", async ({ page }) => {
    // The phone tier grew the room's small buttons to 40px, but the map's toolbar lives in the right
    // drawer and stayed 22px. Grown, a submap's way up was squeezed to "Th…" (#139 names where it goes).
    await bootThenNarrow(page, 'narrow-maptools-root', 360, 780);
    const ids = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const top = await store.createElement('map', { name: 'The whole continent of Ostra' });
      const sub = await store.createElement('map', { name: 'The harbour quarter of Vell', parent_map: top.id });
      api.patchData(await store.listElements());
      return { sub: sub.id, w: api.getState().active.worldId };
    });
    await page.evaluate(([w, m]) => { window.location.hash = `#/w/${w}/map/${m}`; }, [ids.w, ids.sub]);
    await page.locator('.atlas-room-nav-drawer-btn.is-right').click();
    await settledBox(page, '.atlas-right');
    const bar = page.locator('.atlas-right .atlas-map-toolbar').filter({ has: page.locator('.atlas-map-up-btn') });
    await expect(bar).toBeVisible();
    const m = await bar.evaluate((el) => {
      const pane = el.closest('.atlas-right')!.getBoundingClientRect();
      const up = el.querySelector('.atlas-map-up-label') as HTMLElement;
      const tools = [...el.querySelectorAll('.atlas-map-toolbar-btn:not(.atlas-map-up-btn)')]
        .map((b) => b.getBoundingClientRect()).filter((r) => r.width > 0);
      return {
        tools: tools.length,
        small: tools.filter((r) => r.width < 40 || r.height < 40).length,
        past: tools.filter((r) => r.right > pane.right + 0.5).length,
        upClipped: up.scrollWidth > up.clientWidth,
      };
    });
    expect(m.tools).toBeGreaterThanOrEqual(6);
    expect(m.small).toBe(0);
    expect(m.past).toBe(0);
    expect(m.upClipped).toBe(false);
  });

  test("at 390 the aliases dialog's remove is finger-sized", async ({ page }) => {
    // The dialog is a modal outside .atlas-middle, so the phone tier's 40px missed it (22px, #526's gap).
    await bootThenNarrow(page, 'narrow-aliases-root', 390, 780);
    await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const el = await store.createElement('character', { name: 'Ilse Varn', atlas_aliases: ['The Grey', 'Old Ilse'] });
      api.patchData(await store.listElements());
      window.location.hash = `#/w/${api.getState().active.worldId}/element/${el.id}`;
    });
    await page.locator('.atlas-aliases-display').click();
    const removes = page.locator('.atlas-aliases-row [data-role="remove"]');
    await expect(removes).toHaveCount(2);
    const sizes = await removes.evaluateAll((bs) => bs.map((b) => {
      const r = b.getBoundingClientRect();
      return [Math.round(r.width), Math.round(r.height)];
    }));
    for (const [w, h] of sizes) {
      expect(w).toBeGreaterThanOrEqual(40);
      expect(h).toBeGreaterThanOrEqual(40);
    }
  });

  test('above the breakpoint nothing changes', async ({ page }) => {
    await bootThenNarrow(page, 'narrow-wide-root', 1440, 900);

    await expect(page.locator('body')).not.toHaveClass(/atlas-narrow/);
    await expect(page.locator('.atlas-room-nav-drawer-btn.is-right')).toBeHidden();
    await expect(page.locator('.atlas-room-nav-drawer-btn.is-sidebar')).toBeHidden();
    // The phone's More is a phone's only (#244): every room keeps its own button here.
    await expect(page.locator('.atlas-room-nav-more')).toBeHidden();
    await expect(page.locator('.atlas-room-nav-strip [data-room="timeline"]')).toBeVisible();

    // All three panes are columns, side by side, inside the window.
    const boxes = await Promise.all(
      ['.atlas-sidebar', '.atlas-middle', '.atlas-right'].map(sel => page.locator(sel).boundingBox()),
    );
    expect(boxes[0]!.x).toBeLessThan(boxes[1]!.x);
    expect(boxes[1]!.x).toBeLessThan(boxes[2]!.x);
    expect(boxes[2]!.x + boxes[2]!.width).toBeLessThanOrEqual(1441);
  });

  test('the tour dock fits a phone screen instead of painting over itself', async ({ page }) => {
    // THE banked launch item. The dock is fixed-height for desktop no-jitter;
    // at 390 the sentence wraps to six lines and the children overflowed the
    // box and overlapped. Asserted as geometry: each child below the last,
    // and the whole dock inside the viewport.
    await page.setViewportSize({ width: 390, height: 780 });
    await freshBoot(page);
    await page.evaluate(async () => {
      const engine = await import('/src/tour/tour-engine.ts');
      await (engine as any).launchTour();
    });
    await expect(page.locator('.atlas-tour-bar')).toBeVisible();
    await page.locator('.atlas-tour-root button', { hasText: 'Start' }).click();
    await expect(page.locator('.atlas-tour-copy')).toBeVisible();

    const geo = await page.evaluate(() => {
      const bar = document.querySelector('.atlas-tour-bar') as HTMLElement;
      const box = (sel: string) => {
        const el = bar.querySelector(sel) as HTMLElement | null;
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { top: r.top, bottom: r.bottom };
      };
      // The RENDERED extent of the sentence, not its box. The words are laid
      // out inside a container with a reserved height and `overflow: visible`,
      // so when they wrap past that height they PAINT OUTSIDE IT while the
      // box stays exactly as tall as it was told to be. Comparing boxes said
      // everything was fine on a screen where the text was unreadable, which
      // is this suite's own founding lesson wearing a new hat.
      const words = Array.from(bar.querySelectorAll('.atlas-tour-word'));
      const inkBottom = words.reduce((m, w) => Math.max(m, w.getBoundingClientRect().bottom), 0);
      const r = bar.getBoundingClientRect();
      return {
        barTop: r.top, barBottom: r.bottom, vh: window.innerHeight,
        inkBottom,
        sentence: box('.atlas-tour-sentence'),
        copy: box('.atlas-tour-copy'),
        controls: box('.atlas-tour-controls'),
      };
    });

    expect(geo.barTop).toBeGreaterThanOrEqual(0);
    expect(geo.barBottom).toBeLessThanOrEqual(geo.vh + 1);
    // The overlap that shipped: the sentence's WORDS ran over the copy.
    expect(geo.inkBottom).toBeGreaterThan(0);
    expect(geo.inkBottom).toBeLessThanOrEqual(geo.copy!.top + 1);
    expect(geo.copy!.bottom).toBeLessThanOrEqual(geo.controls!.top + 1);
  });
});

// S366 (lane C B1): below 820px with no world open, the sidebar drawer held
// the only thing to do and nothing opened it: the preview strip had no
// toggle and the copy pointed at "the top left". Now the no-world screen
// opens the drawer once, and the toggle is there for a user who closes it.
test('at 760 with a home folder and no world open, the sidebar is in reach', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 820 });
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const fsRoot = await navigator.storage.getDirectory();
    api.setNextDirectory(await fsRoot.getDirectoryHandle('narrow-noworld', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  const create = page.locator('.atlas-worlds-header [data-action="create-local"]');
  const inReach = async () => {
    const box = await create.boundingBox();
    return !!box && box.x >= 0 && box.x + box.width <= 760;
  };
  await expect.poll(inReach).toBe(true);
  // Closed by hand through the scrim, it comes back from the strip's toggle.
  await page.locator('.atlas-drawer-scrim').click({ position: { x: 700, y: 300 } });
  await expect.poll(inReach).toBe(false);
  await page.locator('.atlas-room-nav-drawer-btn.is-sidebar').click();
  await expect.poll(inReach).toBe(true);
});
