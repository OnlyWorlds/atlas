/**
 * The guided Hyperion tour e2e (S297 v2 — progressive build-up). Locks the
 * bare-stage opener, the real-modal hands-on beats (do-mode AND watch-mode),
 * the staged chrome reveal, the reveal/heal contract (aliases deferred to the
 * writing act), the residue contract (exit/finish tear everything down), and
 * the OPFS-only (Safari-shaped) boot path.
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

/** Click the tour bar's Next and wait for the step attribute to advance
 *  (the visible act label was cut in S298 — data-tour-step is the contract). */
async function nextStep(page: Page, expectStep: number) {
  await page.locator('.atlas-tour-controls button', { hasText: /^Next$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', String(expectStep));
}

/** Landing → the tour opens DIRECTLY on the create-world beat (S298: the
 *  intro step was cut; step 1 = the-world at stage 1, worlds sidebar live). */
async function openStage0(page: Page) {
  await page.click('[data-action="start-tour"]');
  await expect(page.locator('.atlas-tour-bar')).toBeVisible();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '1');
  await expect(page.locator('.atlas-tour-attribution')).toContainText('Dan Simmons (1989)');
  expect(await page.evaluate(() => document.body.dataset.tourStage)).toBe('1');
}

/** The consul beat's single route: the locked element modal (no Next until he exists). */
async function createConsulViaModal(page: Page) {
  await page.locator('[data-tour-action="create-consul"]').click();
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
}

/** The pin beat (step 9) is single-route via the REAL +pin button on the
 *  Consul (highlighted by the tour), then a map click. No dock button; Next
 *  appears once the pin exists (the gate). */
async function placePinViaMap(page: Page) {
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
  const pinBtn = page.locator('[data-action="pin-element"]');
  await expect(pinBtn).toBeVisible(); // the map+Consul route surfaced it
  await pinBtn.click();
  await page.locator('.atlas-map-tab-wrapper .leaflet-container').click({ position: { x: 220, y: 160 } });
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
}

/** Stage 0 → step 2 via the REAL create-world modal (locked to Hyperion). */
async function createWorldViaModal(page: Page) {
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '1');
  // The sidebar materialized in its full final structure: create live, the
  // four siblings greyed.
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toBeVisible();
  await expect(page.locator('.atlas-worlds-header .atlas-tour-locked')).toHaveCount(4);
  await page.locator('[data-tour-action="create-world"]').click();
  const nameInput = page.locator('[data-modal="create-world"] input[name="world-name"]');
  await expect(nameInput).toHaveValue('Hyperion');
  await expect(nameInput).toHaveAttribute('readonly', '');
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '2');
}

test('full walk: bare stage → real-modal beats → acts → finish tears down', async ({ page }) => {
  await freshBoot(page);
  await openStage0(page);
  await createWorldViaModal(page);

  // The shell materialized staged: home icon only, no right pane yet.
  expect(await page.evaluate(() => document.body.dataset.tourStage)).toBe('2');
  await expect(page.locator('.atlas-room-nav-strip [data-room="home"]')).toBeVisible();
  await expect(page.locator('.atlas-room-nav-strip [data-room="writing"]')).toBeHidden();
  await expect(page.locator('.atlas-right')).toBeHidden();

  // EVERY create door is scripted during the consul beat: the elements
  // sidebar's + opens the same locked modal (Captain's catch — the free
  // modal mid-script broke the railroad).
  await page.locator('[data-action="create-element"]').click();
  const sidebarCreate = page.locator('.atlas-modal-overlay input[name="element-name"]');
  await expect(sidebarCreate).toHaveValue('The Consul');
  await expect(sidebarCreate).toHaveAttribute('readonly', '');
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-modal-overlay')).toHaveCount(0);

  // The Consul via the REAL element modal, locked.
  await page.locator('[data-tour-action="create-consul"]').click();
  const consulName = page.locator('.atlas-modal-overlay input[name="element-name"]');
  await expect(consulName).toHaveValue('The Consul');
  await expect(consulName).toHaveAttribute('readonly', '');
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await expect(page.locator('.atlas-element-name').first()).toContainText('The Consul');
  // During the tour, all-empty schema sections HIDE (S299, the Freek round):
  // every rendered section carrying field rows has at least one populated one.
  const emptySectionLeak = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const consul = els.find((e: any) => e.name === 'The Consul');
    const populated = (v: any) => v !== null && v !== undefined
      && !(typeof v === 'string' && v.trim() === '') && !(Array.isArray(v) && v.length === 0);
    return [...document.querySelectorAll('.atlas-detail-section')]
      .filter(s => s.querySelectorAll('[data-field]').length > 0)
      .some(s => ![...s.querySelectorAll('[data-field]')]
        .some(r => populated(consul[r.getAttribute('data-field') as string])));
  });
  expect(emptySectionLeak).toBe(false);
  // Aliases are DEFERRED — a beginner's first element page stays clean.
  const aliasesEarly = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.name === 'The Consul')?.atlas_aliases ?? null;
  });
  expect(aliasesEarly).toBeNull();
  // Precision staging (S300, Captain-blessed): no Custom-fields section during
  // the tour, and the filter strip shows ONLY types the world holds (every
  // rendered button carries a count badge; far fewer than the full 20).
  await expect(page.locator('.atlas-custom-fields-section')).toHaveCount(0);
  const stripState = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.atlas-filter-btn')];
    return {
      total: btns.length,
      badged: btns.filter(b => b.querySelector('.atlas-filter-count')).length,
    };
  });
  expect(stripState.total).toBeGreaterThan(0);
  expect(stripState.total).toBeLessThan(10);
  expect(stripState.badged).toBe(stripState.total);

  await nextStep(page, 3); // hegemony
  await expect(page.locator('.atlas-sidebar')).toContainText('The Hegemony');
  await nextStep(page, 4); // title
  await nextStep(page, 5); // objects
  await nextStep(page, 6); // linking payoff
  await nextStep(page, 7); // planet (act 2 — right pane appears)
  expect(await page.evaluate(() => document.body.dataset.tourStage)).toBe('3');
  await expect(page.locator('.atlas-right')).toBeVisible();
  await nextStep(page, 8); // the map
  await expect(page).toHaveURL(/\/map\//);
  await nextStep(page, 9); // pin — the hands-on placement beat
  await placePinViaMap(page);
  const placedPin = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.type === 'pin');
  });
  expect(placedPin?.name).toBe("The Consul's balcony seat"); // locked identity
  await nextStep(page, 10); // swamps

  // Writing act: the icon appears; the chapter renders the sentence verbatim
  // with chips (the markdown-fallback path), and aliases healed in.
  await nextStep(page, 11);
  await expect(page.locator('.atlas-room-nav-strip [data-room="writing"]')).toBeVisible();
  await expect(page).toHaveURL(/\/writing\//);
  const prose = page.locator('.ProseMirror');
  await expect(prose.locator('.atlas-element-chip')).toHaveCount(9);
  await expect(prose).toContainText('The Hegemony Consul sat on the balcony');
  const aliasesLate = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.name === 'The Consul')?.atlas_aliases ?? null;
  });
  expect(aliasesLate).toEqual(['Consul', 'the Consul']);

  await nextStep(page, 12); // events
  await nextStep(page, 13); // chart
  await expect(page).toHaveURL(/\/timeline/);
  await expect(page.locator('.atlas-room-nav-strip [data-room="timeline"]')).toBeVisible();

  await nextStep(page, 14); // the sweep
  await nextStep(page, 15); // web cameo
  await expect(page.locator('[data-tab-kind="context"]')).toHaveClass(/active/);
  await nextStep(page, 16); // online
  // (The ecosystem-explorer link was cut in S298 — nothing to assert here.)
  await nextStep(page, 17); // finale

  // Finish: the residue contract — world gone, landing back, emphasis swapped.
  await page.locator('.atlas-tour-controls button', { hasText: /^Finish$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expect(page.locator('.atlas-landing-actions')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { worlds: s.registry.worlds.length, active: !!s.active, done: localStorage.getItem('atlas_tour_done_v1') };
  });
  expect(after).toEqual({ worlds: 0, active: false, done: '1' });
  // S301: the doors lost their headings — the button IS the label now.
  await expect(page.locator('[data-action="start-tour"]')).toContainText('replay the tour');
});

test('the create beats are single-route: no watch-mode Next, the gesture is the way', async ({ page }) => {
  // Captain's call (2026-07-19): two forward buttons at the first hands-on
  // beats read as a fork. The locked modals are one-click, so the gesture is
  // the only route; the consul step gains plain Next only AFTER he exists.
  await freshBoot(page);
  await openStage0(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '1');
  await expect(page.locator('[data-tour-action="create-world"]')).toBeVisible();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);

  // Through the locked modal → auto-advance to the consul beat: same rule.
  await page.locator('[data-tour-action="create-world"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '2');
  await expect(page.locator('[data-tour-action="create-consul"]')).toBeVisible();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);

  // Create him → the step STAYS (the payoff is his page) and Next appears.
  await page.locator('[data-tour-action="create-consul"]').click();
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '2');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.name === 'The Consul');
  })).toBe(true);
});

test('resilience: the world heals user mess on step-enter, user work survives', async ({ page }) => {
  await freshBoot(page);
  await openStage0(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  for (let step = 3; step <= 10; step++) {
    await nextStep(page, step); // walk to the swamps (map + pin + zone live)
    if (step === 9) await placePinViaMap(page);
  }
  // The step attribute flips before the reveal's writes land — wait for the
  // swamps step's freshest element before messing with the world.
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.name === 'The Swamps');
  })).toBe(true);

  // Mess with everything (the Freek scenario: users CAN break the sandbox):
  // delete the Hegemony, wreck the Consul's objects field but ADD a manual
  // link of our own, delete the pin, delete the zone (while the map tab is
  // live), and strip the map's image.
  const ids = await page.evaluate(async () => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const els = await store.listElements();
    const by = (n: string) => els.find((e: any) => e.name === n);
    const consul = by('The Consul');
    const heg = by('The Hegemony');
    const zone = by('The Swamps');
    const planet = by('Planet Hyperion');
    const ship = by('Ebony Spaceship');
    const map = els.find((e: any) => e.type === 'map' && e.name === 'Hyperion');
    const pin = els.find((e: any) => e.type === 'pin');
    await store.deleteElement(heg.id);
    await store.deleteElement(pin.id);
    await store.deleteElement(zone.id);
    // The bundle authors consul.objects (the ship rides there, S298); replace
    // it wholesale with a USER link the bundle does not author.
    await store.updateElement(consul.id, { objects: [planet.id] });
    await store.updateElement(map.id, { image_media_id: null });
    return { consul: consul.id, heg: heg.id, zone: zone.id, planet: planet.id, ship: ship.id, map: map.id, pin: pin.id };
  });

  // Next (heal runs on step-enter) then Back onto the map (the CACHED tab
  // re-entry path — zones must re-sync there too, not just pins).
  await nextStep(page, 11);
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '10');

  await expect.poll(async () => page.evaluate(async (ids: any) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const els = await store.listElements();
    const get = (id: string) => els.find((e: any) => e.id === id);
    const consul = get(ids.consul);
    return {
      hegemonyBack: Boolean(get(ids.heg)),
      pinBack: Boolean(get(ids.pin)),
      zoneBack: Boolean(get(ids.zone)),
      shipRelinked: Boolean(consul?.objects?.includes(ids.ship)),
      userLinkSurvives: Boolean(consul?.objects?.includes(ids.planet)),
      mapImageBack: Boolean(get(ids.map)?.image_media_id),
    };
  }, ids)).toEqual({
    hegemonyBack: true,
    pinBack: true,
    zoneBack: true,
    shipRelinked: true,
    userLinkSurvives: true,
    mapImageBack: true,
  });

  // The healed truth reaches the SURFACES in the same step-enter: sidebar
  // row, and the zone polygon on the re-entered (cached) map tab.
  await expect(page.locator('.atlas-sidebar')).toContainText('The Hegemony');
  await expect(page.locator('.atlas-map-tab-wrapper path').first()).toBeVisible();
});

test('armed pin placement disarms on navigation — no stray second pin (S299 close gate)', async ({ page }) => {
  await freshBoot(page);
  await openStage0(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  for (let s = 3; s <= 8; s++) await nextStep(page, s);
  await nextStep(page, 9); // the-pin (single-route: no Next until placed)

  // Arm placement via the real +pin button, then NAVIGATE AWAY without
  // placing (Back exists here; the unplaced pin step has no Next). A leftover
  // arm on the map-routed step 8 would let a later map click mint a stray pin.
  await page.locator('[data-action="pin-element"]').click();
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__atlasTestApi.getState().ui.pinPlacement))).toBe(true);
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '8');

  // The navigation disarmed it; a map click now creates NOTHING.
  expect(await page.evaluate(() =>
    (window as any).__atlasTestApi.getState().ui.pinPlacement)).toBeNull();
  await page.locator('.atlas-map-tab-wrapper .leaflet-container').click({ position: { x: 300, y: 240 } });
  await page.waitForTimeout(300);
  const pinCount = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.filter((e: any) => e.type === 'pin').length;
  });
  expect(pinCount).toBe(0); // no pin placed yet, and no stray from the dead arm
});

test('resume after reload lands on the same step with the world active', async ({ page }) => {
  await freshBoot(page);
  await openStage0(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 3);

  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.atlas-tour-bar')).toBeVisible();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  await expect(page.locator('.atlas-sidebar')).toContainText('The Hegemony');
});

test('exit tears down mid-tour and returns to the landing', async ({ page }) => {
  await freshBoot(page);
  await openStage0(page);
  await createWorldViaModal(page);
  await page.locator('.atlas-tour-controls button', { hasText: 'Exit tour' }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expect(page.locator('.atlas-landing-actions')).toBeVisible();
  const state = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { worlds: s.registry.worlds.length, active: !!s.active };
  });
  expect(state).toEqual({ worlds: 0, active: false });
});

test('the residue contract covers the map UI keys, not just the world (S301)', async ({ page }) => {
  // The contract promised "nothing behind" and tore down registry + handle +
  // OPFS — but `atlas_right_tabs` kept a map tab stamped with the tour
  // world's id and `atlas_map_camera_state` kept its camera. Cost: the FIRST
  // world a tour-finisher creates opened with a ghost "Hyperion" tab reading
  // "This map isn't in the current world". Walk far enough to open the map,
  // then exit and prove both keys forgot it.
  await freshBoot(page);
  await openStage0(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  for (let step = 3; step <= 8; step++) await nextStep(page, step);
  await expect(page).toHaveURL(/\/map\//);

  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  // Precondition: the tab and camera really are there to be cleaned (without
  // this the test could pass by never having created them at all).
  const before = await page.evaluate((wid) => {
    const tabs = JSON.parse(localStorage.getItem('atlas_right_tabs') ?? '{"tabs":[]}');
    return {
      mapTabs: tabs.tabs.filter((t: any) => t.kind === 'map' && t.worldId === wid).length,
      cameras: Object.keys(JSON.parse(localStorage.getItem('atlas_map_camera_state') ?? '{}')).length,
    };
  }, worldId);
  expect(before.mapTabs).toBe(1);

  await page.locator('.atlas-tour-controls button', { hasText: 'Exit tour' }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);

  const after = await page.evaluate((wid) => {
    const raw = localStorage.getItem('atlas_right_tabs');
    const tabs = raw ? JSON.parse(raw) : { tabs: [], activeIndex: 0 };
    return {
      tourMapTabs: tabs.tabs.filter((t: any) => t.kind === 'map' && t.worldId === wid).length,
      cameras: Object.keys(JSON.parse(localStorage.getItem('atlas_map_camera_state') ?? '{}')).length,
      activeIndexInRange: tabs.activeIndex >= 0 && tabs.activeIndex < Math.max(tabs.tabs.length, 1),
      worlds: (window as any).__atlasTestApi.getState().registry.worlds.length,
    };
  }, worldId);
  expect(after.tourMapTabs).toBe(0);
  expect(after.cameras).toBe(0);
  expect(after.activeIndexInRange).toBe(true); // no dangling index after the prune
  expect(after.worlds).toBe(0);

  // And the live pane the user is looking at carries no ghost tab either.
  await expect(page.locator('.atlas-right-tab', { hasText: 'Hyperion' })).toHaveCount(0);
});

test('OPFS-only browser (Safari-shaped): app boots, tour runs, folder door honest', async ({ page }) => {
  await page.addInitScript(() => {
    // Simulate Safari: no File System Access picker, OPFS intact.
    delete (window as any).showDirectoryPicker;
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  // Landing: tour leads; the folder door is an honest line, not a button.
  await expect(page.locator('[data-action="start-tour"]')).toBeVisible();
  await expect(page.locator('[data-action="setup-atlas"]')).toHaveCount(0);
  await expect(page.locator('.atlas-landing-note')).toContainText('needs a Chromium browser');
  // The tour boots and walks.
  await openStage0(page);
  await createWorldViaModal(page);
  // Finale: no folder button on an OPFS-only browser; Finish is primary.
  await createConsulViaModal(page);
  for (let step = 3; step <= 17; step++) {
    await nextStep(page, step);
    if (step === 9) await placePinViaMap(page);
  }
  await expect(page.locator('.atlas-tour-controls button', { hasText: 'Set up your folder' })).toHaveCount(0);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Finish$/ })).toBeVisible();
});
