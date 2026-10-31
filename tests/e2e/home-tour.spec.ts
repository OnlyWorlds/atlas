/**
 * A new world's home e2e, after the first steps were retired (1.115.0: the
 * card, its room bar and its silence are gone; a new world opens on its
 * Strand tab, home-strand-first.spec.ts). Home's grid on the Picture tab: a
 * press survives a data refresh, a redraw keeps the focus, a press that wrote
 * nothing leaves no ask, phones fit it and every way in takes a thumb. The
 * guide's notes speak (their tests keep a world past the path, harmless now).
 * Each negative stands beside its positive twin in the same run. Plus the
 * Start-page links and the desk rows. Home's grid by drag and keyboard:
 * home-grows.spec.ts.
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
const plus = (page: Page) => page.locator('[data-grid-plus]');
const just = (page: Page) => page.locator('[data-role="grow-just"]');
const grid = (page: Page) => page.locator('.atlas-world-home [data-role="home-grid"]').first();
const note = (page: Page) => page.locator('[data-role="guide-note"]');
/** A square by its element's name. */
const square = (page: Page, name: string) =>
  page.locator('[data-grid-id]').filter({ has: page.locator('.atlas-home-grid-name', { hasText: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) });
/** The row a square stands in within its column. */
const placeOfRow = (page: Page, name: string) => square(page, name).getAttribute('data-row');

/** Home's Picture tab, where the world's grid draws (a new world opens on Strand, 1.115.0). */
async function toPicture(page: Page) {
  await expect(async () => {
    const tab = page.locator('[data-role="home-tabs"] [data-tab="picture"]');
    if (await tab.count() && (await tab.getAttribute('aria-selected')) !== 'true') await tab.click();
    await expect(grid(page)).toBeVisible({ timeout: 1000 });
  }).toPass();
}

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

// ---- Home's grid ----

test('a press survives a data refresh between press and release (conv. 146): the + square and a square', async ({ page }) => {
  await setupWorld(page);
  await toPicture(page);
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
  // Home's + is plain: the press opens its list of kinds.
  await pressAcross((await plus(page).boundingBox())!);
  await expect(page.getByRole('menu', { name: 'Add which kind' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Add which kind' })).toHaveCount(0);
  await createViaStore(page, 'character', { name: 'Ada' });
  await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await expect(square(page, 'Ada')).toBeVisible();
  await page.waitForTimeout(300);
  await pressAcross((await square(page, 'Ada').boundingBox())!);
  await expect(square(page, 'Ada')).toHaveClass(/is-selected/);
  await expect(square(page, 'Hollow Keep')).toHaveClass(/is-target/);
});

// ---- The code gate's findings ----

test('focus: a redraw keeps it on the same control, an empty world\'s ways in under its strand (C9)', async ({ page }) => {
  await setupWorld(page);
  const download = page.locator('[data-role="home-bring-in"] [data-bring-action="download"]');
  await download.focus();
  await expect(download).toBeFocused();
  // An unrelated change redraws the home.
  await patchEntry(page, { notes: 'a note' });
  await expect(download).toBeFocused();
});

test('focus: a press that wrote nothing leaves no ask behind (C3), and a redraw leaves the focus where the person is', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  const ada = await createViaStore(page, 'character', { name: 'Ada' });
  await toPicture(page);
  await select(page, 'Ada');
  await expect(square(page, 'Hollow Keep')).toHaveClass(/is-target/);
  // Placed on disk behind the grid's back: the drop finds the field filled and writes nothing.
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
  // The home redrew (Ada now placed, from disk), and the focus stayed in the search.
  await expect.poll(() => placeOfRow(page, 'Ada')).toBe('1');
  await expect(search).toBeFocused();
});

// ---- Phones ----

for (const [w, h] of [[360, 640], [390, 844]] as const) {
  test(`a ${w} px phone: no sideways scroll, and Home's + square is in view`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setupWorld(page);
    await toPicture(page);
    await expect(plus(page)).toBeInViewport({ ratio: 1 });
    const overflow = await page.evaluate(() => {
      const g = document.querySelector('.atlas-world-home [data-role="home-grid"]') as HTMLElement;
      return { grid: g.scrollWidth - g.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(overflow.grid).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
  });
}

test.describe('on a touch phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('Home\'s grid by taps: make and place with two presses, the squares 44 px or more', async ({ page }) => {
    await setupWorld(page, 'browser');
    await toPicture(page);
    await make(page, 'Ada', 'a character');
    await make(page, 'Hollow Keep', 'a location');
    await square(page, 'Ada').tap();
    await expect(square(page, 'Ada')).toHaveClass(/is-selected/);
    await square(page, 'Hollow Keep').tap();
    await expect(just(page)).toContainText('Ada is in Hollow Keep');
    await expect(square(page, 'Ada')).toHaveAttribute('data-row', '1');
    const sides = await page.locator('[data-role="home-grid"] .atlas-home-grid-square').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    expect(Math.min(...sides)).toBeGreaterThanOrEqual(44);
  });

  /** Each way read on its own (soft), so one run names every one that falls short. */
  const thumbs = (page: Page) => async (sel: string, what: string) => {
    const hs = await page.locator('.atlas-world-home').locator(sel).evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
    expect.soft(hs.length, `${what} drawn`).toBeGreaterThan(0);
    expect.soft(Math.min(...hs), `${what} takes a thumb`).toBeGreaterThanOrEqual(44);
  };

  test('the ways to bring a world in under an empty world\'s strand take a thumb: 44 px or more', async ({ page }) => {
    await setupWorld(page, 'browser');
    // Quiet buttons: the rooms' own touch rule makes them 40 px unless Home's outranks it.
    await thumbs(page)('[data-role="home-bring-in"] [data-bring-action]', 'the ways to bring a world in');
  });

  test('every way in Home\'s grid takes a thumb: the + square, the name box, Undo are 44 px or more', async ({ page }) => {
    await setupWorld(page, 'browser');
    const thumb = thumbs(page);
    await toPicture(page);
    await thumb('[data-grid-plus] .atlas-home-grid-square', 'the + square');
    // The name box, typed in place.
    await plus(page).click();
    await page.getByRole('menuitem', { name: 'a character' }).click();
    await thumb('.atlas-home-grid-make input', 'the name box');
    await page.keyboard.press('Escape');
    // Undo, after a placing.
    await createViaStore(page, 'character', { name: 'Ada' });
    await createViaStore(page, 'location', { name: 'Hollow Keep' });
    await select(page, 'Ada');
    await dropOn(page, 'Hollow Keep', 'Ada is in Hollow Keep');
    await thumb('[data-action="grow-undo"]', 'Undo');
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

test('negatives beside their twins: the store path and the switch earn nothing, a gesture does', async ({ page }) => {
  await setupWorld(page);
  await watchNotes(page);
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

test('the Start-page links: #/start opens straight on a new world\'s Strand; #/bring-in lands in the Data room', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/start');
  await page.waitForSelector('.atlas-shell');
  const dialog = page.locator('[data-modal="create-world"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Create a world');
  // The hash went first: a reload does not ask again.
  expect(await page.evaluate(() => window.location.hash)).toBe('#/');
  // Count every moment a door or the first steps' card is in the page, not just the end state.
  await page.evaluate(() => {
    (window as any).__sawDoors = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-guide-door], [data-role="guide-block"]')) (window as any).__sawDoors++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const rows = dialog.locator('.atlas-where-row input');
  if (await rows.count() > 1) await rows.nth(1).check();
  await page.fill('input[name="world-name"]', 'From the site');
  await dialog.locator('[data-action="pick"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  // Answered on onlyworlds.com: the world's Home on its Strand tab, and no door or card ever drawn.
  await expect(page.locator('[data-role="home-tabs"] [data-tab="strand"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-role="home-strand"] [data-slot]').first()).toBeVisible();
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
