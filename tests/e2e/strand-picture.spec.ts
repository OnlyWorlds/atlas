/**
 * The strand's picture and the strand's rooms (Atlas 1.121.0). A whole strand on Home's Picture: its five
 * squares at their fixed cells (read by data-line, data-pos, data-row), and no drawn line passing through
 * any square (its own two ends aside) or any name, sampled along each SVG path with getPointAtLength
 * against the squares' and names' boxes, at 1440 and 390, in Chromium and Firefox; the same with four more
 * elements (a Character standing in the strand's place, another Event in the story, a Location holding a
 * Creature, the story and its event naming the Location too). A Zone's Location's Character two deep beside
 * the lines that climb to the block, at 390 and 1440 (the code gate's C1), and a whole strand at a 20 px
 * root font (C2). Each box's doors (1.122.0: the room that edits it, in the box's menu) and the lines'
 * links (the writing room, their page, Charts, the map) land where they say and Back puts the focus on
 * them, or on the menu that holds a door, in both engines and on a phone, where the map opens in its
 * drawer (C3); the story's and the character's lines go once their room was opened. The story's box keeps
 * its second line's room, so the Event make moves nothing (W5). G2 (1.122.0): no filled box moves when a
 * line goes or changes its words (its x, a date saved in Edit here or arriving from elsewhere, a pin) or a
 * map is made, at 1440 and 390. A switch between Picture and Strand keeps Home's scroll, both ways, and
 * (1.122.1) so does every redraw on the same world (a pull on either tab, a line's ×, the last make far
 * down); a tab reached by the keyboard half out of view comes into view; another world lands at the top.
 *
 * Screenshots for a look: ATLAS_SNAPS=<dir> writes each Picture there.
 */
import { test, expect, type Page } from '@playwright/test';
import moppetopiaKeel from '../fixtures/moppetopia-keel.json';

const AT = '2026-11-02T00:00:00.000Z';
const S = '0192a000-0000-7000-8000-000000950001';
const E = '0192a000-0000-7000-8000-000000950002';
const L = '0192a000-0000-7000-8000-000000950003';
const C = '0192a000-0000-7000-8000-000000950004';
const N = '0192a000-0000-7000-8000-000000950005';
const BRAM = '0192a000-0000-7000-8000-000000950011';
const THAW = '0192a000-0000-7000-8000-000000950012';
const MARSH = '0192a000-0000-7000-8000-000000950013';
const HEN = '0192a000-0000-7000-8000-000000950014';
const MAP = '0192a000-0000-7000-8000-000000950021';
const SNAPS = process.env.ATLAS_SNAPS;

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

const go = (page: Page, hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);

/** A new browser world, on its Home. */
async function setupWorld(page: Page, name = 'Ember Hollow'): Promise<string> {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('strand-picture-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  const dialog = page.locator('[data-modal="create-world"]');
  await page.locator('input[name="world-name"]').waitFor();
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

async function reopenHome(page: Page, wid: string): Promise<void> {
  await go(page, `#/w/${wid}/settings`);
  await expect(page.locator('.atlas-world-home')).toHaveCount(0);
  await go(page, `#/w/${wid}`);
  await expect(page.locator('.atlas-world-home')).toBeVisible();
}

/** A whole strand, written as the journey writes it; `rest` adds four elements after it; `names` renames its five; `story` adds to the story; `noNow` leaves where they are now unasked (its card the last). */
async function wholeStrand(page: Page, opts: { rest?: boolean; map?: boolean; names?: string[]; story?: Record<string, unknown>; event?: Record<string, unknown>; noNow?: boolean } = {}): Promise<string> {
  const wid = await setupWorld(page);
  const [sName, eName, lName, cName, nName] = opts.names ?? ['The Lantern Ferry', 'The night crossing', 'Saltmere Quay', 'Odile Varn', 'The Drowned Library'];
  await put(page, 'narrative', S, sName, {
    supertype: 'Book', story: 'Every night a ferry crosses the black lake.', events: opts.rest ? [E, THAW] : [E], protagonist: C,
    // The marsh is a place in the story and in its event too: at 390 it wraps to line 1, so these two lines
    // climb to the block (the channel into the story's right side, the left gutter into the event's).
    ...(opts.rest ? { locations: [MARSH] } : {}),
    ...opts.story,
  });
  // An Event that lists the main character: a world made before 1.122.0 keeps the link, and the Picture draws it.
  await put(page, 'event', E, eName, { locations: opts.rest ? [L, MARSH] : [L], characters: [C], start_date: 1142, ...opts.event });
  await put(page, 'location', L, lName);
  await put(page, 'character', C, cName, opts.noNow ? {} : { location: N });
  if (!opts.noNow) await put(page, 'location', N, nName);
  if (opts.rest) {
    await put(page, 'character', BRAM, 'Bram the ferryman', { location: L });
    await put(page, 'event', THAW, 'The thaw', { start_date: 1143 });
    await put(page, 'location', MARSH, 'Greywater Marsh');
    await put(page, 'creature', HEN, 'Marsh hen', { location: MARSH });
  }
  if (opts.map) await put(page, 'map', MAP, 'The Coast');
  await setMark(page, { narrative: S, event: E, location: L });
  await reopenHome(page, wid);
  return wid;
}

const tab = (page: Page, t: 'picture' | 'strand') => page.locator(`[data-role="home-tabs"] [data-tab="${t}"]`);
const square = (page: Page, id: string) => page.locator(`[data-role="home-grid"] [data-grid-id="${id}"]`);

async function cellOf(page: Page, id: string): Promise<{ line: string | null; pos: string | null; row: string | null }> {
  const c = square(page, id);
  return { line: await c.getAttribute('data-line'), pos: await c.getAttribute('data-pos'), row: await c.getAttribute('data-row') };
}

/** Every drawn line, sampled each pixel along its path, against every square (its own ends aside) and every name. */
async function crossings(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const host = document.querySelector('[data-role="home-grid"] .atlas-home-grid')!;
    const svg = host.querySelector<SVGSVGElement>('.atlas-home-grid-lines')!;
    const origin = svg.getBoundingClientRect();
    type Box = { id: string; kind: string; r: DOMRect };
    const boxes: Box[] = [];
    for (const cell of host.querySelectorAll<HTMLElement>('.atlas-home-grid-cell')) {
      const id = cell.getAttribute('data-grid-id') ?? 'plus';
      const sq = cell.querySelector('.atlas-home-grid-square');
      const nm = cell.querySelector('.atlas-home-grid-name');
      if (sq) boxes.push({ id, kind: 'square', r: sq.getBoundingClientRect() });
      if (nm) boxes.push({ id, kind: 'name', r: nm.getBoundingClientRect() });
    }
    const out: string[] = [];
    for (const p of svg.querySelectorAll<SVGPathElement>('path')) {
      const ends = (p.getAttribute('data-ends') ?? '').split(' ');
      const len = p.getTotalLength();
      const hit = new Set<string>();
      for (let s = 0; s <= len; s += 1) {
        const pt = p.getPointAtLength(s);
        const x = origin.left + pt.x;
        const y = origin.top + pt.y;
        for (const b of boxes) {
          if (b.kind === 'square' && ends.includes(b.id)) continue;
          if (x > b.r.left + 0.5 && x < b.r.right - 0.5 && y > b.r.top + 0.5 && y < b.r.bottom - 0.5) hit.add(`${b.kind} of ${b.id}`);
        }
      }
      for (const h of hit) out.push(`${ends.join(' to ')} crosses the ${h}`);
    }
    return out;
  });
}

/** The Picture with the card's padding around it, where the gutter and the lanes run. */
async function snap(page: Page, path: string): Promise<void> {
  await page.mouse.move(0, 0);
  const b = (await page.locator('[data-role="home-grid"]').boundingBox())!;
  await page.screenshot({ path, clip: { x: Math.max(0, b.x - 24), y: Math.max(0, b.y - 24), width: b.width + 48, height: b.height + 48 } });
}

const lineCount = (page: Page) => page.locator('[data-role="home-grid"] .atlas-home-grid-lines path').count();

for (const tag of ['', ' @firefox']) {
  for (const width of [1440, 390]) {
    test(`a whole strand on the Picture: its squares at their cells, no line through a square or a name, at ${width}${tag}`, async ({ page, browserName }) => {
      await page.setViewportSize({ width, height: 900 });
      await wholeStrand(page);
      await tab(page, 'picture').click();
      await expect(square(page, S)).toBeVisible();
      expect(await cellOf(page, S)).toEqual({ line: '0', pos: '0', row: '0' });
      expect(await cellOf(page, E)).toEqual({ line: '0', pos: '0', row: '1' });
      expect(await cellOf(page, L)).toEqual({ line: '0', pos: '1', row: '1' });
      expect(await cellOf(page, C)).toEqual({ line: '0', pos: '0', row: '2' });
      expect(await cellOf(page, N)).toEqual({ line: '0', pos: '1', row: '2' });
      // The + flows from pos 2 of line 0.
      await expect(page.locator('[data-role="home-grid"] [data-grid-plus]')).toBeVisible();
      // story-event, event-place, story-character, character-now, event-character: five lines, one each.
      expect(await lineCount(page)).toBe(5);
      expect(await crossings(page)).toEqual([]);
      if (SNAPS) await snap(page, `${SNAPS}/strand-picture-${width}-${browserName}.png`);
    });

    test(`a whole strand and four more: the rest beside and below, holds across the block's edge drawn as lines, none through a square or a name, at ${width}${tag}`, async ({ page, browserName }) => {
      await page.setViewportSize({ width, height: 900 });
      await wholeStrand(page, { rest: true });
      await tab(page, 'picture').click();
      await expect(square(page, BRAM)).toBeVisible();
      expect(await cellOf(page, S)).toEqual({ line: '0', pos: '0', row: '0' });
      expect(await cellOf(page, BRAM)).toEqual({ line: '0', pos: '2', row: '0' });
      // The hen stands under its marsh, wherever the marsh wrapped to.
      const marsh = await cellOf(page, MARSH);
      expect(await cellOf(page, HEN)).toEqual({ ...marsh, row: '1' });
      // Bram in the strand's place, and the story's other event: lines to the block, not stacks.
      const ends = await page.locator('[data-role="home-grid"] .atlas-home-grid-lines path').evaluateAll(ps => ps.map(p => p.getAttribute('data-ends')));
      expect(ends).toContainEqual(`${BRAM} ${L}`);
      expect(ends).toContainEqual(`${S} ${THAW}`);
      expect(ends).toContainEqual(`${MARSH} ${HEN}`);
      expect(ends).toContainEqual(`${S} ${MARSH}`);
      expect(ends).toContainEqual(`${E} ${MARSH}`);
      if (width === 390) expect((await cellOf(page, MARSH)).line).toBe('1');
      expect(await crossings(page)).toEqual([]);
      if (SNAPS) await snap(page, `${SNAPS}/strand-picture-rest-${width}-${browserName}.png`);
    });
  }

  // The code gate's C1: a depth-two square used to stand over its column's right edge, where the channel
  // and a held square's side climb run. The ids arrive in the order written (one millisecond, then by id).
  test(`a Zone's Location's Character two deep under the channel's line: the line to the block passes clear, at 390${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    const wid = await wholeStrand(page);
    const id = (n: number) => `0192a000-0000-7000-8000-0000009500${n}`;
    await put(page, 'object', id(41), 'Lantern');
    await put(page, 'object', id(42), 'Oar');
    await put(page, 'object', id(43), 'Ledger');
    await put(page, 'zone', id(44), 'The Lowtown');
    await put(page, 'location', id(45), 'Fishers Ward', { zone: id(44) });
    await put(page, 'character', id(46), 'Night guard Tamsin', { location: id(45) });
    await put(page, 'character', id(47), 'Bram the ferryman', { location: L });
    await reopenHome(page, wid);
    await tab(page, 'picture').click();
    await expect(square(page, id(47))).toBeVisible();
    expect(await cellOf(page, id(46))).toEqual({ line: '1', pos: '1', row: '2' });
    expect(await cellOf(page, id(47))).toEqual({ line: '2', pos: '0', row: '0' });
    expect(await crossings(page)).toEqual([]);
    if (SNAPS) await snap(page, `${SNAPS}/strand-picture-deep-390${tag ? '-firefox' : ''}.png`);
  });

  test(`a Character two deep beside a held one that climbs by its side to the story: clear, at 1440${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const id = (n: number) => `0192a000-0000-7000-8000-0000009500${n}`;
    const wid = await wholeStrand(page, { story: { characters: [id(54)] } });
    await put(page, 'location', id(51), 'Fishers Ward', { zone: id(57) });
    await put(page, 'character', id(52), 'Night guard Tamsin', { location: id(51) });
    await put(page, 'character', id(53), 'Old Wim', { location: id(58) });
    await put(page, 'character', id(54), 'Ysolde', { location: id(58) });
    await put(page, 'object', id(55), 'Lantern');
    await put(page, 'object', id(56), 'Oar');
    await put(page, 'zone', id(57), 'The Lowtown');
    await put(page, 'location', id(58), 'The Inn');
    await reopenHome(page, wid);
    await tab(page, 'picture').click();
    await expect(square(page, id(54))).toBeVisible();
    const t = await cellOf(page, id(52));
    const y = await cellOf(page, id(54));
    expect([t.line, t.row, y.line, y.row]).toEqual(['1', '2', '1', '2']);
    expect(Number(y.pos) - Number(t.pos)).toBe(1);
    expect(await crossings(page)).toEqual([]);
    if (SNAPS) await snap(page, `${SNAPS}/strand-picture-deep-1440${tag ? '-firefox' : ''}.png`);
  });

  test(`each box's doors and the lines' links land where they say, and Back puts the focus on them${tag}`, async ({ page }) => {
    // Eleven round trips to a room and back: more than the default budget on a loaded machine.
    test.slow();
    await page.setViewportSize({ width: 1440, height: 900 });
    const wid = await wholeStrand(page, { map: true });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    const header = (p: Page, name: string) => expect(p.locator('.atlas-middle-header')).toContainText(name);
    const writingRoom = async (p: Page) => { await expect(p.locator('.atlas-writing-workspace')).toBeVisible(); };
    const onMap = async (p: Page) => {
      await header(p, 'Saltmere Quay');
      await expect.poll(() => p.evaluate(() => {
        const ui = (window as any).__atlasTestApi.getState().ui;
        return [ui.rightTabs[ui.rightActiveIndex]?.mapId ?? null, ui.pinPlacement ?? null];
      })).toEqual([MAP, null]);
    };
    // [the control's key, its words, where it lands, what is there, the key the focus is on after Back].
    // A door in a box's menu (1.122.0's amendment) is pressed through its menu, and Back focuses the menu's
    // button; a line's link whose line went once its room opened gives the focus to the box's name.
    const lands: Array<[string, string, string, (p: Page) => Promise<void>, string]> = [
      ['line:narrative:writing', 'the writing room', `#/w/${wid}/writing/${S}`, async p => {
        await writingRoom(p);
        // W8: the empty Book's line at the body's top, gone once its first chapter lands.
        const empty = p.locator('.atlas-writing-workspace-body > [data-role="writing-empty-book"]');
        await expect(empty).toHaveText('Narratives nest as books, chapters and scenes, and you can rename these tiers in Settings. Press + to add the first.');
        await put(p, 'narrative', '0192a000-0000-7000-8000-000000950031', 'Chapter one', { supertype: 'Chapter', parent_narrative: S });
        await expect(empty).toHaveCount(0);
      }, 'narrative:open'],
      ['narrative:room', 'Edit in the writing room', `#/w/${wid}/writing/${S}`, writingRoom, 'narrative:more'],
      // The story's title opens its room, so its page is a door in its menu (the amendment's code gate, M1).
      ['narrative:open', 'The Lantern Ferry', `#/w/${wid}/writing/${S}`, writingRoom, ''],
      ['narrative:page', 'Open its page', `#/w/${wid}/element/${S}`, async p => { await header(p, 'The Lantern Ferry'); }, 'narrative:more'],
      ['event:room', 'Edit in Charts', `#/w/${wid}/timeline/${E}`, async p => { await expect(p.locator('.atlas-world-home')).toHaveCount(0); }, 'event:more'],
      // Dated: the line's Charts goes to its place on the timeline.
      ['line:event:charts', 'Charts', `#/w/${wid}/timeline/${E}`, async p => { await expect(p.locator('.atlas-world-home')).toHaveCount(0); }, 'line:event:charts'],
      ['event:open', 'The night crossing', `#/w/${wid}/element/${E}`, async p => { await header(p, 'The night crossing'); }, ''],
      // C3: the location's way to a map in its box's menu too, the line's own landing.
      ['location:room', 'Pin it on a map', `#/w/${wid}/map/${MAP}/element/${L}`, onMap, 'location:more'],
      ['line:location:pin-map', 'Pin it on a map', `#/w/${wid}/map/${MAP}/element/${L}`, onMap, 'line:location:pin-map'],
      ['line:character:page', 'Their page', `#/w/${wid}/element/${C}`, async p => { await header(p, 'Odile Varn'); }, 'character:open'],
      ['now:open', 'The Drowned Library', `#/w/${wid}/element/${N}`, async p => { await header(p, 'The Drowned Library'); }, ''],
    ];
    // The story's line is there until the writing room opens on it, the character's until their page opens.
    await expect(page.locator('[data-slot="narrative"] [data-role="strand-line"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="character"] [data-role="strand-line"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="event"] [data-role="strand-line"] .atlas-home-strand-line-text')).toHaveText('Its year puts it on the timeline in Charts.');
    for (const [key, label, hash, landed, back] of lands) {
      const act = page.locator(`[data-role="home-strand"] [data-strand-key="${key}"]`);
      await expect(act, key).toHaveText(label);
      const slot = key.split(':')[0];
      if (!key.startsWith('line:') && (key.endsWith(':room') || key.endsWith(':page'))) await page.locator(`[data-role="home-strand"] [data-strand-key="${slot}:more"]`).click();
      await act.click();
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(hash);
      await landed(page);
      // The act never armed placement or wrote: the placing class is off.
      expect(await page.evaluate(() => document.body.classList.contains('atlas-placing'))).toBe(false);
      await page.goBack();
      await expect(page.locator('.atlas-world-home')).toBeVisible();
      await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
      if (back) await expect(page.locator(`[data-role="home-strand"] [data-strand-key="${back}"]`), `Back after ${key}`).toBeFocused();
      // The line's link opened its room: on return the line is gone.
      if (key === 'line:character:page' || key === 'line:narrative:writing') await expect(page.locator(`[data-slot="${slot === 'line' ? key.split(':')[1] : slot}"] [data-role="strand-line"]`)).toHaveCount(0);
    }
    // W4: the rooms were opened, so those two lines have gone, for good in this world and this browser.
    await expect(page.locator('[data-slot="narrative"] [data-role="strand-line"]')).toHaveCount(0);
    await expect(page.locator('[data-slot="character"] [data-role="strand-line"]')).toHaveCount(0);
    expect(await page.evaluate(() => {
      const s = (window as any).__atlasTestApi.getState();
      return s.registry.worlds.find((w: any) => w.id === s.active.worldId)?.strand_lines?.opened?.length ?? 0;
    })).toBe(2);
  });

  test(`the strand's links that go somewhere are heard as links, Enter opens one, and Create a map stays a button${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const wid = await wholeStrand(page, { map: true });
    const strand = page.locator('[data-role="home-strand"]');
    // The lines' links and the boxes' names navigate: a screen reader hears each as a link, none as a button.
    for (const name of ['the writing room', 'Charts', 'Pin it on a map', 'Their page', 'Odile Varn', 'The night crossing', 'The Drowned Library']) {
      await expect(strand.getByRole('link', { name, exact: true }).first(), name).toBeVisible();
    }
    await expect(strand.locator('[data-role="strand-line"] [data-line-link]:not([role="link"])')).toHaveCount(0);
    // Enter on a link opens it, as a click does.
    await strand.getByRole('link', { name: 'Their page', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/w/${wid}/element/${C}`);
    // A world with no map: the location's line offers Create a map, which opens a dialog and stays a button.
    await wholeStrand(page);
    const make = page.locator('[data-role="home-strand"] [data-role="strand-line"] [data-line-link="create-map"]');
    await expect(make).toHaveText('Create a map');
    await expect(make).not.toHaveAttribute('role', 'link');
    await expect(page.locator('[data-role="home-strand"]').getByRole('button', { name: 'Create a map', exact: true }).first()).toBeVisible();
  });
}

// 1.122.0's amendment, A2: the ⋯ sits at the end of its box's name row, beside a long name that wraps inside
// its button, never pushed onto a row of its own.
for (const [w, h] of [[1440, 900], [390, 844]] as const) {
  test(`each box's ⋯ sits beside its name, on the name's row, with long names, at ${w}`, async ({ page }) => {
    await page.setViewportSize({ width: w, height: h });
    await wholeStrand(page, { names: [
      'The Lantern Ferry Across the Black Lake of the North', 'The night crossing in the great storm of the year',
      'Saltmere Quay under the Seven Grey Lighthouses', 'Odile Varn, cartographer of the drowned coast', 'The Drowned Library beneath the harbour',
    ] });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    const rows = await page.locator('[data-role="home-strand"] [data-box]').evaluateAll(boxes => boxes.map(b => {
      const name = b.querySelector('.atlas-home-strand-name')!.getBoundingClientRect();
      const more = b.querySelector('[data-act="more"]')?.getBoundingClientRect();
      return { slot: b.getAttribute('data-box'), nameH: Math.round(name.height), more: !!more,
        sameRow: !!more && more.top < name.bottom && more.bottom > name.top, beside: !!more && more.left >= name.right - 1 };
    }));
    expect(rows.length).toBe(5);
    // Each long name wraps (taller than one line), and its ⋯ stays beside it on its row.
    for (const r of rows) {
      expect(r.more, r.slot!).toBe(true);
      expect(r.sameRow && r.beside, `${r.slot}: the ⋯ beside the name, on its row (${JSON.stringify(r)})`).toBe(true);
    }
    expect(rows.some(r => r.nameH > 40), JSON.stringify(rows)).toBe(true);
  });
}

// 1.122.0's amendment, A3: Home is its own scroller, and a draw builds it in steps; a layout read part
// way clamped the scroll to the part built so far, so a switch of tabs threw the person toward the top.
for (const tag of ['', ' @firefox']) {
  test(`a switch between Picture and Strand keeps Home's scroll, both ways, never past the end${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await wholeStrand(page, { rest: true, map: true });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    const home = page.locator('.atlas-world-home');
    const read = () => home.evaluate(h => ({ top: h.scrollTop, max: h.scrollHeight - h.clientHeight, ch: h.clientHeight, panel: Math.round(h.querySelector('.atlas-home-tabpanel')!.getBoundingClientRect().height) }));
    for (const to of ['picture', 'strand', 'picture'] as const) {
      // Scrolled as far as the tab head allows while it stays in view (near the top), as a person
      // scrolls before pressing it.
      await home.evaluate((h, t) => {
        const el = h.querySelector(`[data-role="home-tabs"] [data-tab="${t}"]`)!;
        h.scrollTop += el.getBoundingClientRect().top - h.getBoundingClientRect().top - 16;
      }, to);
      const before = await read();
      expect(before.top, `scrolled before ${to}`).toBeGreaterThan(100);
      const at = (await tab(page, to).boundingBox())!;
      await page.mouse.click(at.x + at.width / 2, at.y + at.height / 2);
      await expect(tab(page, to)).toHaveAttribute('aria-selected', 'true');
      // The focus lands on the tab pressed, as before.
      await expect(tab(page, to)).toBeFocused();
      const after = await read();
      if (process.env.ATLAS_W5_LOG) console.log(`A3 to ${to}: ${JSON.stringify({ before, after })}`);
      // Promise 5: kept, or the new content's end when it is shorter; never past it.
      expect.soft(after.top, `the scroll after the switch to ${to}`).toBeCloseTo(Math.min(before.top, after.max), 0);
      expect(after.top).toBeLessThanOrEqual(after.max + 0.5);
      // The picture's grid draws a frame after its mount: the scroll stays where it was put.
      await page.waitForTimeout(400);
      expect(Math.abs((await read()).top - after.top), `still after the switch to ${to}`).toBeLessThan(1);
    }
  });
}

// 1.122.1: the same clamp pulled Home up on every redraw while scrolled down (a pull bringing a change, a
// make, a line's ×), not only on a tab's press; at 1440 x 900 on this world the Picture tab fell to 0 at
// a pull, and a line's × or the last make fell 168 px, in both engines. Every redraw on the same world
// now keeps the scroll. Kept means within 2 px; the browser's own clamp to a shorter end is allowed.
const TOLERANCE = 2;
const homeScroll = (page: Page) => page.locator('.atlas-world-home').evaluate(h => ({ top: h.scrollTop, max: h.scrollHeight - h.clientHeight }));
/** Scroll Home so that `sel`'s top sits `y` px below Home's top (or as near as Home scrolls). */
const scrollToPut = (page: Page, sel: string, y: number) => page.locator('.atlas-world-home').evaluate((h, a) => {
  const el = h.querySelector(a.sel)!;
  h.scrollTop += el.getBoundingClientRect().top - h.getBoundingClientRect().top - a.y;
}, { sel, y });
/** A pull bringing one changed element: a new elements array, one description changed, as a sync tick patches it. */
const pullOneChange = (page: Page, id: string, words: string) => page.evaluate(({ id, words }) => {
  const api = (window as any).__atlasTestApi;
  api.patchData(api.getState().data.elements.map((e: any) => e.id === id ? { ...e, description: words } : e));
}, { id, words });

/** Home's next draw: its first child replaced (a draw empties Home and builds it again). */
const markDraw = (page: Page) => page.locator('.atlas-world-home').evaluate(h => { (h.firstElementChild as any).__before = true; });
const redrawn = (page: Page) => page.waitForFunction(() => !(document.querySelector('.atlas-world-home')!.firstElementChild as any)?.__before);

async function expectKept(page: Page, label: string, before: { top: number }, drawn: () => Promise<void>): Promise<void> {
  await markDraw(page);
  await drawn();
  await redrawn(page);
  const after = await homeScroll(page);
  expect.soft(Math.abs(after.top - Math.min(before.top, after.max)), `${label}: ${before.top} kept (now ${after.top} of ${after.max})`).toBeLessThanOrEqual(TOLERANCE);
  await page.waitForTimeout(400);
  const later = await homeScroll(page);
  expect.soft(Math.abs(later.top - after.top), `${label}: still kept 400 ms later (${after.top}, then ${later.top})`).toBeLessThanOrEqual(1);
}

for (const tag of ['', ' @firefox']) {
  test(`Home keeps its scroll when a pull redraws it, on either tab, scrolled to the end or half way${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await wholeStrand(page, { rest: true, map: true });
    const home = page.locator('.atlas-world-home');
    let n = 0;
    for (const t of ['picture', 'strand'] as const) {
      if ((await tab(page, t).getAttribute('aria-selected')) !== 'true') await tab(page, t).click();
      await expect(tab(page, t)).toHaveAttribute('aria-selected', 'true');
      for (const at of ['end', 'half'] as const) {
        const max = (await homeScroll(page)).max;
        await home.evaluate((h, y) => { h.scrollTop = y; }, at === 'end' ? max : Math.round(max / 2));
        const before = await homeScroll(page);
        expect(before.top, `scrolled on ${t} (${at})`).toBeGreaterThan(100);
        const words = `Changed elsewhere, ${++n}.`;
        await expectKept(page, `a pull on ${t} at the ${at}`, before, async () => {
          await pullOneChange(page, BRAM, words);
        });
      }
    }
  });

  // S2: a focus a press asks for wins over the kept position only when its control would be out of view.
  test(`a tab reached by the keyboard while half out of view is brought into view, and the page moves only that far${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await wholeStrand(page, { rest: true, map: true });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    // The tab head's top 12 px above Home's top, the Strand tab focused without a scroll, as after a wheel.
    await scrollToPut(page, '[data-role="home-tabs"] [data-tab="strand"]', -12);
    await tab(page, 'strand').evaluate((b: HTMLElement) => b.focus({ preventScroll: true }));
    const before = await homeScroll(page);
    expect(before.top, 'scrolled before the arrow').toBeGreaterThan(100);
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'picture')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'picture')).toBeFocused();
    await expect(tab(page, 'picture')).toBeInViewport({ ratio: 0.99 });
    const after = await homeScroll(page);
    expect(before.top - after.top, `the page moved up only to show the tab (${before.top} to ${after.top})`).toBeGreaterThan(5);
    expect(before.top - after.top).toBeLessThan(60);
  });

  test(`Home keeps its scroll when a line's × redraws it, and the focus goes to the box${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await wholeStrand(page, { rest: true, map: true });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    const x = page.locator('[data-role="home-strand"] [data-slot="character"] [aria-label="Hide this line"]');
    await expect(x).toBeVisible();
    await scrollToPut(page, '[data-role="home-strand"] [data-slot="character"] [aria-label="Hide this line"]', 300);
    const before = await homeScroll(page);
    expect(before.top, 'scrolled before the ×').toBeGreaterThan(100);
    await expectKept(page, "the character's line ×", before, async () => {
      await x.click();
      await expect(x).toHaveCount(0);
    });
    // The focus lands on the box's first control, in view (it was already).
    const name = page.locator('[data-role="home-strand"] [data-slot="character"] [data-strand-key]').first();
    await expect(name).toBeFocused();
    await expect(name).toBeInViewport();
  });

  test(`Home keeps its scroll when the last make redraws it far down, and the focus goes to the box made${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await wholeStrand(page, { rest: true, map: true, noNow: true });
    const card = page.locator('[data-role="strand-card"][data-mode="make"]');
    await expect(card).toHaveAttribute('data-card-slot', 'now');
    await scrollToPut(page, '[data-role="strand-card"][data-mode="make"] [data-act="make"]', 700);
    await card.locator('[data-field="name"]').fill('The Drowned Library');
    const before = await homeScroll(page);
    expect(before.top, 'scrolled before the make').toBeGreaterThan(100);
    await expectKept(page, 'the Now make', before, async () => {
      await card.locator('[data-act="make"]').click();
      await expect(page.locator('[data-role="home-strand"] [data-box="now"] .atlas-home-strand-name')).toHaveText('The Drowned Library');
    });
    const made = page.locator('[data-role="home-strand"] [data-strand-key="now:open"]');
    await expect(made).toBeFocused();
    await expect(made).toBeInViewport();
  });
}

// The registry's redraw (a landing ending, a role kept, a line's record written) while scrolled down: Firefox
// clamps on any layout read part way, and fell 475 to 135 here before 1.122.1.
test(`Home keeps its scroll when the registry redraws it, as a landing ends @firefox`, async ({ page }) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  await wholeStrand(page, { rest: true, map: true });
  await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
  for (const at of ['end', 'half'] as const) {
    const max = (await homeScroll(page)).max;
    await page.locator('.atlas-world-home').evaluate((h, y) => { h.scrollTop = y; }, at === 'end' ? max : Math.round(max / 2));
    const before = await homeScroll(page);
    expect(before.top, `scrolled (${at})`).toBeGreaterThan(100);
    await expectKept(page, `a registry redraw at the ${at}`, before, () => page.evaluate(async () => {
      const { getState, patchSlice } = await import('/src/core/state.ts');
      const reg = getState().registry;
      patchSlice('registry', { ...reg, worlds: reg.worlds.map(w => ({ ...w })) });
    }));
  }
});

// Moppetopia as Try a demo world brings it down (keel replayed from a recording of 2026-11-04,
// `tests/fixtures/moppetopia-keel.json`): its Strand tab fell 844 to 227 at a pull before 1.122.1.
const MOPPETOPIA = moppetopiaKeel as { world: unknown; elements: Record<string, unknown[]> };
for (const tag of ['', ' @firefox']) {
  test(`Home keeps its scroll on Moppetopia's Strand tab when a pull redraws it${tag}`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1440, height: 900 });
    // Keel's CORS answered too: Firefox sends the preflight for the demo key's headers to the route.
    const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, OPTIONS' };
    await page.route('https://www.onlyworlds.com/**', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/api/v2/')) return route.fulfill({ status: 404, headers: cors, body: '' });
      const type = path.slice('/api/v2/'.length).replace(/\/$/, '');
      if (type === 'world') return route.fulfill({ headers: cors, json: MOPPETOPIA.world });
      return route.fulfill({ headers: cors, json: { data: MOPPETOPIA.elements[type] ?? [], has_more: false, next_cursor: null } });
    });
    await freshBoot(page);
    await page.locator('[data-action="try-demo"]').first().click();
    await expect(page.locator('.atlas-home-world-name')).toHaveText('Moppetopia', { timeout: 30_000 });
    await expect(tab(page, 'strand')).toBeVisible();
    if ((await tab(page, 'strand').getAttribute('aria-selected')) !== 'true') await tab(page, 'strand').click();
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    const home = page.locator('.atlas-world-home');
    await home.evaluate(h => { h.scrollTop = h.scrollHeight; });
    const before = await homeScroll(page);
    expect(before.top, 'scrolled to the end').toBeGreaterThan(300);
    const one = await page.evaluate(() => (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.type === 'object').id as string);
    await expectKept(page, "a pull on Moppetopia's Strand tab", before, () => pullOneChange(page, one, 'Changed elsewhere.'));
  });
}

// Promise 2 (1.122.1): where the page means to move it still moves. Another world, and the same world
// opened again, land at the top.
for (const tag of ['', ' @firefox']) {
  test(`another world, and the same world opened again, land at the top of Home${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const wid = await wholeStrand(page, { rest: true, map: true });
    const home = page.locator('.atlas-world-home');
    const down = async () => {
      await home.evaluate(h => { h.scrollTop = h.scrollHeight; });
      expect((await homeScroll(page)).top).toBeGreaterThan(100);
    };
    await down();
    await reopenHome(page, wid);
    await expect(page.locator('[data-role="home-strand"]')).toBeVisible();
    expect((await homeScroll(page)).top, 'the same world opened again').toBe(0);
    // A second world, registered as the app registers a browser world, then opened from the first's Home.
    await down();
    const other = await page.evaluate(async () => {
      const { getState, patchSlice } = await import('/src/core/state.ts');
      const reg = await import('/src/registry/registry.ts');
      const root = await navigator.storage.getDirectory();
      const dir = await (await root.getDirectoryHandle('browser-worlds', { create: true })).getDirectoryHandle('second-0192c000-5e6f', { create: true });
      const w = await (await dir.getFileHandle('world.json', { create: true })).createWritable();
      await w.write(JSON.stringify({ id: '0192c000-0000-7000-8000-00000000cccc', name: 'Second Hollow' }) + '\n');
      await w.close();
      const { next, entry } = (reg as any).createLocalWorld(getState().registry, {
        name: 'Second Hollow', folderName: 'second-0192c000-5e6f', handleKey: 'world-0192c000-0000-7000-8000-00000000cccc', pathHint: 'browser storage/second-0192c000-5e6f',
      });
      const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
      (reg as any).saveRegistry(withWhere);
      patchSlice('registry', withWhere);
      return entry.id as string;
    });
    await page.evaluate(async (id) => {
      const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
      const { toastManager } = await import('/src/ui/toast-manager.ts');
      await (activateWorld as any)(id, toastManager);
    }, other);
    await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().active?.worldId)).toBe(other);
    await go(page, `#/w/${other}/home`);
    await expect(page.locator('.atlas-home-world-name')).toHaveText('Second Hollow');
    expect((await homeScroll(page)).top, 'another world').toBe(0);
    // And back to the first: its Home at the top, not where it was left.
    await page.evaluate(async (id) => {
      const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
      const { toastManager } = await import('/src/ui/toast-manager.ts');
      await (activateWorld as any)(id, toastManager);
    }, wid);
    await go(page, `#/w/${wid}/home`);
    await expect(page.locator('[data-role="home-strand"]')).toBeVisible();
    expect((await homeScroll(page)).top, 'the first world again').toBe(0);
  });
}

test('a strand with no event keeps its cells: the story, an empty row, then the main character and where they are now', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const wid = await setupWorld(page);
  await put(page, 'narrative', S, 'The Lantern Ferry', { supertype: 'Book', protagonist: C });
  await put(page, 'character', C, 'Odile Varn', { location: N });
  await put(page, 'location', N, 'The Drowned Library');
  await put(page, 'character', BRAM, 'Bram the ferryman');
  await setMark(page, { narrative: S, event: null, location: null });
  await reopenHome(page, wid);
  await tab(page, 'picture').click();
  await expect(square(page, S)).toBeVisible();
  expect(await cellOf(page, S)).toEqual({ line: '0', pos: '0', row: '0' });
  expect(await cellOf(page, C)).toEqual({ line: '0', pos: '0', row: '2' });
  expect(await cellOf(page, N)).toEqual({ line: '0', pos: '1', row: '2' });
  expect(await cellOf(page, BRAM)).toEqual({ line: '0', pos: '2', row: '0' });
  expect(await crossings(page)).toEqual([]);
  if (SNAPS) await snap(page, `${SNAPS}/strand-picture-partial-1440-chromium.png`);
});

test.describe('the line on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
test('on a phone, the location\'s line opens its page with the map in its drawer, and Back focuses its link', async ({ page }) => {
  const wid = await wholeStrand(page, { map: true });
  const act = page.locator('[data-role="home-strand"] [data-strand-key="line:location:pin-map"]');
  await expect(act).toHaveText('Pin it on a map');
  // Promise 7, G11: a thumb by its padding, the line keeping its text height.
  const h = await act.boundingBox();
  expect(Math.round(h!.height)).toBeGreaterThanOrEqual(44);
  expect(Math.round((await lineIn(page, 'location').boundingBox())!.height)).toBeLessThan(30);
  const x = await lineIn(page, 'location').locator('.atlas-home-strand-line-x').boundingBox();
  expect(Math.round(x!.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(x!.height)).toBeGreaterThanOrEqual(44);
  await act.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/w/${wid}/map/${MAP}/element/${L}`);
  await expect(page.locator('.atlas-middle-header')).toContainText('Saltmere Quay');
  // The map is the right drawer on a phone: open once the page has settled, on the map, on screen (C3).
  await expect(page.locator('body.atlas-drawer-right-open')).toHaveCount(1);
  await page.waitForTimeout(600);
  await expect(page.locator('body.atlas-drawer-right-open')).toHaveCount(1);
  const pane = page.locator('.atlas-right');
  await expect(pane).toBeVisible();
  const box = (await pane.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x).toBeLessThan(390);
  expect(await page.evaluate(() => {
    const ui = (window as any).__atlasTestApi.getState().ui;
    return ui.rightTabs[ui.rightActiveIndex]?.mapId ?? null;
  })).toBe(MAP);
  await page.goBack();
  await expect(page.locator('[data-role="home-strand"] [data-strand-key="line:location:pin-map"]')).toBeFocused();
});
});

// The code gate's C2: the name's room under a square follows the root font size, so a larger default
// font (Chrome's "Large" is 20 px) never puts a hold mark through the name above it.
test('a whole strand with two-line names at a 20 px root font: no line through a square or a name, at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const wid = await wholeStrand(page, { names: [
    'The Lantern Ferry of the Black Lake', 'The night crossing at the quay', 'Saltmere Quay by the old salt road',
    'Odile Varn the young cartographer', 'The Drowned Library under the water',
  ] });
  await page.evaluate(() => { document.documentElement.style.fontSize = '20px'; });
  await reopenHome(page, wid);
  await tab(page, 'picture').click();
  await expect(square(page, S)).toBeVisible();
  // Two lines of the name at 20 px: past the 36 px a 16 px root leaves under a square.
  const nameH = await square(page, S).locator('.atlas-home-grid-name').evaluate(n => n.getBoundingClientRect().height);
  expect(nameH).toBeGreaterThan(34);
  expect(await lineCount(page)).toBe(5);
  expect(await crossings(page)).toEqual([]);
  if (SNAPS) await snap(page, `${SNAPS}/strand-picture-root20-1440-chromium.png`);
});

test('W5: the story\'s box keeps room for its second line, so the Event make moves the Event\'s row 0 px at 1440', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await setupWorld(page);
  const card = page.locator('[data-role="strand-card"][data-mode="make"]');
  const answer = async (slot: string, name: string, when?: string) => {
    await expect(card).toHaveAttribute('data-card-slot', slot);
    await card.locator('[data-field="name"]').fill(name);
    if (when) await card.locator('[data-field="when"]').fill(when);
    await card.locator('[data-act="make"]').click();
    await expect(page.locator(`[data-role="home-strand"] [data-box="${slot}"] .atlas-home-strand-name`)).toHaveText(name);
  };
  // The journey's order (1.121.0): the main character first brings the story's one line, its event the second.
  await answer('narrative', 'The Lantern Ferry');
  await answer('character', 'Odile Varn');
  const lines = page.locator('[data-role="home-strand"] [data-box="narrative"] [data-role="strand-lines"] p:not([aria-hidden])');
  await expect(lines).toHaveCount(1);
  // The Event cell's top within the Strand panel (the page scrolls to the next card, so never the
  // viewport's): it holds the Event's card before the make and its box after, under the story's row.
  const eventTop = () => page.evaluate(() => {
    const panel = document.querySelector('[data-role="home-strand"]')!;
    const cell = panel.querySelector('[data-slot="event"]')!;
    return cell.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  });
  const before = await eventTop();
  await answer('event', 'The night crossing', '1142');
  await expect(lines).toHaveCount(2);
  expect(await eventTop() - before).toBe(0);
});

/** How far each box filled before a make moved: after the make settled, and the most in any frame drawn meanwhile. */
type Moves = Record<string, { end: Record<string, number>; frame: Record<string, number> }>;

/**
 * The journey on a new world, each make answered with a name (and a text where the card has one), every
 * filled box's top read within the Strand panel (the page scrolls to the next card, so never the
 * viewport's) before the press, at every animation frame while the write runs, and once it settled.
 * `snapTo` keeps the screen after the Event make. ATLAS_W5_LOG prints the moves.
 */
async function movesAtEachMake(page: Page, snapTo?: string): Promise<Moves> {
  await setupWorld(page);
  const card = page.locator('[data-role="strand-card"][data-mode="make"]');
  const tops = () => page.evaluate(() => {
    const panel = document.querySelector('[data-role="home-strand"]')!;
    const top = panel.getBoundingClientRect().top;
    return Object.fromEntries([...panel.querySelectorAll<HTMLElement>('[data-box]')].map(b => [b.getAttribute('data-box')!, b.getBoundingClientRect().top - top]));
  });
  const round = (n: number) => Math.round(n * 100) / 100;
  const moves: Moves = {};
  const steps: [string, string, string][] = [
    ['narrative', 'The Lantern Ferry', 'Every night a ferry crosses the black lake.\nThe ferryman never asks why.'],
    ['character', 'Odile Varn', 'A cartographer who paid in maps.'],
    ['event', 'The night crossing', 'A storm closed the lake.'],
    ['location', 'Saltmere Quay', 'The stone landing on the far shore.'],
    ['now', 'The Drowned Library', ''],
  ];
  for (const [slot, name, text] of steps) {
    await expect(card).toHaveAttribute('data-card-slot', slot);
    await card.locator('[data-field="name"]').fill(name);
    if (text) await card.locator('[data-field="text"]').fill(text);
    const before = await tops();
    await page.evaluate(() => {
      const w = window as unknown as { w5Frames: Record<string, number>[]; w5Stop: boolean };
      w.w5Frames = [];
      w.w5Stop = false;
      const tick = () => {
        const panel = document.querySelector('[data-role="home-strand"]');
        if (panel) {
          const top = panel.getBoundingClientRect().top;
          w.w5Frames.push(Object.fromEntries([...panel.querySelectorAll<HTMLElement>('[data-box]')].map(b => [b.getAttribute('data-box')!, b.getBoundingClientRect().top - top])));
        }
        if (!w.w5Stop) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await card.locator('[data-act="make"]').click();
    await expect(page.locator(`[data-role="home-strand"] [data-box="${slot}"] .atlas-home-strand-name`)).toHaveText(name);
    // The next card drawn (or the whole line), so the layout read is the settled one.
    if (slot === 'now') await expect(page.locator('[data-role="strand-whole"]')).toBeVisible();
    else {
      await expect(card).not.toHaveAttribute('data-card-slot', slot);
      // The focus went on to the next card's Name, as always (the hold draws before the focus moves).
      await expect(card.locator('[data-field="name"]')).toBeFocused();
    }
    const after = await tops();
    const frames = await page.evaluate(() => {
      const w = window as unknown as { w5Frames: Record<string, number>[]; w5Stop: boolean };
      w.w5Stop = true;
      return w.w5Frames;
    });
    const boxes = Object.keys(before);
    moves[slot] = {
      end: Object.fromEntries(boxes.map(b => [b, round(after[b] - before[b])])),
      frame: Object.fromEntries(boxes.map(b => [b, round(Math.max(0, ...frames.filter(f => b in f).map(f => Math.abs(f[b] - before[b]))))])),
    };
    if (slot === 'event' && snapTo) await page.screenshot({ path: snapTo, fullPage: true });
  }
  if (process.env.ATLAS_W5_LOG) console.log(`W5 moves ${test.info().title}: ${JSON.stringify(moves)}`);
  return moves;
}

// W5 at every make (1.121.2): within one visit to Home a strand row never gets shorter when a card in it
// gives way to a box, so no box already filled moves when another is made. 1.121.1 moved the main
// character's box 42 px up at the Event make (the Event's card taller than the Location's card beside
// it) and 116 px at the Location make; and while a make's write ran, its card drew a Pick for the element
// just made, so that box dropped 38 px for a few frames and came back.
for (const tag of ['', ' @firefox']) {
  test(`W5 at every make: no filled box moves when another is made, nor while it is made, at 1440; once whole the rows close up to a fresh opening's${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const moves = await movesAtEachMake(page, SNAPS ? `${SNAPS}/strand-w5-event-1440${tag ? '-firefox' : '-chromium'}.png` : undefined);
    for (const [make, m] of Object.entries(moves)) {
      // The make that makes the strand whole lets the rows go (1.122.0, the lead's ruling): only the rows
      // below a held row close up; nothing above it moves, and nothing moves down.
      const free = make === 'now' ? new Set(['character']) : new Set<string>();
      for (const [b, d] of Object.entries(m.end)) {
        if (free.has(b)) expect(d, `the ${b} box after the ${make} make closes up, never down`).toBeLessThan(0.5);
        else expect(Math.abs(d), `the ${b} box after the ${make} make`).toBeLessThan(0.5);
      }
      for (const [b, d] of Object.entries(m.frame)) if (!free.has(b)) expect(d, `the ${b} box while the ${make} make ran`).toBeLessThan(0.5);
    }
    // Whole: once settled, no hold is left and every box stands where a fresh opening of the same world
    // draws it, so no gap between rows is wider than the ordinary spacing (the 1.121.2 band gone).
    const tallerHeld = () => page.evaluate(() => {
      const parts = [...document.querySelectorAll<HTMLElement>('[data-role="home-strand"] .atlas-home-strand-cell, [data-role="home-strand"] [data-box]')];
      const name = (e: HTMLElement) => e.hasAttribute('data-box') ? `box ${e.getAttribute('data-box')}` : `cell ${e.getAttribute('data-slot')}`;
      const read = () => parts.map(e => {
        const r = e.getBoundingClientRect();
        const cell = e.closest('.atlas-home-strand-cell')!.getBoundingClientRect();
        return { h: r.height, inCell: r.top - cell.top };
      });
      const held = read();
      for (const e of parts) e.style.removeProperty('--strand-hold');
      const free = read();
      return parts.map((e, i) => [name(e), held[i].h - free[i].h > 0.5 || Math.abs(held[i].inCell - free[i].inCell) > 0.5] as const).filter(([, moved]) => moved).map(([n]) => n);
    });
    const topsNow = () => page.evaluate(() => {
      const panel = document.querySelector('[data-role="home-strand"]')!;
      const top = panel.getBoundingClientRect().top;
      return Object.fromEntries([...panel.querySelectorAll<HTMLElement>('[data-box]')].map(b => [b.getAttribute('data-box')!, Math.round((b.getBoundingClientRect().top - top) * 10) / 10]));
    });
    // Settled: the closing transition is over (two reads 300 ms apart agree).
    let settled = await topsNow();
    for (let i = 0; i < 20; i++) {
      await page.waitForTimeout(300);
      const again = await topsNow();
      if (JSON.stringify(again) === JSON.stringify(settled)) break;
      settled = again;
    }
    expect(await tallerHeld()).toEqual([]);
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await reopenHome(page, wid);
    await expect(page.locator('[data-role="home-strand"] [data-box="now"]')).toBeVisible();
    await page.waitForTimeout(300);
    const fresh = await topsNow();
    for (const [slot, t] of Object.entries(fresh)) expect(Math.abs(settled[slot] - t), `the ${slot} box once whole, against a fresh opening`).toBeLessThan(1);
    expect(await tallerHeld()).toEqual([]);
  });
}

// W5 with classic scrollbars (1.122.1's code gate, M1). Playwright's Chromium hides scrollbars, so the
// suite never met one; Chrome and Edge on Windows draw them. Without a gutter kept for it, the strand's
// grid narrowed by the scrollbar's width at the make where Home first overflowed, the rows' hold (keyed
// on that width) let go, and the main character's box jumped 250 px up at the Location make (1440 x 1300
// on 1.122.1's first build, 1440 x 1100 on 1.122.0). Home keeps the gutter (`scrollbar-gutter: stable`).
// A browser of its own, launched without Playwright's --hide-scrollbars (a launch option cannot be set
// per describe group); Chromium only (the Firefox project runs the tagged tests alone).
test.describe('W5 with classic scrollbars', () => {
  for (const height of [1100, 1300]) {
    test(`W5 at every make with classic scrollbars shown, at 1440 x ${height}: no filled box moves beyond the whole strand's let-go`, async ({ playwright }, info) => {
      const browser = await playwright.chromium.launch({ ignoreDefaultArgs: ['--hide-scrollbars'] });
      try {
        const page = await (await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1440, height } })).newPage();
        const moves = await movesAtEachMake(page);
        // The scrollbar is really drawn: Home's border box is wider than its client box.
        expect(await page.locator('.atlas-world-home').evaluate(h => h.offsetWidth - h.clientWidth), 'a classic scrollbar on Home').toBeGreaterThan(0);
        if (process.env.ATLAS_W5_LOG) console.log(`W5 classic ${height}: ${JSON.stringify(moves)}`);
        for (const [make, m] of Object.entries(moves)) {
          const free = make === 'now' ? new Set(['character']) : new Set<string>();
          for (const [b, d] of Object.entries(m.end)) {
            if (free.has(b)) expect.soft(d, `the ${b} box after the ${make} make closes up, never down`).toBeLessThan(0.5);
            else expect.soft(Math.abs(d), `the ${b} box after the ${make} make`).toBeLessThan(0.5);
          }
          for (const [b, d] of Object.entries(m.frame)) if (!free.has(b)) expect.soft(d, `the ${b} box while the ${make} make ran`).toBeLessThan(0.5);
        }
      } finally {
        await browser.close();
      }
    });
  }
});

test.describe('W5 on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // One column holds no row: the Event make draws the Location's card above the main character's box, so
  // that box moves down there whatever is held, and a held row would leave a gap the column never has.
  test('W5 at 390: the moves read and reported; no cell held taller than what it holds', async ({ page }) => {
    await movesAtEachMake(page, SNAPS ? `${SNAPS}/strand-w5-event-390.png` : undefined);
    const held = await page.locator('.atlas-home-strand-cell').evaluateAll(els => els.map(e => getComputedStyle(e).minHeight).filter(h => h !== '0px' && h !== 'auto'));
    expect(held).toEqual([]);
  });
});

// ---- G2 (1.122.0): a line that goes keeps its height until Home's next opening ----

/** Each filled box's top within the Strand panel, by slot; an open Edit card stands for its box. */
const boxTops = (page: Page) => page.evaluate(() => {
  const panel = document.querySelector('[data-role="home-strand"]')!;
  const top = panel.getBoundingClientRect().top;
  const out: Record<string, number> = {};
  for (const b of panel.querySelectorAll<HTMLElement>('[data-box], [data-role="strand-card"][data-mode="edit"]')) {
    out[b.getAttribute('data-box') ?? b.getAttribute('data-card-slot')!] = Math.round((b.getBoundingClientRect().top - top) * 100) / 100;
  }
  return out;
});
const movedBetween = (a: Record<string, number>, b: Record<string, number>) =>
  Object.fromEntries(Object.keys(a).filter(k => k in b).map(k => [k, Math.round((b[k] - a[k]) * 100) / 100]));
const lineIn = (page: Page, slot: string) => page.locator(`[data-role="home-strand"] [data-slot="${slot}"] [data-role="strand-line"]`);
const lineWordsIn = (page: Page, slot: string) => lineIn(page, slot).locator('.atlas-home-strand-line-text');

/** The three ways a line goes or changes during a visit, each read as every box's move. */
async function movesAsLinesGo(page: Page): Promise<{ hide: Record<string, number>; date: Record<string, number>; dateBack: Record<string, number>; dateIn: Record<string, number>; map: Record<string, number>; pin: Record<string, number> }> {
  // The event undated, no map: every line drawn.
  await wholeStrand(page, { event: { start_date: null } });
  await expect(lineWordsIn(page, 'event')).toHaveText('Give it a date to place it on the timeline in Charts.');
  await expect(lineWordsIn(page, 'location')).toHaveText('Create a map to pin it in place.');
  // 1. The character's x.
  let before = await boxTops(page);
  await lineIn(page, 'character').locator('.atlas-home-strand-line-x').click();
  await expect(lineIn(page, 'character')).toHaveCount(0);
  await expect(page.locator('[data-slot="character"] [data-role="strand-line-strut"]')).toHaveCount(1);
  // G8: the focus on the box's first control.
  await expect(page.locator('[data-role="home-strand"] [data-strand-key="character:open"]')).toBeFocused();
  const hide = movedBetween(before, await boxTops(page));
  // 2. A date saved in Edit here (from the box's menu): the event's line changes its words; its box stands
  // where its Edit card stood, and (the strand whole, so no row is held: 1.122.0) every box below returns to
  // where it stood before Edit here opened the card, the line's slot keeping its tallest height.
  const beforeEdit = await boxTops(page);
  await page.locator('[data-role="home-strand"] [data-box="event"] [data-act="more"]').click();
  await page.locator('[data-role="home-strand"] [data-box="event"] .atlas-home-strand-menu [data-act="edit"]').click();
  const edit = page.locator('[data-role="strand-card"][data-mode="edit"]');
  await edit.locator('[data-field="when"]').fill('1142');
  before = await boxTops(page);
  await edit.locator('[data-act="save"]').click();
  await expect(page.locator('[data-role="home-strand"] [data-box="event"]')).toBeVisible();
  await expect(lineWordsIn(page, 'event')).toHaveText('Its year puts it on the timeline in Charts.');
  const afterSave = await boxTops(page);
  const date = movedBetween(before, afterSave);
  const dateBack = movedBetween(beforeEdit, afterSave);
  // 3. A map made with the line's own link: its words change, nothing below moves.
  const locationDoor = page.locator('[data-role="home-strand"] [data-strand-key="location:room"]');
  await expect(locationDoor).toHaveText('Create a map');
  before = await boxTops(page);
  await lineIn(page, 'location').locator('[data-line-link="create-map"]').click();
  const dialog = page.locator('[data-modal="create-map"]');
  await expect(dialog.locator('input[name="map-name"]')).toHaveValue('');
  await expect(dialog.locator('input[name="map-name"]')).toBeFocused();
  await dialog.locator('input[name="map-name"]').fill('The Coast');
  await dialog.locator('[data-action="submit"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(lineWordsIn(page, 'location')).toHaveText('Pin it on a map.');
  // The code gate's C2: the focus on the link that now pins it, never the page.
  await expect(lineIn(page, 'location').locator('[data-line-link="pin-map"]')).toBeFocused();
  // C3: the box's door follows the line.
  await expect(locationDoor).toHaveText('Pin it on a map');
  const map = movedBetween(before, await boxTops(page));
  // 4. A date that arrives from elsewhere (Charts, a pull) on an event not being edited: the same strut.
  await page.evaluate(async (e) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(e, { start_date: null });
    api.patchData(await api.getActiveStore().listElements());
  }, E);
  await expect(lineWordsIn(page, 'event')).toHaveText('Give it a date to place it on the timeline in Charts.');
  before = await boxTops(page);
  await page.evaluate(async (e) => {
    const api = (window as any).__atlasTestApi;
    await api.getActiveStore().updateElement(e, { start_date: 1150 });
    api.patchData(await api.getActiveStore().listElements());
  }, E);
  await expect(lineWordsIn(page, 'event')).toHaveText('Its year puts it on the timeline in Charts.');
  const dateIn = movedBetween(before, await boxTops(page));
  // 5. A pin placed while Home shows (the map pane beside it, another tab, a pull): the location's line
  // goes to its strut (the code gate's C10).
  before = await boxTops(page);
  await page.evaluate(async (l) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = (await store.listElements()).find((e: any) => e.type === 'map');
    await store.createElement('pin', { name: 'Saltmere Quay', map_id: map.id, element_id: l, element_type: 'location', x: 120, y: 80 });
    api.patchData(await store.listElements());
  }, L);
  await expect(lineIn(page, 'location')).toHaveCount(0);
  await expect(page.locator('[data-slot="location"] [data-role="strand-line-strut"]')).toHaveCount(1);
  const pin = movedBetween(before, await boxTops(page));
  if (process.env.ATLAS_W5_LOG) console.log(`G2 moves ${test.info().title}: ${JSON.stringify({ hide, date, dateBack, dateIn, map, pin })}`);
  return { hide, date, dateBack, dateIn, map, pin };
}

for (const tag of ['', ' @firefox']) {
  test(`G2 at 1440: no filled box moves when a line goes by its x, by a date saved or arriving, or when a map is made; Home opened again lets the struts go${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const moves = await movesAsLinesGo(page);
    for (const way of ['hide', 'dateBack', 'dateIn', 'map', 'pin'] as const) {
      expect(Object.keys(moves[way]).length, way).toBeGreaterThanOrEqual(4);
      for (const [slot, d] of Object.entries(moves[way])) expect(Math.abs(d), `the ${slot} box when ${way}`).toBeLessThan(0.5);
    }
    expect(Math.abs(moves.date.event), 'the event box when a date is saved').toBeLessThan(0.5);
    expect(Math.abs(moves.date.narrative), 'the story box when a date is saved').toBeLessThan(0.5);
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await reopenHome(page, wid);
    await expect(page.locator('[data-role="home-strand"] [data-box="now"]')).toBeVisible();
    await expect(page.locator('[data-role="strand-line-strut"]')).toHaveCount(0);
    // W4 (the code gate's C10): a line hidden by its x stays hidden across a reload; the others are drawn.
    await expect(lineIn(page, 'event')).toHaveCount(1);
    await page.reload();
    await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
    await page.evaluate(async (w) => {
      const { activateWorld } = await import('/src/sidebar/worlds-sidebar.ts');
      const { toastManager } = await import('/src/ui/toast-manager.ts');
      if ((window as any).__atlasTestApi.getState().active?.worldId !== w) await (activateWorld as any)(w, toastManager);
      window.location.hash = `#/w/${w}`;
    }, wid);
    await expect(page.locator('[data-role="home-strand"] [data-box="now"]')).toBeVisible();
    await expect(lineIn(page, 'event')).toHaveCount(1);
    await expect(lineIn(page, 'now')).toHaveCount(0);
    await expect(lineIn(page, 'character')).toHaveCount(0);
    await expect(page.locator('[data-role="strand-line-strut"]')).toHaveCount(0);
  });
}

// The code gate's C1: a page opened before it was the main character's is noted when opened after.
for (const tag of ['', ' @firefox']) {
  test(`the character's page opened before they were the main character, then after: their line goes${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const wid = await wholeStrand(page, { story: { protagonist: null } });
    await go(page, `#/w/${wid}/element/${C}`);
    await expect(page.locator('.atlas-middle-header')).toContainText('Odile Varn');
    await go(page, `#/w/${wid}`);
    await expect(page.locator('.atlas-world-home')).toBeVisible();
    // The story names her now (the Character card's Pick, another tab, a pull).
    await page.evaluate(async ([s, c]) => {
      const api = (window as any).__atlasTestApi;
      await api.getActiveStore().updateElement(s, { protagonist: c });
      api.patchData(await api.getActiveStore().listElements());
    }, [S, C]);
    await expect(lineWordsIn(page, 'character')).toHaveText('Their page holds everything about them.');
    await page.locator('[data-role="home-strand"] [data-strand-key="line:character:page"]').click();
    await expect(page.locator('.atlas-middle-header')).toContainText('Odile Varn');
    await page.goBack();
    await expect(page.locator('.atlas-world-home')).toBeVisible();
    await expect(page.locator('[data-role="home-strand"] [data-box="character"]')).toBeVisible();
    await expect(lineIn(page, 'character')).toHaveCount(0);
  });
}

test.describe('G2 on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  // One column holds no row (1.121.2), and a whole strand holds none (1.122.0): the Edit card giving way to the
  // shorter box lifts the boxes below it back to where they stood before Edit here opened it.
  test('G2 at 390: no filled box moves when a line goes by its x, by a date arriving, or when a map is made; a date saved keeps the event\'s box where its card stood', async ({ page }) => {
    const moves = await movesAsLinesGo(page);
    for (const way of ['hide', 'dateBack', 'dateIn', 'map', 'pin'] as const) {
      for (const [slot, d] of Object.entries(moves[way])) expect(Math.abs(d), `the ${slot} box when ${way}`).toBeLessThan(0.5);
    }
    expect(Math.abs(moves.date.event), 'the event box when a date is saved').toBeLessThan(0.5);
    expect(Math.abs(moves.date.narrative), 'the story box when a date is saved').toBeLessThan(0.5);
  });
});
