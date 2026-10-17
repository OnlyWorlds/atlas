/**
 * A map drawn from its own zones (S423; `src/core/map-ink.ts`): a map's style
 * draws each zone whose subtype names a kind from that kind (ink, patterns,
 * names along lines), the rest as before, and nothing about the zones is
 * written; and Trace turns one drag into the few points of a zone, without
 * panning the map under it.
 */

import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    (window as any).__atlasTestApi.setNextDirectory(await root.getDirectoryHandle('map-ink-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'inkworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/** A map with a Landmass, a Range, a River and a zone of no known kind. */
async function seedMap(page: Page, style: string | null): Promise<{ worldId: string; mapId: string }> {
  return page.evaluate(async (style) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', style ? { name: 'Isle', atlas_map_style: style } : { name: 'Isle' });
    const zone = async (name: string, subtype: string, shape: string, pts: number[][]) => {
      const z = await store.createZone({ name, subtype, atlas_shape: shape });
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({ name: '', map_id: map.id, zone_id: z.id, x: pts[i][0], y: pts[i][1], order: i });
      }
    };
    await zone('Isle', 'Landmass', 'polygon', [[500, 500], [1500, 450], [1600, 1300], [900, 1550], [450, 1100]]);
    await zone('Spine', 'Range', 'polygon', [[800, 900], [1200, 850], [1250, 1100], [850, 1150]]);
    await zone('Sallow', 'River', 'line', [[700, 700], [900, 1000], [1100, 1400]]);
    await zone('Barony', 'Barony', 'polygon', [[1300, 600], [1450, 600], [1450, 750], [1300, 750]]);
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId, mapId: map.id };
  }, style);
}

async function openMap(page: Page, ids: { worldId: string; mapId: string }) {
  await page.evaluate(({ worldId, mapId }) => { location.hash = `#/w/${worldId}/map/${mapId}`; }, ids);
  await expect(page.locator('.atlas-map-pane .leaflet-overlay-pane path').first()).toBeVisible();
}

const inkFacts = (page: Page) => page.evaluate(() => ({
  patterned: [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path')]
    .filter(p => (p.getAttribute('fill') || '').startsWith('url(#atlas-ink-')).length,
  alongLine: [...document.querySelectorAll('.atlas-map-pane .atlas-ink-line-label textPath')].map(t => t.textContent),
  inkLabels: [...document.querySelectorAll('.atlas-map-pane .atlas-zone-label-ink span')].map(s => s.textContent).sort(),
  plainLabels: [...document.querySelectorAll('.atlas-map-pane .atlas-zone-label:not(.atlas-zone-label-ink) span')].map(s => s.textContent),
  inkPins: document.querySelectorAll('.atlas-map-pane .atlas-map-ink').length,
}));

test('a plain map draws its zones as before (the control)', async ({ page }) => {
  await setupWorld(page);
  await openMap(page, await seedMap(page, null));
  await expect.poll(async () => (await inkFacts(page)).plainLabels.length).toBe(4);
  const f = await inkFacts(page);
  expect(f.patterned).toBe(0);
  expect(f.alongLine).toEqual([]);
  expect(f.inkLabels).toEqual([]);
  expect(f.inkPins).toBe(0);
});

test('an ink map draws each zone from its kind, and the zones stay as they are', async ({ page }) => {
  await setupWorld(page);
  const ids = await seedMap(page, 'ink');
  const before = await page.evaluate(() => JSON.stringify((window as any).__atlasTestApi.getState().data.elements
    .filter((e: any) => e.type === 'zone' || e.type === 'marker').map((e: any) => [e.id, e.x, e.y, e.subtype, e.supertype])));
  await openMap(page, ids);
  await expect.poll(async () => (await inkFacts(page)).inkLabels).toEqual(['Isle', 'Spine']);
  const f = await inkFacts(page);
  expect(f.patterned).toBe(1);                 // the Range's hatch
  expect(f.alongLine).toEqual(['Sallow']);      // the River's name runs along it
  expect(f.plainLabels).toEqual(['Barony']);    // no known kind: as before
  expect(f.inkPins).toBe(1);
  const after = await page.evaluate(() => JSON.stringify((window as any).__atlasTestApi.getState().data.elements
    .filter((e: any) => e.type === 'zone' || e.type === 'marker').map((e: any) => [e.id, e.x, e.y, e.subtype, e.supertype])));
  expect(after).toBe(before);
});

const readTransform = (page: Page) =>
  page.locator('.atlas-map-pane .leaflet-map-pane').evaluate(el => (el as HTMLElement).style.transform);

/** The map pane's transform once a pan's inertia has run out (two reads 300 ms apart agree). */
async function mapPaneTransform(page: Page): Promise<string> {
  let prev = await readTransform(page);
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const next = await readTransform(page);
    if (next === prev) return next;
    prev = next;
  }
  return prev;
}

async function dragAcross(page: Page) {
  const box = (await page.locator('.atlas-map-pane .leaflet-container').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) * 0.25;
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 1.8;
    await page.mouse.move(cx + r * Math.cos(t) * (1 + 0.1 * Math.sin(4 * t)), cy + r * Math.sin(t));
  }
  await page.mouse.up();
}

test('Trace turns one drag into a few points and does not pan the map', async ({ page }) => {
  await setupWorld(page);
  await openMap(page, await seedMap(page, 'ink'));
  // At the fitted view the map's bounds allow no pan at all, so the control
  // below could never move it: zoom in first.
  for (let i = 0; i < 2; i++) {
    await page.locator('.atlas-map-pane .leaflet-control-zoom-in').click();
    await page.waitForTimeout(350);
  }
  await page.click('button[data-action="draw-polygon"]');
  const overlay = page.locator('[data-zone-draft-overlay]');

  // Control: without Trace, the same drag pans the map and places nothing.
  const t0 = await mapPaneTransform(page);
  await dragAcross(page);
  expect(await mapPaneTransform(page)).not.toBe(t0);
  await expect(overlay.locator('.atlas-zone-draft-count-num')).toHaveText('0');

  await overlay.locator('[data-action="trace"]').click();
  await expect(overlay.locator('[data-action="trace"]')).toHaveAttribute('aria-pressed', 'true');
  const t1 = await mapPaneTransform(page);
  await dragAcross(page);
  expect(await mapPaneTransform(page)).toBe(t1);
  const n = Number(await overlay.locator('.atlas-zone-draft-count-num').textContent());
  expect(n).toBeGreaterThan(5);
  expect(n).toBeLessThan(40);                  // 121 samples, kept at meaning resolution

  // Trace off: a drag pans again. Straight out from the centre, clear of the
  // traced points (a press on one drags the point), and the other way from the
  // first drag, which left the map at its bound.
  await overlay.locator('[data-action="trace"]').click();
  await expect(overlay.locator('[data-action="trace"]')).toHaveAttribute('aria-pressed', 'false');
  const box = (await page.locator('.atlas-map-pane .leaflet-container').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 20; i++) await page.mouse.move(box.x + box.width / 2 + 8 * i, box.y + box.height / 2 + 6 * i);
  await page.mouse.up();
  expect(await mapPaneTransform(page)).not.toBe(t1);
  await expect(overlay.locator('.atlas-zone-draft-count-num')).toHaveText(String(n));
});
