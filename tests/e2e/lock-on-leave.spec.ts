/**
 * A world closed with its tab is free at once (DESIGN_LAWS conv. 13): each
 * open store holds a Web Lock of its own, named in `.atlas/lock`, and the
 * browser releases it when the page dies. A real tab close and a real
 * browser quit (a persistent profile, closed and launched again) then open
 * the world with no confirm; the control (the same quit, its lock read as
 * another browser's) and a true second page still meet the confirm, after
 * the claim's wait. The confirm's Cancel, and the open from the address at
 * startup, say why the world stayed closed. Each row runs in Chromium and,
 * tagged @firefox, in Firefox.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import { rmSync } from 'node:fs';

const SALTMERE = { name: 'Saltmere', worldId: '0192c000-0000-7000-8000-00000000cccc', dir: 'saltmere-0192c000-5e6f' };
const HARBOR = { name: 'Harbor', worldId: '0192d000-0000-7000-8000-00000000dddd', dir: 'harbor-0192d000-7a8b' };
const STAYED = 'stayed closed here. Another Atlas tab may still have it open. Close that tab and open the world again here, or open it again and choose to take it over.';
/** Said when the world's own make-and-move lock is busy: no take-over offered. */
const BUSY = 'stayed closed here. Another Atlas tab may still have it open, or be moving it. Open it again here once that tab is done.';
/** Either of the two: a page that loses a start race loses at one check or the other. */
const EITHER = /stayed closed here\. Another Atlas tab may still have it open/;
const TRY_AGAIN = 'Atlas could not open this world just now. Try again in a moment.';

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll().catch(() => {}); });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  // The boot reconciliation runs first on the activation chain: wait it out.
  await page.evaluate(async () => {
    const { enqueueActivationTask } = await import('/src/core/activation-chain.ts');
    await enqueueActivationTask(async () => {});
  });
}

/** Browser worlds, registered as the app registers them; their registry ids. */
async function seed(page: Page, worlds: Array<typeof SALTMERE>): Promise<string[]> {
  return page.evaluate(async (list) => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds', { create: true });
    const write = async (d: FileSystemDirectoryHandle, file: string, body: unknown) => {
      const w = await (await d.getFileHandle(file, { create: true })).createWritable();
      await w.write(JSON.stringify(body, null, 2) + '\n');
      await w.close();
    };
    const ids: string[] = [];
    for (const { name, worldId, dir } of list) {
      const d = await home.getDirectoryHandle(dir, { create: true });
      await write(d, 'world.json', { id: worldId, name });
      const chars = await (await d.getDirectoryHandle('elements', { create: true })).getDirectoryHandle('character', { create: true });
      await write(chars, `ada--${worldId.slice(-8)}.json`, { id: `${worldId.slice(0, -4)}0001`, name: 'Ada', type: 'character' });
      const { next, entry } = (reg as any).createLocalWorld(getState().registry, {
        name, folderName: dir, handleKey: `world-${worldId}`, pathHint: `browser storage/${dir}`,
      });
      const withWhere = (reg as any).updateWorldEntry(next, entry.id, { where: 'browser' });
      (reg as any).saveRegistry(withWhere);
      patchSlice('registry', withWhere);
      ids.push(entry.id as string);
    }
    return ids;
  }, worlds);
}

async function shell(page: Page, at = '/'): Promise<void> {
  await page.goto(at);
  await page.waitForSelector('.atlas-shell');
}

const activeWorld = (page: Page) => page.evaluate(async () => (await import('/src/core/state.ts')).getState().active?.worldId ?? null);

async function clickWorld(page: Page, name: string): Promise<void> {
  await page.locator('.atlas-row[data-world-id]', { hasText: name }).click();
}

async function readLock(page: Page, dir: string): Promise<Record<string, unknown> | null> {
  return page.evaluate(async (d) => {
    try {
      const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
      const atlas = await (await home.getDirectoryHandle(d)).getDirectoryHandle('.atlas');
      return JSON.parse(await (await (await atlas.getFileHandle('lock')).getFile()).text());
    } catch {
      return null;
    }
  }, dir);
}

async function writeLock(page: Page, dir: string, lock: Record<string, unknown>): Promise<void> {
  await page.evaluate(async ({ d, body }) => {
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    const atlas = await (await home.getDirectoryHandle(d)).getDirectoryHandle('.atlas');
    const w = await (await atlas.getFileHandle('lock')).createWritable();
    await w.write(JSON.stringify(body));
    await w.close();
  }, { d: dir, body: lock });
}

/** A beat now, so a relaunch meets a lock whose heartbeat is minutes from stale. */
const beatNow = (page: Page) => page.evaluate(async () => {
  const { getActiveStore } = await import('/src/core/active-store.ts');
  await (getActiveStore() as any).__debug_heartbeat();
});

function countDialogs(page: Page): { at: number[] } {
  const seen = { at: [] as number[] };
  page.on('dialog', d => { seen.at.push(Date.now()); void d.dismiss(); });
  return seen;
}

/** The lock is live (its heartbeat well inside the 90 s) and names a Web Lock of this browser. */
function expectLiveNamedLock(lock: Record<string, unknown> | null): void {
  expect(lock).not.toBeNull();
  expect(String(lock!.web_lock)).toMatch(/^atlas-writer:/);
  expect(typeof lock!.browser_id).toBe('string');
  const age = Date.now() - Date.parse(String(lock!.last_heartbeat));
  if (process.env.LOCK_E2E_LOG) console.log(`[lock age before the click] ${age} ms`);
  expect(age).toBeLessThan(60_000);
}

async function opensWithoutConfirm(page: Page, name: string, id: string, dialogs: { at: number[] }): Promise<void> {
  await clickWorld(page, name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  expect(dialogs.at).toHaveLength(0);
}

// ---- the rows ----

async function realTabClose(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  await page.close({ runBeforeUnload: true });

  const next = await context.newPage();
  const dialogs = countDialogs(next);
  await shell(next);
  expectLiveNamedLock(await readLock(next, SALTMERE.dir));
  await opensWithoutConfirm(next, SALTMERE.name, id, dialogs);
  expect((await readLock(next, SALTMERE.dir))!.web_lock).toMatch(/^atlas-writer:/);
}

async function launch(playwright: any, browserName: string, dir: string, baseURL: string): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx: BrowserContext = await playwright[browserName].launchPersistentContext(dir, { baseURL, headless: true });
  const page = ctx.pages()[0] ?? await ctx.newPage();
  return { ctx, page };
}

/**
 * Quit with the world open, launch again on the same profile. `beforeClick`
 * runs on the relaunched page just before the click (the control rewrites
 * the lock there). Returns the relaunched page's dialogs, the page still open.
 */
async function realQuit(
  playwright: any, browserName: string, baseURL: string, profile: string,
  beforeClick: (page: Page) => Promise<void>,
): Promise<{ ctx: BrowserContext; page: Page; dialogs: { at: number[] }; id: string }> {
  const first = await launch(playwright, browserName, profile, baseURL);
  await boot(first.page);
  const [id] = await seed(first.page, [SALTMERE]);
  await shell(first.page);
  await clickWorld(first.page, SALTMERE.name);
  await expect.poll(() => activeWorld(first.page)).toBe(id);
  await beatNow(first.page);
  await first.ctx.close();

  const again = await launch(playwright, browserName, profile, baseURL);
  const dialogs = countDialogs(again.page);
  await shell(again.page);
  expectLiveNamedLock(await readLock(again.page, SALTMERE.dir));
  await beforeClick(again.page);
  return { ...again, dialogs, id };
}

async function quitRow(playwright: any, browserName: string, baseURL: string, profile: string): Promise<void> {
  const r = await realQuit(playwright, browserName, baseURL, profile, async () => {});
  try {
    await opensWithoutConfirm(r.page, SALTMERE.name, r.id, r.dialogs);
  } finally {
    await r.ctx.close();
  }
}

async function quitControl(playwright: any, browserName: string, baseURL: string, profile: string): Promise<void> {
  // The same quit, the lock read as another browser's: the ask is never
  // made, the heartbeat decides, and the pinch is back.
  const r = await realQuit(playwright, browserName, baseURL, profile, async (page) => {
    const lock = (await readLock(page, SALTMERE.dir))!;
    await writeLock(page, SALTMERE.dir, { ...lock, browser_id: 'another-browser' });
  });
  try {
    await clickWorld(r.page, SALTMERE.name);
    await expect.poll(() => r.dialogs.at.length).toBe(1);
    await expect(r.page.locator('.ow-toast', { hasText: STAYED })).toBeVisible();
    expect(await activeWorld(r.page)).toBeNull();
  } finally {
    await r.ctx.close();
  }
}

async function trueSecondPage(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  const held = (await readLock(page, SALTMERE.dir))!.web_lock;

  const second = await context.newPage();
  const dialogs = countDialogs(second);
  await shell(second);
  const t0 = Date.now();
  await clickWorld(second, SALTMERE.name);
  await expect.poll(() => dialogs.at.length).toBe(1);
  expect(dialogs.at[0] - t0).toBeGreaterThanOrEqual(1_900);
  // Cancel: the world stays closed here, and the page says why.
  await expect(second.locator('.ow-toast', { hasText: `"${SALTMERE.name}" ${STAYED}` })).toBeVisible();
  expect(await activeWorld(second)).toBeNull();
  expect((await readLock(second, SALTMERE.dir))!.web_lock).toBe(held);
  await second.close();
}

/**
 * The claim's wait on a live second page says what it checks: after one second a line, which stays
 * while the check waits and goes once the open ends (1.125.3). The wait here runs two asks (about four
 * seconds): during the first, the first page writes its lock again naming another Web Lock it holds, as
 * a store that wrote meanwhile does, and the claim asks about that one too. A sampler in the page reads
 * the line every 50 ms from the click, and the confirm (the open's end, held) is marked when it is
 * called. Was: the line, shown with no timer of its own, went about 300 ms after it came.
 */
async function checkingLineDuringTheWait(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  // The first page's own open asked no other tab: no line came.
  expect(await page.locator('.ow-toast', { hasText: 'Checking whether another tab' }).count()).toBe(0);
  // A second Web Lock of the first page, held for the test's length, for its lock to name mid-wait.
  const EXTRA = 'atlas-writer:checking-line-extra';
  await page.evaluate((name) => new Promise<void>((held) => {
    void navigator.locks.request(name, () => { held(); return new Promise(() => {}); });
  }), EXTRA);
  const lock = (await readLock(page, SALTMERE.dir))!;

  const second = await context.newPage();
  const dialogs = countDialogs(second);
  await shell(second);
  const text = `Checking whether another tab has "${SALTMERE.name}" open…`;
  await second.evaluate((want) => {
    const w = window as any;
    const has = () => Array.from(document.querySelectorAll('.ow-toast')).some(t => (t.textContent ?? '').includes(want));
    const seen = w.__checking = { t0: null as number | null, samples: [] as Array<[number, boolean]>, confirmAt: null as number | null };
    document.addEventListener('click', () => {
      if (seen.t0 !== null) return;
      seen.t0 = performance.now();
      setInterval(() => seen.samples.push([performance.now() - seen.t0!, has()]), 50);
    }, { capture: true });
    const confirm = window.confirm.bind(window);
    window.confirm = (message?: string) => {
      if (seen.t0 !== null && seen.confirmAt === null) seen.confirmAt = performance.now() - seen.t0;
      return confirm(message);
    };
  }, text);
  await clickWorld(second, SALTMERE.name);
  await page.waitForTimeout(1_000);
  await writeLock(page, SALTMERE.dir, { ...lock, web_lock: EXTRA, last_heartbeat: new Date().toISOString() });
  await expect.poll(() => dialogs.at.length, { timeout: 15_000 }).toBe(1);
  await expect(second.locator('.ow-toast', { hasText: `"${SALTMERE.name}" ${STAYED}` })).toBeVisible();
  await second.waitForTimeout(600);
  const seen = await second.evaluate(() => (window as any).__checking as { samples: Array<[number, boolean]>; confirmAt: number | null });
  const at = (ms: number) => [...seen.samples].reverse().find(([t]) => t <= ms)?.[1] ?? false;
  const firstShown = seen.samples.find(([, on]) => on)?.[0] ?? null;
  console.log(`[checking line] first shown at ${firstShown === null ? 'never' : Math.round(firstShown)} ms, the confirm at ${seen.confirmAt === null ? 'never' : Math.round(seen.confirmAt)} ms`);
  // The wait ran two asks, past three seconds.
  expect(seen.confirmAt, 'the open ended held, at the confirm').not.toBeNull();
  expect(seen.confirmAt!).toBeGreaterThan(3_300);
  // Nothing in the first second; then the line, at 1.5 s and again at 3 s, while the check still waits.
  expect(firstShown, 'the line came').not.toBeNull();
  expect(firstShown!).toBeGreaterThanOrEqual(900);
  expect(at(1_500), 'the line at 1.5 s').toBe(true);
  expect(at(3_000), 'the line at 3 s').toBe(true);
  // Gone within a moment of the open's end (its fade is 300 ms).
  expect(seen.samples.filter(([t, on]) => on && t > seen.confirmAt! + 450)).toEqual([]);
  expect(await second.locator('.ow-toast', { hasText: text }).count()).toBe(0);
  await second.close();
}

async function addressAtStartup(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);

  const second = await context.newPage();
  const dialogs = countDialogs(second);
  await shell(second, `/#/w/${id}`);
  await expect(second.locator('.ow-toast', { hasText: `"${SALTMERE.name}" ${STAYED}` })).toBeVisible();
  expect(dialogs.at).toHaveLength(0);
  expect(await activeWorld(second)).toBeNull();
  await second.close();
}

async function clickDuringTheWait(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [saltmere, harbor] = await seed(page, [SALTMERE, HARBOR]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(saltmere);

  const second = await context.newPage();
  const dialogs = countDialogs(second);
  await shell(second);
  await clickWorld(second, SALTMERE.name);
  await second.waitForTimeout(300);
  await clickWorld(second, HARBOR.name);
  await expect.poll(() => activeWorld(second)).toBe(harbor);
  await second.waitForTimeout(2_500);
  expect(dialogs.at).toHaveLength(0);
  expect(await activeWorld(second)).toBe(harbor);
  await second.close();
}

/** A page that shares the holder's tab id, as a duplicated tab does (Duplicate copies sessionStorage), at `at`. */
async function duplicateOf(page: Page, context: BrowserContext, at: string): Promise<Page> {
  const tab = await page.evaluate(() => sessionStorage.getItem('atlas_tab_id'));
  expect(tab).toBeTruthy();
  const dup = await context.newPage();
  await shell(dup);
  await dup.evaluate((t) => { sessionStorage.setItem('atlas_tab_id', t as string); }, tab);
  await dup.goto(at);
  await dup.reload();
  await dup.waitForSelector('.atlas-shell');
  expect(await dup.evaluate(() => sessionStorage.getItem('atlas_tab_id'))).toBe(tab);
  return dup;
}

async function duplicatedTabClick(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  const held = (await readLock(page, SALTMERE.dir))!.web_lock;
  const dup = await duplicateOf(page, context, '/');
  const dialogs = countDialogs(dup);
  const t0 = Date.now();
  await clickWorld(dup, SALTMERE.name);
  await expect.poll(() => dialogs.at.length).toBe(1);
  expect(dialogs.at[0] - t0).toBeGreaterThanOrEqual(1_900);
  await expect(dup.locator('.ow-toast', { hasText: STAYED })).toBeVisible();
  expect(await activeWorld(dup)).toBeNull();
  // The original still owns and beats its own lock.
  await beatNow(page);
  expect((await readLock(page, SALTMERE.dir))!.web_lock).toBe(held);
  await dup.close();
}

async function duplicatedTabAtStartup(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  const held = (await readLock(page, SALTMERE.dir))!.web_lock;
  const dup = await duplicateOf(page, context, `/#/w/${id}`);
  const dialogs = countDialogs(dup);
  await expect(dup.locator('.ow-toast', { hasText: `"${SALTMERE.name}" ${STAYED}` })).toBeVisible();
  expect(dialogs.at).toHaveLength(0);
  expect(await activeWorld(dup)).toBeNull();
  expect((await readLock(page, SALTMERE.dir))!.web_lock).toBe(held);
  await dup.close();
}

/** Another page holds the world's own make-and-move lock (`atlas-world:<dir>`) while this one starts on its address. */
async function worldLockHeldAtStartup(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page);
  await page.evaluate((dir) => new Promise<void>(held => {
    void navigator.locks.request(`atlas-world:${dir}`, () => { held(); return new Promise<void>(r => { (window as any).__releaseWorldLock = r; }); });
  }), SALTMERE.dir);
  const second = await context.newPage();
  const dialogs = countDialogs(second);
  await shell(second, `/#/w/${id}`);
  await expect(second.locator('.ow-toast', { hasText: `"${SALTMERE.name}" ${BUSY}` })).toBeVisible();
  await expect(second.locator('.ow-toast', { hasText: 'take it over' })).toHaveCount(0);
  expect(dialogs.at).toHaveLength(0);
  expect(await activeWorld(second)).toBeNull();
  await page.evaluate(() => (window as any).__releaseWorldLock());
  await second.close();
}

/** Two pages start at once on a world whose page closed: exactly one opens, and the other says why, every round. */
async function twoPagesAtStartup(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  let holder = page;
  for (let round = 0; round < 3; round++) {
    await shell(holder);
    await clickWorld(holder, SALTMERE.name);
    await expect.poll(() => activeWorld(holder)).toBe(id);
    await holder.close({ runBeforeUnload: true });
    const pages = [await context.newPage(), await context.newPage()];
    const dialogs = pages.map(countDialogs);
    await Promise.all(pages.map(p => p.goto(`/#/w/${id}`)));
    await Promise.all(pages.map(p => p.waitForSelector('.atlas-shell')));
    await expect.poll(async () => (await Promise.all(pages.map(activeWorld))).filter(x => x === id).length, { timeout: 15_000 }).toBe(1);
    const actives = await Promise.all(pages.map(activeWorld));
    const winner = pages[actives.indexOf(id)];
    const loser = pages[1 - actives.indexOf(id)];
    await expect(loser.locator('.ow-toast', { hasText: EITHER })).toBeVisible();
    expect(dialogs[0].at.length + dialogs[1].at.length).toBe(0);
    await loser.close();
    holder = winner;
  }
}

/** A click superseded during the wait puts the address back, so a newer open that fails restores the address from before both. */
async function supersededRestoresTheAddress(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [saltmere] = await seed(page, [SALTMERE, HARBOR]);
  await shell(page);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(saltmere);
  const second = await context.newPage();
  const dialogs = countDialogs(second);
  await shell(second);
  const before = await second.evaluate(() => location.hash);
  // Harbor's storage goes: its open will fail and restore the address it started from.
  await second.evaluate(async (dir) => {
    const home = await (await navigator.storage.getDirectory()).getDirectoryHandle('browser-worlds');
    await home.removeEntry(dir, { recursive: true });
  }, HARBOR.dir);
  await clickWorld(second, SALTMERE.name);
  await second.waitForTimeout(300);
  await clickWorld(second, HARBOR.name);
  await expect(second.locator('.ow-toast').filter({ hasText: 'cleared by this browser' })).toBeVisible();
  await second.waitForTimeout(2_500);
  expect(dialogs.at).toHaveLength(0);
  expect(await second.evaluate(() => location.hash)).toBe(before);
  expect(await activeWorld(second)).toBeNull();
  await second.close();
}

/**
 * The update reload: every open tab reloads into the new release over the lock
 * its old page wrote, in the old shape ({ tab_id, started_at, last_heartbeat },
 * of this very tab). It opens at start as before: no toast, no dialog.
 */
async function updateReload(page: Page): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  await shell(page, `/#/w/${id}`);
  await clickWorld(page, SALTMERE.name);
  await expect.poll(() => activeWorld(page)).toBe(id);
  const named = (await readLock(page, SALTMERE.dir))!;
  await writeLock(page, SALTMERE.dir, { tab_id: named.tab_id, started_at: named.started_at, last_heartbeat: new Date().toISOString() });
  const dialogs = countDialogs(page);
  expect(page.url()).toContain('#/w/');
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await expect.poll(() => activeWorld(page)).toBe(id);
  expect(await page.locator('.ow-toast', { hasText: EITHER }).count()).toBe(0);
  expect(dialogs.at).toHaveLength(0);
  expect(String((await readLock(page, SALTMERE.dir))!.web_lock)).toMatch(/^atlas-writer:/);
}

/** The start on a world's address when this page's own Web Lock does not come: said, never nothing. */
async function lateOwnLockAtStartup(page: Page, context: BrowserContext): Promise<void> {
  await boot(page);
  const [id] = await seed(page, [SALTMERE]);
  const second = await context.newPage();
  await second.addInitScript(() => {
    const L = navigator.locks as any;
    const orig = L.request.bind(L);
    L.request = (name: string, opts: any, cb: any) => {
      if (typeof name === 'string' && name.startsWith('atlas-writer:')) {
        return new Promise((_r, rej) => { opts?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))); });
      }
      return orig(name, opts, cb);
    };
  });
  const dialogs = countDialogs(second);
  await shell(second, `/#/w/${id}`);
  await expect(second.locator('.ow-toast', { hasText: TRY_AGAIN })).toBeVisible();
  expect(dialogs.at).toHaveLength(0);
  expect(await activeWorld(second)).toBeNull();
  expect(await readLock(second, SALTMERE.dir)).toBeNull();
  await second.close();
}

function profileDir(testInfo: { outputPath: (...p: string[]) => string }): string {
  return testInfo.outputPath('profile');
}

for (const tag of ['', ' @firefox']) {
  test.describe(`a world closed with its tab${tag}`, () => {
    test(`a real tab close: a new page opens the world with no confirm${tag}`, async ({ page, context }) => {
      await realTabClose(page, context);
    });

    test(`a real browser quit: relaunched, the world opens with no confirm${tag}`, async ({ playwright, browserName }, testInfo) => {
      test.slow();
      const profile = profileDir(testInfo);
      try {
        await quitRow(playwright, browserName, String(testInfo.project.use.baseURL), profile);
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    });

    test(`the control: after the same quit, a live lock rewritten as another browser's meets the confirm${tag}`, async ({ playwright, browserName }, testInfo) => {
      test.slow();
      const profile = profileDir(testInfo);
      try {
        await quitControl(playwright, browserName, String(testInfo.project.use.baseURL), profile);
      } finally {
        rmSync(profile, { recursive: true, force: true });
      }
    });

    test(`a true second page holding the world: the confirm after the wait, and Cancel says why${tag}`, async ({ page, context }) => {
      await trueSecondPage(page, context);
    });

    test(`the wait on a live second page says what it checks after a second, and the line goes with the open${tag}`, async ({ page, context }) => {
      await checkingLineDuringTheWait(page, context);
    });

    test(`the address at startup, the world held by a live page: said, never asked${tag}`, async ({ page, context }) => {
      await addressAtStartup(page, context);
    });

    test(`a second world clicked during the wait opens, and no confirm asks about the first${tag}`, async ({ page, context }) => {
      await clickDuringTheWait(page, context);
    });

    test(`a click superseded during the wait puts the address back${tag}`, async ({ page, context }) => {
      await supersededRestoresTheAddress(page, context);
    });

    test(`a duplicated tab (same tab id) clicking the world: the confirm after the wait, the original keeps its lock${tag}`, async ({ page, context }) => {
      await duplicatedTabClick(page, context);
    });

    test(`a duplicated tab starting on the world's address: said, never asked, never opened${tag}`, async ({ page, context }) => {
      await duplicatedTabAtStartup(page, context);
    });

    test(`the address at startup while another page holds the world's own lock: said, never nothing${tag}`, async ({ page, context }) => {
      await worldLockHeldAtStartup(page, context);
    });

    test(`two pages starting at once on a world whose page closed: one opens, the other says why${tag}`, async ({ page, context }) => {
      test.slow();
      await twoPagesAtStartup(page, context);
    });

    test(`the update reload over its own lock of the release before: opens at start, no toast, no dialog${tag}`, async ({ page }) => {
      await updateReload(page);
    });

    test(`the start on the address when this page's own Web Lock is late: says try again, never nothing${tag}`, async ({ page, context }) => {
      await lateOwnLockAtStartup(page, context);
    });
  });
}
