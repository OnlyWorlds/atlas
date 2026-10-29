/**
 * A new world's first screen and the guide's path on the home (#964) e2e.
 * Drives the real flow: the two doors and Back; Start from nothing through
 * all five steps by the card alone (each step confirmed with Next, Place and
 * Were there writing only their own fields, the chart and the writing room
 * seen before their Next); the block holding its place from the doors to
 * Done; a step done by hand elsewhere reading done on return; Bring in a file
 * and an empty return. While the path shows no path note draws; once it is
 * done the notes speak again, and their tests run in a world past the path.
 * Each negative stands beside its positive twin in the same run. Plus the
 * Start-page links and the desk rows.
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

/** A world past the path (its last Next pressed): there the notes speak, as they did before the path. */
async function pastThePath(page: Page) {
  await patchEntry(page, { guide_step: 'done' });
}

/** The create dialog as Anything else opens it: it stays on the home (the block is gone past the path). */
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
const card = (page: Page) => page.locator('[data-role="guide-card"]');
const step = (page: Page, verb: string) => card(page).locator(`[data-step-action="${verb}"]`);
const litOf = (page: Page) => page.locator('[data-role="guide-strip"] [data-dot]')
  .evaluateAll(els => els.map(e => `${e.getAttribute('data-dot')}${e.getAttribute('data-lit') === 'true' ? '+' : ''}`));
const note = (page: Page) => page.locator('[data-role="guide-note"]');
const boxOf = async (page: Page) => {
  const b = (await block(page).boundingBox())!;
  return { top: Math.round(b.y), height: Math.round(b.height) };
};

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

// ---- The doors ----

test('an empty world: two doors, Bring in opens in place, Back returns to the doors and to the door it left', async ({ page }) => {
  await setupWorld(page);
  await expect(block(page)).toHaveAttribute('data-state', 'doors');
  await expect(block(page).locator('.atlas-home-have-title')).toHaveText('What do you have?');
  await expect(block(page).locator('[data-guide-door]')).toHaveText([/Start from nothing/, /Bring in a world I have/]);
  // "Just looking" goes: the first screen already offers Moppetopia and the tour.
  await expect(block(page)).not.toContainText('Just looking');
  await expect(block(page).locator('[data-action="guide-back"]')).toHaveCount(0);
  await expect(block(page).locator('[data-action="cards-dismiss"]')).toBeVisible();

  await page.click('[data-guide-door="bring"]');
  await expect(block(page)).toHaveAttribute('data-state', 'bring');
  await expect(block(page).locator('.atlas-home-have-title')).toHaveText('What do you have?');
  await expect(block(page).locator('[data-bring-action]')).toHaveText(['Bring in a file', 'Open a folder', 'Download a world']);
  await expect(block(page).locator('[data-bring-action="file"]')).toBeFocused();
  await page.click('[data-action="guide-back"]');
  await expect(block(page)).toHaveAttribute('data-state', 'doors');
  await expect(block(page).locator('[data-guide-door="bring"]')).toBeFocused();
  // Nothing was written by looking.
  expect((await entryOf(page)).guide_step).toBeUndefined();
});

test('Start from nothing writes the pointer; a reload shows the doors again; the block keeps its place and height', async ({ page }) => {
  await setupWorld(page);
  const doors = await boxOf(page);
  await page.click('[data-guide-door="nothing"]');
  await expect(block(page)).toHaveAttribute('data-state', 'path');
  await expect(block(page).locator('.atlas-home-have-title')).toHaveText('Grow your world');
  await expect(card(page)).toContainText('Start with someone.');
  await expect(step(page, 'create-character')).toBeFocused();
  expect((await entryOf(page)).guide_step).toBe('someone');
  const path = await boxOf(page);
  expect(path.top).toBe(doors.top);
  expect(path.height).toBe(doors.height);
  await page.click('[data-action="guide-back"]');
  await expect(block(page).locator('[data-guide-door="nothing"]')).toBeFocused();
  await page.click('[data-guide-door="nothing"]');
  await page.reload();
  await page.waitForSelector('.atlas-world-home');
  await expect(block(page)).toHaveAttribute('data-state', 'doors');
});

// ---- The path by the card ----

test('the path by the card alone: five steps, each confirmed with Next, the block still, no path note drawn', async ({ page }) => {
  await setupWorld(page);
  await watchNotes(page);
  await page.click('[data-guide-door="nothing"]');
  const start = await boxOf(page);
  const still = async (label: string) => {
    const b = await boxOf(page);
    expect(b.height, label).toBe(start.height);
  };

  await step(page, 'create-character').click();
  await createInModal(page, 'Ada');
  await expect(card(page)).toContainText('Ada is in your world.');
  await expect(step(page, 'next')).toHaveText('Next: Somewhere');
  await expect(step(page, 'next')).toBeFocused();
  // The block is still the same height, though the world now has its first element.
  await still('someone done');
  expect(await litOf(page)).toEqual(['someone+', 'placed', 'happened', 'story', 'copy+']);
  await step(page, 'next').click();

  await expect(card(page)).toContainText('Give them somewhere.');
  await expect(step(page, 'create-location')).toBeFocused();
  await step(page, 'create-location').click();
  await createInModal(page, 'Hollow Keep');
  await expect(card(page)).toContainText('Ada has no place yet. Hollow Keep could be it.');
  await step(page, 'place').click();
  await expect(card(page)).toContainText('Ada is at Hollow Keep.');
  await expect(step(page, 'next')).toBeFocused();
  const keep = await element(page, 'Hollow Keep');
  expect((await element(page, 'Ada')).location).toBe(keep.id);
  await still('placed');
  await step(page, 'next').click();

  await expect(card(page)).toContainText('Something happened in your world. Give it a year.');
  await step(page, 'create-event').click();
  const modal = page.locator('[data-modal="create-element"]');
  await page.fill('input[name="element-name"]', 'The Founding');
  await modal.locator('input[name="element-date"]').fill('120');
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toHaveCount(0);
  await expect(card(page)).toContainText('The Founding happened in year 120. Were Ada and Hollow Keep there?');
  // Were there is offered, never required: the chart stands beside it.
  await expect(step(page, 'open-chart')).toBeVisible();
  await step(page, 'were-there').click();
  await expect(card(page)).toContainText('The Founding is on the chart at year 120.');
  const ev = await element(page, 'The Founding');
  expect(ev.characters).toEqual([(await element(page, 'Ada')).id]);
  expect(ev.locations).toEqual([keep.id]);
  // Lit, but the chart not seen: no Next yet.
  await expect(step(page, 'next')).toHaveCount(0);
  await step(page, 'open-chart').click();
  await expect(page).toHaveURL(/\/timeline/);
  await expect.poll(async () => (await entryOf(page)).guide_visited).toEqual(['happened']);
  await goHome(page);
  await expect(step(page, 'next')).toHaveText('Next: A story');
  await still('happened');
  await step(page, 'next').click();

  await expect(card(page)).toContainText('Tell a story in your world.');
  await step(page, 'create-story').click();
  await createInModal(page, "Ada's Tale");
  // The world's first writing label, so the story is a book in the writing room.
  await expect.poll(async () => (await element(page, "Ada's Tale")).supertype).toBe('Book');
  await expect(card(page)).toContainText("Ada's Tale is a book.");
  await step(page, 'open-writing').click();
  await expect(page).toHaveURL(/\/writing/);
  await expect.poll(async () => (await entryOf(page)).guide_visited).toEqual(['happened', 'story']);
  await goHome(page);
  await still('story');
  // A folder world already has its copy outside the browser: a step lit before it is reached is
  // skipped (§5 1), so A story's Next is the last and reads Done. (The browser world's copy step: below.)
  await expect(step(page, 'next')).toHaveText('Done');
  await step(page, 'next').click();

  // Done: the block goes, never dismissed (the reading and lens notes keep speaking).
  await expect(block(page)).toHaveCount(0);
  const entry = await entryOf(page);
  expect(entry.guide_step).toBe('done');
  expect(entry.tour_dismissed ?? []).not.toContain('home-cards');
  // One voice: the card said every step; only the reward (not a path note) may have spoken.
  expect((await notesDrawn(page)).filter(n => n !== 'reading')).toEqual([]);
});

test('a step done by hand elsewhere reads done on the card when the person comes back', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="nothing"]');
  await step(page, 'create-character').click();
  await createInModal(page, 'Ada');
  await step(page, 'next').click();
  await watchNotes(page);
  const ada = (await element(page, 'Ada')).id;
  await page.evaluate(id => { const s = (window as any).__atlasTestApi.getState(); window.location.hash = `#/w/${s.active.worldId}/element/${id}`; }, ada);
  await page.locator('.atlas-field[data-field="location"] .atlas-link-pick').click();
  await createInModal(page, 'Hollow Keep');
  await page.waitForTimeout(300);
  // The placed note stays silent while the path shows, in the element page too.
  expect((await notesDrawn(page)).filter(n => n !== 'reading')).toEqual([]);
  await goHome(page);
  await expect(card(page)).toContainText('Ada is at Hollow Keep.');
  await expect(step(page, 'next')).toHaveText('Next: Something happened');
});

test('Something happened with no dates in the world: the year starts empty and is the person\'s to type', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="nothing"]');
  await patchEntry(page, { guide_step: 'happened' });
  await step(page, 'create-event').click();
  const modal = page.locator('[data-modal="create-element"]');
  const year = modal.locator('input[name="element-date"]');
  await expect(year).toHaveValue('');
  await expect(year).toHaveAttribute('placeholder', /year/);
  await page.fill('input[name="element-name"]', 'The Founding');
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toContainText('Type a date first');
  await year.fill('7');
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toBeHidden();
  expect(await litOf(page)).toContain('happened+');
});

test('a stale tab never moves the pointer back: Next writes the later of stored and computed', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="nothing"]');
  await step(page, 'create-character').click();
  await createInModal(page, 'Ada');
  await expect(step(page, 'next')).toBeVisible();
  // Another tab moved on to A story while this one still shows Someone's Next: stored only, no storage event here.
  await page.evaluate(() => {
    const key = 'atlas_worlds_registry';
    const reg = JSON.parse(localStorage.getItem(key)!);
    const id = (window as any).__atlasTestApi.getState().active.worldId;
    reg.worlds = reg.worlds.map((w: any) => (w.id === id ? { ...w, guide_step: 'story' } : w));
    localStorage.setItem(key, JSON.stringify(reg));
  });
  await step(page, 'next').click();
  expect((await entryOf(page)).guide_step).toBe('story');
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_worlds_registry')!).worlds[0].guide_step);
  expect(stored).toBe('story');
});

test('Bring in a file, then back with nothing brought in: the block opens on Start from nothing', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="bring"]');
  await page.click('[data-bring-action="file"]');
  await expect(page).toHaveURL(/\/import$/);
  await goHome(page);
  await expect(block(page)).toHaveAttribute('data-state', 'path');
  await expect(card(page)).toContainText('Start with someone.');
  await expect(block(page).locator('[data-action="guide-back"]')).toBeVisible();
  await expect.poll(async () => (await entryOf(page)).guide_step).toBe('someone');
});

test('a world never on the path (an older or imported one): the first unlit step, and a press on its card holds it for Next', async ({ page }) => {
  await setupWorld(page);
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  await createViaStore(page, 'character', { name: 'Ada' });
  await expect(card(page)).toContainText('Ada has no place yet. Hollow Keep could be it.');
  expect((await entryOf(page)).guide_step).toBeUndefined();
  await step(page, 'place').click();
  await expect(card(page)).toContainText('Ada is at Hollow Keep.');
  expect((await element(page, 'Ada')).location).toBe(keep);
  expect((await entryOf(page)).guide_step).toBe('placed');
  // Its twin: with every dot lit and no pointer, no block at all.
  await patchEntry(page, { guide_step: undefined });
  await createViaStore(page, 'event', { name: 'The Founding', start_date: 1 });
  await createViaStore(page, 'narrative', { name: 'Tale', supertype: 'Book' });
  await expect(block(page)).toHaveCount(0);
});

test('a card press survives a data refresh between press and release (conv. 146)', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="nothing"]');
  const btn = step(page, 'create-character');
  const box = (await btn.boundingBox())!;
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

test('a browser world: the copy step carries the keep-safe ways', async ({ page }) => {
  await setupWorld(page, 'browser');
  await page.click('[data-guide-door="nothing"]');
  expect(await litOf(page)).toEqual(['someone', 'placed', 'happened', 'story', 'copy']);
  await patchEntry(page, { guide_step: 'copy' });
  await createViaStore(page, 'character', { name: 'Ada' });
  await expect(card(page)).toContainText('tourworld is kept only in this browser.');
  await expect(step(page, 'download')).toBeVisible();
  await expect(step(page, 'online')).toBeVisible();
});

// ---- The code gate's findings ----

test('a browser world worth keeping, mid-path: the keep-safe card draws below the block, and waits only at the copy step (C2)', async ({ page }) => {
  await setupWorld(page, 'browser');
  await page.click('[data-guide-door="nothing"]');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    for (let i = 0; i < 26; i++) await store.createElement('character', { name: `C${i}` });
    api.patchData(await store.listElements());
  });
  await expect(card(page)).toContainText('is in your world.');
  const keep = page.locator('.atlas-home-keepsafe');
  await expect(keep).toBeVisible();
  // Below the block: the block never moves for it.
  const [b, k] = [(await block(page).boundingBox())!, (await keep.boundingBox())!];
  expect(k.y).toBeGreaterThan(b.y + b.height - 1);
  // Its twin: at the copy step the card carries the same ways, and the keep-safe card waits.
  await patchEntry(page, { guide_step: 'copy' });
  await expect(card(page)).toContainText('is kept only in this browser.');
  await expect(keep).toHaveCount(0);
});

test('a browser world exported as JSON is not "kept only in this browser": its copy step reads done (C7)', async ({ page }) => {
  await setupWorld(page, 'browser');
  await page.click('[data-guide-door="nothing"]');
  await createViaStore(page, 'character', { name: 'Ada' });
  await patchEntry(page, { guide_step: 'copy', kept_export_at: new Date().toISOString() });
  await expect(card(page)).toContainText('tourworld has a copy outside this browser.');
  await expect(step(page, 'next')).toHaveText('Done');
});

test('Something happened with an Event already made and no year: the card leads to it first (C6)', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="nothing"]');
  const ev = await createViaStore(page, 'event', { name: 'The Siege' });
  await patchEntry(page, { guide_step: 'happened' });
  await expect(card(page).locator('[data-step-action]')).toHaveText(['Open The Siege', 'Create an Event']);
  await step(page, 'open-event').click();
  await expect(page).toHaveURL(new RegExp(`/element/${ev}$`));
});

test('focus: a redraw keeps it on the same control (C9); a press that wrote nothing leaves no ask behind (C3)', async ({ page }) => {
  await setupWorld(page);
  await page.click('[data-guide-door="bring"]');
  await block(page).locator('[data-bring-action="download"]').focus();
  // An unrelated change redraws the home.
  await patchEntry(page, { notes: 'a note' });
  await expect(block(page).locator('[data-bring-action="download"]')).toBeFocused();

  await page.click('[data-action="guide-back"]');
  await page.click('[data-guide-door="nothing"]');
  const keep = await createViaStore(page, 'location', { name: 'Hollow Keep' });
  const ada = await createViaStore(page, 'character', { name: 'Ada' });
  await patchEntry(page, { guide_step: 'placed' });
  await expect(step(page, 'place')).toBeVisible();
  // Placed on disk behind the card's back: Place finds the field filled and writes nothing.
  await page.evaluate(async ({ ada, keep }) => {
    await (window as any).__atlasTestApi.getActiveStore().updateElement(ada, { location: keep });
  }, { ada, keep });
  await step(page, 'place').click();
  await page.waitForTimeout(200);
  // Typing elsewhere, then the home redraws: the focus stays where the person is.
  const search = page.locator('.atlas-search-row input').first();
  await search.focus();
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    api.patchData(await api.getActiveStore().listElements());
  });
  await expect(card(page)).toContainText('Ada is at Hollow Keep.');
  await expect(search).toBeFocused();
});

// ---- Phones ----

for (const [w, h] of [[360, 640], [390, 844]] as const) {
  test(`a ${w} px phone: no sideways scroll, and the card's button is in view after Start from nothing`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await setupWorld(page);
    await page.click('[data-guide-door="nothing"]');
    await expect(step(page, 'create-character')).toBeInViewport({ ratio: 1 });
    await expect(page.locator('[data-role="guide-strip"] [data-dot]')).toHaveCount(5);
    const overflow = await page.evaluate(() => {
      const s = document.querySelector('[data-role="guide-strip"]') as HTMLElement;
      return { strip: s.scrollWidth - s.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    expect(overflow.strip).toBeLessThanOrEqual(0);
    expect(overflow.page).toBeLessThanOrEqual(0);
  });
}

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
  await page.click('[data-guide-door="nothing"]');
  await watchNotes(page);
  // While the path shows: a gesture made by hand earns no path note.
  await page.click('[data-role="guide-strip"] [data-create-any]');
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

test('the Start-page links: #/start opens straight on the path, the doors never drawn; #/bring-in lands in the Data room', async ({ page }) => {
  await freshBoot(page);
  await page.goto('/#/start');
  await page.waitForSelector('.atlas-shell');
  const dialog = page.locator('[data-modal="create-world"]');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Create a world');
  // The hash went first: a reload does not ask again.
  expect(await page.evaluate(() => window.location.hash)).toBe('#/');
  // Count every moment the doors are in the page, not just the end state.
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
  // Answered on onlyworlds.com: the path at its first step, no Back, and the doors never drawn.
  await expect(card(page)).toContainText('Start with someone.');
  await expect(block(page).locator('[data-action="guide-back"]')).toHaveCount(0);
  await expect.poll(async () => (await entryOf(page)).guide_step).toBe('someone');
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
