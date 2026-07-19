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
  // Aliases are DEFERRED — a beginner's first element page stays clean.
  const aliasesEarly = await page.evaluate(async () => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.name === 'The Consul')?.atlas_aliases ?? null;
  });
  expect(aliasesEarly).toBeNull();

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
  await nextStep(page, 9); // pin
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
  await expect(page.locator('.atlas-landing-doors')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { worlds: s.registry.worlds.length, active: !!s.active, done: localStorage.getItem('atlas_tour_done_v1') };
  });
  expect(after).toEqual({ worlds: 0, active: false, done: '1' });
  await expect(page.locator('.atlas-landing-doors h3').first()).toContainText('Replay the tour');
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
  await expect(page.locator('.atlas-landing-doors')).toBeVisible();
  const state = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { worlds: s.registry.worlds.length, active: !!s.active };
  });
  expect(state).toEqual({ worlds: 0, active: false });
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
  await expect(page.locator('.atlas-landing-doors')).toContainText('needs a Chromium browser');
  // The tour boots and walks.
  await openStage0(page);
  await createWorldViaModal(page);
  // Finale: no folder button on an OPFS-only browser; Finish is primary.
  await createConsulViaModal(page);
  for (let step = 3; step <= 17; step++) {
    await nextStep(page, step);
  }
  await expect(page.locator('.atlas-tour-controls button', { hasText: 'Set up your folder' })).toHaveCount(0);
  await expect(page.locator('.atlas-tour-controls button', { hasText: /^Finish$/ })).toBeVisible();
});
