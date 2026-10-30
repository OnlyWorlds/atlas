/**
 * Onboarding step 2 (the guide's reward and the world's picture) e2e.
 * The reward, See <name>'s world, speaks once, on the note of the gesture that
 * took a Character's web to two, and opens the right pane's Web on her; at a
 * phone's width the Web's drawer opens after the page settles and the copy
 * note waits until it closes. Past the grid's hand-over (a small world's
 * picture is its grid: home-grows.spec.ts), Home's picture is the Web, small,
 * centred on the best-linked element of a world built without a gesture: no note speaks
 * there, a press on the centre opens the Web, and rebuilds leave one graph.
 * Each negative stands beside its positive twin.
 */

import { test, expect, Page } from '@playwright/test';

const DEMO_WORLD_ID = '0695db52-5433-7332-8000-db7fe10da375';

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
    const sub = await root.getDirectoryHandle('reading-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  const dialog = page.locator('[data-modal="create-world"]');
  if (where === 'browser') await dialog.locator('input[name="where"][value="browser"]').check();
  await page.fill('input[name="world-name"]', 'readingworld');
  await dialog.locator('[data-action="pick"]').click();
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
const note = (page: Page) => page.locator('[data-role="guide-note"]');
const seeWorld = (page: Page) => note(page).locator('[data-note-action="see-world"]');
const webNodes = (page: Page) => page.locator('.atlas-right-pane .atlas-context-pane-graph [data-element-id]');
const pictureNodes = (page: Page) => page.locator('[data-role="home-picture"] [data-element-id]');
const liveGraphs = (page: Page): Promise<number> => page.evaluate(async () => {
  const { contextGraphLiveCount } = await import('/src/tabs/right/context-pane-graph.ts');
  return contextGraphLiveCount();
});
const seenNotes = (page: Page): Promise<string[]> => page.evaluate(async () => {
  const { loadGuideState } = await import('/src/core/guide.ts');
  return Object.keys(loadGuideState().seen).sort();
});

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

/** The open world's registry entry patched; `guide_step: 'done'` is a world past the guide's path, where the notes speak (#964). */
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
const pastThePath = (page: Page) => patchEntry(page, { guide_step: 'done' });

/** The create dialog as Anything else opens it (any width, no sidebar). */
async function openCreate(page: Page) {
  await page.evaluate(async () => {
    const { ElementCreateModal } = await import('/src/ui/element-create-modal.ts');
    const { toastManager } = await import('/src/ui/toast-manager.ts');
    new ElementCreateModal(toastManager, { suppressNavigate: true }).open();
  });
}

/** Past the path: Ada, Hollow Keep, and Ada placed there, each by hand; the placed note left showing. */
async function adaPlaced(page: Page) {
  await pastThePath(page);
  await openCreate(page);
  await createInModal(page, 'Ada', 'character');
  await expect(note(page)).toHaveAttribute('data-note', 'someone');
  await note(page).locator('[data-note-action="add-place"]').click();
  await createInModal(page, 'Hollow Keep');
  await note(page).locator('[data-note-action="place"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'placed');
  // Placing lit the second dot, with nothing yet dated: no reward.
  await expect(seeWorld(page)).toHaveCount(0);
}

/** A square of the home's grid by its element's name. */
const square = (page: Page, name: string) =>
  page.locator('[data-grid-id]').filter({ has: page.locator('.atlas-home-grid-name', { hasText: new RegExp(`^${name}$`) }) });

/** The card's + square: a name typed in place, Enter keeps. */
async function makeFromPlus(page: Page, name: string) {
  await page.locator('[data-role="guide-block"] [data-grid-plus]').click();
  await page.locator('.atlas-home-grid-make input').first().fill(name);
  await page.keyboard.press('Enter');
  await expect(square(page, name)).toHaveCount(1);
}

test('on the path, by the grid: placing Ada gives her web, and the reward speaks alone (#964\'s G4)', async ({ page }) => {
  await setupWorld(page);
  await watchNotes(page);
  await makeFromPlus(page, 'Ada');
  await makeFromPlus(page, 'Hollow Keep');
  // The Founding, dated and naming Ada, arrives from elsewhere (a world file): Ada's web is one.
  const adaId = (await element(page, 'Ada')).id;
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 120, characters: [adaId] });
  await expect(page.locator('[data-role="guide-block"]')).toHaveAttribute('data-step', 'placed');
  // Made and dated, but no web of two yet, and no path note on the way.
  await expect(note(page)).toHaveCount(0);
  // The placing by two presses is the gesture that takes Ada's web to two.
  await expect(async () => {
    if (!/is-selected/.test((await square(page, 'Ada').getAttribute('class')) ?? '')) await square(page, 'Ada').click();
    await expect(square(page, 'Ada')).toHaveClass(/is-selected/, { timeout: 1000 });
  }).toPass();
  await square(page, 'Hollow Keep').click();
  await expect(page.locator('[data-role="grow-just"]')).toContainText('Ada is in Hollow Keep');
  await expect(note(page)).toHaveAttribute('data-note', 'reading');
  await expect(note(page)).toContainText('Ada, Hollow Keep and The Founding are linked now.');
  await expect(seeWorld(page)).toHaveText("See Ada's world");
  expect(await notesDrawn(page)).toEqual(['reading']);
  const ada = await element(page, 'Ada');
  await seeWorld(page).click();
  await expect(page).toHaveURL(new RegExp(`/element/${ada.id}$`));
  await expect(webNodes(page)).toHaveCount(3);
});

test('past the path: the reward speaks once, on the year that made Ada\'s web, and opens the Web on her', async ({ page }) => {
  await setupWorld(page);
  await watchNotes(page);
  await adaPlaced(page);

  // New Event from the sidebar, with the placed note still up: the create moves to the Event's page,
  // and the note left on Home gives way to the Event's (the contract gate's H3).
  await page.click('[data-action="create-element"]');
  await createInModal(page, 'The Founding', 'event');
  await expect(note(page)).toHaveAttribute('data-note', 'event');
  await note(page).locator('[data-note-action="were-there"]').click();
  await expect(note(page).locator('[data-note-action="were-there"]')).toHaveCount(0);
  // Were there linked Ada to a second thing, but nothing is dated yet: no reward.
  await expect(seeWorld(page)).toHaveCount(0);

  await note(page).locator('.atlas-guide-note-year-input').fill('120');
  await note(page).locator('[data-note-action="set-year"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'dated');
  await expect(note(page)).toContainText('The Founding is on the chart at year 120.');
  await expect(seeWorld(page)).toHaveText("See Ada's world");
  await expect(note(page).locator('button.atlas-guide-note-act')).toHaveCount(2);
  expect(await seenNotes(page)).toContain('reading');
  expect(await notesDrawn(page)).toEqual(['someone', 'place-offer', 'placed', 'event', 'dated']);

  // Its press: Ada's page, the Web in front, holding Ada's ring.
  const ada = await element(page, 'Ada');
  const keep = await element(page, 'Hollow Keep');
  const ev = await element(page, 'The Founding');
  await seeWorld(page).click();
  await expect(page).toHaveURL(new RegExp(`/element/${ada.id}$`));
  await expect(page.locator('.atlas-tab.active[data-tab-kind="context"]')).toBeVisible();
  await expect(webNodes(page)).toHaveCount(3);
  const ids = await webNodes(page).evaluateAll(els => els.map(e => (e as HTMLElement).dataset.elementId).sort());
  expect(ids).toEqual([ada.id, keep.id, ev.id].sort());
  await expect(page.locator(`.atlas-right-pane .atlas-context-graph-node.is-center[data-element-id="${ada.id}"]`)).toHaveCount(1);
  await expect(note(page)).toHaveCount(0);
  // The world on disk is as it was: the press wrote nothing.
  expect((await element(page, 'Ada')).location).toBe(keep.id);
});

test('a browser that has seen the reward: the same path draws the year\'s note without it', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: { reading: '2026-10-29T00:00:00.000Z' }, off: false })));
  await adaPlaced(page);
  await note(page).locator('[data-note-close]').click();
  await openCreate(page);
  await createInModal(page, 'The Founding', 'event');
  await note(page).locator('[data-note-action="were-there"]').click();
  await note(page).locator('.atlas-guide-note-year-input').fill('120');
  await note(page).locator('[data-note-action="set-year"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'dated');
  await expect(seeWorld(page)).toHaveCount(0);
});

test('the year\'s own note seen before: the reward speaks alone, naming what is linked', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: { dated: '2026-10-29T00:00:00.000Z' }, off: false })));
  await adaPlaced(page);
  await note(page).locator('[data-note-close]').click();
  await openCreate(page);
  await createInModal(page, 'The Founding', 'event');
  await note(page).locator('[data-note-action="were-there"]').click();
  await note(page).locator('.atlas-guide-note-year-input').fill('120');
  await note(page).locator('[data-note-action="set-year"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'reading');
  await expect(note(page)).toContainText('Ada, Hollow Keep and The Founding are linked now.');
  await expect(seeWorld(page)).toHaveText("See Ada's world");
});

test('at a phone\'s width: the Web\'s drawer opens once the page settles, and the copy note waits for it to close', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setupWorld(page, 'browser');
  await adaPlaced(page);
  await note(page).locator('[data-note-close]').click();
  await openCreate(page);
  await createInModal(page, 'The Founding', 'event');
  await note(page).locator('[data-note-action="were-there"]').click();
  await note(page).locator('.atlas-guide-note-year-input').fill('120');
  await note(page).locator('[data-note-action="set-year"]').click();
  await expect(seeWorld(page)).toBeVisible();
  await seeWorld(page).click();
  const ada = await element(page, 'Ada');
  await expect(page).toHaveURL(new RegExp(`/element/${ada.id}$`));
  await expect(page.locator('body.atlas-drawer-right-open')).toHaveCount(1);
  await page.waitForTimeout(600);
  await expect(page.locator('body.atlas-drawer-right-open')).toHaveCount(1);
  await expect(webNodes(page)).toHaveCount(3);
  // The copy note was due (a browser world, an Event made): it waits under the drawer.
  await expect(note(page)).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('body.atlas-drawer-right-open')).toHaveCount(0);
  await expect(note(page)).toHaveAttribute('data-note', 'copy');
});

/** A world built by the store (as an import or a world file brings it): Hollow Keep holds three. */
async function builtWorld(page: Page) {
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  for (const name of ['Ada', 'Bram', 'Cole']) await createViaStore(page, 'character', { name, location: keep });
  await createViaStore(page, 'location', { name: 'Lonely Hill' });
  return keep;
}

/**
 * Fifty loose Objects: a world past the grid's hand-over (the home that grows draws a small
 * world as its grid; past about 640 px of grid, or 48 elements, Home's picture is the Web's).
 */
async function pastTheGrid(page: Page) {
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    for (let i = 0; i < 50; i++) await store.createElement('object', { name: `Trinket ${i}` });
    api.patchData(await store.listElements());
  });
}

test('a world brought in whole: Home\'s picture, no note; its centre opens the Web; rebuilds keep one graph', async ({ page }) => {
  await setupWorld(page);
  const keep = await builtWorld(page);
  await pastTheGrid(page);
  await goHome(page);
  const picture = page.locator('[data-role="home-picture"]');
  await expect(picture).toBeVisible();
  await expect(picture.locator('.atlas-home-picture-title')).toHaveText('Hollow Keep and what it touches');
  await expect(pictureNodes(page)).toHaveCount(4);
  await expect(note(page)).toHaveCount(0);
  expect(await liveGraphs(page)).toBe(1);

  // Three rebuilds of Home (what the world says moved each time): one live graph after them.
  for (const d of ['one', 'two', 'three']) {
    await page.evaluate(async ({ id, d }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.updateElement(id, { description: d });
      api.patchData(await store.listElements());
    }, { id: keep, d });
    await expect(picture).toBeVisible();
  }
  expect(await liveGraphs(page)).toBe(1);

  // A press on the centre opens the Web on it.
  await picture.locator(`.atlas-context-graph-node.is-center[data-element-id="${keep}"]`).click();
  await expect(page).toHaveURL(new RegExp(`/element/${keep}$`));
  await expect(page.locator('.atlas-tab.active[data-tab-kind="context"]')).toBeVisible();
  await expect(webNodes(page)).toHaveCount(4);
  // Home's graph went with Home.
  expect(await liveGraphs(page)).toBe(1);
});

test('a world with nothing worth drawing has no picture, and its twin with a third link does', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  for (const name of ['Ada', 'Bram']) await createViaStore(page, 'character', { name, location: keep });
  await pastTheGrid(page);
  await goHome(page);
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await expect(page.locator('[data-role="home-picture"]')).toHaveCount(0);
  await createViaStore(page, 'character', { name: 'Cole', location: keep });
  await expect(page.locator('[data-role="home-picture"]')).toBeVisible();
});

test('Moppetopia: a create by hand speaks no note, and Home shows the picture', async ({ page }) => {
  await setupWorld(page);
  await builtWorld(page);
  await pastTheGrid(page);
  await pastThePath(page);
  // The open world is Moppetopia by its world id, as its copy carries it.
  await page.evaluate(async (demoId) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const a = getState().active!;
    patchSlice('active', { ...a, meta: { ...a.meta, id: demoId } });
  }, DEMO_WORLD_ID);
  await goHome(page);
  await expect(page.locator('[data-role="home-picture"]')).toBeVisible();
  await page.click('[data-action="create-element"]');
  // An Event made by hand earns its note in any other world (the twin below).
  await createInModal(page, 'A Moppet Feast', 'event');
  await page.waitForTimeout(400);
  await expect(note(page)).toHaveCount(0);
  expect(await seenNotes(page)).toEqual([]);
});

test('the twin: the same Event made by hand in a world that is not Moppetopia speaks its note', async ({ page }) => {
  await setupWorld(page);
  await builtWorld(page);
  await pastThePath(page);
  await goHome(page);
  await page.click('[data-action="create-element"]');
  await createInModal(page, 'A Moppet Feast', 'event');
  await expect(note(page)).toHaveAttribute('data-note', 'event');
});
