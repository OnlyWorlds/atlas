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
const STAYED = 'stayed closed here. Another Atlas page may still have it open.';

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

    test(`the control: the same quit, its lock read as another browser's, meets the confirm${tag}`, async ({ playwright, browserName }, testInfo) => {
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

    test(`the address at startup, the world held by a live page: said, never asked${tag}`, async ({ page, context }) => {
      await addressAtStartup(page, context);
    });

    test(`a second world clicked during the wait opens, and no confirm asks about the first${tag}`, async ({ page, context }) => {
      await clickDuringTheWait(page, context);
    });
  });
}
