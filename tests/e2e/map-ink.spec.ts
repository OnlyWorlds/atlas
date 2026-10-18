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

// gate G3: over a picture the picture is the ground: the zones keep their ink,
// names and patterns, and the land neither fills with paper nor rings with shore.
test('a map with a picture takes the style\'s ink and covers nothing', async ({ page }) => {
  await setupWorld(page);
  const ids = await seedMap(page, 'ink');
  await page.evaluate(async (mapId) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const png1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    await store.updateMap(mapId, { image_url: png1x1, width: 2000, height: 2000 });
    api.patchData(await store.listElements());
  }, ids.mapId);
  await openMap(page, ids);
  await expect.poll(async () => (await inkFacts(page)).inkLabels).toEqual(['Isle', 'Spine']);
  const f = await inkFacts(page);
  expect(f.patterned).toBe(1);                 // the Range's hatch, over the picture
  expect(f.alongLine).toEqual(['Sallow']);
  expect(f.inkPins).toBe(1);
  const cover = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path')];
    return {
      // ink on parchment's paper and its three shore bands
      paper: paths.filter(p => (p.getAttribute('fill') || '').toLowerCase() === '#f3ead2').length,
      bands: paths.filter(p => ['#c9b48d', '#d6c4a0', '#dfd0b0'].includes((p.getAttribute('stroke') || '').toLowerCase())).length,
    };
  });
  expect(cover).toEqual({ paper: 0, bands: 0 });
});

// gate G4: back on Plain, a map-wide sea drawn first stays under the kingdom on it.
test('back from a style to Plain, the zones keep their plain order', async ({ page }) => {
  await setupWorld(page);
  const ids = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', { name: 'Gulf', atlas_map_style: 'ink' });
    const zone = async (name: string, subtype: string, pts: number[][]) => {
      const z = await store.createZone({ name, subtype, atlas_shape: 'polygon' });
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({ name: '', map_id: map.id, zone_id: z.id, x: pts[i][0], y: pts[i][1], order: i });
      }
    };
    await zone('Ocean', 'Sea', [[0, 0], [2000, 0], [2000, 2000], [0, 2000]]);
    await zone('Kingdom', 'Kingdom', [[800, 800], [1200, 800], [1200, 1200], [800, 1200]]);
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId, mapId: map.id };
  });
  await openMap(page, ids);
  await expect.poll(async () => (await inkFacts(page)).inkPins).toBe(1);
  await page.evaluate(async (mapId) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.updateMap(mapId, { atlas_map_style: null });
    api.patchData(await store.listElements());
  }, ids.mapId);
  await expect.poll(async () => (await inkFacts(page)).inkPins).toBe(0);
  // The order the svg paints in: the largest path is the Ocean, the smallest the Kingdom.
  const order = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path')] as SVGPathElement[];
    const area = (p: SVGPathElement) => { const b = p.getBBox(); return b.width * b.height; };
    const filled = paths.filter(p => area(p) > 0);
    const big = filled.reduce((a, b) => (area(b) > area(a) ? b : a));
    const small = filled.reduce((a, b) => (area(b) < area(a) ? b : a));
    return { ocean: paths.indexOf(big), kingdom: paths.indexOf(small) };
  });
  expect(order.ocean).toBeLessThan(order.kingdom);
});

test('a modern atlas map draws the same zones in its own register (S424)', async ({ page }) => {
  await setupWorld(page);
  await openMap(page, await seedMap(page, 'atlas'));
  await expect.poll(async () => (await inkFacts(page)).inkLabels).toEqual(['Isle', 'Spine']);
  const f = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path')];
    return {
      fills: paths.map(p => p.getAttribute('fill') || '').filter(s => s.startsWith('url(#atlas-ink-')),
      shoreBands: paths.filter(p => p.getAttribute('stroke') === '#c9b48d').length,
      styleClass: document.querySelector('.atlas-map-pane .atlas-map-style-atlas') !== null,
      inkClass: document.querySelector('.atlas-map-pane .atlas-map-style-ink') !== null,
      riverName: getComputedStyle(document.querySelector('.atlas-map-pane .atlas-ink-line-label')!).fill,
    };
  });
  expect(f.fills).toEqual(['url(#atlas-ink-dots-9a8a6d-on-f0e6cf)']);   // the Range: Seethe's contour dots on her warm ground
  expect(f.shoreBands).toBe(0);
  expect(f.styleClass).toBe(true);
  expect(f.inkClass).toBe(false);
  expect(f.riverName).toBe('rgb(48, 101, 133)');               // #306585
});

test('a hatched map draws the same zones in one sepia, the kind in the texture (S425)', async ({ page }) => {
  await setupWorld(page);
  await openMap(page, await seedMap(page, 'hatched'));
  await expect.poll(async () => (await inkFacts(page)).inkLabels).toEqual(['Isle', 'Spine']);
  const f = await page.evaluate(() => {
    const paths = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path')];
    const fill = (p: Element) => p.getAttribute('fill') || '';
    const id = paths.map(fill).find(s => s.startsWith('url(#atlas-ink-'))?.slice(5, -1);
    const tile = id ? document.getElementById(id) : null;
    return {
      fills: paths.map(fill).filter(s => s.startsWith('url(#atlas-ink-')),
      tileStrokes: tile ? [...new Set([...tile.querySelectorAll('line')].map(l => l.getAttribute('stroke')))] : [],
      // the double coast: a sepia band and a paper band over it, under the land
      shore: paths.filter(p => p.getAttribute('fill') === 'none' && ['#28220f', '#e8e2cc'].includes(p.getAttribute('stroke') || ''))
        .map(p => `${p.getAttribute('stroke')} ${p.getAttribute('stroke-width')}`),
      land: paths.filter(p => fill(p) === '#f0e9cf').length,
      styleClass: document.querySelector('.atlas-map-pane .atlas-map-style-hatched') !== null,
      atlasClass: document.querySelector('.atlas-map-pane .atlas-map-style-atlas') !== null,
      riverName: getComputedStyle(document.querySelector('.atlas-map-pane .atlas-ink-line-label')!).fill,
      islandCase: getComputedStyle([...document.querySelectorAll('.atlas-map-pane .atlas-zone-label-ink span')]
        .find(s => s.textContent === 'Isle')!).textTransform,
    };
  });
  expect(f.fills).toEqual(['url(#atlas-ink-rhatch-28220f-on-f0e9cf)']);   // the Range: dense diagonal strokes on the land
  expect(f.tileStrokes).toEqual(['#28220f']);                            // one ink
  expect(f.shore).toEqual(['#28220f 10.7', '#e8e2cc 9.3']);
  expect(f.land).toBe(1);
  expect(f.styleClass).toBe(true);
  expect(f.atlasClass).toBe(false);
  expect(f.riverName).toBe('rgb(40, 34, 15)');                           // #28220f
  expect(f.islandCase).toBe('uppercase');
});

/** An island lettered in spaced capitals, a pin either side of its middle at `dx` units (S424). */
async function seedLetteredIsland(page: Page, name: string, dx: number, style = 'ink'): Promise<{ worldId: string; mapId: string }> {
  return page.evaluate(async ({ name, dx, style }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', { name, atlas_map_style: style });
    const zone = async (zname: string, subtype: string, pts: number[][]) => {
      const z = await store.createZone({ name: zname, subtype, atlas_shape: 'polygon' });
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({ name: '', map_id: map.id, zone_id: z.id, x: pts[i][0], y: pts[i][1], order: i });
      }
    };
    // A wood in another face (italic, lowercase) in a corner, first by name: the
    // density layer must not measure the island's capitals by it.
    await zone('Alder', 'Forest', [[350, 1350], [650, 1350], [650, 1650], [350, 1650]]);
    await zone(name, 'Landmass', [[300, 300], [1700, 300], [1700, 1700], [300, 1700]]);
    for (const x of [1000 - dx, 1000 + dx]) {
      const loc = await store.createElement('location', { name: `${name} ${x}` });
      await store.createElement('pin', { name: `${name} ${x}`, map_id: map.id, element_id: loc.id, element_type: 'location', x, y: 1000 });
    }
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId, mapId: map.id };
  }, { name, dx, style });
}

/** Whether the island's name prints, over how many pins, and the map's px per unit. */
const letteringFacts = (page: Page, name: string) => page.evaluate((name) => {
  const span = [...document.querySelectorAll('.atlas-map-pane .atlas-zone-label-ink span')]
    .find(s => s.textContent === name) as HTMLElement | undefined;
  const land = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path')]
    .find(p => ['#f3ead2', '#f0e9cf'].includes(p.getAttribute('fill') || ''));   // ink's land, hatched's
  if (!span || !land) return null;
  const a = span.getBoundingClientRect();
  const covered = [...document.querySelectorAll('.atlas-map-pane img.leaflet-marker-icon')]
    .map(i => i.getBoundingClientRect())
    .filter(b => a.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top).length;
  return { shown: a.width > 0, covered, width: Math.round(a.width), scale: land.getBoundingClientRect().width / 1400 };
}, name);

/** The facts once the fit and the density pass have settled (two reads 300 ms apart agree). */
async function settledLettering(page: Page, name: string) {
  await expect(page.locator('.atlas-map-pane img.leaflet-marker-icon')).toHaveCount(2);
  let prev = JSON.stringify(await letteringFacts(page, name));
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(300);
    const next = JSON.stringify(await letteringFacts(page, name));
    if (next === prev && next !== 'null') break;
    prev = next;
  }
  return (await letteringFacts(page, name))!;
}

// Ink only: a hatched variant hid the name with the per-face measure reverted
// too, so it could never go red (S425).
for (const style of ['ink']) {
  test(`an island's spaced capitals never print over the pins beside them, ${style} (S424)`, async ({ page }) => {
    await setupWorld(page);
    // The control: pins far out, so the name has room and prints.
    await openMap(page, await seedLetteredIsland(page, 'Ostmark', 650, style));
    const far = await settledLettering(page, 'Ostmark');
    expect(far).toMatchObject({ shown: true, covered: 0 });
    // Pins at half the printed width from the middle: under the spaced
    // capitals, outside a lowercase, unspaced measure of the same name.
    const dx = Math.round((far.width * 0.5) / far.scale);
    await openMap(page, await seedLetteredIsland(page, 'Westmark', dx, style));
    const near = await settledLettering(page, 'Westmark');
    expect(near.covered).toBe(0);
  });
}

/** An island with a river that runs out over its east coast, through a forest on its middle (S424). */
async function seedRiverMap(page: Page): Promise<{ worldId: string; mapId: string }> {
  return page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', { name: 'Isle', atlas_map_style: 'ink' });
    const zone = async (name: string, subtype: string, shape: string, pts: number[][]) => {
      const z = await store.createZone({ name, subtype, atlas_shape: shape });
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({ name: '', map_id: map.id, zone_id: z.id, x: pts[i][0], y: pts[i][1], order: i });
      }
    };
    await zone('Isle', 'Landmass', 'polygon', [[500, 500], [1500, 450], [1600, 1300], [900, 1550], [450, 1100]]);
    // away from the island's own name, which sits at its middle
    await zone('Greenwood', 'Forest', 'polygon', [[1150, 600], [1350, 600], [1350, 780], [1150, 780]]);
    await zone('Outflow', 'River', 'line', [[600, 700], [1000, 700], [1900, 700]]);
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId, mapId: map.id };
  });
}

/** The river's drawn ink and the island's, in container px (the river: the one unfilled ink path). */
const riverAndLand = (page: Page) => page.evaluate(() => {
  const paths = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path.atlas-zone-ink')] as SVGPathElement[];
  const river = paths.find(p => p.getAttribute('fill') === 'none');
  const land = paths.find(p => p.getAttribute('fill') === '#f3ead2');
  const r = river?.getBoundingClientRect(), l = land?.getBoundingClientRect();
  const c = document.querySelector('.atlas-map-pane .leaflet-container')!.getBoundingClientRect();
  // Leaflet cuts every path at its renderer's edge: until the whole island is
  // on screen, river and coast can end at the same cut and prove nothing.
  const whole = Boolean(l && l.left > c.left && l.right < c.right && l.top > c.top && l.bottom < c.bottom);
  return r && l && whole ? { riverRight: r.right, landRight: l.right, riverLeft: r.left } : null;
});

test('a river on an ink map ends at the coast it runs out over', async ({ page }) => {
  await setupWorld(page);
  await openMap(page, await seedRiverMap(page));
  // Read once the fit has settled: two reads 300 ms apart agree, no zoom animating.
  let f = await riverAndLand(page);
  for (let i = 0; i < 30; i++) {
    await page.waitForTimeout(300);
    const next = await riverAndLand(page);
    const still = await page.locator('.atlas-map-pane .leaflet-zoom-anim').count() === 0;
    if (next && still && JSON.stringify(next) === JSON.stringify(f)) break;
    f = next;
  }
  expect(f).not.toBeNull();
  // stored, the river runs 300 units past the coast (about 100 px at this view)
  expect(f!.riverRight).toBeLessThanOrEqual(f!.landRight + 1);
  expect(f!.riverLeft).toBeLessThan(f!.landRight - 100);   // and is still drawn inland
});

test('a river\'s name keeps to its land, never the stretch out at sea', async ({ page }) => {
  await setupWorld(page);
  const ids = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', { name: 'Isle', atlas_map_style: 'ink' });
    const zone = async (name: string, subtype: string, shape: string, pts: number[][]) => {
      const z = await store.createZone({ name, subtype, atlas_shape: shape });
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({ name: '', map_id: map.id, zone_id: z.id, x: pts[i][0], y: pts[i][1], order: i });
      }
    };
    await zone('Isle', 'Landmass', 'polygon', [[500, 500], [1500, 450], [1600, 1300], [900, 1550], [450, 1100]]);
    // 1050 units long, the last 40% past the coast: its middle sits on the coast
    await zone('Outflow', 'River', 'line', [[900, 700], [1300, 700], [1950, 700]]);
    api.patchData(await store.listElements());
    return { worldId: api.getState().active.worldId, mapId: map.id };
  });
  await openMap(page, ids);
  const along = page.locator('.atlas-map-pane .atlas-ink-line-label');
  await expect(along).toBeVisible();
  await expect.poll(() => along.locator('textPath').getAttribute('startOffset')).not.toBe('50%');
  // Read once the fit has settled (no zoom animating, the pane still), and one density pass after it.
  await mapPaneTransform(page);
  await expect(page.locator('.atlas-map-pane .leaflet-zoom-anim')).toHaveCount(0);
  await page.waitForTimeout(300);
  const ends = await page.evaluate(() => {
    const river = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path.atlas-zone-ink')]
      .find(p => p.getAttribute('fill') === 'none')!.getBoundingClientRect();
    return { name: document.querySelector('.atlas-map-pane .atlas-ink-line-label')!.getBoundingClientRect().right, river: river.right };
  });
  expect(ends.name).toBeLessThanOrEqual(ends.river + 2);
});

test('a name along a river moves along it, clear of an area\'s name on its middle', async ({ page }) => {
  // Room on the river for its name somewhere: at 1280 the map pane is so
  // narrow that every place along it meets Greenwood, and the name drops.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await setupWorld(page);
  await openMap(page, await seedRiverMap(page));
  const along = page.locator('.atlas-map-pane .atlas-ink-line-label');
  const forest = page.locator('.atlas-map-pane .atlas-zone-label-ink span', { hasText: 'Greenwood' });
  await expect(forest).toBeVisible();
  await expect.poll(() => along.locator('textPath').getAttribute('startOffset')).not.toBe('50%');
  const overlap = () => page.evaluate(() => {
    const a = document.querySelector('.atlas-map-pane .atlas-ink-line-label')!.getBoundingClientRect();
    const spans = [...document.querySelectorAll('.atlas-map-pane .atlas-zone-label-ink span')];
    const b = spans.find(s => s.textContent === 'Greenwood')!.getBoundingClientRect();
    return a.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  });
  await expect(along).toBeVisible();
  await expect(forest).toBeVisible();
  expect(await overlap()).toBe(false);
  // ...and it keeps to the river's land, never the stretch past the coast.
  const ends = await page.evaluate(() => {
    const river = [...document.querySelectorAll('.atlas-map-pane .leaflet-overlay-pane path.atlas-zone-ink')]
      .find(p => p.getAttribute('fill') === 'none')!.getBoundingClientRect();
    return { name: document.querySelector('.atlas-map-pane .atlas-ink-line-label')!.getBoundingClientRect().right, river: river.right };
  });
  expect(ends.name).toBeLessThanOrEqual(ends.river + 2);
  // The control: at the middle the two names would print over each other.
  await along.locator('textPath').evaluate(t => t.setAttribute('startOffset', '50%'));
  expect(await overlap()).toBe(true);
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

// gates G6, G8: a finger's drag is the stroke's (red without the touch-action),
// and a coast full of bays keeps at most 60 points (98 without the cap, S426).
// The drifting click is a behaviour check only: before G15's floor it also
// landed one point, the moving average folding three samples into one.
test('Trace keeps a coast to its budget, a drifting click to one point, and the drag to itself', async ({ page }) => {
  await setupWorld(page);
  await openMap(page, await seedMap(page, 'ink'));
  await page.click('button[data-action="draw-polygon"]');
  const overlay = page.locator('[data-zone-draft-overlay]');
  const count = async () => Number(await overlay.locator('.atlas-zone-draft-count-num').textContent());
  const touchAction = () => page.locator('.atlas-map-pane .leaflet-container').evaluate(el => getComputedStyle(el).touchAction);
  const before = await touchAction();
  await overlay.locator('[data-action="trace"]').click();
  expect(await touchAction()).toBe('none');

  const box = (await page.locator('.atlas-map-pane .leaflet-container').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2, r = Math.min(box.width, box.height) * 0.3;
  // a click that drifts four pixels, as on a trackpad
  await page.mouse.move(cx + 0.5 * r, cy - 0.5 * r);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) await page.mouse.move(cx + 0.5 * r + i, cy - 0.5 * r);
  await page.mouse.up();
  await expect.poll(count).toBe(1);

  // a coast full of bays: far more turns than 60 points can follow at 3 px
  await page.mouse.move(cx + r, cy);
  await page.mouse.down();
  for (let i = 1; i <= 1500; i++) {
    const t = (i / 1500) * Math.PI * 1.9;
    const k = r * (1 + 0.12 * Math.sin(47 * t) + 0.06 * Math.sin(131 * t));
    await page.mouse.move(cx + k * Math.cos(t), cy + k * Math.sin(t));
  }
  await page.mouse.up();
  const n = await count();
  expect(n - 1).toBeGreaterThan(20);
  expect(n - 1).toBeLessThanOrEqual(60);

  await overlay.locator('[data-action="trace"]').click();
  expect(await touchAction()).toBe(before);
});
