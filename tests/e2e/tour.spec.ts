/**
 * The guided Hyperion tour e2e (S303 rework — the act restructure). Locks the
 * centre-stage opener (step 0) and its hand-off into the dock, the real-modal
 * hands-on beats, the new order (maps BEFORE objects, institution+title merged),
 * the pin's SOFT correction (place anywhere, Next only over the swamps), the
 * staged chrome reveal, the reveal/heal contract, the residue contract, and the
 * OPFS-only (Safari-shaped) boot path.
 *
 * Step numbers (data-tour-step, 1-based): 1 opener · 2 world · 3 consul ·
 * 4 hegemony+title · 5 planet · 6 map · 7 pin · 8 swamps · 9 objects ·
 * 10 linking · 11 writing · 12 events · 13 chart (the now beat) · 14 deep time ·
 * 15 the rest · 16 yours-to-keep (files + OnlyWorlds, web cameo) · 17 finale.
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

/** Exit goes through the confirm screen (S305): it lists the rooms the tour
 *  never reached, so leaving early still leaves you with a map of the app. */
async function exitViaConfirm(page: Page) {
  await page.locator('.atlas-tour-controls button', { hasText: 'Exit tour' }).click();
  await expect(page.locator('[data-modal="tour-exit"]')).toBeVisible();
  await page.click('[data-action="tour-exit-confirm"]');
}

/** The charts act's now beat (step 13) is SINGLE ROUTE: the world ships with no
 *  clock, so the step renders no Next until the user sets one with the room's
 *  real button. Any spec that walks past this step must perform the gesture —
 *  assuming a Next exists is what hung four sibling specs when the objects run
 *  gained its gate (S302). */
async function setNowViaButton(page: Page) {
  const setNow = page.locator('[data-action="set-now"]');
  await expect(setNow).toBeVisible();
  await setNow.click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', 'b');
}

/** The writing beat (step 11) is SINGLE ROUTE (S306): the chapter is baked as
 *  plain prose and Next appears only once a chip exists in it.
 *
 *  Drives the REAL gesture: a real click to put the cursor inside the dotted
 *  word, then a REAL `keyboard.press('Tab')` through ProseMirror's own
 *  handleKeyDown. Deliberately NOT a dispatched KeyboardEvent — a synthetic
 *  event does not reproduce a library's own event routing, which is exactly
 *  the proxy that lied green about the zone-click in S304.
 *
 *  The forward gate reads the chapter's `story` from the STORE, so it waits on
 *  the workspace's ~1s save debounce; the phase assertion polls it out. */
async function linkWordViaTab(page: Page) {
  // THE SETTLE, and the reason this is not a sleep: `data-tour-step` flips
  // BEFORE the step's reveal/heal runs, and the heal writes elements, which
  // swaps `state.data.elements` and refreshes the writing workspace — taking
  // the editor's selection (and a just-made chip) with it. Clicking into prose
  // before the heal lands is a real race that reads as "Tab did nothing".
  await page.evaluate(async () => { await (window as any).__atlasTestApi.awaitTourSettled(); });
  // The step's reveal/heal must be DONE before the decorations mean anything:
  // `data-tour-step` flips before it runs (the S301 trap), and the reveal is
  // what puts the linkable elements on disk. Seven is the beat's premise
  // (TOUR_WRITING_LINKABLE), so this doubles as an assertion that every surface
  // form this world can resolve is actually offered to the user.
  await expect(page.locator('.ProseMirror .atlas-autolink-hint')).toHaveCount(7);
  const hint = page.locator('.ProseMirror .atlas-autolink-hint').first();
  await expect(hint).toBeVisible();
  // Retried as a unit: under 4 workers a single attempt is not reliable.
  // (Measured, not assumed: when it fails the chip count sits at 0 for the
  // whole timeout, and when it succeeds the chip is present immediately and
  // STAYS — sampled over 7s, with `story` carrying the ow:// link. So nothing
  // is racing the chip away after the fact; attempts either land or are lost.)
  await expect(async () => {
    await hint.click();
    // THE REAL PRECONDITION, and the one I got wrong twice before measuring.
    // `handleKeyDown` promotes the decoration CONTAINING THE CURSOR, so what
    // must be true is not "the editor has focus" but "the collapsed selection
    // sits inside a hint span". The focus-class assertion resolves from a
    // cached snapshot without a round-trip, so the key could be sent before the
    // click's selection had been applied; the handler then found no decoration
    // at the cursor, returned false, and Tab just moved focus. Every green run
    // I got before this traced back to some incidental round-trip buying the
    // time — this waits on the condition itself.
    await page.waitForFunction(() => {
      const sel = window.getSelection();
      if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
      const node = sel.anchorNode;
      if (!node) return false;
      const el = node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element);
      return Boolean(el && el.closest('.atlas-autolink-hint'));
    });
    await page.keyboard.press('Tab');
    await expect(page.locator('.ProseMirror .atlas-element-chip'))
      .toHaveCount(1, { timeout: 4_000 });
  }).toPass({ timeout: 45_000 });
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', 'b');
}

/**
 * The WALKS satisfy the writing gate by clicking the prose panel's LINK-ALL
 * corner button — a real user gesture, and the one the step's own phase-b copy
 * now recommends.
 *
 * Why not click+Tab here: that gesture depends on the click's selection being
 * applied before the key arrives, which is genuinely timing-sensitive in a long
 * walk and failed intermittently for whole runs. The precise gesture is still
 * covered — the dedicated "writing beat" test drives click+Tab and nothing
 * else. This mirrors `movePinToSwamps`, which forces the pin through the store
 * because the raw click mapping "is not what these specs assert": here the
 * subject is the WALK, not the keystroke.
 */
async function linkAllViaCorner(page: Page) {
  await page.evaluate(async () => { await (window as any).__atlasTestApi.awaitTourSettled(); });
  const corner = page.locator('.atlas-writing-linkall-corner');
  await expect(corner).toBeVisible();
  await corner.click();
  await expect(page.locator('.ProseMirror .atlas-element-chip').first()).toBeVisible();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', /b|c/);
}

/** Landing → the tour opens on the centre-stage OPENER (step 1): the sentence
 *  at vignette scale on black, the shell hidden, "Begin" the only forward. */
async function openOpener(page: Page) {
  await page.click('[data-action="start-tour"]');
  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-tour-step', '1');
  await expect(bar).toHaveClass(/is-opener/);
  await expect(page.locator('.atlas-tour-sentence')).toBeVisible();
  // The grey book cite under the opener was cut (S306) — the opener copy
  // names Hyperion and its year itself.
  await expect(page.locator('.atlas-tour-attribution')).toHaveCount(0);
  // The bare stage: no `shell` capability yet, so the shell is hidden behind
  // the sentence (the vignette on black).
  expect(await page.evaluate(() => document.body.classList.contains('atlas-tour-cap-shell'))).toBe(false);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Start$/ })).toBeVisible();
  // No docked Next at the opener; Begin is the hand-off.
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
}

/** Begin → the shell materializes on the create-world beat (step 2). */
async function beginToWorld(page: Page) {
  await page.locator('.atlas-tour-controls button', { hasText: /^Start$/ }).click();
  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toHaveAttribute('data-tour-step', '2');
  await expect(bar).not.toHaveClass(/is-opener/);
  // Shell on (create-world unlocked it), right pane still off (the maps act).
  expect(await page.evaluate(() => document.body.classList.contains('atlas-tour-cap-shell'))).toBe(true);
  expect(await page.evaluate(() => document.body.classList.contains('atlas-tour-cap-rightpane'))).toBe(false);
}

/** Step 2 → step 3 via the REAL create-world modal (locked to Hyperion). */
async function createWorldViaModal(page: Page) {
  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toHaveAttribute('data-tour-step', '2');
  // The sidebar materialized in its full final structure: create live, the
  // four siblings greyed.
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toBeVisible();
  await expect(page.locator('.atlas-worlds-header .atlas-tour-locked')).toHaveCount(4);
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  const nameInput = page.locator('[data-modal="create-world"] input[name="world-name"]');
  await expect(nameInput).toHaveValue('Hyperion');
  await expect(nameInput).toHaveAttribute('readonly', '');
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(bar).toHaveAttribute('data-tour-step', '3');
}

/** The consul beat's single route: the locked element modal (no Next until he exists). */
async function createConsulViaModal(page: Page) {
  await page.locator('[data-action="create-element"]').click();
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
}

/** Force the just-placed tour pin to the swamps zone's centroid + refresh state
 *  — the soft gate's deterministic in-zone crossing. (The pixel→storage mapping
 *  of a raw map click is not what these specs assert; the pinInZone gate is, and
 *  the geometry itself is unit-tested.) Mirrors the drag's updatePin+refresh. */
async function movePinToSwamps(page: Page) {
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const els = await store.listElements();
    const pin = els.find((e: any) => e.type === 'pin');
    const markers = els.filter((e: any) => e.type === 'marker')
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    const cx = Math.round(markers.reduce((s: number, m: any) => s + m.x, 0) / markers.length);
    const cy = Math.round(markers.reduce((s: number, m: any) => s + m.y, 0) / markers.length);
    await store.updatePin(pin.id, { x: cx, y: cy });
    api.patchSlice('data', { elements: await store.listElements() });
  });
}

/** The pin beat (step 7): the REAL +pin button on the Consul (highlighted),
 *  a map click to place, then the pin over the swamps so the soft gate opens. */
async function placePinViaMap(page: Page) {
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
  const pinBtn = page.locator('[data-action="pin-element"]');
  await expect(pinBtn).toBeVisible(); // the map+Consul route surfaced it
  await pinBtn.click();
  await page.locator('.atlas-map-tab-wrapper .leaflet-container').click({ position: { x: 220, y: 160 } });
  // Placement is async (createPin → listElements → refresh); the click resolves
  // before it lands, so wait for the pin to exist before nudging its position.
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.type === 'pin');
  })).toBe(true);
  await movePinToSwamps(page);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
}

/** The objects step's scripted run (step 9): three clicks of the app's real +,
 *  one element each, no dialog. Next appears only when all three exist. */
async function mintObjectRun(page: Page) {
  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toHaveAttribute('data-tour-phase', 'a');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
  for (const phase of ['b', 'c', 'd']) {
    await page.locator('[data-action="create-element"]').click();
    await expect(bar).toHaveAttribute('data-tour-phase', phase);
    // A silent mint: the create dialog never opens.
    await expect(page.locator('.atlas-modal-overlay')).toHaveCount(0);
  }
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
}

test('the tour world mirrors its FULL meta into state, not a hand-picked subset', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await page.evaluate(async () => { await (window as any).__atlasTestApi.awaitTourSettled(); });

  // The scaffold used to hand-build `{id, name, demo}` while having just
  // written four time_* fields to world.json, so the charts step promised a
  // gold now-line the room could not draw. Asserting mirror EQUALS disk locks
  // the class rather than one field: any future meta the scaffold writes is
  // covered without touching this test.
  const { mirror, disk } = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const disk = await api.worldMetaOnDisk();
    const mirror = api.getState().active?.meta ?? null;
    return { mirror, disk };
  });
  expect(disk).toBeTruthy();
  // The bundle's clock in particular: the beat that reads it is the charts act.
  expect((disk as any).time_basic_unit).toBe('Year');
  expect(mirror).toEqual(disk);
});

test('relaunch after exit mounts a WORKING bar (gate R3: the render memo must not outlive unmount)', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);

  // Exit at the opener, then replay from the landing. The bar unmounts and
  // remounts, and the second mount enters step 0 BEFORE the root element
  // exists — so a module-level render memo that survives unmount would match
  // its own stale signature and early-return against a dead root, leaving
  // `atlas-touring` chrome with no narrator, no Begin and no Exit, recoverable
  // only by reload. Nothing else covers relaunch-after-exit.
  await exitViaConfirm(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);

  await page.click('[data-action="start-tour"]');
  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-tour-step', '1');
  // The controls are the part a stale memo eats: assert a working ladder.
  await expect(page.locator('.atlas-tour-sentence')).toBeVisible();
  await expect(page.locator('.atlas-tour-body')).not.toBeEmpty();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Start$/ })).toBeVisible();
  await expect(page.locator('.atlas-tour-exit')).toBeVisible();

  // And it still WORKS: Begin hands off to the create-world beat as usual.
  await beginToWorld(page);
  await createWorldViaModal(page);
});

test('full walk: opener → real-modal beats → maps → objects → acts → finish tears down', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);

  // The shell materialized staged: home icon only, no right pane yet. The
  // visibility asserts below ARE the contract — the capability class is the
  // mechanism, these are the outcome.
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

  // The Consul via the REAL element modal, locked (sidebar + is the route).
  await page.locator('[data-action="create-element"]').click();
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
  // the tour, and the filter strip shows ONLY types the world holds.
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

  await nextStep(page, 4); // hegemony + title (merged)
  await expect(page.locator('.atlas-sidebar')).toContainText('The Hegemony');
  await expect(page.locator('.atlas-sidebar')).toContainText('Consul of the Hegemony');

  await nextStep(page, 5); // planet — the maps act; right pane appears
  expect(await page.evaluate(() => document.body.classList.contains('atlas-tour-cap-rightpane'))).toBe(true);
  await expect(page.locator('.atlas-right')).toBeVisible();
  await nextStep(page, 6); // the map (+ swamps zone drawn on it)
  await expect(page).toHaveURL(/\/map\//);
  await expect(page.locator('.atlas-map-tab-wrapper path').first()).toBeVisible(); // the zone polygon
  await nextStep(page, 7); // pin — the hands-on placement beat, soft correction
  await placePinViaMap(page);
  const placedPin = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.type === 'pin');
  });
  expect(placedPin?.name).toBe("The Consul's balcony seat"); // locked identity
  await nextStep(page, 8); // swamps — the living things
  await nextStep(page, 9); // objects — the scripted run (now AFTER the maps act)
  await mintObjectRun(page);
  await nextStep(page, 10); // linking payoff

  // S308 — the ABSENT half of the Web-tab pair (the PRESENT half is asserted at
  // step 16 below). `linking`'s copy deliberately withholds the Web tab's name,
  // citing "naming a tab the user cannot see yet is a promise the chrome does
  // not keep" — so the tab must genuinely not be on screen here.
  //
  // It was. `tour-bar.ts` looked up `atlas-tour-preweb` by the step id
  // 'where-it-lives', which S306c MERGED into 'yours-to-keep': findIndex
  // returned -1, `idx < -1` was false for every step, the gate never applied,
  // and the tab had been visible since step 5 for three sessions. Nothing
  // caught it because only the PRESENT half was ever asserted — a rename
  // silently disarmed the gate, and a one-sided assertion cannot see that.
  //
  // toBeHidden, not toHaveCount(0): the gate is a CSS `display: none`
  // (atlas.css:2016), so the tab stays in the DOM and only stops rendering.
  // My first draft asserted removal and failed against the WORKING fix.
  await expect(page.locator('.atlas-right [data-tab-kind="context"]')).toBeHidden();

  // Writing act: the icon appears; the chapter renders the sentence verbatim
  // as PLAIN prose (S306 — the user links it), with aliases healed in so
  // autolink can recognise every surface form.
  await nextStep(page, 11);
  await expect(page.locator('.atlas-room-nav-strip [data-room="writing"]')).toBeVisible();
  await expect(page).toHaveURL(/\/writing\//);
  const prose = page.locator('.ProseMirror');
  await expect(prose.locator('.atlas-element-chip')).toHaveCount(0);
  await expect(prose).toContainText('The Hegemony Consul sat on the balcony');
  const aliasesLate = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.name === 'The Consul')?.atlas_aliases ?? null;
  });
  expect(aliasesLate).toEqual(['Consul']);
  await linkAllViaCorner(page);

  await nextStep(page, 12); // events
  await nextStep(page, 13); // chart — the now beat, SINGLE ROUTE (no watch Next)
  await expect(page).toHaveURL(/\/timeline/);
  await expect(page.locator('.atlas-room-nav-strip [data-room="timeline"]')).toBeVisible();

  // The clock arrives unset, so the step has NO forward control until the user
  // sets it with the room's real button — the same single-route contract the
  // create beats hold. Walking past with Next is exactly what hung four sibling
  // specs when the objects run gained its gate (S302), so the walk performs the
  // gesture instead of assuming one exists.
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/atlas-tour-nowstep/);
  // The document-mode toggle is hidden while the beat is live: that view has no
  // now control at all, so switching into it would strand the gesture.
  await expect(page.locator('.atlas-chart-mode')).toBeHidden();
  await setNowViaButton(page);
  // Phase b: the clock is set, so the highlight releases and Next appears.
  await expect(page.locator('body')).not.toHaveClass(/atlas-tour-nowstep/);

  await nextStep(page, 14); // deep time — Rachmaninov in the Old Earth era
  await nextStep(page, 15); // the sweep
  // 16 is now the MERGED close (S306): the files story + the OnlyWorlds story
  // in one step, carrying the Web tab cameo the cut step used to own.
  await nextStep(page, 16); // yours-to-keep (web cameo rides here)
  await expect(page.locator('[data-tab-kind="context"]')).toHaveClass(/active/);
  await nextStep(page, 17); // finale

  // The finale's control set, asserted POSITIVELY (S301 gate, MED): the
  // shipped early-return renders Finish + the folder button and NO Exit.
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Set up a folder$/ })).toBeVisible();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Exit tour$/ })).toHaveCount(0);

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

test('the pin beat is a SOFT correction: place anywhere, Next only over the swamps (S303)', async ({ page }) => {
  // Captain's ruling: never refuse a placement. A drop outside the swamps shows
  // the correction phase with no Next; dragging the pin onto the zone opens it.
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // map (zone drawn)
  await nextStep(page, 7); // pin

  const bar = page.locator('.atlas-tour-bar');
  // Arm + place; then force the pin OUTSIDE the swamps → correction, no Next.
  await page.locator('[data-action="pin-element"]').click();
  await page.locator('.atlas-map-tab-wrapper .leaflet-container').click({ position: { x: 220, y: 160 } });
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.type === 'pin');
  })).toBe(true);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const els = await store.listElements();
    const pin = els.find((e: any) => e.type === 'pin');
    await store.updatePin(pin.id, { x: 5, y: 5 }); // far outside the swamps bbox
    api.patchSlice('data', { elements: await store.listElements() });
  });
  // The +pin highlight releases once the pin exists (the gesture is done), but
  // the gate stays closed until it is over the zone.
  await expect(bar).toHaveAttribute('data-tour-phase', 'b');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
  expect(await page.evaluate(() =>
    document.body.classList.contains('atlas-tour-pinstep'))).toBe(false);

  // Drag it onto the swamps → placed phase, Next appears.
  await movePinToSwamps(page);
  await expect(bar).toHaveAttribute('data-tour-phase', 'c');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
});

test('clicking DIRECTLY on the swamps zone places the pin there (the instructed gesture, S304)', async ({ page }) => {
  // The copy says "click the swamps below to set his balcony seat over them" —
  // so a real click ON the zone polygon must PLACE the pin, not select the zone.
  // A zone is an interactive polygon that stopPropagation's clicks; the
  // clickFallsThrough wiring (map-tab.ts) lets the click reach the map's
  // placement handler while placement is armed. The other pin specs click OFF
  // the zone and force the coords, so this is the one that exercises the
  // fall-through with a real click (the close gate flagged the gap).
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // map (the swamps zone is drawn)
  await nextStep(page, 7); // pin

  const zone = page.locator('.atlas-map-tab-wrapper path.leaflet-interactive').first();
  await expect(zone).toBeVisible();

  // BEFORE arming: clicking the zone must NOT select it and route off the
  // Consul (which would hide the +pin button). During the pin beat it falls
  // through to a no-op; the +pin button stays put.
  await zone.click();
  await page.waitForTimeout(150);
  await expect(page).toHaveURL(/\/element\/[^/]+$/); // still on the Consul, not the zone
  await expect(page.locator('[data-action="pin-element"]')).toBeVisible();
  expect(await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.filter((e: any) => e.type === 'pin').length;
  })).toBe(0); // no-op: nothing placed, nothing selected

  // Arm, then click the zone polygon itself (center = inside the swamps).
  await page.locator('[data-action="pin-element"]').click();
  await zone.click();

  // A pin was placed (not the zone selected), it sits IN the zone, and the beat
  // completes: phase c + Next, with the Consul still the selected element.
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.filter((e: any) => e.type === 'pin').length;
  })).toBe(1);
  const placed = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const els = await api.getActiveStore().listElements();
    const pin = els.find((e: any) => e.type === 'pin');
    const consul = els.find((e: any) => e.name === 'The Consul');
    return { pinName: pin?.name, selectedIsConsul: api.getState().ui.selectedElementId === consul?.id };
  });
  expect(placed.pinName).toBe("The Consul's balcony seat"); // placed, locked identity
  expect(placed.selectedIsConsul).toBe(true); // the zone was NOT selected
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', 'c');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
});

test('the scripted create door: links survive, no double-mint, no dead button', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // map
  await nextStep(page, 7); // pin
  await placePinViaMap(page);
  await nextStep(page, 8); // swamps
  await nextStep(page, 9); // objects — the scripted run

  // TWO FAST CLICKS must mint TWO elements, not the same one twice (gate R9).
  // Both compute "next un-minted" against the same snapshot unless the mint is
  // serialized with the ref resolved inside the chain — and the failure is
  // silent: the third ref never lands and Next never appears.
  // NOTE the clicks are dispatched SYNCHRONOUSLY in the page: two awaited
  // Playwright clicks are sequential enough that the first mint has already
  // refreshed state, so they do not reproduce the race at all.
  const plus = page.locator('[data-action="create-element"]');
  await plus.waitFor();
  await page.evaluate(() => {
    const btn = document.querySelector<HTMLElement>('[data-action="create-element"]')!;
    btn.click();
    btn.click();
  });
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', 'c');
  const afterTwo = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const objects = els.filter((e: any) => e.type === 'object');
    const balcony = objects.find((e: any) => e.name === 'Spaceship Balcony');
    const ship = objects.find((e: any) => e.name === 'Ebony Spaceship');
    const consul = els.find((e: any) => e.name === 'The Consul');
    return {
      names: objects.map((e: any) => e.name).sort(),
      balconyParent: balcony?.parent_object ?? null,
      shipId: ship?.id ?? null,
      consulObjects: consul?.objects ?? [],
    };
  });
  expect(afterTwo.names).toEqual(['Ebony Spaceship', 'Spaceship Balcony']);

  // Gate R1, the headline: the balcony was minted while the ship was NOT in
  // the step-keyed revealed set, so the old strip rule deleted its
  // parent_object — and the step's own copy teaches exactly that field.
  expect(afterTwo.balconyParent).toBe(afterTwo.shipId);
  // And the heal ran in the same beat: the Consul owns the ship now.
  expect(afterTwo.consulObjects).toContain(afterTwo.shipId);

  // The step's copy points at the sidebar +, so it has to be findable.
  expect(await page.evaluate(() =>
    document.body.classList.contains('atlas-tour-createstep'))).toBe(true);

  // Third click completes the run and Next appears.
  await plus.click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', 'd');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
  // ...and the highlight releases once there is nothing left to add.
  expect(await page.evaluate(() =>
    document.body.classList.contains('atlas-tour-createstep'))).toBe(false);

  // A COMPLETED run must fall through to the ordinary create modal (gate R8).
  await plus.click();
  await expect(page.locator('.atlas-modal-overlay')).toHaveCount(1);
  await expect(page.locator('.atlas-modal-overlay input[name="element-name"]'))
    .not.toHaveAttribute('readonly', '');
});

test('a world switch mid-tour SUSPENDS the narrator (close gate, 3-lens convergent)', async ({ page }) => {
  // The suspension contract existed in tour-view.ts from the start (hold the
  // opening phase, force canAdvance false) and was UNREACHABLE: the bar's
  // state subscription bailed on `!tourWorldIsActive()`, which is the very
  // transition that has to paint it.
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4);
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '4');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();

  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const active = api.getState().active;
    api.patchSlice('active', { ...active, worldId: 'some-other-world-id' });
  });

  // Suspended: the opening phase, no forward control, and no tour highlight
  // left burning on a control that now belongs to someone else's world.
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-phase', 'a');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);
  expect(await page.evaluate(() =>
    document.body.classList.contains('atlas-tour-createstep'))).toBe(false);
  expect(await page.evaluate(() =>
    document.body.classList.contains('atlas-tour-pinstep'))).toBe(false);
});

test('the create beats are single-route: no watch-mode Next, the gesture is the way', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '2');
  // S301: the dock carries NO create button at all now — the app's own
  // control is the only route, and it pulses.
  await expect(page.locator('[data-tour-action]')).toHaveCount(0);
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"].atlas-create-pulse')).toBeVisible();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);

  // Through the locked modal → auto-advance to the consul beat: same rule.
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  await page.locator('[data-modal="create-world"] [data-action="pick"]').click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  await expect(page.locator('[data-tour-action]')).toHaveCount(0);
  await expect(page.locator('[data-action="create-element"]')).toBeVisible();
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);

  // Create him → the step STAYS (the payoff is his page) and Next appears.
  await page.locator('[data-action="create-element"]').click();
  await page.locator('.atlas-modal-overlay button', { hasText: /^Create$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.name === 'The Consul');
  })).toBe(true);
});

test('resilience: the world heals user mess on step-enter, user work survives', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  // Walk PAST the objects (they now follow the maps act) so the ship exists to
  // be re-linked, and the map tab is cached for the re-entry test.
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // map (zone + markers live)
  await nextStep(page, 7); // pin
  await placePinViaMap(page);
  await nextStep(page, 8); // swamps
  await nextStep(page, 9); // objects
  await mintObjectRun(page);
  await nextStep(page, 10); // linking
  await expect.poll(async () => page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.some((e: any) => e.name === 'Ebony Spaceship');
  })).toBe(true);

  // Mess with everything (the Freek scenario: users CAN break the sandbox):
  // delete the Hegemony, wreck the Consul's objects field but ADD a manual
  // link of our own, delete the pin, delete the zone (map tab cached), and
  // strip the map's image.
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
    await store.updateElement(consul.id, { objects: [planet.id] });
    await store.updateElement(map.id, { image_media_id: null });
    return { consul: consul.id, heg: heg.id, zone: zone.id, planet: planet.id, ship: ship.id, map: map.id, pin: pin.id };
  });

  // Back onto the swamps (map-routed) — heals run on step-enter, and the CACHED
  // map tab re-entry must re-sync zones (not just pins). Two Backs from linking.
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '9');
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '8');

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

  // The healed truth reaches the SURFACES: sidebar row, and the zone polygon on
  // the re-entered (cached) map tab.
  await expect(page.locator('.atlas-sidebar')).toContainText('The Hegemony');
  await expect(page.locator('.atlas-map-tab-wrapper path').first()).toBeVisible();
});

test('armed pin placement disarms on navigation — no stray second pin (S299 close gate)', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // map
  await nextStep(page, 7); // the-pin (single-route: no Next until placed in-zone)

  // Arm placement via the real +pin button, then NAVIGATE AWAY without
  // placing (Back exists here; the unplaced pin step has no Next). A leftover
  // arm on the map-routed step 6 would let a later map click mint a stray pin.
  await page.locator('[data-action="pin-element"]').click();
  await expect.poll(() => page.evaluate(() =>
    Boolean((window as any).__atlasTestApi.getState().ui.pinPlacement))).toBe(true);
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '6');

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
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4);

  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.atlas-tour-bar')).toBeVisible();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '4');
  await expect(page.locator('.atlas-sidebar')).toContainText('The Hegemony');
});

test('exit tears down mid-tour and returns to the landing', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await exitViaConfirm(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expect(page.locator('.atlas-landing-actions')).toBeVisible();
  const state = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { worlds: s.registry.worlds.length, active: !!s.active };
  });
  expect(state).toEqual({ worlds: 0, active: false });
});

test('back-navigation does not strip links off elements that still exist (S301 gate R2)', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  // Walk to linking (objects now follow the maps act).
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // map
  await nextStep(page, 7); // pin
  await placePinViaMap(page);
  await nextStep(page, 8); // swamps
  await nextStep(page, 9); // objects
  await mintObjectRun(page);
  await nextStep(page, 10); // linking

  // Sync on the tour's own settle signal, NOT on data-tour-step: the panel
  // re-renders with the new step number BEFORE revealUpTo heals.
  const possessionsAt = async () => page.evaluate(async () => {
    await (window as any).__atlasTestApi.awaitTourSettled();
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    const consul = els.find((e: any) => e.name === 'The Consul');
    return (consul?.objects ?? []).length;
  });

  const atPayoff = await possessionsAt();
  expect(atPayoff).toBeGreaterThan(0); // the linking step's whole point

  // Back across the boundary that used to retract them, twice.
  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '9');
  expect(await possessionsAt()).toBe(atPayoff);

  await page.locator('.atlas-tour-controls button', { hasText: /^Back$/ }).click();
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '8');
  expect(await possessionsAt()).toBe(atPayoff);

  // And forward again: no oscillation, no rewrite.
  await nextStep(page, 9);
  await nextStep(page, 10);
  expect(await possessionsAt()).toBe(atPayoff);
});

test('the residue contract covers the map UI keys, not just the world (S301)', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  await nextStep(page, 4); // hegemony
  await nextStep(page, 5); // planet
  await nextStep(page, 6); // the map opens (right-pane tab stamped with the tour world)
  await expect(page).toHaveURL(/\/map\//);

  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  const before = await page.evaluate((wid) => {
    const tabs = JSON.parse(localStorage.getItem('atlas_right_tabs') ?? '{"tabs":[]}');
    return {
      mapTabs: tabs.tabs.filter((t: any) => t.kind === 'map' && t.worldId === wid).length,
      cameras: Object.keys(JSON.parse(localStorage.getItem('atlas_map_camera_state') ?? '{}')).length,
    };
  }, worldId);
  expect(before.mapTabs).toBe(1);

  await exitViaConfirm(page);
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
  expect(after.activeIndexInRange).toBe(true);
  expect(after.worlds).toBe(0);

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
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  for (let step = 4; step <= 17; step++) {
    await nextStep(page, step);
    if (step === 7) await placePinViaMap(page);
    if (step === 9) await mintObjectRun(page);
    if (step === 11) await linkAllViaCorner(page);
    if (step === 13) await setNowViaButton(page);
  }
  // The label is 'Set up a folder' (tour-bar.ts); on an OPFS-only browser no
  // folder button renders and Finish is primary.
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Set up a folder$/ })).toHaveCount(0);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Finish$/ })).toBeVisible();
});

test('the exit confirm names the rooms the tour never reached, and can be declined', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);

  // Leaving early opens the door rather than dropping the user through it.
  await page.locator('.atlas-tour-controls button', { hasText: 'Exit tour' }).click();
  const modal = page.locator('[data-modal="tour-exit"]');
  await expect(modal).toBeVisible();

  // The offer: rooms this tour has not opened at step 3. Charts and Writing are
  // still ahead, so they belong in the unseen list too — the screen must not
  // credit a room the user has not actually been routed to.
  await expect(modal).toContainText('Knowledge');
  await expect(modal).toContainText('Pages');
  await expect(modal).toContainText('Data');
  await expect(modal).toContainText('Charts');

  // Declining keeps the tour exactly where it was, world intact.
  await page.click('[data-action="tour-exit-cancel"]');
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.atlas-tour-bar')).toHaveAttribute('data-tour-step', '3');
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length)).toBe(1);

  // Confirming tears down as before: the residue contract is unchanged by the
  // new door standing in front of it.
  await exitViaConfirm(page);
  await expect(page.locator('.atlas-tour-bar')).toHaveCount(0);
  await expect(page.locator('.atlas-landing-actions')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length)).toBe(0);
});

test('the writing beat: the sentence arrives plain, Tab links it, Next waits for a chip', async ({ page }) => {
  await freshBoot(page);
  await openOpener(page);
  await beginToWorld(page);
  await createWorldViaModal(page);
  await createConsulViaModal(page);
  for (let step = 4; step <= 11; step++) {
    await nextStep(page, step);
    if (step === 7) await placePinViaMap(page);
    if (step === 9) await mintObjectRun(page);
  }

  const bar = page.locator('.atlas-tour-bar');
  const prose = page.locator('.ProseMirror');

  // Phase a: plain prose, SINGLE ROUTE — no Next until a chip exists.
  await expect(bar).toHaveAttribute('data-tour-phase', 'a');
  await expect(prose.locator('.atlas-element-chip')).toHaveCount(0);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toHaveCount(0);

  // The suggestions the beat depends on: autolink resolves the sentence's
  // baked surface forms, so there is something to press Tab on at all.
  await expect(prose.locator('.atlas-autolink-hint').first()).toBeVisible();

  // The real gesture.
  await linkWordViaTab(page);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Next$/ })).toBeVisible();

  // The chip is a real link, not styled text: it carries the element's id
  // (`data-id` — the ElementChip node's own attribute, not a guessed name).
  const chipId = await prose.locator('.atlas-element-chip').first()
    .getAttribute('data-id');
  expect(chipId, 'the chip points at a real element').toBeTruthy();
  const known = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.map((e: any) => e.id);
  });
  expect(known, 'the chip id resolves to a real element in the world').toContain(chipId);

  // ...and it reached the STORE (the gate reads `story`, not the editor DOM).
  const storyAfter = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.name === 'Chapter 1')?.story ?? '';
  });
  expect(storyAfter).toContain('ow://');
});

/**
 * REPLAY FROM SETTINGS, with the user's own world open and a folder set up.
 *
 * This is the precondition pair that NO tour spec has ever established: every
 * other test in this file begins at `freshBoot` (registry empty, no root, no
 * active world) and launches from the landing button. The settings replay row
 * was shipped with zero e2e coverage, and the path it takes is the one a real
 * user takes — finishing the tour is what sets an atlas root in the first
 * place.
 *
 * Before S307 this walk failed three ways at once: the route stayed on the
 * user's settings page (so step 2 painted the dock over it), the sidebar
 * listed the user's real worlds, and — the blocker — the tour's scripted
 * create button did not exist at all, because `worlds-sidebar` tested
 * `if (root)` before the tour branch. No Next, no create: hard stuck.
 */
test('replay from settings with a world open clears the stage and can be completed', async ({ page }) => {
  // --- the preconditions: a real atlas root, a real world, both live. ---
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('replay-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'my own world');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();

  const ownWorldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  expect(ownWorldId, 'the user has their own world open').toBeTruthy();

  // The PRESENT half of the pair below. Without this the absence assertion
  // could pass because the selector matches nothing — which is exactly how
  // the first draft of this test passed with the filter reverted.
  // (Creating a world flips the sidebar into elements mode — S255v3 — and
  // sidebar mode is its own state, not a function of the URL, so this needs
  // the real toggle rather than a hash change.)
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await expect(page.locator(`.atlas-list [data-world-id="${ownWorldId}"]`).first()).toBeVisible();

  // --- launch the replay from the settings nav chip. ---
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/onlyworlds`; }, ownWorldId);
  const chip = page.locator('[data-action="replay-tour"]');
  await expect(chip, 'the replay chip lives in the settings nav, on every tab').toBeVisible();
  await chip.click();

  const bar = page.locator('.atlas-tour-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toHaveAttribute('data-tour-step', '1');

  // LEAK 1: the launching route. Nothing in the start path used to navigate.
  await expect
    .poll(() => page.evaluate(() => window.location.hash), { message: 'the tour left the settings route' })
    .not.toContain('settings');

  // LEAK 2: the user's world stayed open, and stayed syncing, under the dock.
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().active))
    .toBeNull();

  await beginToWorld(page);

  // LEAK 3: the sidebar listed the user's real worlds while the tour narrated
  // "your world". The ABSENT half of the pair asserted above — same selector,
  // so a markup rename breaks one half loudly instead of quietly disarming
  // the other.
  await expect(page.locator(`.atlas-list [data-world-id="${ownWorldId}"]`)).toHaveCount(0);

  // THE BLOCKER: the scripted create door must exist even though a root is
  // set. `createWorldViaModal` asserts the locked-to-Hyperion modal and the
  // four greyed siblings — i.e. the TOUR's sidebar, not the root sidebar.
  await createWorldViaModal(page);
  await expect(bar).toHaveAttribute('data-tour-step', '3');

  // Reaching step 3 IS the proof the blocker is gone: the create-world gate
  // reads `tourWorldExists()`, so the walk cannot leave step 2 unless the
  // scripted door actually minted the tour world. (Step 3 is the consul beat
  // and correctly shows NO Next — it is hands-on. Asserting a Next here would
  // be legislating a contract the design does not have.)
  const tourWorld = await page.evaluate(() => {
    const st = (window as any).__atlasTestApi.getState();
    const active = st.active;
    return active ? st.registry.worlds.find((w: any) => w.id === active.worldId) ?? null : null;
  });
  expect(tourWorld, 'the tour is running on its own demo world, not the user\'s').toMatchObject({ demo: true });

  // The user's own world survived the tour's stage-clearing: it is still in
  // the registry, just not active. Clearing the stage must not delete data.
  const stillRegistered = await page.evaluate((id) =>
    (window as any).__atlasTestApi.getState().registry.worlds.some((w: any) => w.id === id), ownWorldId);
  expect(stillRegistered, 'clearing the stage closes the world, never deletes it').toBe(true);
});
