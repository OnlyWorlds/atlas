/**
 * The strand as a journey (Atlas 1.120.0): an empty world's Home is the strand alone, asking one
 * question at a time. The journey from an empty world to whole, each field read back from disk, in
 * Chromium, Firefox and at a phone's width; text typed surviving a pull and a redraw; Skip for now and
 * Add; Edit writing only what changed; the ⋯ menu's Use another; Escape writing nothing; an established
 * world's first Home unchanged; the writing room frame's Pick on Home. Since 1.121.0 the journey asks
 * the story, its main character, what happens to them, where, and where they are now; the Event card puts
 * the main character into its Event, and the whole strand draws as before on the Strand tab and Picture.
 */
import { test, expect, type Page } from '@playwright/test';

const AT = '2026-10-31T00:00:00.000Z';
const N1 = '0192a000-0000-7000-8000-000000900001';
const E1 = '0192a000-0000-7000-8000-000000900011';
const L1 = '0192a000-0000-7000-8000-000000900021';
const L2 = '0192a000-0000-7000-8000-000000900022';
const C1 = '0192a000-0000-7000-8000-000000900031';
const C2 = '0192a000-0000-7000-8000-000000900032';
const GONE_L = '0192a000-0000-7000-8000-0000009000e2';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

/** A new browser world, on its Home. */
async function setupWorld(page: Page, name = 'Ember Hollow'): Promise<string> {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('strand-journey-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  const dialog = page.locator('[data-modal="create-world"]');
  await page.locator('input[name="world-name"]').waitFor();
  // Firefox has no folder mode, so its dialog draws no choice: a browser world is the only kind there.
  const where = dialog.locator('input[name="where"][value="browser"]');
  if (await where.count()) await where.check();
  await page.fill('input[name="world-name"]', name);
  await dialog.locator('[data-action="pick"]').click();
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return !!s.active?.worldId && !s.data.loading;
  });
  const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
  await go(page, `#/w/${wid}/home`);
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  return wid;
}

const go = (page: Page, hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);

/** Home opened again: another room, then back. */
async function reopenHome(page: Page, wid: string): Promise<void> {
  await go(page, `#/w/${wid}/settings`);
  await expect(page.locator('.atlas-world-home')).toHaveCount(0);
  await go(page, `#/w/${wid}`);
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

async function put(page: Page, type: string, id: string, name: string, extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(async ({ type, id, name, extra, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim(type, { id, type, name, local_updated_at: at, ...extra });
    api.patchData(await store.listElements());
  }, { type, id, name, extra, at: AT });
}

async function setMark(page: Page, mark: unknown): Promise<void> {
  await page.evaluate(async (m) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().writeWorldMeta({ x_strand: m });
    const { getState, patchActiveMeta } = await import('/src/core/state.ts');
    patchActiveMeta(getState().active!.worldId, { x_strand: m } as never);
  }, mark);
}

async function patchEntry(page: Page, patch: Record<string, unknown>): Promise<void> {
  await page.evaluate(async (p) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const s = getState();
    const next = (reg as any).updateWorldEntry(s.registry, s.active!.worldId, p);
    (reg as any).saveRegistry(next);
    patchSlice('registry', next);
  }, patch);
}

async function markOnDisk(page: Page): Promise<unknown> {
  return page.evaluate(async () => ((await (window as any).__atlasTestApi.getActiveStore().readWorldMeta()).x_strand ?? null));
}
async function onDisk(page: Page, id: string): Promise<Record<string, unknown>> {
  return page.evaluate(async (i) => (await (window as any).__atlasTestApi.getActiveStore().listElements()).find((e: any) => e.id === i) ?? {}, id);
}
async function idByName(page: Page, name: string): Promise<string> {
  return page.evaluate(async (n) => (await (window as any).__atlasTestApi.getActiveStore().listElements()).find((e: any) => e.name === n)?.id ?? '', name);
}
async function count(page: Page): Promise<number> {
  return page.evaluate(async () => (await (window as any).__atlasTestApi.getActiveStore().listElements()).length);
}

const head = (page: Page) => page.locator('[data-role="home-tabs"]');
const tab = (page: Page, t: 'picture' | 'strand') => page.locator(`[data-role="home-tabs"] [data-tab="${t}"]`);
const card = (page: Page) => page.locator('[data-role="strand-card"][data-mode="make"]');
const cardTitle = (page: Page) => card(page).locator('.atlas-home-strand-card-title > span:last-child');
const field = (page: Page, f: 'name' | 'text' | 'when') => card(page).locator(`[data-field="${f}"]`);
const box = (page: Page, slot: string) => page.locator(`[data-role="home-strand"] [data-box="${slot}"]`);
const boxName = (page: Page, slot: string) => box(page, slot).locator('.atlas-home-strand-name');
const cell = (page: Page, slot: string) => page.locator(`[data-role="home-strand"] [data-slot="${slot}"]`);
const said = (page: Page) => page.locator('[data-role="strand-say"]');
/** Edit here, from the box's menu (1.122.0: the box draws no row of buttons). */
async function editHere(page: Page, slot: string): Promise<void> {
  await box(page, slot).locator('[data-act="more"]').click();
  await box(page, slot).locator('.atlas-home-strand-menu [data-act="edit"]').click();
}
/** The line above a filled box (1.122.0): its words, without the ×. */
const line = (page: Page, slot: string) => cell(page, slot).locator('[data-role="strand-line"] .atlas-home-strand-line-text');
/** A make card's field label, by the field it names. */
const fieldLabel = (page: Page, f: 'name' | 'text' | 'when') => card(page).locator('.atlas-home-strand-field').filter({ has: page.locator(`[data-field="${f}"]`) }).locator('label');

/** The asked card, answered: name, text and When typed, then Make (Enter in Name, or the button). */
async function answer(page: Page, slot: string, values: { name: string; text?: string; when?: string }, by: 'enter' | 'press' = 'press'): Promise<void> {
  await expect(card(page)).toHaveAttribute('data-card-slot', slot);
  await field(page, 'name').fill(values.name);
  if (values.text) await field(page, 'text').fill(values.text);
  if (values.when) await field(page, 'when').fill(values.when);
  if (by === 'enter') await field(page, 'name').press('Enter');
  else await card(page).locator('[data-act="make"]').click();
  await expect(boxName(page, slot)).toHaveText(values.name);
}

/** The journey from an empty world to whole, every field read back from disk. */
async function journey(page: Page, still = false): Promise<string> {
  const wid = await setupWorld(page);
  // G1: no tab head, no Pick where nothing can be picked; the story's card and the ways in.
  await expect(head(page)).toHaveCount(0);
  await expect(cardTitle(page)).toHaveText('Start with a story');
  await expect(card(page).locator('[data-act="pick"]')).toHaveCount(0);
  await expect(card(page).locator('[data-act="skip"]')).toHaveCount(0);
  await expect(page.locator('[data-role="home-bring-in"]')).toContainText('Already have a world file or notes?');

  await answer(page, 'narrative', { name: 'The Lantern Ferry', text: 'Every night a ferry crosses the black lake.\nThe ferryman never asks why.' }, 'enter');
  const story = await idByName(page, 'The Lantern Ferry');
  expect(await markOnDisk(page)).toEqual({ narrative: story, event: null, location: null });
  expect((await onDisk(page, story)).story).toBe('Every night a ferry crosses the black lake.\nThe ferryman never asks why.');
  expect('description' in (await onDisk(page, story))).toBe(false);
  // The focus goes to the next question's Name: who the story is about (1.121.0: before what happens).
  await expect(field(page, 'name')).toBeFocused();
  await expect(cardTitle(page)).toHaveText('Who is the story about?');
  await expect(card(page).locator('.atlas-home-strand-card-what')).toHaveText('Characters drive your stories: start with its main character.');
  await expect(card(page).locator('[data-act="make"]')).toHaveText('Create');
  // 1.122.0: the story's line above its box, in the world's tier names.
  await expect(line(page, 'narrative')).toHaveText('In the writing room you can shape it into chapters and scenes.');
  await expect(fieldLabel(page, 'when')).toHaveText('Born');

  await answer(page, 'character', { name: 'Odile Varn', text: 'A cartographer who paid in maps.', when: '1119' });
  const odile = await idByName(page, 'Odile Varn');
  expect((await onDisk(page, story)).protagonist).toBe(odile);
  // G9: Born written to birth_date in the one create; the box says it on a line of its own.
  expect(await onDisk(page, odile)).toMatchObject({ description: 'A cartographer who paid in maps.', birth_date: 1119 });
  await expect(box(page, 'character').locator('[data-role="strand-box-date"]')).toHaveText('Born 1119');
  await expect(line(page, 'character')).toHaveText('Their page holds everything about them.');
  expect(await markOnDisk(page)).toEqual({ narrative: story, event: null, location: null });
  await expect(field(page, 'name')).toBeFocused();
  await expect(cardTitle(page)).toHaveText('What happens in The Lantern Ferry?');
  await expect(card(page).locator('.atlas-home-strand-card-what')).toHaveText('Events are happenings of any size, each a part of a larger story.');
  await expect(fieldLabel(page, 'when')).toHaveText('When');

  await answer(page, 'event', { name: 'The night crossing', text: 'A storm closed the lake.', when: '1142' });
  const event = await idByName(page, 'The night crossing');
  expect(await onDisk(page, event)).toMatchObject({ description: 'A storm closed the lake.', start_date: 1142 });
  expect((await onDisk(page, story)).events).toEqual([event]);
  expect(await markOnDisk(page)).toEqual({ narrative: story, event, location: null });
  // W2: the Event card writes no character into the Event.
  expect((await onDisk(page, event)).characters).toBeUndefined();
  // Dated as the timeline reads it: the line says where its year puts it, Charts its link (the amendment's A1).
  await expect(line(page, 'event')).toHaveText('Its year puts it on the timeline in Charts.');
  await expect(cardTitle(page)).toHaveText('Where did The night crossing happen?');
  await expect(card(page).locator('.atlas-home-strand-card-what')).toHaveText('Locations are where your stories happen.');
  await expect(fieldLabel(page, 'when')).toHaveText('Founded');
  // The asked card has no join words (its question says them); the box will, between its line and itself.
  await expect(cell(page, 'location').locator('[data-role="strand-join"]')).toHaveCount(0);

  await answer(page, 'location', { name: 'Saltmere Quay', text: 'The stone landing on the far shore.', when: '1102' });
  const quay = await idByName(page, 'Saltmere Quay');
  expect((await onDisk(page, event)).locations).toEqual([quay]);
  expect(await markOnDisk(page)).toEqual({ narrative: story, event, location: quay });
  expect(await onDisk(page, quay)).toMatchObject({ description: 'The stone landing on the far shore.', founding_date: 1102 });
  await expect(box(page, 'location').locator('[data-role="strand-box-date"]')).toHaveText('Founded 1102');
  await expect(cell(page, 'location').locator('[data-role="strand-join"]')).toHaveText('happened in or at');
  // No map in the world: the location's line asks for one.
  await expect(line(page, 'location')).toHaveText('Create a map to pin it in place.');

  await expect(cardTitle(page)).toHaveText('Where is Odile Varn now?');
  await expect(card(page).locator('.atlas-home-strand-card-what')).toHaveText('The night crossing may be long past; Odile Varn is still somewhere.');
  await expect(card(page).locator('[data-act="same"]')).toHaveText('Still at Saltmere Quay');
  // The question's other answer comes before the form, so Create reads as making the new place.
  await expect(card(page).locator('[data-role="strand-card-else"]')).toHaveText('Or somewhere else:');
  const lines = box(page, 'narrative').locator('[data-role="strand-lines"] p');
  await expect(lines.nth(0)).toHaveText(/It tells of .*The night crossing, which happened in or at .*Saltmere Quay\./);
  if (still) {
    // Still at: where they are now is where it happened, so "still" (G5: the strand's `same` alone).
    await card(page).locator('[data-act="same"]').click();
    await expect(cell(page, 'now').locator('[data-role="strand-same"] p')).toHaveText('is still in or at Saltmere Quay');
    expect((await onDisk(page, odile)).location).toBe(quay);
    await expect(lines.nth(1)).toHaveText(/Its main character is .*Odile Varn, still in or at .*Saltmere Quay\./);
    // No box was written: the focus goes to the whole line.
    await expect(page.locator('[data-role="strand-whole"]')).toBeFocused();
  } else {
    await answer(page, 'now', { name: 'The Drowned Library' });
    expect((await onDisk(page, odile)).location).toBe(await idByName(page, 'The Drowned Library'));
    // Where they are now has no line (the amendment's A1).
    await expect(cell(page, 'now').locator('[data-role="strand-line"]')).toHaveCount(0);
    // Every line in the journey's order, top to bottom as drawn, and each one's link.
    await expect(page.locator('[data-role="home-strand"] [data-role="strand-line"] .atlas-home-strand-line-text')).toHaveText([
      'In the writing room you can shape it into chapters and scenes.', 'Its year puts it on the timeline in Charts.', 'Create a map to pin it in place.',
      'Their page holds everything about them.',
    ]);
    await expect(page.locator('[data-role="home-strand"] [data-role="strand-line"] [data-line-link]')).toHaveText([
      'the writing room', 'Charts', 'Create a map', 'Their page',
    ]);
    await expect(lines.nth(1)).toHaveText(/Its main character is .*Odile Varn, now in or at .*The Drowned Library\./);
    // Nothing more to ask: the focus goes to the box written.
    await expect(boxName(page, 'now')).toBeFocused();
  }
  // 1.122.0's amendment, A2: no box draws a row of buttons; each ⋯ holds Edit here, the room door, Use another.
  await expect(page.locator('[data-role="home-strand"] .atlas-home-strand-box-acts')).toHaveCount(0);
  await expect(box(page, 'event').locator('.atlas-home-strand-menu > button')).toHaveText(['Edit here', 'Edit in Charts', 'Use another event']);
  await expect(box(page, 'narrative').locator('.atlas-home-strand-menu > button')).toHaveText(['Edit here', 'Edit in the writing room', 'Open its page', 'Use another story']);
  await expect(box(page, 'character').locator('.atlas-home-strand-menu > button')).toHaveText(['Edit here', 'Use another character']);
  // Whole, and still no head in this visit.
  await expect(page.locator('[data-role="strand-whole"]')).toContainText('The Lantern Ferry is whole.');
  await expect(head(page)).toHaveCount(0);
  // The whole strand's links: the story names its main character; the Event lists no one (W2).
  expect((await onDisk(page, story)).protagonist).toBe(odile);
  expect((await onDisk(page, event)).characters).toBeUndefined();
  return wid;
}

/** A square's place on Home's Picture. */
async function squareAt(page: Page, id: string): Promise<{ line: string | null; pos: string | null; row: string | null }> {
  const c = page.locator(`[data-role="home-grid"] [data-grid-id="${id}"]`);
  await expect(c).toBeVisible();
  return { line: await c.getAttribute('data-line'), pos: await c.getAttribute('data-pos'), row: await c.getAttribute('data-row') };
}

for (const tag of ['', ' @firefox']) {
  test(`the journey from an empty world to whole, each field read back from disk; the head at Home's next opening${tag}`, async ({ page }) => {
    const wid = await journey(page);
    await reopenHome(page, wid);
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    // The Strand tab draws the five boxes in their places, whatever order they were asked in.
    for (const [slot, name] of [['narrative', 'The Lantern Ferry'], ['event', 'The night crossing'], ['location', 'Saltmere Quay'], ['character', 'Odile Varn'], ['now', 'The Drowned Library']]) {
      await expect(boxName(page, slot)).toHaveText(name);
    }
    const lines = box(page, 'narrative').locator('[data-role="strand-lines"] p:not([aria-hidden])');
    await expect(lines).toHaveText([/It tells of .*The night crossing, which happened in or at .*Saltmere Quay\./, /Its main character is .*Odile Varn, now in or at .*The Drowned Library\./]);
    // And the Picture: the story, its event and place, its main character and where they are now in their cells.
    await tab(page, 'picture').click();
    expect(await squareAt(page, await idByName(page, 'The Lantern Ferry'))).toEqual({ line: '0', pos: '0', row: '0' });
    expect(await squareAt(page, await idByName(page, 'The night crossing'))).toEqual({ line: '0', pos: '0', row: '1' });
    expect(await squareAt(page, await idByName(page, 'Saltmere Quay'))).toEqual({ line: '0', pos: '1', row: '1' });
    expect(await squareAt(page, await idByName(page, 'Odile Varn'))).toEqual({ line: '0', pos: '0', row: '2' });
    expect(await squareAt(page, await idByName(page, 'The Drowned Library'))).toEqual({ line: '0', pos: '1', row: '2' });
    // story-event, event-place, story-character, character-now: four lines, one each (W2: no event-character link made).
    await expect(page.locator('[data-role="home-grid"] .atlas-home-grid-lines path')).toHaveCount(4);
  });

  test(`text typed in a card survives a pull while focused, and a redraw after it left${tag}`, async ({ page }) => {
    await setupWorld(page);
    await answer(page, 'narrative', { name: 'The Lantern Ferry' });
    // The card asked next is the main character's (1.121.0).
    await expect(card(page)).toHaveAttribute('data-card-slot', 'character');
    await field(page, 'name').fill('Odile Varn');
    await field(page, 'text').fill('A cartographer who paid');
    await expect(field(page, 'text')).toBeFocused();
    // A pull lands mid-typing: an element made through the store.
    await createViaStore(page, 'character', { name: 'Bystander' });
    await page.waitForTimeout(300);
    await field(page, 'text').pressSequentially(' in maps.');
    await expect(field(page, 'text')).toHaveValue('A cartographer who paid in maps.');
    await expect(field(page, 'name')).toHaveValue('Odile Varn');
    // The focus leaves the card; the next pull redraws Home, and the card comes back from memory.
    await page.locator('[data-role="home-strand"] [data-box="narrative"] .atlas-home-strand-box-head').click();
    await createViaStore(page, 'location', { name: 'Somewhere' });
    await expect(field(page, 'text')).toHaveValue('A cartographer who paid in maps.');
    await expect(field(page, 'name')).toHaveValue('Odile Varn');
    expect(await idByName(page, 'Odile Varn')).toBe('');
  });

  test(`Escape writes nothing: the card empties, the focus stays in Name, Home stays${tag}`, async ({ page }) => {
    await setupWorld(page);
    const before = await count(page);
    await field(page, 'name').fill('Unsent');
    await field(page, 'text').fill('Never written.');
    await field(page, 'text').press('Escape');
    await expect(field(page, 'name')).toHaveValue('');
    await expect(field(page, 'text')).toHaveValue('');
    await expect(field(page, 'name')).toBeFocused();
    await expect(page.locator('.atlas-world-home')).toBeVisible();
    expect(await count(page)).toBe(before);
    expect(await markOnDisk(page)).toBeNull();
  });
}

test('Skip for now and Add: the event asked without a main character, the main character brought back and put in it', async ({ page }) => {
  await setupWorld(page);
  await answer(page, 'narrative', { name: 'The Lantern Ferry' });
  await expect(card(page)).toHaveAttribute('data-card-slot', 'character');
  await card(page).locator('[data-act="skip"]').click();
  // No main character: the Event asks what happens in the story.
  await expect(cardTitle(page)).toHaveText('What happens in The Lantern Ferry?');
  await expect(card(page).locator('.atlas-home-strand-card-what')).toHaveText('Events are happenings of any size, each a part of a larger story.');
  await expect(field(page, 'name')).toBeFocused();
  await expect(cell(page, 'character').locator('[data-act="add"]')).toHaveText('Add character');
  await answer(page, 'event', { name: 'The night crossing' });
  const story = await idByName(page, 'The Lantern Ferry');
  const event = await idByName(page, 'The night crossing');
  expect((await onDisk(page, story)).events).toEqual([event]);
  // An Event made with no main character writes no characters.
  expect((await onDisk(page, event)).characters ?? null).toBeNull();
  await expect(cardTitle(page)).toHaveText('Where did The night crossing happen?');
  await cell(page, 'character').locator('[data-act="add"]').click();
  await expect(card(page)).toHaveAttribute('data-card-slot', 'character');
  await expect(field(page, 'name')).toBeFocused();
  await expect(cardTitle(page)).toHaveText('Who is the story about?');
  await answer(page, 'character', { name: 'Mira' });
  const mira = await idByName(page, 'Mira');
  expect((await onDisk(page, story)).protagonist).toBe(mira);
  // W2: the Character card made after the event leaves the Event as it was.
  expect((await onDisk(page, event)).characters ?? null).toBeNull();
  // Where it happened is still to come: no place, so where they are now is asked plainly after it.
  await expect(card(page)).toHaveAttribute('data-card-slot', 'location');
});

/** A world with a strand set and room around it, past its first opening. */
async function seeded(page: Page, mark: unknown, storyExtra: Record<string, unknown> = {}): Promise<string> {
  const wid = await setupWorld(page);
  await put(page, 'narrative', N1, 'The Long Road', { supertype: 'Book', events: [E1], ...storyExtra });
  await put(page, 'event', E1, 'The Fire', { locations: [L1], characters: [], description: 'Smoke over the hills.', start_date: 40 });
  await put(page, 'location', L1, 'The Harbour');
  await put(page, 'location', L2, 'The Lighthouse');
  await put(page, 'character', C1, 'Mira');
  await put(page, 'character', C2, 'Ilse');
  await setMark(page, mark);
  await page.evaluate(async () => { ((await import('/src/middle/home-strand.ts')) as any).resetStrandTabForTests(); });
  await reopenHome(page, wid);
  return wid;
}

test('Edit writes only the fields changed; a change meanwhile writes nothing and is said', async ({ page }) => {
  await seeded(page, { narrative: N1, event: E1, location: L1 });
  await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
  await editHere(page, 'event');
  const edit = page.locator('[data-role="strand-card"][data-mode="edit"]');
  await expect(edit.locator('[data-field="name"]')).toBeFocused();
  await expect(edit.locator('[data-field="when"]')).toHaveValue('40');
  await edit.locator('[data-field="name"]').fill('The Great Fire');
  await edit.locator('[data-act="save"]').click();
  await expect(boxName(page, 'event')).toHaveText('The Great Fire');
  await expect(boxName(page, 'event')).toBeFocused();
  expect(await onDisk(page, E1)).toMatchObject({ name: 'The Great Fire', description: 'Smoke over the hills.', start_date: 40 });

  await editHere(page, 'event');
  await edit.locator('[data-field="text"]').fill('Mine.');
  // Another tab or pane writes the description meanwhile.
  await page.evaluate(async (id) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(id, { description: 'Theirs.' });
  }, E1);
  await edit.locator('[data-act="save"]').click();
  await expect(said(page)).toHaveText('The Great Fire changed meanwhile. What you typed is kept: Save again to write it.');
  expect((await onDisk(page, E1)).description).toBe('Theirs.');
  await expect(edit.locator('[data-field="text"]')).toHaveValue('Mine.');
  // The second Save is a knowing choice: it writes (the code gate's C4).
  await edit.locator('[data-act="save"]').click();
  await expect(edit).toHaveCount(0);
  expect((await onDisk(page, E1)).description).toBe('Mine.');

  // Escape on an Edit: back to the box, the focus on Edit, nothing written.
  await editHere(page, 'event');
  await edit.locator('[data-field="text"]').fill('Never saved.');
  await edit.locator('[data-field="text"]').press('Escape');
  await expect(edit).toHaveCount(0);
  // Edit here sits in the closed menu: the focus on the menu's button (1.122.0).
  await expect(box(page, 'event').locator('[data-act="more"]')).toBeFocused();
  expect((await onDisk(page, E1)).description).toBe('Mine.');
});

test('C1 and C2: a reopened Edit takes a change made meanwhile; a typed name never crosses to the next main character', async ({ page }) => {
  await seeded(page, { narrative: N1, event: E1, location: L1 }, { protagonist: C1 });
  const edit = page.locator('[data-role="strand-card"][data-mode="edit"]');
  // C1: a name typed on the Event, another box's Edit opened and cancelled, the description changed elsewhere.
  await editHere(page, 'event');
  await edit.locator('[data-field="name"]').fill('The Great Fire');
  await editHere(page, 'character');
  await edit.locator('[data-act="cancel"]').click();
  await page.evaluate(async (id) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(id, { description: 'Ash everywhere.' });
    api.patchData(await api.getActiveStore().listElements());
  }, E1);
  await editHere(page, 'event');
  await expect(edit.locator('[data-field="text"]')).toHaveValue('Ash everywhere.');
  await edit.locator('[data-act="save"]').click();
  await expect(edit).toHaveCount(0);
  expect(await onDisk(page, E1)).toMatchObject({ name: 'The Great Fire', description: 'Ash everywhere.' });

  // C2: a name typed on Mira; the story's main character becomes Ilse elsewhere.
  await editHere(page, 'character');
  await edit.locator('[data-field="name"]').fill('Mira the Bold');
  await editHere(page, 'event');
  await edit.locator('[data-act="cancel"]').click();
  await page.evaluate(async ({ n, c }) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(n, { protagonist: c });
    api.patchData(await api.getActiveStore().listElements());
  }, { n: N1, c: C2 });
  await expect(boxName(page, 'character')).toHaveText('Ilse');
  await editHere(page, 'character');
  await expect(edit.locator('[data-field="name"]')).toHaveValue('Ilse');
  await edit.locator('[data-act="save"]').click();
  await expect(edit).toHaveCount(0);
  expect((await onDisk(page, C2)).name).toBe('Ilse');
  expect((await onDisk(page, C1)).name).toBe('Mira');
});

test('C3: a view-only world\'s pull takes its strand, and the head stays for the visit', async ({ page }) => {
  const wid = await seeded(page, { narrative: N1, event: E1, location: L1 });
  await patchEntry(page, { copy_of: { world_id: 'elsewhere' } });
  await reopenHome(page, wid);
  await expect(head(page)).toBeVisible();
  await expect(page.locator('[data-role="strand-read-only"]')).toBeVisible();
  // A pull takes the mark away.
  await page.evaluate(async () => {
    const { getState, patchActiveMeta } = await import('/src/core/state.ts');
    patchActiveMeta(getState().active!.worldId, { x_strand: undefined } as never);
  });
  await page.waitForTimeout(300);
  await expect(head(page)).toBeVisible();
  // Home's next opening reads afresh: nothing to show here, the picture alone.
  await reopenHome(page, wid);
  await expect(head(page)).toHaveCount(0);
});

test('the ⋯ menu\'s Use another: the promise first, the second press writes, the Event untouched', async ({ page }) => {
  await seeded(page, { narrative: N1, event: E1, location: L1 }, { protagonist: C1 });
  const more = box(page, 'character').locator('[data-act="more"]');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  // Escape closes the menu, the focus back on ⋯.
  await page.keyboard.press('Escape');
  await expect(more).toHaveAttribute('aria-expanded', 'false');
  await expect(more).toBeFocused();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  await more.click();
  await box(page, 'character').getByRole('button', { name: 'Use another character' }).click();
  await box(page, 'character').locator('[data-act="pick"]').click();
  await box(page, 'character').locator('[data-role="strand-filter"]').fill('Ilse');
  await box(page, 'character').locator('[role="option"]', { hasText: 'Ilse' }).click();
  await expect(box(page, 'character').locator('[data-role="strand-promise"]')).toHaveText('Ilse will be the main character in place of Mira.');
  expect((await onDisk(page, N1)).protagonist).toBe(C1);
  await box(page, 'character').locator('[data-act="confirm"]').click();
  await expect(boxName(page, 'character')).toHaveText('Ilse');
  expect((await onDisk(page, N1)).protagonist).toBe(C2);
  expect((await onDisk(page, E1)).characters).toEqual([]);
});

test('an established world\'s first Home is as before: the head, the Picture tab, its picture', async ({ page }) => {
  const wid = await setupWorld(page);
  await put(page, 'character', C1, 'Mira');
  await put(page, 'location', L1, 'The Harbour');
  await put(page, 'event', E1, 'The Fire');
  await page.evaluate(async () => { ((await import('/src/middle/home-strand.ts')) as any).resetStrandTabForTests(); });
  await reopenHome(page, wid);
  await expect(head(page)).toBeVisible();
  await expect(tab(page, 'picture')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#atlas-home-tabpanel [data-role="home-grow-picture"], #atlas-home-tabpanel [data-role="home-picture"]')).toHaveCount(1);
  await expect(page.locator('[data-role="home-strand"]')).toHaveCount(0);
  // Strand pressed: the story's card, nothing written.
  await tab(page, 'strand').click();
  await expect(cardTitle(page)).toHaveText('Start with a story');
  await expect(card(page).locator('[data-act="pick"]')).toHaveCount(0);
  expect(await markOnDisk(page)).toBeNull();
});

test('the writing room frame\'s Pick on Home asks for that part, its Name focused', async ({ page }) => {
  const wid = await seeded(page, { narrative: N1, event: E1, location: GONE_L });
  await patchEntry(page, { writing_initialized: true });
  await go(page, `#/w/${wid}/writing/${N1}`);
  await page.locator('.atlas-tab[data-tab-kind="context"]').click();
  const frame = page.locator('[data-role="strand-frame"]');
  await expect(frame.locator('[data-slot="character"] [data-action="strand-pick-on-home"]')).toHaveText('Pick on Home');
  await frame.locator('[data-slot="location"] [data-action="strand-pick-on-home"]').click();
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  // The main character would be asked first (1.121.0); the frame asked for where it happened.
  await expect(card(page)).toHaveAttribute('data-card-slot', 'location');
  await expect(field(page, 'name')).toBeFocused();
  await expect(cardTitle(page)).toHaveText('Where did The Fire happen?');
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the journey at 390: one column, no empty gaps, nothing sideways, every target a thumb', async ({ page }) => {
    await journey(page, true);
    const fits = await page.evaluate(() => {
      const grid = document.querySelector('.atlas-home-strand-grid')!.getBoundingClientRect();
      const cells = [...document.querySelectorAll<HTMLElement>('.atlas-home-strand-cell')].map(c => c.getBoundingClientRect());
      return {
        scroll: document.documentElement.scrollWidth, width: window.innerWidth, gridRight: grid.right,
        oneColumn: cells.every(r => Math.abs(r.left - grid.left) < 2),
      };
    });
    expect(fits.scroll).toBeLessThanOrEqual(fits.width);
    expect(fits.gridRight).toBeLessThanOrEqual(fits.width);
    expect(fits.oneColumn).toBe(true);
    // 1.122.0: the lines' × and links too (Promise 7), a thumb by padding while the line keeps its text height.
    const targets = page.locator('[data-role="home-strand"]').locator('.atlas-home-strand-act, .atlas-home-strand-name, .atlas-home-strand-chip, .atlas-home-strand-whole-link, .atlas-home-strand-line-x');
    const heights = await targets.evaluateAll(els => els.filter(e => (e as HTMLElement).offsetParent !== null).map(e => Math.round(e.getBoundingClientRect().height)));
    expect(heights.length).toBeGreaterThan(10);
    expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
  });

  test('C6: the same line\'s ⋯ menu stays on screen at 390 with a long place name', async ({ page }) => {
    const wid = await seeded(page, { narrative: N1, event: E1, location: L1 }, { protagonist: C1 });
    await page.evaluate(async ({ l1, c1 }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.updateElement(l1, { name: 'The Long Harbour Under the Seven Grey Lighthouses of Saltmere' });
      await store.updateElement(c1, { location: l1 });
      api.patchData(await store.listElements());
    }, { l1: L1, c1: C1 });
    await reopenHome(page, wid);
    const more = cell(page, 'now').locator('[data-act="more"]');
    await more.click();
    const menu = cell(page, 'now').locator('.atlas-home-strand-menu');
    await expect(menu).toBeVisible();
    const r = await menu.evaluate(el => { const b = el.getBoundingClientRect(); return { left: b.left, right: b.right, w: window.innerWidth }; });
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeLessThanOrEqual(r.w);
    await expect(menu.getByRole('button', { name: 'Use another location' })).toBeVisible();
  });

  test('an asked card at 390: the empty cells take no space, the fields and acts a thumb', async ({ page }) => {
    await setupWorld(page);
    await answer(page, 'narrative', { name: 'The Lantern Ferry' });
    const empty = await page.locator('.atlas-home-strand-cell.is-empty').evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
    expect(empty.length).toBeGreaterThan(0);
    expect(Math.max(...empty)).toBe(0);
    for (const t of [field(page, 'name'), card(page).locator('[data-act="make"]'), card(page).locator('[data-act="skip"]')]) {
      expect(Math.round((await t.boundingBox())!.height)).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  });
});

test('a whole strand in a small browser world asks for a copy, though its story has no text; four of five do not', async ({ page }) => {
  await setupWorld(page, 'Quiet Ferry');
  const ids = { n: '00000000-0000-4000-8000-0000000000a1', e: '00000000-0000-4000-8000-0000000000a2', l: '00000000-0000-4000-8000-0000000000a3', c: '00000000-0000-4000-8000-0000000000a4', now: '00000000-0000-4000-8000-0000000000a5' };
  const keepsafe = page.locator('[data-role="keepsafe"]');
  await put(page, 'location', ids.l, 'Saltmere Quay');
  await put(page, 'location', ids.now, 'The Drowned Library');
  await put(page, 'event', ids.e, 'The night crossing', { locations: [ids.l] });
  await put(page, 'narrative', ids.n, 'The Lantern Ferry', { events: [ids.e] });
  await put(page, 'character', ids.c, 'Odile Varn', { location: ids.now });
  await setMark(page, { narrative: ids.n, event: ids.e, location: ids.l });
  // Four of five: the story names no main character yet. Five elements, no text, no map: nothing asks.
  await expect(page.locator('[data-role="home-strand"]')).toBeVisible();
  await expect(keepsafe).toHaveCount(0);
  // The story's main character, already somewhere: the strand is whole, and the copy is asked.
  await page.evaluate(async ({ n, c }) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(n, { protagonist: c });
    api.patchData(await api.getActiveStore().listElements());
  }, { n: ids.n, c: ids.c });
  await expect(boxName(page, 'character')).toHaveText('Odile Varn');
  await expect(boxName(page, 'now')).toHaveText('The Drowned Library');
  await expect(boxName(page, 'event')).toHaveText('The night crossing');
  await expect(boxName(page, 'location')).toHaveText('Saltmere Quay');
  await expect(keepsafe).toBeVisible();
  await expect(keepsafe).toContainText('This world lives only in this browser');
});
