/**
 * The strand's picture and the strand's rooms (Atlas 1.121.0). A whole strand on Home's Picture: its five
 * squares at their fixed cells (read by data-line, data-pos, data-row), and no drawn line passing through
 * any square (its own two ends aside) or any name, sampled along each SVG path with getPointAtLength
 * against the squares' and names' boxes, at 1440 and 390, in Chromium and Firefox; the same with four more
 * elements (a Character standing in the strand's place, another Event in the story, a Location holding a
 * Creature, the story and its event naming the Location too). A Zone's Location's Character two deep beside
 * the lines that climb to the block, at 390 and 1440 (the code gate's C1), and a whole strand at a 20 px
 * root font (C2). Each box's room act lands where it says and Back puts the focus on it, in both engines
 * and on a phone, where the map opens in its drawer (C3). The story's box keeps its second line's room, so
 * the Event make moves nothing (W5).
 *
 * Screenshots for a look: ATLAS_SNAPS=<dir> writes each Picture there.
 */
import { test, expect, type Page } from '@playwright/test';

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

/** A whole strand, written as the journey writes it; `rest` adds four elements after it; `names` renames its five; `story` adds to the story. */
async function wholeStrand(page: Page, opts: { rest?: boolean; map?: boolean; names?: string[]; story?: Record<string, unknown> } = {}): Promise<string> {
  const wid = await setupWorld(page);
  const [sName, eName, lName, cName, nName] = opts.names ?? ['The Lantern Ferry', 'The night crossing', 'Saltmere Quay', 'Odile Varn', 'The Drowned Library'];
  await put(page, 'narrative', S, sName, {
    supertype: 'Book', story: 'Every night a ferry crosses the black lake.', events: opts.rest ? [E, THAW] : [E], protagonist: C,
    // The marsh is a place in the story and in its event too: at 390 it wraps to line 1, so these two lines
    // climb to the block (the channel into the story's right side, the left gutter into the event's).
    ...(opts.rest ? { locations: [MARSH] } : {}),
    ...opts.story,
  });
  await put(page, 'event', E, eName, { locations: opts.rest ? [L, MARSH] : [L], characters: [C], start_date: 1142 });
  await put(page, 'location', L, lName);
  await put(page, 'character', C, cName, { location: N });
  await put(page, 'location', N, nName);
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

  test(`each box's room act lands where it says, and Back puts the focus on it${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const wid = await wholeStrand(page, { map: true });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    const lands: Array<[string, string, (p: Page) => Promise<void>]> = [
      ['narrative', `#/w/${wid}/writing/${S}`, async p => {
        await expect(p.locator('.atlas-writing-workspace')).toBeVisible();
        // R4: the empty Book's line at the body's top, gone once its first chapter lands.
        const empty = p.locator('.atlas-writing-workspace-body > [data-role="writing-empty-book"]');
        await expect(empty).toHaveText('A chapter can be any part you like: a chapter, an act, a session. Press + to add one.');
        await put(p, 'narrative', '0192a000-0000-7000-8000-000000950031', 'Chapter one', { supertype: 'Chapter', parent_narrative: S });
        await expect(empty).toHaveCount(0);
      }],
      ['event', `#/w/${wid}/timeline/${E}`, async p => { await expect(p.locator('.atlas-world-home')).toHaveCount(0); }],
      ['location', `#/w/${wid}/map/${MAP}/element/${L}`, async p => {
        await expect(p.locator('.atlas-middle-header')).toContainText('Saltmere Quay');
        await expect.poll(() => p.evaluate(() => {
          const ui = (window as any).__atlasTestApi.getState().ui;
          return [ui.rightTabs[ui.rightActiveIndex]?.mapId ?? null, ui.pinPlacement ?? null];
        })).toEqual([MAP, null]);
      }],
      ['character', `#/w/${wid}/element/${C}`, async p => { await expect(p.locator('.atlas-middle-header')).toContainText('Odile Varn'); }],
      ['now', `#/w/${wid}/map/${MAP}/element/${N}`, async p => { await expect(p.locator('.atlas-middle-header')).toContainText('The Drowned Library'); }],
    ];
    for (const [slot, hash, landed] of lands) {
      const act = page.locator(`[data-role="home-strand"] [data-strand-key="${slot}:room"]`);
      await act.click();
      await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(hash);
      await landed(page);
      // The act never armed placement or wrote: the placing class is off.
      expect(await page.evaluate(() => document.body.classList.contains('atlas-placing'))).toBe(false);
      await page.goBack();
      await expect(page.locator('.atlas-world-home')).toBeVisible();
      await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator(`[data-role="home-strand"] [data-strand-key="${slot}:room"]`)).toBeFocused();
    }
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

test('on a phone, the location\'s act opens its page with the map in its drawer, and Back focuses the act', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wid = await wholeStrand(page, { map: true });
  const act = page.locator('[data-role="home-strand"] [data-strand-key="location:room"]');
  await expect(act).toHaveText('Open it with the map');
  const h = await act.boundingBox();
  expect(h!.height).toBeGreaterThanOrEqual(24);
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
  await expect(page.locator('[data-role="home-strand"] [data-strand-key="location:room"]')).toBeFocused();
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
  test(`W5 at every make: no filled box moves when another is made, nor while it is made, at 1440; Home opened again holds nothing${tag}`, async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const moves = await movesAtEachMake(page, SNAPS ? `${SNAPS}/strand-w5-event-1440${tag ? '-firefox' : '-chromium'}.png` : undefined);
    for (const [make, m] of Object.entries(moves)) {
      for (const [b, d] of Object.entries(m.end)) expect(Math.abs(d), `the ${b} box after the ${make} make`).toBeLessThan(0.5);
      for (const [b, d] of Object.entries(m.frame)) expect(d, `the ${b} box while the ${make} make ran`).toBeLessThan(0.5);
    }
    // What the holds changed, read by taking every hold off: only the Event's row is held (its two
    // cells taller), the room stays under what a cell holds (no box taller, none lower in its cell), and
    // Home opened again holds nothing.
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
    expect(await tallerHeld()).toEqual(['cell event', 'cell location']);
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await reopenHome(page, wid);
    await expect(page.locator('[data-role="home-strand"] [data-box="now"]')).toBeVisible();
    expect(await tallerHeld()).toEqual([]);
  });
}

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
