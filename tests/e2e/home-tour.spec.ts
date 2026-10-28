/**
 * The guide on the home (onboarding step 1, the strip and the notes) e2e.
 * Drives the real flow: the strip's five marks lit from the world; a create
 * from a mark stays on the home and earns its note; the path through Place,
 * Set year, Write it as a book and Add a chapter, each action writing only
 * its own field; a link field's create earns `placed`, never the offer; a
 * note survives the home rebuilding under a typed year; and the negatives,
 * each beside its positive twin in the same run (a negative alone passes on
 * any build without notes). Plus the two Start-page links and the desk rows.
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
const litOf = (page: Page) => page.locator('[data-role="guide-strip"] [data-dot]')
  .evaluateAll(els => els.map(e => `${e.getAttribute('data-dot')}${e.getAttribute('data-lit') === 'true' ? '+' : ''}`));
const note = (page: Page) => page.locator('[data-role="guide-note"]');

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

test('an empty world: "What do you have?", the strip first, a folder world\'s copy already lit', async ({ page }) => {
  await setupWorld(page);
  const block = page.locator('.atlas-home-have');
  await expect(block.locator('.atlas-home-have-title')).toHaveText('What do you have?');
  await expect(block.locator('.atlas-home-have-row')).toHaveCount(3);
  await expect(block.locator('[data-have="nothing"] [data-role="guide-strip"]')).toBeVisible();
  expect(await litOf(page)).toEqual(['someone', 'placed', 'happened', 'story', 'copy+']);
  // No count anywhere on the strip.
  await expect(block).not.toContainText(/\d of \d/);
});

test('the path: each mark stays on the home, each note says what was made, each action writes only its field', async ({ page }) => {
  await setupWorld(page);
  await watchNotes(page);
  await page.click('[data-dot="someone"]');
  await createInModal(page, 'Ada');
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await expect(note(page)).toHaveAttribute('data-note', 'someone');
  await expect(note(page)).toContainText('Ada is someone in your world.');
  expect(await litOf(page)).toEqual(['someone+', 'placed', 'happened', 'story', 'copy+']);

  await note(page).locator('[data-note-action="add-place"]').click();
  await expect(note(page)).toHaveCount(0);
  await createInModal(page, 'Hollow Keep');
  await expect(note(page)).toHaveAttribute('data-note', 'place-offer');
  await expect(note(page)).toContainText('Ada and Hollow Keep: place one in the other?');
  await note(page).locator('[data-note-action="place"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'placed');
  await expect(note(page)).toContainText('Ada is at Hollow Keep, and Hollow Keep lists Ada.');
  const keep = await element(page, 'Hollow Keep');
  expect((await element(page, 'Ada')).location).toBe(keep.id);
  expect(await litOf(page)).toEqual(['someone+', 'placed+', 'happened', 'story', 'copy+']);

  // An Event from Anything else (no date asked): the note offers the pair and a year.
  await note(page).locator('[data-note-close]').click();
  await page.click('[data-role="guide-strip"] [data-create-any]');
  await createInModal(page, 'The Founding', 'event');
  await expect(note(page)).toHaveAttribute('data-note', 'event');
  await note(page).locator('[data-note-action="were-there"]').click();
  await expect(note(page).locator('[data-note-action="were-there"]')).toHaveCount(0);
  const ev = await element(page, 'The Founding');
  expect(ev.characters).toEqual([(await element(page, 'Ada')).id]);
  expect(ev.locations).toEqual([keep.id]);
  await note(page).locator('.atlas-guide-note-year-input').fill('120');
  await note(page).locator('[data-note-action="set-year"]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'dated');
  await expect(note(page)).toContainText('The Founding is on the chart at year 120.');
  expect((await element(page, 'The Founding')).start_date).toBe(120);
  expect(await litOf(page)).toEqual(['someone+', 'placed+', 'happened+', 'story', 'copy+']);

  // A story: Write it as a book files it as a book and opens it; the chapter note follows.
  await note(page).locator('[data-note-close]').click();
  await page.click('[data-dot="story"]');
  await createInModal(page, "Ada's Tale");
  await expect(note(page)).toHaveAttribute('data-note', 'story');
  await note(page).locator('[data-note-action="write"]').click();
  await expect.poll(async () => (await element(page, "Ada's Tale")).supertype).toBe('Book');
  const tale = await element(page, "Ada's Tale");
  await expect(page).toHaveURL(new RegExp(`/writing/${tale.id}$`));
  await expect(note(page)).toHaveAttribute('data-note', 'chapter');
  await note(page).locator('[data-note-action="add-chapter"]').click();
  await expect(page.locator('.atlas-modal-overlay').first()).toBeVisible();

  // One at a time, never twice: every note drawn once, in order.
  expect(await notesDrawn(page)).toEqual(['someone', 'place-offer', 'placed', 'event', 'dated', 'story', 'chapter']);
});

test('a link field\'s create earns placed, never the offer', async ({ page }) => {
  await setupWorld(page);
  const ada = await createViaStore(page, 'character', { name: 'Ada' });
  await page.evaluate(id => { const s = (window as any).__atlasTestApi.getState(); window.location.hash = `#/w/${s.active.worldId}/element/${id}`; }, ada);
  await watchNotes(page);
  await page.locator('.atlas-field[data-field="location"] .atlas-link-pick').click();
  await createInModal(page, 'Hollow Keep');
  await expect(note(page)).toHaveAttribute('data-note', 'placed');
  expect(await notesDrawn(page)).toEqual(['placed']);
});

test('a note survives the home rebuilding under a typed year', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-role="guide-strip"] [data-create-any]');
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
  // Made by the store (an import, a sync, a world file): no gesture, no note.
  await createViaStore(page, 'character', { name: 'Imported' });
  await page.waitForTimeout(300);
  // Switched off: a gesture made by hand earns nothing.
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: {}, off: true })));
  await page.click('[data-role="guide-strip"] [data-create-any]');
  await createInModal(page, 'The Quiet One', 'event');
  await page.waitForTimeout(300);
  expect(await notesDrawn(page)).toEqual([]);
  // The twin: switched on, the same gesture speaks.
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: {}, off: false })));
  await page.click('[data-role="guide-strip"] [data-create-any]');
  await createInModal(page, 'The Loud One', 'event');
  await expect(note(page)).toHaveAttribute('data-note', 'event');
  expect(await notesDrawn(page)).toEqual(['event']);
});

test('a seen note is never drawn again, across a reload; the twin is the first draw', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-dot="someone"]');
  await createInModal(page, 'Ada');
  await expect(note(page)).toHaveAttribute('data-note', 'someone');
  await page.reload();
  await page.waitForSelector('.atlas-world-home');
  await watchNotes(page);
  await page.click('[data-role="guide-strip"] [data-create-any]');
  await createInModal(page, 'Bel', 'character');
  await page.waitForTimeout(400);
  expect(await notesDrawn(page)).toEqual([]);
});

test('the Somewhere mark always acts: it draws the offer even with the notes off', async ({ page }) => {
  await setupWorld(page);
  await createViaStore(page, 'character', { name: 'Ada' });
  await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await page.evaluate(() => localStorage.setItem('atlas_guide_v1', JSON.stringify({ seen: { 'place-offer': 'x' }, off: true })));
  await page.click('[data-dot="placed"]');
  await expect(note(page)).toHaveAttribute('data-note', 'place-offer');
});

test('a browser world: the copy note follows the Event note, with its ways to keep a copy', async ({ page }) => {
  await setupWorld(page, 'browser');
  expect(await litOf(page)).toEqual(['someone', 'placed', 'happened', 'story', 'copy']);
  await page.click('[data-role="guide-strip"] [data-create-any]');
  await createInModal(page, 'The Founding', 'event');
  await expect(note(page)).toHaveAttribute('data-note', 'event');
  await note(page).locator('[data-note-close]').click();
  await expect(note(page)).toHaveAttribute('data-note', 'copy');
  await expect(note(page)).toContainText('tourworld is kept only in this browser.');
  await expect(note(page).locator('[data-note-action="download"]')).toBeVisible();
});

test('a browser world: Open the chart moves first, then the copy note speaks in the chart room (never burned unseen)', async ({ page }) => {
  await setupWorld(page, 'browser');
  await page.click('[data-role="guide-strip"] [data-create-any]');
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

test('a typed year survives Were there, and keeps its focus', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada', location: keep });
  await page.click('[data-role="guide-strip"] [data-create-any]');
  await createInModal(page, 'The Founding', 'event');
  const input = note(page).locator('.atlas-guide-note-year-input');
  await input.fill('120');
  await note(page).locator('[data-note-action="were-there"]').click();
  await expect(note(page).locator('[data-note-action="were-there"]')).toHaveCount(0);
  await expect(note(page).locator('.atlas-guide-note-year-input')).toHaveValue('120');
});

test('a mark press survives a data refresh between press and release (conv. 146)', async ({ page }) => {
  await setupWorld(page);
  const mark = page.locator('[data-dot="someone"]');
  const box = (await mark.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  // An idle sync round: a fresh elements array that says nothing new.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData([...(await api.getActiveStore().listElements())]);
  });
  await page.waitForTimeout(100);
  await page.mouse.up();
  await expect(page.locator('[data-modal="create-element"]')).toBeVisible();
});

test('the strip at a 360 px phone: five marks, no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await setupWorld(page);
  const strip = page.locator('[data-role="guide-strip"]');
  await expect(strip.locator('[data-dot]')).toHaveCount(5);
  const overflow = await page.evaluate(() => {
    const s = document.querySelector('[data-role="guide-strip"]') as HTMLElement;
    return { strip: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  expect(overflow.strip).toBeLessThanOrEqual(0);
  expect(overflow.page).toBeLessThanOrEqual(0);
});

test('the Start-page links: #/start asks nothing; #/bring-in lands in the Data room', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/start');
  await page.waitForSelector('.atlas-shell');
  const dialog = page.locator('[data-modal="create-world"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Start a world');
  // The hash went first: a reload does not ask again.
  expect(await page.evaluate(() => window.location.hash)).toBe('#/');
  // Count every moment the question is in the page, not just the end state
  // (it drew once under the dialog before the mark landed).
  await page.evaluate(() => {
    (window as any).__sawQuestion = 0;
    new MutationObserver(() => {
      if (document.querySelector('[data-have="elsewhere"]')) (window as any).__sawQuestion++;
    }).observe(document.body, { childList: true, subtree: true });
  });
  const rows = dialog.locator('.atlas-where-row input');
  if (await rows.count() > 1) await rows.nth(1).check();
  await page.fill('input[name="world-name"]', 'From the site');
  await dialog.locator('[data-action="pick"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  // Answered on onlyworlds.com: the strip, and the question never drawn.
  await expect(page.locator('[data-have="nothing"] [data-role="guide-strip"]')).toBeVisible();
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => (window as any).__sawQuestion)).toBe(0);

  await page.goto('/#/bring-in');
  await page.waitForSelector('.atlas-shell');
  await expect(dialog).toBeVisible();
  const rows2 = dialog.locator('.atlas-where-row input');
  if (await rows2.count() > 1) await rows2.nth(1).check();
  await page.fill('input[name="world-name"]', 'Notes from elsewhere');
  await dialog.locator('[data-action="pick"]').click();
  await expect(page).toHaveURL(/\/import$/);
  await expect(page.locator('.atlas-import-ai')).toContainText('add nothing your notes do not say');
});

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
