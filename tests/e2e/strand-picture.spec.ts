/**
 * The strand's picture and the strand's rooms (Atlas 1.121.0). A whole strand on Home's Picture: its five
 * squares at their fixed cells (read by data-line, data-pos, data-row), and no drawn line passing through
 * any square (its own two ends aside) or any name, sampled along each SVG path with getPointAtLength
 * against the squares' and names' boxes, at 1440 and 390, in Chromium and Firefox; the same with four more
 * elements (a Character standing in the strand's place, another Event in the story, a Location holding a
 * Creature, the story and its event naming the Location too). Each box's room act lands where it says and Back puts the focus on it, in both engines and on
 * a phone. The story's box keeps its second line's room, so the Character make moves nothing (W5).
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

/** A whole strand, written as the journey writes it; `rest` adds four elements after it. */
async function wholeStrand(page: Page, opts: { rest?: boolean; map?: boolean } = {}): Promise<string> {
  const wid = await setupWorld(page);
  await put(page, 'narrative', S, 'The Lantern Ferry', {
    supertype: 'Book', story: 'Every night a ferry crosses the black lake.', events: opts.rest ? [E, THAW] : [E], protagonist: C,
    // The marsh is a place in the story and in its event too: at 390 it wraps to line 1, so these two lines
    // climb to the block (the channel into the story's right side, the left gutter into the event's).
    ...(opts.rest ? { locations: [MARSH] } : {}),
  });
  await put(page, 'event', E, 'The night crossing', { locations: opts.rest ? [L, MARSH] : [L], characters: [C], start_date: 1142 });
  await put(page, 'location', L, 'Saltmere Quay');
  await put(page, 'character', C, 'Odile Varn', { location: N });
  await put(page, 'location', N, 'The Drowned Library');
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

test('on a phone, the location\'s act opens its page with the map, and Back focuses the act', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const wid = await wholeStrand(page, { map: true });
  const act = page.locator('[data-role="home-strand"] [data-strand-key="location:room"]');
  await expect(act).toHaveText('Open it with the map');
  const h = await act.boundingBox();
  expect(h!.height).toBeGreaterThanOrEqual(24);
  await act.click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toBe(`#/w/${wid}/map/${MAP}/element/${L}`);
  await expect(page.locator('.atlas-middle-header')).toContainText('Saltmere Quay');
  await page.goBack();
  await expect(page.locator('[data-role="home-strand"] [data-strand-key="location:room"]')).toBeFocused();
});

test('W5: the story\'s box keeps room for its second line, so the Character make moves the Event box 0 px at 1440', async ({ page }) => {
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
  await answer('narrative', 'The Lantern Ferry');
  await answer('event', 'The night crossing', '1142');
  await answer('location', 'Saltmere Quay');
  const lines = page.locator('[data-role="home-strand"] [data-box="narrative"] [data-role="strand-lines"] p:not([aria-hidden])');
  await expect(lines).toHaveCount(1);
  // The Event box's top within the Strand panel (the page scrolls to the next card, so never the viewport's).
  const eventTop = () => page.evaluate(() => {
    const panel = document.querySelector('[data-role="home-strand"]')!;
    const box = panel.querySelector('[data-box="event"]')!;
    return box.getBoundingClientRect().top - panel.getBoundingClientRect().top;
  });
  const before = await eventTop();
  await answer('character', 'Odile Varn');
  await expect(lines).toHaveCount(2);
  expect(await eventTop() - before).toBe(0);
});
