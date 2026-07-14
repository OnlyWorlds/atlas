/**
 * Calendar e2e (2B, 2026-07-14). Locks the arc's spine end to end:
 * the world clock GATE (setting the step meaning enables calendar creation) →
 * the builder (live preview) → save mints a Construct with atlas_calendar →
 * the lens re-labels the room (ticks, now chip) → typed calendar-word date
 * entry writes the raw integer → lens off restores bare numbers → saved
 * charts remember their lens.
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
    const sub = await root.getDirectoryHandle('calendar-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'calworld');
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

/** Gate → builder → save: mints "The Almanac" (two 90-day months, one era). */
async function buildCalendar(page: Page) {
  // Pre-clock, "+ new calendar" is GREYED (the clock is the prerequisite and
  // sits above it — Captain's ruling); the world clock item names the ask.
  await page.click('.atlas-cal-chip');
  await expect(page.locator('.atlas-cal-menu-item.disabled', { hasText: '+ new calendar' })).toBeVisible();
  await page.locator('.atlas-cal-menu-item', { hasText: 'world clock — set it first' }).click();
  await expect(page.locator('[data-modal="world-clock"]')).toBeVisible();
  await page.fill('#wc-unit', 'day');
  await page.fill('#wc-now', '400');
  await page.click('[data-action="save-clock"]');
  // With the clock set, create is live.
  await page.click('.atlas-cal-chip');
  await page.locator('.atlas-cal-menu-item', { hasText: '+ new calendar' }).click();
  await expect(page.locator('[data-modal="calendar-builder"]')).toBeVisible();
  await page.fill('#cb-name', 'The Almanac');
  await page.click('[data-add="era"]');
  const era = page.locator('[data-row="era:0"]');
  await era.locator('[data-col="name"]').fill('Freehold Tally');
  await era.locator('[data-col="abbrev"]').fill('FT');
  await era.locator('[data-col="start"]').fill('0');
  await page.click('[data-add="month"]');
  await page.click('[data-add="month"]');
  await page.locator('[data-row="month:0"] [data-col="name"]').fill('Sowmarch');
  await page.locator('[data-row="month:0"] [data-col="length"]').fill('90');
  await page.locator('[data-row="month:1"] [data-col="name"]').fill('Greening');
  await page.locator('[data-row="month:1"] [data-col="length"]').fill('90');
  await page.fill('[data-field="format"]', '{day} {month}, Year {year} {era}');
  // The live preview formats real world dates through the draft.
  await expect(page.locator('[data-role="preview"]')).toContainText('Sowmarch');
  await page.click('[data-action="save-calendar"]');
  await expect(page.locator('[data-modal="calendar-builder"]')).toHaveCount(0);
}

test('the world clock gate flows into the builder, and the saved calendar re-labels the room', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Founding', start_date: 0 });
  await createElement(page, 'event', { name: 'The Cracking', start_date: 380 });
  await openCharts(page);

  // Fresh world: no calendar, bare-number now control after the gate will show.
  await expect(page.locator('.atlas-cal-chip')).toContainText('no calendar');

  await buildCalendar(page);

  // The lens activates on save: chip names it, the now chip speaks calendar
  // (400 = day 41 of year 3 under two 90-day months → "41 Sowmarch, Year 3 FT").
  await expect(page.locator('.atlas-cal-chip')).toContainText('The Almanac');
  await expect(page.locator('.atlas-chart-now-chip')).toContainText('Year 3 FT');

  // The calendar exists as a real Construct with the config field.
  const construct = await page.evaluate(() => {
    const els = (window as any).__atlasTestApi.getState().data.elements;
    const cal = els.find((e: any) => e.atlas_calendar);
    return cal ? { type: cal.type, supertype: cal.supertype, version: cal.atlas_calendar.version } : null;
  });
  expect(construct).toEqual({ type: 'construct', supertype: 'calendar', version: 1 });
});

test('typed calendar-word date entry resolves and writes the raw integer', async ({ page }) => {
  await setupWorld(page);
  // Three WELL-SEPARATED events (far apart in time → all sit on the beeswarm
  // midline, no lane fan) with the target at the exact fit midpoint — the one
  // x every pad model agrees on (the S265 geometry law).
  await createElement(page, 'event', { name: 'Founding', start_date: 10 });
  const eventId = await createElement(page, 'event', { name: 'Midfeast', start_date: 270 });
  await createElement(page, 'event', { name: 'The Cracking', start_date: 530 });
  await openCharts(page);
  await buildCalendar(page);

  // Grab the midpoint node: x is the canvas centre by construction; y probes a
  // short band around the midline (the axis strip reserves the bottom).
  const canvas = page.locator('.atlas-timeline-view-canvas');
  const box = (await canvas.boundingBox())!;
  for (const fy of [0.42, 0.46, 0.38, 0.5, 0.34]) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height * fy);
    if (await page.locator('.atlas-timeline-card-date').count()) break;
  }
  await expect(page.locator('.atlas-timeline-card-date')).toBeVisible();
  await page.click('.atlas-timeline-card-date');

  const input = page.locator('.atlas-edit-popover input');
  // Pre-filled in calendar words (day 270 = first day of Greening, year 2).
  await expect(input).toHaveValue('1 Greening, Year 2 FT');
  await input.fill('11 Sowmarch, Year 2 FT');
  // The live hint shows the resolution before commit (step 190 = 180 + 10).
  await expect(page.locator('.atlas-edit-popover-live')).toContainText('(step 190)');
  await input.press('Enter');

  await expect.poll(async () => page.evaluate((id) => {
    const els = (window as any).__atlasTestApi.getState().data.elements;
    return els.find((e: any) => e.id === id)?.start_date;
  }, eventId)).toBe(190);
});

test('lens off restores bare numbers; a saved chart remembers its lens', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Founding', start_date: 0 });
  await createElement(page, 'event', { name: 'The Cracking', start_date: 380 });
  await openCharts(page);
  await buildCalendar(page);
  await expect(page.locator('.atlas-chart-now-chip')).toContainText('Year 3 FT');

  // Save a chart UNDER the lens.
  await page.click('[data-action="save-chart"]');
  await expect(page.locator('.atlas-saved-chart')).toHaveCount(1);

  // Lens off: the now chip returns to the bare number. Nothing moves.
  await page.click('.atlas-cal-chip');
  await page.locator('.atlas-cal-menu-item', { hasText: 'none (bare numbers)' }).click();
  await expect(page.locator('.atlas-cal-chip')).toContainText('no calendar');
  await expect(page.locator('.atlas-chart-now-chip')).toContainText('400');

  // Reopen the saved chart: its lens comes back with it.
  await page.locator('.atlas-saved-chart-name').click();
  await expect(page.locator('.atlas-cal-chip')).toContainText('The Almanac');
  await expect(page.locator('.atlas-chart-now-chip')).toContainText('Year 3 FT');
});

test('the legacy-field mint offer seeds the builder and clears the fields', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'event', { name: 'Founding', start_date: 0 });
  // A world carrying the old time fields (junk-shaped, plus a usable "= 1"
  // pair) — written to disk AND mirrored into the slice the room reads.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const fields = {
      time_format_names: ['Day', 'Week', 'Year'],
      time_format_equivalents: ['1', '7', '365'],
    };
    await api.getActiveStore().writeWorldMeta(fields);
    const s = api.getState();
    api.patchSlice('active', { ...s.active, meta: { ...s.active.meta, ...fields } });
  });
  await openCharts(page);

  // Gates hold (fields present, no calendar, writable) → the offer shows,
  // and it says out loud that the fields will be cleared.
  const banner = page.locator('.atlas-cal-mint-offer');
  await expect(banner).toContainText('old fields are cleared');
  await banner.locator('[data-action="mint-calendar"]').click();

  // Clock unset → the world clock gate comes first, as everywhere.
  await expect(page.locator('[data-modal="world-clock"]')).toBeVisible();
  await page.fill('#wc-unit', 'day');
  await page.click('[data-action="save-clock"]');

  // The builder opens SEEDED: the step word came from the "= 1" pair.
  await expect(page.locator('[data-modal="calendar-builder"]')).toBeVisible();
  await expect(page.locator('#cb-step')).toHaveValue('day');
  await page.fill('#cb-name', 'The Inherited Count');
  await page.click('[data-action="save-calendar"]');

  // Lens active · offer retired · both fields CLEARED on the world · the
  // vocabulary preserved as description prose on the construct.
  await expect(page.locator('.atlas-cal-chip')).toContainText('The Inherited Count');
  await expect(banner).toBeEmpty();
  await expect.poll(() => page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const meta = await api.getActiveStore().readWorldMeta();
    const cal = api.getState().data.elements.find((e: any) => e.atlas_calendar);
    return {
      names: meta.time_format_names ?? [],
      equivalents: meta.time_format_equivalents ?? [],
      descHasUnits: (cal?.description ?? '').includes('Day = 1'),
    };
  })).toEqual({ names: [], equivalents: [], descHasUnits: true });
});
