/**
 * A new world's first steps on the home (#964, then the home that grows) e2e.
 * Drives the real flow: an empty world opens straight on the path (no doors,
 * no Next), its card read from the world on every draw, every act of the path
 * in the card's grid (a + square makes the step's kind, two presses place);
 * Bring it in opens today's ways in place; a step done by hand elsewhere
 * reads done on return; a pointer a stale tab holds never moves back. While
 * the path shows no path note draws; once it is done the notes speak again,
 * and their tests run in a world past the path. #975's room bar keeps a way
 * back from the chart and the writing room. Each negative stands beside its
 * positive twin in the same run. Plus the Start-page links and the desk rows.
 * The path end to end in a browser world, by drag and keyboard: home-grows.spec.ts.
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

async function setupWorld(page: Page, where: 'folder' | 'browser' = 'folder') {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('home-tour-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  const dialog = page.locator('[data-modal="create-world"]');
  if (where === 'browser') await dialog.locator('input[name="where"][value="browser"]').check();
  await page.fill('input[name="world-name"]', 'tourworld');
  await dialog.locator('[data-action="pick"]').click();
  // The world is open (the sidebar's search is a drawer's on a phone, so read the state).
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi.getState().active?.worldId));
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

/** The open world's registry entry, patched as another tab or an older session would leave it. */
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
const entryOf = (page: Page) => page.evaluate(() => {
  const s = (window as any).__atlasTestApi.getState();
  return s.registry.worlds.find((w: any) => w.id === s.active.worldId);
});

/** A world past the path (Done pressed): there the notes speak, as they did before the path. */
async function pastThePath(page: Page) {
  await patchEntry(page, { guide_step: 'done' });
}

/** The create dialog as the sidebar's + opens it: it stays on the home. */
async function openCreate(page: Page) {
  await page.evaluate(async () => {
    const { ElementCreateModal } = await import('/src/ui/element-create-modal.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    new ElementCreateModal(toastManager, { suppressNavigate: true }).open();
  });
}

/** Fill the open create dialog and create. */
async function createInModal(page: Page, name: string, type?: string) {
  const modal = page.locator('[data-modal="create-element"]');
  await expect(modal).toBeVisible();
  await page.fill('input[name="element-name"]', name);
  if (type) await modal.locator(`.atlas-create-type-btn[data-type="${type}"]`).click();
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toHaveCount(0);
}

const element = (page: Page, name: string) => page.evaluate((n) =>
  (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.name === n), name);
const block = (page: Page) => page.locator('[data-role="guide-block"]');
const line = (page: Page) => block(page).locator('[data-role="grow-line"]');
const act = (page: Page, verb: string) => block(page).locator(`[data-step-action="${verb}"]`);
const plus = (page: Page) => block(page).locator('[data-grid-plus]');
const just = (page: Page) => page.locator('[data-role="grow-just"]');
const litOf = (page: Page) => block(page).locator('[data-dot]')
  .evaluateAll(els => els.map(e => `${e.getAttribute('data-dot')}${e.getAttribute('data-lit') === 'true' ? '+' : ''}`));
const note = (page: Page) => page.locator('[data-role="guide-note"]');
/** A square by its element's name. */
const square = (page: Page, name: string) =>
  page.locator('[data-grid-id]').filter({ has: page.locator('.atlas-home-grid-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
/** Focus is on the card's grid: its roving square or its + square. */
const gridHasFocus = (page: Page) => page.evaluate(() =>
  !!document.activeElement?.closest('[data-role="guide-block"] [data-role="home-grid"]'));

/** The + square: a press opens the name box in place; a year for an Event; Enter keeps. */
async function make(page: Page, name: string, year?: number) {
  await plus(page).click();
  const box = page.locator('.atlas-home-grid-make');
  await expect(box.locator('input').first()).toBeFocused();
  await box.locator('input').first().fill(name);
  if (year !== undefined) await box.locator('input[type="number"]').fill(String(year));
  await page.keyboard.press('Enter');
  await expect(square(page, name)).toHaveCount(1);
}

/** The first press selects (repeated only while the square shows unselected: a make redraws the home just after). */
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

/** Count every note drawn from now on, by id: an end-state check cannot see a flash. */
async function watchNotes(page: Page) {
  await page.evaluate(() => {
    (window as any).__notes = [] as string[];
    new MutationObserver(muts => {
      for (const m of muts) m.addedNodes.forEach(n => {
        if (n instanceof HTMLElement && n.dataset.role === 'guide-note') (window as any).__notes.push(n.dataset.note);
      });
    }).observe(document.querySelector('.atlas-guide-slot')!, { childList: true });
  });
}
const notesDrawn = (page: Page): Promise<string[]> => page.evaluate(() => (window as any).__notes);

// ---- An empty world ----

test('an empty world opens on the path: no doors, Bring it in opens the ways in place and folds them again', async ({ page }) => {
  await setupWorld(page);
  await expect(block(page)).toHaveAttribute('data-state', 'path');
  await expect(block(page)).toHaveAttribute('data-step', 'someone');
  await expect(line(page)).toHaveText('Start with someone.');
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'character');
  await expect(block(page).locator('[data-guide-door], [data-step-action="next"], [data-action="guide-back"]')).toHaveCount(0);
  await expect(block(page)).not.toContainText('What do you have?');
  // "Just looking" stays gone: the first screen already offers Moppetopia and the tour.
  await expect(block(page)).not.toContainText('Just looking');
  await expect(block(page).locator('[data-action="cards-dismiss"]')).toBeVisible();

  const bring = block(page).locator('[data-action="grow-bring"]');
  await expect(block(page)).toContainText('Already have something written down?');
  await expect(bring).toHaveAttribute('aria-expanded', 'false');
  await expect(block(page).locator('[data-bring-action]')).toHaveCount(0);
  await bring.click();
  await expect(block(page).locator('[data-bring-action]')).toHaveText(['Bring in a file', 'Open a folder', 'Download a world']);
  await expect.soft(block(page).locator('[data-bring-action="file"]')).toBeFocused();
  // The path stays above the ways: the card is still the path's.
  await expect(block(page)).toHaveAttribute('data-step', 'someone');
  await expect(block(page).locator('[data-action="grow-bring"]')).toHaveAttribute('aria-expanded', 'true');
  await block(page).locator('[data-action="grow-bring"]').click();
  await expect(block(page).locator('[data-bring-action]')).toHaveCount(0);
  await expect(block(page).locator('[data-action="grow-bring"]')).toBeFocused();
  // Nothing was written by looking.
  expect((await entryOf(page)).guide_step).toBeUndefined();
});

test('#972: the first Tab stop skips the chrome to the first steps; it goes with the block', async ({ page }) => {
  await setupWorld(page);
  const skip = page.locator('[data-role="guide-skip"]');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  const box = await skip.boundingBox();
  expect(box && box.y >= 0, 'seen once focused').toBe(true);
  await page.keyboard.press('Enter');
  // The first steps' first control is the + square, never the head's ×.
  await expect(plus(page)).toBeFocused();
  // Unseen until focused.
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const away = await skip.boundingBox();
  expect(away && away.y + away.height <= 0, 'off screen unfocused').toBe(true);
  // The tab bar clips its overflow: a tab's keyboard ring is drawn inside it.
  await page.keyboard.press('Shift');
  await page.locator('.atlas-tab').first().focus();
  expect(await page.locator('.atlas-tab').first().evaluate(e => getComputedStyle(e).outlineOffset)).toBe('-2px');
  // The block dismissed: no skip, and the first Tab stop is the chrome's.
  await page.click('[data-action="cards-dismiss"]');
  await expect(block(page)).toHaveCount(0);
  await expect(skip).toBeHidden();
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Tab');
  await expect(skip).not.toBeFocused();
});

test('the first make writes the pointer, never a render or an open box; the card keeps its place; a reload reads the world', async ({ page }) => {
  await setupWorld(page);
  const top = Math.round((await block(page).boundingBox())!.y);
  await plus(page).click();
  await expect(page.locator('.atlas-home-grid-make input').first()).toBeFocused();
  // The open box wrote nothing: Escape leaves nothing made and nothing written.
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-home-grid-make')).toHaveCount(0);
  expect((await entryOf(page)).guide_step).toBeUndefined();
  await make(page, 'Ada');
  expect((await entryOf(page)).guide_step).toBe('someone');
  // Being born moves nothing above it: the card stays where it stood.
  expect(Math.round((await block(page).boundingBox())!.y)).toBe(top);
  await page.reload();
  await page.waitForSelector('.atlas-world-home');
  await expect(block(page)).toHaveAttribute('data-step', 'placed');
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'location');
  await expect(block(page).locator('[data-guide-door]')).toHaveCount(0);
});

// ---- The path by the card ----

test('the path by the card alone, a folder world: four steps by the grid, the copy card with Done alone, no path note drawn', async ({ page }) => {
  await setupWorld(page);
  await watchNotes(page);

  await make(page, 'Ada');
  await expect(block(page)).toHaveAttribute('data-step', 'placed');
  await expect(line(page)).toHaveText('Now somewhere for Ada to be.');
  // A folder world already has its copy outside the browser.
  expect(await litOf(page)).toEqual(['someone+', 'placed', 'happened', 'story', 'copy+']);
  await make(page, 'Hollow Keep');
  const keepAt = await square(page, 'Hollow Keep').getAttribute('data-pos');
  await expect(line(page)).toHaveText('Ada will be in Hollow Keep.');
  await select(page, 'Ada');
  await dropOn(page, 'Hollow Keep', 'Ada is in Hollow Keep');
  const keep = await element(page, 'Hollow Keep');
  expect((await element(page, 'Ada')).location).toBe(keep.id);

  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  await expect(line(page)).toHaveText('Something happened in your world.');
  await make(page, 'The Founding', 120);
  await expect(block(page)).toHaveAttribute('data-step', 'story');
  // The card says what the step before made possible: the chart, a press away.
  await expect(block(page)).toContainText('The Founding is on the chart at year 120.');
  await act(page, 'open-chart').click();
  await expect(page).toHaveURL(/\/timeline/);
  await expect.poll(async () => (await entryOf(page)).guide_visited).toEqual(['happened']);
  await goHome(page);

  await expect(line(page)).toHaveText('Tell a story in your world.');
  await make(page, "Ada's Tale");
  // The world's first writing label, so the story is a book in the writing room.
  await expect.poll(async () => (await element(page, "Ada's Tale")).supertype).toBe('Book');
  // All five lit: the copy card, with Done alone (the copy is already kept).
  await expect(block(page)).toHaveAttribute('data-step', 'copy');
  await expect(line(page)).toHaveText('That is a world. Keep making.');
  await expect(block(page).locator('.atlas-home-grow-keep [data-step-action]')).toHaveText(['Done']);
  await act(page, 'open-writing').click();
  await expect(page).toHaveURL(/\/writing/);
  await expect.poll(async () => (await entryOf(page)).guide_visited).toEqual(['happened', 'story']);
  await goHome(page);
  // No square drawn before moved for what came after.
  await expect(square(page, 'Hollow Keep')).toHaveAttribute('data-pos', keepAt!);
  await act(page, 'done').click();

  // Done: the block goes, never dismissed (the reading and lens notes keep speaking).
  await expect(block(page)).toHaveCount(0);
  const entry = await entryOf(page);
  expect(entry.guide_step).toBe('done');
  expect(entry.tour_dismissed ?? []).not.toContain('home-cards');
  // One voice: the card said every step; only the reward (not a path note) may have spoken.
  expect((await notesDrawn(page)).filter(n => n !== 'reading')).toEqual([]);
});

// ---- #975: the card follows the person into the room ----

const roomBar = (page: Page) => page.locator('[data-role="guide-room-bar"]');

/** Ada placed at Hollow Keep, The Founding at year 120, and `extra`: the card stands at the step they leave. */
async function worldAt(page: Page, extra: Array<[string, Record<string, unknown>]> = []) {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 120 });
  for (const [type, data] of extra) await createViaStore(page, type, data);
  await patchEntry(page, { guide_step: 'someone' });
  await goHome(page);
}

test('#975: Open the chart keeps a way back in the room; it stays through the chart\'s own moves; Back lands on the grid', async ({ page }) => {
  await worldAt(page);
  await expect(block(page)).toHaveAttribute('data-step', 'story');
  await act(page, 'open-chart').click();
  await expect(page).toHaveURL(/\/timeline\//);
  await expect(roomBar(page)).toBeVisible();
  await expect(roomBar(page)).toContainText('Step 3 of 5, Something happened');
  // The room's first child: nothing in the chart sits under it.
  expect(await page.evaluate(() => document.querySelector('.atlas-timeline-room')!.firstElementChild!.getAttribute('data-role'))).toBe('guide-room-bar');
  // The chart's own move (clear the focus) keeps it.
  await page.locator('.atlas-chart-focus-clear').click();
  await expect(page).toHaveURL(/\/timeline$/);
  await expect(roomBar(page)).toBeVisible();
  await roomBar(page).locator('[data-action="guide-room-back"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await expect(block(page)).toHaveAttribute('data-step', 'story');
  // Nothing written by the bar: the visit is the room mount's.
  expect((await entryOf(page)).guide_visited).toEqual(['happened']);
  await expect.poll(() => gridHasFocus(page)).toBe(true);
});

test('#975: the bar reads the world, not the press: shown while the card stands at the chart\'s step or the one after, gone past Done', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'location', { name: 'Hollow Keep' });
  const ada = await createViaStore(page, 'character', { name: 'Ada' });
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 120 });
  await patchEntry(page, { guide_step: 'someone' });
  const toChart = () => page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  // The chart's dot is lit, but the card stands at the placing (Ada has no place): no bar.
  await goHome(page);
  await expect(block(page)).toHaveAttribute('data-step', 'placed');
  await toChart();
  await expect(page.locator('.atlas-timeline-room')).toBeVisible();
  await expect(roomBar(page)).toBeHidden();
  // Ada placed (elsewhere): the card stands at the story, the step after the chart's; the bar shows without a remount.
  await page.evaluate(async (id) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const keep = (await store.listElements()).find((e: any) => e.name === 'Hollow Keep');
    await store.updateElement(id, { location: keep.id });
    api.patchData(await store.listElements());
  }, ada);
  await expect(roomBar(page)).toBeVisible();
  // Done pressed in another tab, merged: the bar goes without a remount.
  await patchEntry(page, { guide_step: 'done' });
  await expect(roomBar(page)).toBeHidden();
});

test('#975: Open the writing room keeps a way back too, for a story the writing room does not list', async ({ page }) => {
  // A Narrative with no writing label (made from the sidebar): the room shows its landing, and the bar names the step, not the story.
  await worldAt(page, [['narrative', { name: 'Loose Tale' }]]);
  await expect(block(page)).toHaveAttribute('data-step', 'copy');
  await act(page, 'open-writing').click();
  await expect(page).toHaveURL(/\/writing\//);
  await expect(roomBar(page)).toBeVisible();
  await expect(roomBar(page)).toContainText('Step 4 of 5, A story');
  await expect(roomBar(page)).not.toContainText('Loose Tale');
  await roomBar(page).locator('[data-action="guide-room-back"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await expect.poll(() => gridHasFocus(page)).toBe(true);
});

test('#975: a step lit inside the room counts the room seen: Back lands on the grid (the gate\'s G1)', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  await patchEntry(page, { guide_step: 'someone' });
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room')).toBeVisible();
  await expect(roomBar(page)).toBeHidden();
  // The year given in the chart: the step lights while the room is mounted.
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 120 });
  await expect(roomBar(page)).toBeVisible();
  await expect.poll(async () => (await entryOf(page)).guide_visited).toEqual(['happened']);
  await roomBar(page).locator('[data-action="guide-room-back"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await expect.poll(() => gridHasFocus(page)).toBe(true);
});

test('#975: a reload in the room, the world reopening under it, still counts the room seen', async ({ page }) => {
  await worldAt(page);
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(roomBar(page)).toBeVisible();
  // The mount's own write runs first: undo it, then reload, so only the reopened room can write it.
  await patchEntry(page, { guide_visited: [] });
  await page.reload();
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi?.getState().active?.worldId));
  await expect(roomBar(page)).toBeVisible();
  await expect.poll(async () => (await entryOf(page)).guide_visited).toEqual(['happened']);
});

test('a step done by hand elsewhere reads done on the card when the person comes back', async ({ page }) => {
  await setupWorld(page);
  await make(page, 'Ada');
  await expect(block(page)).toHaveAttribute('data-step', 'placed');
  await watchNotes(page);
  const ada = (await element(page, 'Ada')).id;
  await page.evaluate(id => { const s = (window as any).__atlasTestApi.getState(); window.location.hash = `#/w/${s.active.worldId}/element/${id}`; }, ada);
  await page.locator('.atlas-field[data-field="location"] .atlas-link-pick').click();
  await createInModal(page, 'Hollow Keep');
  await page.waitForTimeout(300);
  // The placed note stays silent while the path shows, in the element page too.
  expect((await notesDrawn(page)).filter(n => n !== 'reading')).toEqual([]);
  await goHome(page);
  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  expect(await litOf(page)).toEqual(['someone+', 'placed+', 'happened', 'story', 'copy+']);
});

test('Something happened with no dates in the world: the year starts empty, may stay empty, and the card asks for it', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  await plus(page).click();
  const year = page.locator('.atlas-home-grid-make input[type="number"]');
  await expect(year).toHaveValue('');
  await expect(year).toHaveAttribute('placeholder', 'Year');
  await page.locator('.atlas-home-grid-make input').first().fill('The Siege');
  await year.focus();
  await page.keyboard.press('Enter');
  await expect(square(page, 'The Siege')).toHaveCount(1);
  // Made without a year: still the step, and the card leads to it.
  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  await expect(block(page)).toContainText('Give The Siege a year to see it on the chart.');
  await expect(act(page, 'open-element')).toHaveText('Open The Siege');
  // The year the person types lights it.
  await make(page, 'The Founding', 7);
  await expect(block(page)).toHaveAttribute('data-step', 'story');
  expect(await litOf(page)).toContain('happened+');
});

test('a stale tab never moves the pointer back: a make after another tab\'s Done keeps done', async ({ page }) => {
  await setupWorld(page);
  await expect(plus(page)).toBeVisible();
  // Another tab pressed Done while this one still shows the card: stored only, no storage event here.
  await page.evaluate(() => {
    const key = 'atlas_worlds_registry';
    const reg = JSON.parse(localStorage.getItem(key)!);
    const id = (window as any).__atlasTestApi.getState().active.worldId;
    reg.worlds = reg.worlds.map((w: any) => (w.id === id ? { ...w, guide_step: 'done' } : w));
    localStorage.setItem(key, JSON.stringify(reg));
  });
  await make(page, 'Ada');
  await expect.poll(async () => (await entryOf(page)).guide_step).toBe('done');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!).worlds[0].guide_step);
  expect(stored).toBe('done');
});

test('Bring in a file, then back with nothing brought in: the card is still on the path, the ways folded', async ({ page }) => {
  await setupWorld(page);
  await block(page).locator('[data-action="grow-bring"]').click();
  await page.click('[data-bring-action="file"]');
  await expect(page).toHaveURL(/\/import$/);
  await goHome(page);
  await expect(block(page)).toHaveAttribute('data-step', 'someone');
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'character');
  await expect(block(page).locator('[data-action="grow-bring"]')).toHaveAttribute('aria-expanded', 'false');
  await expect(block(page).locator('[data-bring-action]')).toHaveCount(0);
  // The return is no press: nothing written.
  expect((await entryOf(page)).guide_step).toBeUndefined();
});

test('a world never on the path (an older or imported one): the first unlit step, placed by the grid', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada' });
  await expect(block(page)).toHaveAttribute('data-step', 'placed');
  await expect(line(page)).toHaveText('Ada will be in Hollow Keep.');
  expect((await entryOf(page)).guide_step).toBeUndefined();
  await select(page, 'Ada');
  await dropOn(page, 'Hollow Keep', 'Ada is in Hollow Keep');
  expect((await element(page, 'Ada')).location).toBe(keep);
  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  // Its twin: with every dot lit and no pointer, no block at all.
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 1 });
  await createViaStore(page, 'narrative', { name: 'Tale', supertype: 'Book' });
  await expect(block(page)).toHaveCount(0);
});

test('a press survives a data refresh between press and release (conv. 146): the + square and a square', async ({ page }) => {
  await setupWorld(page);
  const refresh = () => page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData([...(await api.getActiveStore().listElements())]);
  });
  const pressAcross = async (box: { x: number; y: number; width: number; height: number }) => {
    await page.mouse.move(box.x + box.width / 2, box.y + 20);
    await page.mouse.down();
    // An idle sync round: a fresh elements array that says nothing new.
    await refresh();
    await page.waitForTimeout(100);
    await page.mouse.up();
  };
  await pressAcross((await plus(page).boundingBox())!);
  await expect(page.locator('.atlas-home-grid-make input').first()).toBeVisible();
  await page.keyboard.press('Escape');
  await createViaStore(page, 'character', { name: 'Ada' });
  await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await expect(square(page, 'Ada')).toBeVisible();
  await page.waitForTimeout(300);
  await pressAcross((await square(page, 'Ada').boundingBox())!);
  await expect(square(page, 'Ada')).toHaveClass(/is-selected/);
  await expect(square(page, 'Hollow Keep')).toHaveClass(/is-target/);
});

/** Every dot lit by the world's own elements but the copy: Ada placed, The Founding dated, a story. */
async function allButCopy(page: Page) {
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 120 });
  await createViaStore(page, 'narrative', { name: "Ada's Tale", supertype: 'Book' });
}

test('a browser world: the copy step carries the keep-safe ways and Done', async ({ page }) => {
  await setupWorld(page, 'browser');
  expect(await litOf(page)).toEqual(['someone', 'placed', 'happened', 'story', 'copy']);
  await patchEntry(page, { guide_step: 'someone' });
  await allButCopy(page);
  await expect(block(page)).toHaveAttribute('data-step', 'copy');
  await expect(line(page)).toHaveText('That is a world. Keep it, or keep making.');
  await expect(act(page, 'download')).toBeVisible();
  await expect(act(page, 'online')).toBeVisible();
  await expect(act(page, 'done')).toBeVisible();
});

// ---- The code gate's findings ----

test('a browser world worth keeping, mid-path: the keep-safe card draws below the block, and waits only at the copy step (C2)', async ({ page }) => {
  await setupWorld(page, 'browser');
  await patchEntry(page, { guide_step: 'someone' });
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    for (let i = 0; i < 26; i++) await store.createElement('character', { name: `C${i}` });
    api.patchData(await store.listElements());
  });
  await expect(block(page)).toHaveAttribute('data-step', 'placed');
  const keep = page.locator('.atlas-home-keepsafe');
  await expect(keep).toBeVisible();
  // Below the block: the block never moves for it.
  const [b, k] = [(await block(page).boundingBox())!, (await keep.boundingBox())!];
  expect(k.y).toBeGreaterThan(b.y + b.height - 1);
  // Its twin: at the copy step the card carries the same ways, and the keep-safe card waits.
  await allButCopy(page);
  await expect(block(page)).toHaveAttribute('data-step', 'copy');
  await expect(act(page, 'download')).toBeVisible();
  await expect(keep).toHaveCount(0);
});

test('a browser world exported as JSON is not "kept only in this browser": its copy step reads done (C7)', async ({ page }) => {
  await setupWorld(page, 'browser');
  await patchEntry(page, { guide_step: 'someone', kept_export_at: new Date().toISOString() });
  await allButCopy(page);
  await expect(block(page)).toHaveAttribute('data-step', 'copy');
  await expect(line(page)).toHaveText('That is a world. Keep making.');
  await expect(block(page).locator('.atlas-home-grow-keep [data-step-action]')).toHaveText(['Done']);
});

test('Something happened with an Event already made and no year: the card leads to it first (C6)', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  const ev = await createViaStore(page, 'event', { name: 'The Siege' });
  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  await expect(block(page).locator('[data-step-action]:visible')).toHaveText(['Open The Siege']);
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'event');
  await act(page, 'open-element').click();
  await expect(page).toHaveURL(new RegExp(`/element/${ev}$`));
});

test('focus: a redraw keeps it on the same control (C9); a press that wrote nothing leaves no ask behind (C3)', async ({ page }) => {
  await setupWorld(page);
  await block(page).locator('[data-action="grow-bring"]').click();
  await block(page).locator('[data-bring-action="download"]').focus();
  // An unrelated change redraws the home.
  await patchEntry(page, { notes: 'a note' });
  await expect(block(page).locator('[data-bring-action="download"]')).toBeFocused();

  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  const ada = await createViaStore(page, 'character', { name: 'Ada' });
  await select(page, 'Ada');
  await expect(square(page, 'Hollow Keep')).toHaveClass(/is-target/);
  // Placed on disk behind the card's back: the drop finds the field filled and writes nothing.
  await page.evaluate(async ({ ada, keep }) => {
    await (window as any).__atlasTestApi.getActiveStore().updateElement(ada, { location: keep });
  }, { ada, keep });
  await square(page, 'Hollow Keep').click();
  await page.waitForTimeout(200);
  await expect(just(page)).toHaveCount(0);
  // Typing elsewhere, then the home redraws: the focus stays where the person is.
  const search = page.locator('.atlas-search-row input').first();
  await search.focus();
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData(await api.getActiveStore().listElements());
  });
  await expect(block(page)).toHaveAttribute('data-step', 'happened');
  await expect(search).toBeFocused();
});

// ---- Phones ----

for (const [w, h] of [[360, 640], [390, 844]] as const) {
  test(`a ${w} px phone: no sideways scroll, and the card's + square is in view`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setupWorld(page);
    await expect(plus(page)).toBeInViewport({ ratio: 1 });
    await expect(block(page).locator('[data-dot]')).toHaveCount(5);
    const overflow = await page.evaluate(() => {
      const g = document.querySelector('[data-role="guide-block"] [data-role="home-grid"]') as HTMLElement;
      return { grid: g.scrollWidth - g.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(overflow.grid).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
  });
}

test.describe('on a small touch phone', () => {
  test.use({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true });

  test('#975: Back lands on the grid, in view, once the home has settled (the gate\'s G2)', async ({ page }) => {
    await worldAt(page);
    await act(page, 'open-chart').click();
    await roomBar(page).locator('[data-action="guide-room-back"]').click();
    await expect.poll(() => gridHasFocus(page)).toBe(true);
    // The home draws again when its saved charts arrive: read the view after that, not at the first draw.
    await page.waitForTimeout(1000);
    expect(await gridHasFocus(page)).toBe(true);
    await expect(page.locator(':focus')).toBeInViewport({ ratio: 1 });
  });
});

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('#975: the room\'s Back takes a thumb, and lands on the grid in view', async ({ page }) => {
    await worldAt(page);
    await act(page, 'open-chart').click();
    const back = roomBar(page).locator('[data-action="guide-room-back"]');
    await expect(back).toBeVisible();
    expect(Math.round((await back.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    await back.click();
    await expect.poll(() => gridHasFocus(page)).toBe(true);
    await expect(page.locator(':focus')).toBeInViewport();
  });

  test('the path by taps: make and place with two presses, the squares 44 px or more', async ({ page }) => {
    await setupWorld(page, 'browser');
    await make(page, 'Ada');
    await make(page, 'Hollow Keep');
    await square(page, 'Ada').tap();
    await expect(square(page, 'Ada')).toHaveClass(/is-selected/);
    await square(page, 'Hollow Keep').tap();
    await expect(just(page)).toContainText('Ada is in Hollow Keep');
    await expect(square(page, 'Ada')).toHaveAttribute('data-row', '1');
    const sides = await page.locator('[data-role="home-grid"] .atlas-home-grid-square').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    expect(Math.min(...sides)).toBeGreaterThanOrEqual(44);
  });

  test('every way in the block takes a thumb: the + square, Bring it in and its ways, Undo, the card\'s buttons are 44 px or more', async ({ page }) => {
    await setupWorld(page, 'browser');
    const heights = (sel: string) => block(page).locator(sel).evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    // Each way read on its own (soft), so one run names every one that falls short.
    const thumb = async (sel: string, what: string) => {
      const hs = await heights(sel);
      expect.soft(hs.length, `${what} drawn`).toBeGreaterThan(0);
      expect.soft(Math.min(...hs), `${what} takes a thumb`).toBeGreaterThanOrEqual(44);
    };
    await patchEntry(page, { guide_step: 'someone' });
    await thumb('[data-grid-plus] .atlas-home-grid-square', 'the + square');
    // The card's one link, under everything: a strip a thumb can hit.
    await thumb('[data-action="grow-bring"]', 'Bring it in');
    await block(page).locator('[data-action="grow-bring"]').click();
    // The ghost buttons too: the rooms' own touch rule makes them 40 px unless the block's outranks it.
    await thumb('[data-bring-action]', 'the ways to bring a world in');
    await block(page).locator('[data-action="grow-bring"]').click();
    // The name box, typed in place.
    await plus(page).click();
    await thumb('.atlas-home-grid-make input', 'the name box');
    await page.keyboard.press('Escape');
    // Undo, after a placing.
    await createViaStore(page, 'character', { name: 'Ada' });
    await createViaStore(page, 'location', { name: 'Hollow Keep' });
    await select(page, 'Ada');
    await dropOn(page, 'Hollow Keep', 'Ada is in Hollow Keep');
    await thumb('[data-action="grow-undo"]', 'Undo');
    // The copy card's ways and Done, and the links that say what the step before made possible.
    await createViaStore(page, 'event', { name: 'The Founding', start_date: 120 });
    await createViaStore(page, 'narrative', { name: "Ada's Tale", supertype: 'Book' });
    await expect(act(page, 'online')).toBeVisible();
    await thumb('.atlas-home-grow-keep [data-step-action]', 'the keep ways and Done');
    await thumb('.atlas-home-grow-recap [data-step-action]', 'the card\'s links');
  });
});

// ---- The notes, in a world past the path ----

test('past the path, the notes speak again: a link field\'s create earns placed, never the offer', async ({ page }) => {
  await setupWorld(page);
  await pastThePath(page);
  const ada = await createViaStore(page, 'character', { name: 'Ada' });
  await page.evaluate(id => { const s = (window as any).__atlasTestApi.getState(); window.location.hash = `#/w/${s.active.worldId}/element/${id}`; }, ada);
  await watchNotes(page);
  await page.locator('.atlas-field[data-field="location"] .atlas-link-pick').click();
  await createInModal(page, 'Hollow Keep');
  await expect(note(page)).toHaveAttribute('data-note', 'placed');
  expect(await notesDrawn(page)).toEqual(['placed']);
});

test('past the path: a note survives the home rebuilding under a typed year', async ({ page }) => {
  await setupWorld(page);
  await pastThePath(page);
  await openCreate(page);
  await createInModal(page, 'The Founding', 'event');
  const input = note(page).locator('.atlas-guide-note-year-input');
  await input.fill('12');
  // A sync round's refresh: a new elements array, the home rebuilds.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData([...(await api.getActiveStore().listElements())]);
  });
  await page.waitForTimeout(200);
  await expect(input).toHaveValue('12');
  await expect(input).toBeFocused();
});

test('negatives beside their twins: the store path, the switch and the path showing earn nothing, a gesture past it does', async ({ page }) => {
  await setupWorld(page);
  await expect(block(page)).toHaveAttribute('data-step', 'someone');
  await watchNotes(page);
  // While the path shows: a gesture made by hand earns no path note.
  await openCreate(page);
  await createInModal(page, 'The Path One', 'event');
  await page.waitForTimeout(300);
  expect(await notesDrawn(page)).toEqual([]);
  await pastThePath(page);
  // Made by the store (an import, a sync, a world file): no gesture, no note.
  await createViaStore(page, 'character', { name: 'Imported' });
  await page.waitForTimeout(300);
  // Switched off: a gesture made by hand earns nothing.
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: {}, off: true })));
  await openCreate(page);
  await createInModal(page, 'The Quiet One', 'event');
  await page.waitForTimeout(300);
  expect(await notesDrawn(page)).toEqual([]);
  // The twin: switched on, past the path, the same gesture speaks.
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: {}, off: false })));
  await openCreate(page);
  await createInModal(page, 'The Loud One', 'event');
  await expect(note(page)).toHaveAttribute('data-note', 'event');
  expect(await notesDrawn(page)).toEqual(['event']);
});

test('past the path: a seen note is never drawn again, across a reload; the twin is the first draw', async ({ page }) => {
  await setupWorld(page);
  await pastThePath(page);
  await openCreate(page);
  await createInModal(page, 'Ada', 'character');
  await expect(note(page)).toHaveAttribute('data-note', 'someone');
  await page.reload();
  await page.waitForSelector('.atlas-world-home');
  await watchNotes(page);
  await openCreate(page);
  await createInModal(page, 'Bel', 'character');
  await page.waitForTimeout(400);
  expect(await notesDrawn(page)).toEqual([]);
});

test('past the path, a browser world: Open the chart moves first, then the copy note speaks in the chart room (never burned unseen)', async ({ page }) => {
  await setupWorld(page, 'browser');
  await pastThePath(page);
  await openCreate(page);
  await createInModal(page, 'The Founding', 'event');
  await note(page).locator('.atlas-guide-note-year-input').fill('120');
  await note(page).locator('[data-note-action="set-year"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'dated');
  await watchNotes(page);
  await note(page).locator('[data-note-action="open-chart"]').click();
  await expect(page).toHaveURL(/\/timeline\//);
  await expect(note(page)).toHaveAttribute('data-note', 'copy');
  await page.waitForTimeout(400);
  await expect(note(page)).toHaveAttribute('data-note', 'copy');
  expect(await notesDrawn(page)).toEqual(['copy']);
});

test('past the path: a typed year survives Were there, and keeps its focus', async ({ page }) => {
  await setupWorld(page);
  await pastThePath(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  await openCreate(page);
  await createInModal(page, 'The Founding', 'event');
  const input = note(page).locator('.atlas-guide-note-year-input');
  await input.fill('120');
  await note(page).locator('[data-note-action="were-there"]').click();
  await expect(note(page).locator('[data-note-action="were-there"]')).toHaveCount(0);
  await expect(note(page).locator('.atlas-guide-note-year-input')).toHaveValue('120');
});

// ---- The Start-page links ----

test('the Start-page links: #/start opens straight on the path; #/bring-in lands in the Data room', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/start');
  await page.waitForSelector('.atlas-shell');
  const dialog = page.locator('[data-modal="create-world"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Create a world');
  // The hash went first: a reload does not ask again.
  expect(await page.evaluate(() => window.location.hash)).toBe('#/');
  // Count every moment a door is in the page, not just the end state.
  await page.evaluate(() => {
    (window as any).__sawDoors = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-guide-door]')) (window as any).__sawDoors++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const rows = dialog.locator('.atlas-where-row input');
  if (await rows.count() > 1) await rows.nth(1).check();
  await page.fill('input[name="world-name"]', 'From the site');
  await dialog.locator('[data-action="pick"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  // Answered on onlyworlds.com: the path at its first step, and no door ever drawn.
  await expect(block(page)).toHaveAttribute('data-step', 'someone');
  await expect(plus(page)).toHaveAttribute('data-grid-plus', 'character');
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__sawDoors)).toBe(0);

  // #/bring-in (#856): no dialog; with a world open it is that world's Data room.
  await page.goto('/#/bring-in');
  await page.waitForSelector('.atlas-shell');
  await expect(page).toHaveURL(/#\/w\/[^/]+\/import$/);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.atlas-import-ai')).toContainText('add nothing your notes do not say');
});

// ---- The desk ----

test('desk map rows: imageless map opens its flat canvas tab (was a divert)', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'map', { name: 'Blank Atlas' });
  const mapRow = page.locator('.atlas-home-continue-row', { hasText: 'Blank Atlas' });
  await expect(mapRow).toBeVisible();
  await mapRow.click();
  // Imageless maps are first-class: the tab opens and renders the sized flat
  // canvas (no toast, no divert — DESIGN_MAPS.md §4.2).
  await expect(page.locator('.atlas-tab.active', { hasText: 'Blank Atlas' })).toBeVisible();
  await expect(page.locator('.ow-toast', { hasText: 'set a map image' })).toHaveCount(0);
});

test('desk map rows: an already-open background map tab re-activates on click', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'map', { name: 'Alpha Map', image_url: 'https://example.invalid/a.png' });
  const mapRow = page.locator('.atlas-home-continue-row', { hasText: 'Alpha Map' });
  await expect(mapRow).toBeVisible();
  await mapRow.click();
  // First click: tab opens and is active.
  await expect(page.locator('.atlas-tab.active', { hasText: 'Alpha Map' })).toBeVisible();
  // Background the tab (switch to the map index), then click the row again.
  await page.click('.atlas-tab[data-tab-kind="map-index"]');
  await expect(page.locator('.atlas-tab[data-tab-kind="map-index"]')).toHaveClass(/active/);
  await mapRow.click();
  // The fix: the existing tab ACTIVATES instead of nothing happening.
  await expect(page.locator('.atlas-tab.active', { hasText: 'Alpha Map' })).toBeVisible();
});
