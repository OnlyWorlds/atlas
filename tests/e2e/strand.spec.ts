/**
 * The world's strand (the strand profile; Atlas 1.114): Home's Strand tab beside its picture, the five
 * boxes and their writes read back from world.json and each element's one field, Change with its
 * promise, a mark moved by a second tab refused, who gets which box, Make this
 * the world's strand on a story's page and in the writing room's bar, the frame beside the story
 * changing without a keystroke, the focus after a write, the tab's keys in Firefox, and a phone.
 *
 * A mark of three string ids reads as a strand on every SDK serial, so most specs seed one whose
 * unfilled members name nothing here. The specs tagged [half-mark] pass through a mark with nulls,
 * which the SDK reads as a strand only from the serial that reads a half mark: they skip themselves
 * until the installed SDK does.
 */
import { test, expect, type Page } from '@playwright/test';

const AT = '2026-10-31T00:00:00.000Z';
const N1 = '0192a000-0000-7000-8000-000000700001';
const N2 = '0192a000-0000-7000-8000-000000700002';
const E1 = '0192a000-0000-7000-8000-000000700011';
const L1 = '0192a000-0000-7000-8000-000000700021';
const L2 = '0192a000-0000-7000-8000-000000700022';
const C1 = '0192a000-0000-7000-8000-000000700031';
const C2 = '0192a000-0000-7000-8000-000000700032';
/** Ids that name nothing here: the unfilled members of a three-id mark. */
const GONE_E = '0192a000-0000-7000-8000-0000007000e1';
const GONE_L = '0192a000-0000-7000-8000-0000007000e2';

/** Skips the spec while the installed SDK reads a mark with only its story set as no strand (asked in the page). */
async function halfMark(page: Page): Promise<void> {
  await page.goto('/');
  const reads = await page.evaluate(async () => {
    const m = await import('/src/core/strand.ts');
    const meta = { id: 'w', name: 'W', x_strand: { narrative: 'n', event: null, location: null } };
    return (m as any).strandView(meta, [{ id: 'n', type: 'narrative', name: 'N' }]).narrative !== null;
  });
  test.skip(!reads, 'the installed SDK reads a half mark as no strand yet');
}

async function setupWorld(page: Page, name = 'strandworld'): Promise<string> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('strand-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // The world is open (on a phone the sidebar is a drawer, so its search is not in view).
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return !!s.active && !s.data.loading;
  });
  return page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
}

/** The world's registry entry patched (and saved), as Done or a writing setup writes it. */
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
const pastPath = (page: Page) => patchEntry(page, { guide_step: 'done' });

async function put(page: Page, type: string, id: string, name: string, extra: Record<string, unknown> = {}): Promise<void> {
  await page.evaluate(async ({ type, id, name, extra, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim(type, { id, type, name, local_updated_at: at, ...extra });
    api.patchData(await store.listElements());
  }, { type, id, name, extra, at: AT });
}

/** world.json's world meta written; `mirror` patches the open world as a pull does (else only the disk moves, as another tab's write). */
async function writeMeta(page: Page, patch: Record<string, unknown>, mirror = true): Promise<void> {
  await page.evaluate(async ({ patch, mirror }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const body: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) body[k] = v === null ? undefined : v;
    await store.writeWorldMeta(body);
    if (mirror) {
      const { getState, patchActiveMeta } = await import('/src/core/state.ts');
      patchActiveMeta(getState().active!.worldId, body as never);
    }
  }, { patch, mirror });
}
const setMark = (page: Page, mark: unknown, mirror = true) => writeMeta(page, { x_strand: mark }, mirror);

async function markOnDisk(page: Page): Promise<unknown> {
  return page.evaluate(async () => {
    const meta = await (window as any).__atlasTestApi.getActiveStore().readWorldMeta();
    return meta.x_strand ?? null;
  });
}
async function fieldOf(page: Page, id: string, field: string): Promise<unknown> {
  return page.evaluate(async ({ id, field }) => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.id === id)?.[field] ?? null;
  }, { id, field });
}
async function idByName(page: Page, name: string): Promise<string> {
  return page.evaluate(async (n) => {
    const els = await (window as any).__atlasTestApi.getActiveStore().listElements();
    return els.find((e: any) => e.name === n)?.id ?? '';
  }, name);
}

const go = (page: Page, hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);
const tab = (page: Page, t: 'picture' | 'strand') => page.locator(`[data-role="home-tabs"] [data-tab="${t}"]`);
const box = (page: Page, slot: string) => page.locator(`[data-role="home-strand"] [data-slot="${slot}"]`);
const actIn = (page: Page, slot: string, a: string) => box(page, slot).locator(`[data-act="${a}"]`);

async function pick(page: Page, slot: string, name: string): Promise<void> {
  await actIn(page, slot, 'pick').click();
  await box(page, slot).locator('[data-role="strand-filter"]').fill(name);
  await box(page, slot).locator('[role="option"]', { hasText: name }).first().click();
}
async function make(page: Page, slot: string, name: string): Promise<void> {
  await actIn(page, slot, 'make').click();
  await box(page, slot).locator('[data-role="strand-name"]').fill(name);
  await box(page, slot).locator('[data-role="strand-name"]').press('Enter');
}
/** The box names its element: the write has landed, so the disk can be read. */
const filled = (page: Page, slot: string, name: string) => expect(box(page, slot).locator('.atlas-home-strand-name')).toHaveText(name);
/** The focus is in the box the write wrote (S6, G13). */
async function expectFocusIn(page: Page, slot: string): Promise<void> {
  await expect.poll(() => page.evaluate((s) => !!document.activeElement?.closest(`[data-slot="${s}"]`), slot)).toBe(true);
}

/** A world with a story, a happening it lists and two places, past its first steps, on Home. */
async function seeded(page: Page, mark: unknown, meta?: Record<string, unknown>): Promise<string> {
  const wid = await setupWorld(page);
  await put(page, 'narrative', N1, 'The Long Road', { supertype: 'Book', events: [E1] });
  await put(page, 'event', E1, 'The Fire', { locations: [] });
  await put(page, 'location', L1, 'The Harbour');
  await put(page, 'location', L2, 'The Lighthouse');
  await put(page, 'character', C1, 'Mira');
  await put(page, 'character', C2, 'Ilse');
  if (mark !== undefined) await setMark(page, mark);
  // World meta in place before Home's first draw past the path (a reader's slice, for one).
  if (meta) await writeMeta(page, meta);
  await pastPath(page);
  // The world opened empty, and an empty world's first draw chose Strand for the session (G13, 1.115.0):
  // forget that choice, as a new session would, so Home's next opening picks its tab from what is here.
  await page.evaluate(async () => { ((await import('/src/middle/home-strand.ts')) as any).resetStrandTabForTests(); });
  await go(page, `#/w/${wid}/settings`);
  await expect(page.locator('.atlas-world-home')).toHaveCount(0);
  await go(page, `#/w/${wid}`);
  await expect(page.locator('.atlas-world-home')).toBeVisible();
  return wid;
}

test.describe('the Strand tab', () => {
  test('Picture by default without a strand; a pulled story does not switch it; Strand by default when the story is filled', async ({ page }) => {
    await seeded(page, undefined);
    await expect(tab(page, 'picture')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#atlas-home-tabpanel [data-role="home-grow-picture"], #atlas-home-tabpanel [data-role="home-picture"]')).toHaveCount(1);
    await expect(page.locator('[data-role="home-strand"]')).toHaveCount(0);
    // A pull fills the story: the tab drawn stays (G13).
    await setMark(page, { narrative: N1, event: GONE_E, location: GONE_L });
    await expect(tab(page, 'picture')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-role="home-strand"]')).toHaveCount(0);
    // The press: the strand, the picture not built.
    await tab(page, 'strand').click();
    await expect(box(page, 'narrative')).toContainText('The Long Road');
    await expect(page.locator('#atlas-home-tabpanel [data-role="home-grow-picture"]')).toHaveCount(0);
    await expect(tab(page, 'strand')).toBeFocused();

    // A world whose first draw has its story filled opens on Strand.
    await seeded(page, { narrative: N1, event: GONE_E, location: GONE_L });
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    await expect(box(page, 'narrative').locator('.atlas-home-strand-name')).toHaveText('The Long Road');
    await expect(box(page, 'event')).toContainText('Empty');
    await expect(box(page, 'location')).toContainText('After the happening');
  });

  test('where it happened, the hero and where the hero is now, by Pick, Make one and Same place; each field read back, the focus on the box it wrote', async ({ page }) => {
    await seeded(page, { narrative: N1, event: E1, location: GONE_L });
    await expect(box(page, 'event').locator('.atlas-home-strand-name')).toHaveText('The Fire');

    await pick(page, 'location', 'The Harbour');
    await expect(box(page, 'location').locator('.atlas-home-strand-name')).toHaveText('The Harbour');
    expect(await markOnDisk(page)).toEqual({ narrative: N1, event: E1, location: L1 });
    expect(await fieldOf(page, E1, 'locations')).toEqual([L1]);
    await expectFocusIn(page, 'location');

    await make(page, 'character', 'Arden');
    await expect(box(page, 'character').locator('.atlas-home-strand-name')).toHaveText('Arden');
    const arden = await idByName(page, 'Arden');
    expect(await fieldOf(page, N1, 'protagonist')).toBe(arden);
    expect(await markOnDisk(page)).toEqual({ narrative: N1, event: E1, location: L1 });
    await expectFocusIn(page, 'character');

    await actIn(page, 'now', 'same').click();
    await expect(box(page, 'now').locator('.atlas-home-strand-name')).toHaveText('The Harbour');
    await expect(box(page, 'now').locator('[data-role="strand-same"]')).toHaveText('The same place');
    expect(await fieldOf(page, arden, 'location')).toBe(L1);
    await expectFocusIn(page, 'now');
  });

  test('Change on a filled box says what it will do, and only the second press writes', async ({ page }) => {
    await seeded(page, { narrative: N1, event: E1, location: GONE_L });
    await page.evaluate(async ({ n1, c1 }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.updateElement(n1, { protagonist: c1 });
      api.patchData(await store.listElements());
    }, { n1: N1, c1: C1 });
    await expect(box(page, 'character').locator('.atlas-home-strand-name')).toHaveText('Mira');
    await actIn(page, 'character', 'change').click();
    await pick(page, 'character', 'Ilse');
    await expect(box(page, 'character').locator('[data-role="strand-promise"]')).toHaveText('Ilse will be the hero in place of Mira.');
    expect(await fieldOf(page, N1, 'protagonist')).toBe(C1);
    await expect(actIn(page, 'character', 'confirm')).toBeFocused();
    await actIn(page, 'character', 'confirm').click();
    await expect(box(page, 'character').locator('.atlas-home-strand-name')).toHaveText('Ilse');
    expect(await fieldOf(page, N1, 'protagonist')).toBe(C2);

    // The story: a new one that lists the same happening keeps it (and its place).
    await put(page, 'narrative', N2, 'The Short Road', { supertype: 'Book', events: [E1] });
    await actIn(page, 'narrative', 'change').click();
    await pick(page, 'narrative', 'The Short Road');
    await expect(box(page, 'narrative').locator('[data-role="strand-promise"]')).toHaveText('The Short Road will be the story in place of The Long Road.');
    await actIn(page, 'narrative', 'cancel').click();
    await expect(box(page, 'narrative').locator('.atlas-home-strand-name')).toHaveText('The Long Road');
    expect((await markOnDisk(page) as any).narrative).toBe(N1);
  });

  test('a mark another tab changed between the draw and the press is refused, and nothing is written', async ({ page }) => {
    await seeded(page, { narrative: N1, event: E1, location: GONE_L });
    await expect(box(page, 'location')).toContainText('Empty');
    await actIn(page, 'location', 'pick').click();
    // Another tab moves the strand on disk while this one still draws the old.
    await put(page, 'narrative', N2, 'The Short Road', { supertype: 'Book' });
    await setMark(page, { narrative: N2, event: GONE_E, location: GONE_L }, false);
    await box(page, 'location').locator('[role="option"]', { hasText: 'The Harbour' }).click();
    await expect(page.locator('[data-role="strand-say"]')).toHaveText('The strand changed meanwhile.');
    expect(await fieldOf(page, E1, 'locations')).toEqual([]);
    expect(await markOnDisk(page)).toEqual({ narrative: N2, event: GONE_E, location: GONE_L });
  });

  test('a contributor: no tab without a strand; with one, only the hero\'s box; a view-only world reads it with one line', async ({ page }) => {
    // A contributor from Home's first draw past the path: no tab head was ever drawn here.
    await seeded(page, undefined, { exported_as: { kind: 'member', role: 'contributor' } });
    await expect(page.locator('.atlas-home-statline')).toBeVisible();
    await expect(page.locator('[data-role="home-tabs"]')).toHaveCount(0);
    await expect(page.locator('[data-role="home-strand"]')).toHaveCount(0);

    await setMark(page, { narrative: N1, event: E1, location: GONE_L });
    // The picture this reader was looking at stays: the pulled strand gets its tab, not the page (C4).
    await expect(tab(page, 'picture')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('[data-role="home-strand"]')).toHaveCount(0);
    await tab(page, 'strand').click();
    await expect(box(page, 'narrative').locator('.atlas-home-strand-name')).toHaveText('The Long Road');
    await expect(box(page, 'narrative').locator('[data-act]')).toHaveCount(0);
    await expect(box(page, 'location').locator('[data-act]')).toHaveCount(0);
    await expect(box(page, 'character').locator('[data-act="make"]')).toBeVisible();

    await patchEntry(page, { copy_of: { world_id: 'elsewhere' } });
    await expect(page.locator('[data-role="strand-read-only"]')).toHaveText('The owner or a co-builder chooses the strand.');
    await expect(page.locator('[data-role="home-strand"] [data-act]')).toHaveCount(0);
  });
});

test.describe('Make this the world\'s strand', () => {
  test('from the page: "instead of", Open it on the Strand tab, and Clear the strand after its promise', async ({ page }) => {
    const wid = await seeded(page, { narrative: N1, event: E1, location: L1 });
    await put(page, 'narrative', N2, 'The Short Road', { supertype: 'Book', events: [E1] });
    await page.evaluate(async ({ e1, l1 }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.updateElement(e1, { locations: [l1] });
      api.patchData(await store.listElements());
    }, { e1: E1, l1: L1 });
    await go(page, `#/w/${wid}/element/${N2}`);
    const offer = page.locator('[data-role="strand-offer"]');
    await expect(offer.locator('[data-action="strand-make"]')).toHaveText("Make this the world's strand instead of The Long Road");
    await offer.locator('[data-action="strand-make"]').click();
    await expect(offer).toContainText("This is the world's strand");
    expect(await markOnDisk(page)).toEqual({ narrative: N2, event: E1, location: L1 });
    const toast = page.locator('.ow-toast', { hasText: "The world's strand" });
    await toast.locator('.ow-toast-action', { hasText: 'Open it' }).click();
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    await expect(box(page, 'narrative').locator('.atlas-home-strand-name')).toHaveText('The Short Road');
    await expect(box(page, 'location').locator('.atlas-home-strand-name')).toHaveText('The Harbour');

    await go(page, `#/w/${wid}/element/${N2}`);
    await offer.locator('[data-action="strand-clear"]').click();
    await expect(page.locator('[data-role="strand-clear-promise"]')).toContainText('The Short Road will no longer be the world\'s strand');
    expect(await markOnDisk(page)).toEqual({ narrative: N2, event: E1, location: L1 });
    await offer.locator('[data-action="strand-clear-confirm"]').click();
    await expect(offer.locator('[data-action="strand-make"]')).toHaveText("Make this the world's strand");
    expect(await markOnDisk(page)).toBeNull();
  });

  test('from the writing room\'s bar: the bar and the frame change without a keystroke, on a press and on a pull', async ({ page }) => {
    const wid = await seeded(page, { narrative: N1, event: E1, location: GONE_L });
    await put(page, 'narrative', N2, 'The Short Road', { supertype: 'Book', events: [E1] });
    // The happening lists the mark's place (an id that names nothing here), so a story change keeps all
    // three members and the mark reads as a strand on every SDK serial.
    await page.evaluate(async ({ e1, gone }) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.updateElement(e1, { locations: [gone] });
      api.patchData(await store.listElements());
    }, { e1: E1, gone: GONE_L });
    await patchEntry(page, { writing_initialized: true });
    await go(page, `#/w/${wid}/writing/${N2}`);
    await page.locator('.atlas-tab[data-tab-kind="context"]').click();
    await expect(page.locator('.atlas-context-pane')).toBeVisible();
    const bar = page.locator('.atlas-writing-workspace-crumb [data-action="strand-make"]');
    await expect(bar).toHaveText("Make this the world's strand instead of The Long Road");
    await expect(page.locator('[data-role="strand-frame"]')).toHaveCount(0);
    await bar.click();
    await expect(bar).toHaveCount(0);
    const frame = page.locator('[data-role="strand-frame"]');
    await expect(frame).toContainText("This story is the world's strand");
    await expect(frame.locator('[data-slot="event"] [data-action="strand-open"]')).toHaveText(/The Fire/);
    await expect(frame.locator('[data-slot="character"] [data-action="strand-pick-on-home"]')).toHaveText('Pick on Home');
    expect(await markOnDisk(page)).toEqual({ narrative: N2, event: E1, location: GONE_L });

    // A pull takes the strand elsewhere: the bar offers again and the frame goes, with no keystroke.
    await setMark(page, { narrative: N1, event: E1, location: GONE_L });
    await expect(frame).toHaveCount(0);
    await expect(bar).toHaveText("Make this the world's strand instead of The Long Road");
  });

  test('[half-mark] from the bar on a world with no strand: the bar then shows nothing and the frame leads the context', async ({ page }) => {
    await halfMark(page);
    const wid = await seeded(page, undefined);
    await patchEntry(page, { writing_initialized: true });
    await go(page, `#/w/${wid}/writing/${N1}`);
    await page.locator('.atlas-tab[data-tab-kind="context"]').click();
    const bar = page.locator('.atlas-writing-workspace-crumb [data-action="strand-make"]');
    await expect(bar).toHaveText("Make this the world's strand");
    await bar.click();
    await expect(bar).toHaveCount(0);
    await expect(page.locator('[data-role="strand-frame"]')).toContainText("This story is the world's strand");
  });
});

test.describe('story first to a full strand', () => {
  test('[half-mark] by Pick from the world, each press read back', async ({ page }) => {
    await halfMark(page);
    await seeded(page, undefined);
    await tab(page, 'strand').click();
    await pick(page, 'narrative', 'The Long Road');
    await expect(box(page, 'narrative').locator('.atlas-home-strand-name')).toHaveText('The Long Road');
    expect(await markOnDisk(page)).toEqual({ narrative: N1, event: null, location: null });
    await expectFocusIn(page, 'narrative');
    await pick(page, 'event', 'The Fire');
    await filled(page, 'event', 'The Fire');
    expect(await markOnDisk(page)).toEqual({ narrative: N1, event: E1, location: null });
    expect(await fieldOf(page, N1, 'events')).toEqual([E1]);
    await pick(page, 'location', 'The Harbour');
    await filled(page, 'location', 'The Harbour');
    expect(await markOnDisk(page)).toEqual({ narrative: N1, event: E1, location: L1 });
    expect(await fieldOf(page, E1, 'locations')).toEqual([L1]);
    await pick(page, 'character', 'Mira');
    await filled(page, 'character', 'Mira');
    expect(await fieldOf(page, N1, 'protagonist')).toBe(C1);
    await pick(page, 'now', 'The Lighthouse');
    await filled(page, 'now', 'The Lighthouse');
    expect(await fieldOf(page, C1, 'location')).toBe(L2);
  });

  test('[half-mark] by Make one, each press read back', async ({ page }) => {
    await halfMark(page);
    await seeded(page, undefined);
    await tab(page, 'strand').click();
    await make(page, 'narrative', 'A New Tale');
    await filled(page, 'narrative', 'A New Tale');
    const tale = await idByName(page, 'A New Tale');
    expect(await fieldOf(page, tale, 'supertype')).toBe('Book');
    expect(await markOnDisk(page)).toEqual({ narrative: tale, event: null, location: null });
    await make(page, 'event', 'The Flood');
    await filled(page, 'event', 'The Flood');
    const flood = await idByName(page, 'The Flood');
    expect(await fieldOf(page, tale, 'events')).toEqual([flood]);
    await make(page, 'location', 'The Weir');
    await filled(page, 'location', 'The Weir');
    const weir = await idByName(page, 'The Weir');
    expect(await markOnDisk(page)).toEqual({ narrative: tale, event: flood, location: weir });
    expect(await fieldOf(page, flood, 'locations')).toEqual([weir]);
    await make(page, 'character', 'Ottilie');
    await filled(page, 'character', 'Ottilie');
    const ottilie = await idByName(page, 'Ottilie');
    expect(await fieldOf(page, tale, 'protagonist')).toBe(ottilie);
    await make(page, 'now', 'The Mill');
    await filled(page, 'now', 'The Mill');
    expect(await fieldOf(page, ottilie, 'location')).toBe(await idByName(page, 'The Mill'));
    await expectFocusIn(page, 'now');
  });
});

for (const tag of ['', ' @firefox']) {
  test(`the tab head is one Tab stop, and the arrows move between Picture and Strand${tag}`, async ({ page }) => {
    await seeded(page, undefined);
    await tab(page, 'picture').focus();
    await expect(tab(page, 'strand')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowRight');
    await expect(tab(page, 'strand')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'strand')).toBeFocused();
    await expect(page.locator('[data-role="home-strand"]')).toBeVisible();
    await expect(tab(page, 'picture')).toHaveAttribute('tabindex', '-1');
    await page.keyboard.press('ArrowLeft');
    await expect(tab(page, 'picture')).toHaveAttribute('aria-selected', 'true');
    await expect(tab(page, 'picture')).toBeFocused();
    await expect(page.locator('[data-role="home-strand"]')).toHaveCount(0);
    // Tab leaves the head: never onto the other tab.
    await page.keyboard.press('Tab');
    await expect(tab(page, 'strand')).not.toBeFocused();
    await expect(tab(page, 'picture')).not.toBeFocused();
  });
}

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the boxes fit 390 px and every act and tab takes a thumb', async ({ page }) => {
    await seeded(page, { narrative: N1, event: E1, location: GONE_L });
    await expect(box(page, 'location')).toBeVisible();
    const targets: Array<[string, ReturnType<typeof tab>]> = [
      ['Picture', tab(page, 'picture')], ['Strand', tab(page, 'strand')], ['Make one', actIn(page, 'location', 'make')],
      ['Pick from the world', actIn(page, 'location', 'pick')], ['Change', actIn(page, 'event', 'change')],
      ['the happening\'s name', box(page, 'event').locator('.atlas-home-strand-name')],
    ];
    for (const [word, target] of targets) {
      expect(Math.round((await target.boundingBox())!.height), word).toBeGreaterThanOrEqual(44);
    }
    const over = await page.evaluate(() => {
      const r = document.querySelector('[data-role="home-strand"]')!.getBoundingClientRect();
      return { right: r.right, width: window.innerWidth, scroll: document.documentElement.scrollWidth };
    });
    expect(over.right).toBeLessThanOrEqual(over.width);
    expect(over.scroll).toBeLessThanOrEqual(over.width);
  });
});

/** Own-eyes pictures: written only when STRAND_SHOTS names a folder. */
test('pictures of the tab at 1280 and 390, light and dark', async ({ page }) => {
  const dir = process.env.STRAND_SHOTS;
  test.skip(!dir, 'STRAND_SHOTS not set');
  await page.setViewportSize({ width: 1280, height: 900 });
  await seeded(page, { narrative: N1, event: E1, location: GONE_L });
  await expect(box(page, 'location')).toBeVisible();
  for (const theme of ['dark', 'light'] as const) {
    await page.evaluate((t) => { if (t === 'light') document.documentElement.setAttribute('data-theme', 'light'); else document.documentElement.removeAttribute('data-theme'); }, theme);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${dir}/strand-${width}-${theme}.png`, fullPage: false });
    }
  }
});
