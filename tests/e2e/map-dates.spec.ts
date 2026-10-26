/**
 * #280, date-keyed map layers: a map whose zones carry dates shows each zone
 * as of a chosen date (the world's now by default); a slider moves it, Now
 * and All dates set it, and a zone with no dates always shows. The seeded
 * world is a border that moves: two eras of one kingdom chained by
 * `linked_zones`, the later and larger one drawn first so the earlier sits on
 * top of it, plus an undated sea and a road that ends at 150.
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
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('map-dates-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'dated world');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** Set the world's now the way the charts room does: the meta on disk and in state. */
async function setNow(page: Page, value: number) {
  await page.evaluate(async (v) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().writeWorldMeta({ time_current: v });
    const active = api.getState().active;
    api.patchSlice('active', { ...active, meta: { ...active.meta, time_current: v } });
  }, value);
}

test('a map shows its zones as of a date: the now by default, a slider, Now and All dates (#280)', async ({ page }) => {
  await freshBoot(page);
  await setupWorld(page);
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Dated Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Dated Canvas' })).toBeVisible();
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  const bar = page.locator('[data-role="map-datebar"]');

  const seed = (zones: Array<{ name: string; color: string; box: [number, number, number, number]; dates?: object; line?: boolean }>) =>
    page.evaluate(async (list) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Dated Canvas');
      const ids: string[] = [];
      for (const z of list) {
        const zone = await store.createZone({ name: z.name, atlas_color: z.color, ...(z.line ? { atlas_shape: 'line' } : {}), ...(z.dates ?? {}) });
        const [x0, y0, x1, y1] = z.box;
        const pts = z.line ? [[x0, y0], [x1, y1]] : [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        let order = 1;
        for (const [x, y] of pts) await store.createMarker({ map_id: map.id, zone_id: zone.id, x, y, order: order++ });
        ids.push(zone.id);
      }
      api.patchData(await store.listElements());
      return ids;
    }, zones);

  // An undated zone alone: no bar.
  await seed([{ name: 'the sea', color: '#0000aa', box: [100, 100, 400, 400] }]);
  await expect(container.locator('svg path[fill="#0000aa"]')).toHaveCount(1);
  await expect(bar).toBeHidden();

  // The border's two eras (the later one first, so the earlier lies on top), the road.
  const [second, first] = await seed([
    { name: 'the kingdom, second era', color: '#00aa00', box: [600, 600, 1600, 1600], dates: { start_date: 200 } },
    { name: 'the kingdom, first era', color: '#aa0000', box: [800, 800, 1400, 1400], dates: { start_date: 100, end_date: 200 } },
    { name: 'the old road', color: '#aaaa00', box: [100, 1800, 1900, 1800], dates: { end_date: 150 }, line: true },
  ]);
  await page.evaluate(async ([a, b]) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createZone({ name: 'the kingdom', linked_zones: [a, b] });
    api.patchData(await store.listElements());
  }, [first, second]);

  const label = bar.locator('[data-role="datebar-label"]');
  // How many the date shows rides the label's tooltip.
  const shows = (n: number) => expect(label).toHaveAttribute('title', new RegExp(`: ${n} of 4 zones show$`));
  const nowBtn = bar.locator('[data-action="datebar-now"]');
  const allBtn = bar.locator('[data-action="datebar-all"]');
  const shown = (color: string) => container.locator(`svg path[stroke="${color}"]:not([stroke-opacity="0"])`);

  // No now: every zone shows, the bar says so, there is no Now.
  await expect(bar).toBeVisible();
  await expect(label).toHaveText('All dates');
  await shows(4);
  await expect(nowBtn).toBeHidden();
  await expect(allBtn).toHaveAttribute('aria-pressed', 'true');

  // The world's now arrives: the map follows it. At 150 the first era and the road (ending at 150, half-open) part ways.
  await setNow(page, 150);
  await expect(label).toHaveText('150');
  await shows(2);
  await expect(nowBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(shown('#aa0000')).toHaveCount(1);
  await expect(shown('#00aa00')).toHaveCount(0);
  await expect(shown('#aaaa00')).toHaveCount(0);
  await expect(shown('#0000aa')).toHaveCount(1);

  // The zone panel lists what the date shows, the kingdom with it (its own dates are none).
  await page.click('[data-action="zones-dropdown"]');
  const panel = page.locator('[data-role="zones-dropdown-panel"]');
  await expect(panel.locator('.atlas-zone-chip-name')).toHaveText(['the kingdom', 'the kingdom, first era', 'the sea']);
  await page.keyboard.press('Escape');

  // The slider, by keyboard: Home is the earliest date, End the latest.
  const slider = bar.locator('[data-role="datebar-slider"]');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(label).toHaveText('100');
  await shows(3);
  await expect(shown('#aaaa00')).toHaveCount(1);
  await expect(nowBtn).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('End');
  await expect(label).toHaveText('200');
  await shows(2);
  await expect(shown('#00aa00')).toHaveCount(1);
  await expect(shown('#aa0000')).toHaveCount(0);

  // The earlier era lies on top of the later one, hidden: a click in the middle selects what is shown.
  const box = (await container.locator('svg path[stroke="#00aa00"]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect.poll(() => page.evaluate(() => location.hash)).toContain(second);

  // A right-click on the bar is the bar's, never the map's New pin.
  await label.click({ button: 'right' });
  await page.waitForTimeout(300);
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);

  // All dates, then back to the now.
  await allBtn.click();
  await expect(label).toHaveText('All dates');
  await shows(4);
  await expect(shown('#aa0000')).toHaveCount(1);
  await nowBtn.click();
  await expect(label).toHaveText('150');
  // The selected zone shows whatever the date (its page's Edit shape never lands on nothing).
  await shows(3);
  await expect(shown('#00aa00')).toHaveCount(1);
  // Esc clears the selection: the date alone decides again.
  await page.locator('.atlas-middle-content').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
  await shows(2);
  await expect(shown('#00aa00')).toHaveCount(0);
});

test('the zone panel at a date: a kind keeps its key, its eye hides it, and a date with no zone keeps the panel open (#280)', async ({ page }) => {
  await freshBoot(page);
  await setupWorld(page);
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Border Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Border Canvas' })).toBeVisible();
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();

  // Two north borders share a role across their eras; the south one is undated.
  // At 5 the date shows one north and the south, whose roles differ: grouped from
  // those two alone, the kind had a key the map's eyes never knew.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Border Canvas');
    const zone = async (name: string, role: string, color: string, x: number, dates: object) => {
      const z = await store.createZone({ name, supertype: 'Border', role, atlas_color: color, ...dates });
      let order = 1;
      for (const [px, py] of [[x, 100], [x + 300, 100], [x + 300, 400], [x, 400]]) {
        await store.createMarker({ map_id: map.id, zone_id: z.id, x: px, y: py, order: order++ });
      }
    };
    await zone('north, old', 'north', '#aa0000', 100, { start_date: 0, end_date: 10 });
    await zone('north, new', 'north', '#00aa00', 500, { start_date: 10 });
    await zone('south', 'south', '#0000aa', 900, {});
    await store.writeWorldMeta({ time_current: 5 });
    const active = api.getState().active;
    api.patchSlice('active', { ...active, meta: { ...active.meta, time_current: 5 } });
    api.patchData(await store.listElements());
  });
  const shown = (color: string) => container.locator(`svg path[stroke="${color}"]:not([stroke-opacity="0"])`);
  await expect(shown('#aa0000')).toHaveCount(1);
  await expect(shown('#00aa00')).toHaveCount(0);

  await page.click('[data-action="zones-dropdown"]');
  const panel = page.locator('[data-role="zones-dropdown-panel"]');
  await expect(panel.locator('.atlas-zone-kind-name')).toHaveText(['Border · north', 'Border · south']);
  await expect(page.locator('[data-action="zones-dropdown"] [data-role="zones-count"]')).toHaveText('2');
  await panel.locator('.atlas-zone-kind', { hasText: 'Border · south' }).locator('[data-action="toggle-kind-visible"]').click();
  await expect(shown('#0000aa')).toHaveCount(0);
  await expect(shown('#aa0000')).toHaveCount(1);

  // A date before every zone but the undated one hidden by its eye: the map shows
  // nothing it was asked to, and the open panel stays open saying so.
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const active = api.getState().active;
    api.patchSlice('active', { ...active, meta: { ...active.meta, time_current: -50 } });
  });
  await expect(shown('#aa0000')).toHaveCount(0);
  await expect(panel).toHaveClass(/is-open/);
  await expect(panel.locator('.atlas-zone-kind-name')).toHaveText(['Border · south']);
});

test('a map shows its pins by their element\'s dates: a birth on, an event inside its dates, the undated always (Q11)', async ({ page }) => {
  await freshBoot(page);
  await setupWorld(page);
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', 'Pinned Canvas');
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: 'Pinned Canvas' })).toBeVisible();
  const container = page.locator('.atlas-map-tab-wrapper .leaflet-container').first();
  const bar = page.locator('[data-role="map-datebar"]');
  const pins = container.locator('.leaflet-marker-icon.leaflet-interactive');

  // No zones at all: the pins' elements alone bring the bar.
  const siegeId = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = api.getState().data.elements.find((e: any) => e.type === 'map' && e.name === 'Pinned Canvas');
    const hero = await store.createElement('character', { name: 'Born at 100', birth_date: 100 });
    const siege = await store.createElement('event', { name: 'Siege 120 to 140', start_date: 120, end_date: 140 });
    const town = await store.createElement('location', { name: 'Undated Town' });
    // Not pinned yet: placed by New pin below, while the date hides it.
    await store.createElement('character', { name: 'Late Comer', birth_date: 160 });
    let x = 200;
    for (const el of [hero, siege, town]) {
      await store.createPin({ name: el.name, map_id: map.id, element_id: el.id, element_type: el.type, x, y: 300 });
      x += 300;
    }
    api.patchData(await store.listElements());
    return siege.id as string;
  });
  await expect(pins).toHaveCount(3);
  const label = bar.locator('[data-role="datebar-label"]');
  await expect(bar).toBeVisible();
  await expect(label).toHaveText('All dates');
  await expect(label).toHaveAttribute('title', /: 3 of 3 pins show$/);

  // The now inside the siege: all three.
  await setNow(page, 130);
  await expect(label).toHaveText('130');
  await expect(pins).toHaveCount(3);

  // The slider by keyboard: Home is 100 (the birth), where the siege has not begun.
  const slider = bar.locator('[data-role="datebar-slider"]');
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(label).toHaveText('100');
  await expect(pins).toHaveCount(2);
  await expect(label).toHaveAttribute('title', /: 2 of 3 pins show$/);
  // End is 140, the siege's end: half-open, so it is over there.
  await page.keyboard.press('End');
  await expect(label).toHaveText('140');
  await expect(pins).toHaveCount(2);

  // The chip strip keeps every type, counting what the date shows.
  const eventChip = page.locator('.atlas-pin-filter-chip[data-type="event"]');
  await expect(eventChip).toBeVisible();
  await expect(eventChip.locator('.atlas-pin-filter-chip-count')).toHaveText('0');

  // Selected, the siege's pin shows at any date, so show on map never lands on nothing.
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
  await page.evaluate(([w, id]) => { location.hash = `#/w/${w}/element/${id}`; }, [worldId, siegeId]);
  await expect(pins).toHaveCount(3);

  // Nothing selected again (the global Escape): the date rules once more.
  await page.locator('[data-role="datebar-label"]').click();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().ui.selectedElementId)).toBeNull();
  await expect(pins).toHaveCount(2);

  // The date only hides and shows: a slider move re-skins or rebuilds no pin
  // (the full sync per frame re-set every icon).
  await page.evaluate(async () => {
    const { mapTabCache } = await import('/src/tabs/right/map-tab-cache.ts');
    const w = window as any;
    w.__s416 = { update: 0, add: 0 };
    for (const entry of mapTabCache.values()) {
      const m = entry.manager as any;
      const update = m.updatePin.bind(m);
      const add = m.addPin.bind(m);
      m.updatePin = (...a: unknown[]) => { w.__s416.update++; return update(...a); };
      m.addPin = (...a: unknown[]) => { w.__s416.add++; return add(...a); };
    }
  });
  await slider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(label).toHaveText('139');
  await expect(pins).toHaveCount(3);
  await page.keyboard.press('End');
  await expect(pins).toHaveCount(2);
  expect(await page.evaluate(() => (window as any).__s416)).toEqual({ update: 0, add: 0 });

  // New pin, placing an element by name while the date hides it.
  const placeByName = async (type: string, prefix: string) => {
    await container.click({ button: 'right', position: { x: 60, y: 60 } });
    const create = page.locator('[data-modal="create-element"]');
    await create.locator('input[name="element-type"]').fill(type);
    const nameInput = create.locator('input[name="element-name"]');
    await nameInput.fill(prefix);
    await nameInput.press('Tab');
    await expect(create.locator('[data-action="create"]')).toHaveText('Place');
    await create.locator('[data-action="create"]').click();
  };
  // The siege is pinned already: the refusal says so, and its pin shows.
  await placeByName('event', 'Sie');
  await expect(page.locator('.ow-toast', { hasText: 'That element already has a pin on this map.' })).toBeVisible();
  await expect(pins).toHaveCount(3);
  // One born after the date, pinned now: it lands where the person can see it.
  await placeByName('character', 'Late');
  await expect(page.locator('.ow-toast', { hasText: 'Pin placed' })).toBeVisible();
  await expect(pins).toHaveCount(4);
  // Moving the date is a new question: the reveals end.
  await slider.focus();
  await page.keyboard.press('Home');
  await expect(label).toHaveText('100');
  await expect(pins).toHaveCount(2);

  // Located from the sidebar's on-map badge, the hidden siege shows (F2).
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await page.locator(`[data-element-id="${siegeId}"] .atlas-elements-row-onmap-badge`).click();
  await expect(pins).toHaveCount(3);
  await page.keyboard.press('Escape');
  await slider.focus();
  await page.keyboard.press('End');
  await expect(label).toHaveText('160');
  await expect(pins).toHaveCount(3);

  // The Charts move the now: the pins follow it.
  await bar.locator('[data-action="datebar-now"]').click();
  await setNow(page, 90);
  await expect(label).toHaveText('90');
  await expect(pins).toHaveCount(1);

  // All dates: every pin.
  await bar.locator('[data-action="datebar-all"]').click();
  await expect(pins).toHaveCount(4);
});
