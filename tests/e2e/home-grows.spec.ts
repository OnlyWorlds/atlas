/**
 * The home that grows e2e: Home's own grid, on its Picture tab. The first
 * steps' card that once carried it is retired (1.115.0: a new world opens
 * on Strand), so every act here is the grid's on Home: a placing by two
 * presses, read from the squares' places and the "just now" sentence, Undo
 * restoring what it wrote; the same placing by a mouse drag (Chromium and
 * Firefox) and by the keyboard; a view-only world offers no + and lights no
 * target.
 *
 * Release (b): every pair the table offers is a target. A line pair (Mira
 * onto The Founding) by a drag, and by two presses (the first writes
 * nothing and says the promise), its Undo; two Characters cannot be linked;
 * a contributor's own Mira and the owner's Event; a browse by presses writes
 * nothing. The plain + with its list by keys. Nothing above the squares
 * moves with an act, at 390 and 1440. The "just now" line names the latest
 * act. Undo's height. Tab through the targets in grid order. No + on the demo.
 *
 * Contract: a design note of 2026-10-30, the home that grows, draft 3 (§7 the
 * acts, §9's e2e line), and its addendum for release (b).
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

/** A new browser world, on its Home. */
async function setupWorld(page: Page, name = 'Growworld') {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('home-grows-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  const dialog = page.locator('[data-modal="create-world"]');
  // A browser world, always: the copy step's keep ways are a browser world's. Counted before the
  // dialog drew its choice, the check was skipped and a folder world made (1 run in 5). Firefox
  // has no folder mode, so its dialog draws no choice: a browser world is the only kind there.
  await page.locator('input[name="world-name"]').waitFor();
  const where = dialog.locator('input[name="where"][value="browser"]');
  if (await where.count()) await where.check();
  await page.fill('input[name="world-name"]', name);
  await dialog.locator('[data-action="pick"]').click();
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi.getState().active?.worldId));
  expect(await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.registry.worlds.find((w: { id: string }) => w.id === s.active.worldId)?.where;
  })).toBe('browser');
  await goHome(page);
}

async function goHome(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/home`;
  });
  await expect(page.locator('.atlas-world-home')).toBeVisible();
}

async function createViaStore(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const el = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return el.id as string;
  }, { type, data });
}

async function patchEntry(page: Page, patch: Record<string, unknown>) {
  await page.evaluate(async (p) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const s = getState();
    const next = (reg as any).updateWorldEntry(s.registry, s.active!.worldId, p);
    (reg as any).saveRegistry(next);
    patchSlice('registry', next);
  }, patch);
}
const element = (page: Page, name: string) => page.evaluate((n) =>
  (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.name === n), name);

const plus = (page: Page) => page.locator('[data-grid-plus]');
const just = (page: Page) => page.locator('[data-role="grow-just"]');
const grid = (page: Page) => page.locator('.atlas-world-home [data-role="home-grid"]').first();

/** Home's Picture tab, where the world's grid draws (a new world opens on Strand, 1.115.0); a world with no tab head draws it alone. */
async function toPicture(page: Page) {
  await expect(async () => {
    const tab = page.locator('[data-role="home-tabs"] [data-tab="picture"]');
    if (await tab.count() && (await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await expect(grid(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
}
/** A square by its element's name. */
const square = (page: Page, name: string) =>
  page.locator('[data-grid-id]').filter({ has: page.locator('.atlas-home-grid-name', { hasText: new RegExp(`^${name}$`) }) });
/** Where a square stands: its column and its row in that column. */
const placeOf = async (page: Page, name: string) => {
  const s = square(page, name);
  return { pos: await s.getAttribute('data-pos'), row: await s.getAttribute('data-row') };
};

/** Home's plain + square: a press opens its list, the kind picked opens the name box in place; a year for an Event; Enter keeps. */
async function make(page: Page, name: string, kind: 'a character' | 'a location' | 'an event' | 'a story', year?: number) {
  await plus(page).click();
  await page.getByRole('menu', { name: 'Add which kind' }).getByRole('menuitem', { name: kind }).click();
  const box = page.locator('.atlas-home-grid-make');
  await expect(box.locator('input').first()).toBeFocused();
  await box.locator('input').first().fill(name);
  if (year !== undefined) await box.locator('input[type="number"]').fill(String(year));
  await page.keyboard.press('Enter');
  await expect(square(page, name)).toHaveCount(1);
}

/**
 * The first press: selects the square. A make redraws the home twice in quick succession (the
 * create, then a story's label), and a press on a square the redraw just replaced lands nowhere, so
 * the press is repeated only while the square shows unselected (a second press would let go).
 */
async function select(page: Page, name: string) {
  await expect(async () => {
    if (!/is-selected/.test((await square(page, name).getAttribute('class')) ?? '')) await square(page, name).click();
    await expect(square(page, name)).toHaveClass(/is-selected/, { timeout: 1000 });
  }).toPass();
}

/** The second press, on a lit square: the placing, read from the "just now" sentence. */
async function dropOn(page: Page, name: string, sentence: string) {
  await expect(async () => {
    const said = (await just(page).count()) ? await just(page).textContent() : '';
    if (!said?.includes(sentence) && /is-target/.test((await square(page, name).getAttribute('class')) ?? '')) await square(page, name).click();
    await expect(just(page)).toContainText(sentence, { timeout: 1000 });
  }).toPass();
}

/** A mouse drag from one square onto another, past the 4 px lift. */
async function drag(page: Page, from: string, to: string) {
  const a = (await square(page, from).boundingBox())!;
  const b = (await square(page, to).boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 20, a.y + 30, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 20, { steps: 8 });
  await page.mouse.up();
}

/** Mira and The Harbour made by Home's plain + square, on the Picture tab. */
async function miraAndHarbour(page: Page) {
  await toPicture(page);
  await make(page, 'Mira', 'a character');
  await make(page, 'The Harbour', 'a location');
  // Home's + names no kind: it is plain.
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'any');
}

test('a placing by a mouse drag: the same write, the same sentence', async ({ page }) => {
  await setupWorld(page);
  await miraAndHarbour(page);
  await drag(page, 'Mira', 'The Harbour');
  await expect(just(page)).toContainText('Mira is in The Harbour');
  expect((await element(page, 'Mira')).location).toBe((await element(page, 'The Harbour')).id);
  await expect.poll(() => placeOf(page, 'Mira')).toEqual({ pos: '1', row: '1' });
  // A drag that ends off any lit square springs back and writes nothing.
  await just(page).locator('[data-action="grow-undo"]').click();
  await expect(just(page)).toHaveCount(0);
  const a = (await square(page, 'Mira').boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + 20);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 30, a.y + 200, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  expect((await element(page, 'Mira')).location ?? null).toBeNull();
  await expect(just(page)).toHaveCount(0);
});

test('a placing by a mouse drag in Firefox @firefox', async ({ page }) => {
  await setupWorld(page);
  await miraAndHarbour(page);
  await drag(page, 'Mira', 'The Harbour');
  await expect(just(page)).toContainText('Mira is in The Harbour');
  await expect.poll(() => placeOf(page, 'Mira')).toEqual({ pos: '1', row: '1' });
});

test('a placing by the keyboard: one Tab stop, Enter selects, arrows among the lit, Enter drops, Escape lets go', async ({ page }) => {
  await setupWorld(page);
  await miraAndHarbour(page);
  // One Tab stop: the roving square.
  const stops = page.locator('[data-role="home-grid"] [data-grid-id][tabindex="0"]');
  await expect(stops).toHaveCount(1);
  await square(page, 'Mira').focus();
  await expect(square(page, 'Mira')).toHaveAttribute('tabindex', '0');
  // Arrows move by the grid as drawn, and the Tab stop follows.
  await page.keyboard.press('ArrowRight');
  await expect(square(page, 'The Harbour')).toBeFocused();
  await expect(square(page, 'The Harbour')).toHaveAttribute('tabindex', '0');
  await page.keyboard.press('ArrowLeft');
  await expect(square(page, 'Mira')).toBeFocused();
  // Enter selects; Escape lets go.
  await page.keyboard.press('Enter');
  await expect(square(page, 'Mira')).toHaveClass(/is-selected/);
  await expect(square(page, 'The Harbour')).toHaveClass(/is-target/);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-grid-id].is-selected')).toHaveCount(0);
  await expect(page.locator('[data-grid-id].is-target')).toHaveCount(0);
  // Still on Home: Escape was the grid's.
  await expect(grid(page)).toBeVisible();
  // Enter, an arrow to the lit square, Enter drops.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowRight');
  await expect(square(page, 'The Harbour')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(just(page)).toContainText('Mira is in The Harbour');
  expect((await element(page, 'Mira')).location).toBe((await element(page, 'The Harbour')).id);
  await expect.poll(() => placeOf(page, 'Mira')).toEqual({ pos: '1', row: '1' });
  // The make's own keys: Escape makes nothing, an empty name says so. Home's + is plain: Enter opens
  // its list, two arrows down reach an event, Enter picks it.
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'any');
  const pickEvent = async () => {
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Add which kind' })).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
  };
  await plus(page).focus();
  await pickEvent();
  const name = page.locator('.atlas-home-grid-make input').first();
  await expect(name).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-home-grid-make')).toHaveCount(0);
  await expect(plus(page)).toBeFocused();
  await pickEvent();
  await page.locator('.atlas-home-grid-make input[type="number"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.atlas-home-grid-make')).toContainText('Type a name first');
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.filter((e: any) => e.type === 'event').length)).toBe(0);
});

test('a view-only world: no + square and no lit target', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Mira' });
  await createViaStore(page, 'location', { name: 'The Harbour' });
  // Its twin first: the same world, editable, offers both.
  await toPicture(page);
  await expect(plus(page)).toHaveCount(1);
  await select(page, 'Mira');
  await expect(square(page, 'The Harbour')).toHaveClass(/is-target/);
  await square(page, 'Mira').click();
  await expect(page.locator('[data-grid-id].is-target')).toHaveCount(0);
  await patchEntry(page, { copy_of: { world_id: 'elsewhere', at: new Date().toISOString() } });
  await goHome(page);
  await toPicture(page);
  await expect(square(page, 'Mira')).toBeVisible();
  await expect(page.locator('[data-grid-plus]')).toHaveCount(0);
  const squares = page.locator('[data-grid-id]');
  for (let i = 0; i < await squares.count(); i++) await squares.nth(i).click();
  await expect(page.locator('[data-grid-id].is-target')).toHaveCount(0);
});

// ---- Release (b): every pair the table offers, the plain +, the window frame ----

/** The line under Home's grid a press speaks in. */
const said = (page: Page) => page.locator('[data-role="grid-say"]').first();
const gridTop = (page: Page) => page.locator('[data-role="home-grid"]').first().evaluate(el => el.getBoundingClientRect().top);
const idOf = async (page: Page, name: string) => (await element(page, name)).id as string;

async function storeEdit(page: Page, op: 'update' | 'delete', id: string, patch: Record<string, unknown> = {}) {
  await page.evaluate(async ({ op, id, patch }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (op === 'update') await store.updateElement(id, patch); else await store.deleteElement(id);
    api.patchData(await store.listElements());
  }, { op, id, patch });
}

test('a name keeps 6 px of its column\'s edges clear, where a lane link climbs', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'location', { name: 'The Harbour of Ten Thousand Lanterns' });
  await createViaStore(page, 'character', { name: 'Mira' });
  await toPicture(page);
  await expect(square(page, 'Mira')).toBeVisible();
  for (const name of ['The Harbour of Ten Thousand Lanterns', 'Mira']) {
    const cell = page.locator('[data-grid-id]').filter({ hasText: name }).first();
    const [c, n] = await Promise.all([cell.boundingBox(), cell.locator('.atlas-home-grid-name').boundingBox()]);
    expect(n!.x).toBeGreaterThanOrEqual(c!.x + 5.5);
    expect(n!.x + n!.width).toBeLessThanOrEqual(c!.x + c!.width - 5.5);
  }
});

test('a line pair: two Characters cannot be linked; Mira onto The Founding by two presses, then Undo, then by a drag', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Mira' });
  await createViaStore(page, 'event', { name: 'The Founding' });
  await createViaStore(page, 'character', { name: 'Ilse' });
  await toPicture(page);
  const mira = await idOf(page, 'Mira');
  const before = { mira: await placeOf(page, 'Mira'), founding: await placeOf(page, 'The Founding') };
  const listed = async () => (await element(page, 'The Founding')).characters ?? [];

  // Two Characters: no target, and a press says why nothing is written. (On 1.110.0 no line pair lit at all.)
  await select(page, 'Mira');
  await expect(square(page, 'The Founding')).toHaveClass(/is-target/);
  await expect(square(page, 'Ilse')).not.toHaveClass(/is-target/);
  await square(page, 'Ilse').click();
  await expect(said(page)).toContainText('Mira and Ilse cannot be linked by placing');
  await expect(just(page)).toHaveCount(0);

  // Two presses: the first writes nothing and says the promise with Place; the second writes.
  await select(page, 'Mira');
  await square(page, 'The Founding').click();
  await expect(said(page)).toContainText('The Founding will list Mira.');
  await expect(said(page).locator('[data-action="grid-place"]')).toBeVisible();
  expect(await listed()).toEqual([]);
  await expect(just(page)).toHaveCount(0);
  await square(page, 'The Founding').click();
  await expect(just(page)).toContainText('The Founding now lists Mira');
  expect(await listed()).toEqual([mira]);
  // No square moved; a line drawn.
  expect(await placeOf(page, 'Mira')).toEqual(before.mira);
  expect(await placeOf(page, 'The Founding')).toEqual(before.founding);
  await expect(page.locator('[data-role="home-grid"] .atlas-home-grid-link')).toHaveCount(1);

  // Undo takes the line back.
  await just(page).locator('[data-action="grow-undo"]').click();
  await expect.poll(listed).toEqual([]);
  await expect(page.locator('[data-role="home-grid"] .atlas-home-grid-link')).toHaveCount(0);

  // A drag writes at once.
  await drag(page, 'Mira', 'The Founding');
  await expect(just(page)).toContainText('The Founding now lists Mira');
  expect(await listed()).toEqual([mira]);
  expect(await placeOf(page, 'Mira')).toEqual(before.mira);

  // The Founding's own page lists Mira.
  const founding = await idOf(page, 'The Founding');
  await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/element/${id}`;
  }, founding);
  await expect(page.locator('.atlas-middle-content')).toContainText('Mira');
});

test('a browse by presses writes nothing: press Mira, press The Founding, press a third square', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Mira' });
  await createViaStore(page, 'event', { name: 'The Founding' });
  await createViaStore(page, 'location', { name: 'The Harbour' });
  await toPicture(page);
  await select(page, 'Mira');
  await square(page, 'The Founding').click();
  await expect(said(page)).toContainText('The Founding will list Mira.');
  await square(page, 'The Harbour').click();
  await expect(square(page, 'The Harbour')).toHaveClass(/is-selected/);
  await page.waitForTimeout(200);
  expect((await element(page, 'The Founding')).characters ?? []).toEqual([]);
  expect((await element(page, 'Mira')).location ?? null).toBeNull();
  await expect(just(page)).toHaveCount(0);
});

test('a contributor: their own Mira lights the owner\'s The Harbour, never the owner\'s The Founding', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Mira', created_by: 'member-me' });
  await createViaStore(page, 'event', { name: 'The Founding', created_by: null });
  await createViaStore(page, 'location', { name: 'The Harbour', created_by: null });
  await patchEntry(page, { api: { member_role: 'contributor', membership: 'member-me' } });
  await goHome(page);
  await toPicture(page);
  await select(page, 'Mira');
  // Mira's place is Mira's field (hers); The Founding's list is the owner's Event.
  await expect(square(page, 'The Harbour')).toHaveClass(/is-target/);
  await expect(square(page, 'The Founding')).not.toHaveClass(/is-target/);
});

test('the plain +: its list by keys, Another kind…', async ({ page }) => {
  await setupWorld(page);
  await miraAndHarbour(page);
  await expect(plus(page)).toContainText('add');
  // By keys: Enter opens the list, arrows move, Escape closes it with the focus on the +.
  await plus(page).focus();
  await page.keyboard.press('Enter');
  const menu = page.getByRole('menu', { name: 'Add which kind' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['a character', 'a location', 'an event', 'a story', 'Another kind…']);
  await expect(menu.getByRole('menuitem', { name: 'a character' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'an event' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(plus(page)).toBeFocused();
  await expect(grid(page)).toBeVisible();
  // Enter picks: the square takes a name and a year; Escape makes nothing.
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(page.locator('.atlas-home-grid-make input[type="number"]')).toBeVisible();
  await expect(page.locator('.atlas-home-grid-make input').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-home-grid-make')).toHaveCount(0);
  // Tab closes the list and moves on.
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(menu).toHaveCount(0);
  // Another kind…: the New element dialog, Home stays; a cancel gives the focus back to the +.
  await plus(page).click();
  await menu.getByRole('menuitem', { name: 'Another kind…' }).click();
  const dialog = page.locator('.atlas-modal-overlay').last();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(plus(page)).toBeFocused();
  await expect(grid(page)).toBeVisible();
});

for (const width of [390, 1440]) {
  test(`nothing above the squares moves with an act, at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
    await setupWorld(page);
    await toPicture(page);
    const t0 = await gridTop(page);
    const same = async (act: string) => {
      await page.waitForTimeout(150);
      expect(Math.abs((await gridTop(page)) - t0), act).toBeLessThanOrEqual(1);
    };
    await make(page, 'Mira', 'a character'); await same('a make');
    await make(page, 'The Harbour', 'a location'); await same('a second make');
    await plus(page).click();
    await expect(page.getByRole('menu')).toBeVisible(); await same('the plain + list opened');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0); await same('the list closed');
    await select(page, 'Mira');
    await dropOn(page, 'The Harbour', 'Mira is in The Harbour'); await same('a placing');
    // Undo is a thumb's target at every width.
    expect((await just(page).locator('[data-action="grow-undo"]').boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await just(page).locator('[data-action="grow-undo"]').click();
    await expect(just(page)).toHaveCount(0); await same('Undo');
    await select(page, 'Mira');
    await dropOn(page, 'The Harbour', 'Mira is in The Harbour');
    await make(page, 'The Founding', 'an event', 12); await same('an event');
    await select(page, 'Mira');
    await square(page, 'The Founding').click();
    await expect(said(page)).toContainText('The Founding will list Mira.'); await same('a promise');
    await said(page).locator('[data-action="grid-place"]').click();
    await expect(just(page)).toContainText('The Founding now lists Mira'); await same('a line placing');
    await make(page, 'How the Harbour began', 'a story'); await same('a story');
  });
}

test('the "just now" line names the latest act: a rename shows, a make ends it, a delete ends it', async ({ page }) => {
  await setupWorld(page);
  await miraAndHarbour(page);
  await select(page, 'Mira');
  await dropOn(page, 'The Harbour', 'Mira is in The Harbour');
  // A rename: the line says the new name.
  await storeEdit(page, 'update', await idOf(page, 'Mira'), { name: 'Mirabel' });
  await expect(just(page)).toContainText('Mirabel is in The Harbour');
  // A make after the placing: the placing is no longer the latest act.
  await make(page, 'The Founding', 'an event', 12);
  await expect(just(page)).toHaveCount(0);
  // Place again, then delete another element: the line goes.
  await createViaStore(page, 'character', { name: 'Ilse' });
  await select(page, 'Ilse');
  await dropOn(page, 'The Harbour', 'Ilse is in The Harbour');
  await storeEdit(page, 'delete', await idOf(page, 'The Founding'));
  await expect(just(page)).toHaveCount(0);
});

test('Tab while a square is held: through its targets in grid order, a target that arrived first included; Enter places', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'location', { name: 'The Harbour' });
  await createViaStore(page, 'character', { name: 'Mira' });
  await toPicture(page);
  await square(page, 'Mira').focus();
  await page.keyboard.press('Enter');
  await expect(square(page, 'Mira')).toHaveClass(/is-selected/);
  await page.keyboard.press('Tab');
  await expect(square(page, 'The Harbour')).toBeFocused();
  await expect(square(page, 'The Harbour')).toHaveAccessibleDescription('Mira will be in The Harbour');
  // Tab past the last leaves the grid and ends the press.
  await page.keyboard.press('Tab');
  await expect(square(page, 'The Harbour')).not.toBeFocused();
  await expect(page.locator('[data-grid-id].is-selected')).toHaveCount(0);
  // Again, and Enter places.
  await square(page, 'Mira').focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(just(page)).toContainText('Mira is in The Harbour');
  expect((await element(page, 'Mira')).location).toBe((await element(page, 'The Harbour')).id);
});

test('the demo world: the grid with no + and no target', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Mira' });
  await createViaStore(page, 'location', { name: 'The Harbour' });
  await patchEntry(page, { demo: true });
  await goHome(page);
  await toPicture(page);
  await expect(square(page, 'Mira')).toBeVisible();
  await expect(plus(page)).toHaveCount(0);
  await square(page, 'Mira').click();
  await expect(square(page, 'Mira')).toHaveClass(/is-selected/);
  await expect(page.locator('[data-grid-id].is-target')).toHaveCount(0);
  await expect(page.locator('[data-action="grow-open"]')).toHaveText('Open Mira');
});

test('an open name box gives way to a press elsewhere: the press acts, and Home draws what it wrote', async ({ page }) => {
  await setupWorld(page);
  await miraAndHarbour(page);
  // A box opened and left: a press on Mira, then The Harbour, places her, drawn and said.
  await plus(page).click();
  await page.getByRole('menuitem', { name: 'a character' }).click();
  await expect(page.locator('.atlas-home-grid-make input').first()).toBeFocused();
  await square(page, 'Mira').click();
  await expect(page.locator('.atlas-home-grid-make')).toHaveCount(0);
  await expect(square(page, 'Mira')).toHaveClass(/is-selected/);
  await square(page, 'The Harbour').click();
  await expect(just(page)).toContainText('Mira is in The Harbour');
  await expect.poll(() => placeOf(page, 'Mira')).toEqual({ pos: '1', row: '1' });
  // The box left open made nothing.
  expect(await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.length)).toBe(2);
});
