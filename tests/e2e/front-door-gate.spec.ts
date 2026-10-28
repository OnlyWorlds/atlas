/**
 * PROMOTED from a composition gate on the front door: delete stays inside the home folder, discovery never hijacks a slot, every setup door opens a world pick, the tour keeps its doors, double-clicks keep the chooser.
 * Each asserts the fixed behaviour; red on the code before the gate fixes.
 */
import { test, expect, type Page } from '@playwright/test';

const A = '00000000-0000-4000-8000-0000000b0a01';
const B = '00000000-0000-4000-8000-0000000b0b02';

async function freshBoot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

/** Write files into OPFS by path; `pick` (a dir path) goes to the next picker. */
async function seed(page: Page, files: Record<string, unknown>, pick?: string): Promise<void> {
  await page.evaluate(async ({ files, pick }) => {
    const opfs = await navigator.storage.getDirectory();
    const dirAt = async (parts: string[]) => {
      let d = opfs;
      for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
      return d;
    };
    for (const [path, body] of Object.entries(files)) {
      const parts = path.split('/');
      const name = parts.pop()!;
      const d = await dirAt(parts);
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(JSON.stringify(body));
      await w.close();
    }
    if (pick) (window as any).__atlasTestApi.setNextDirectory(await dirAt(pick.split('/')));
  }, { files, pick });
}

async function exists(page: Page, path: string): Promise<boolean> {
  return page.evaluate(async (path) => {
    let d: FileSystemDirectoryHandle = await navigator.storage.getDirectory();
    const parts = path.split('/');
    const last = parts.pop()!;
    try {
      for (const p of parts) d = await d.getDirectoryHandle(p);
      await d.getFileHandle(last);
      return true;
    } catch { return false; }
  }, path);
}

async function openInPlaceFromLanding(page: Page, dir: string, id: string, name: string): Promise<void> {
  await seed(page, { [`${dir}/world.json`]: { id, name } }, dir);
  // A world folder opens from Other ways in (the landing's own link moved there, 2026-10-27).
  await page.click('[data-action="other-ways-in"]');
  await page.click('[data-modal="add-world"] [data-choice="open-folder"]');
  await expect(page.locator('h1', { hasText: name })).toBeVisible();
}

test('B1 rootless: "Delete world + folder" on a world opened in place never leaves the active world without a store', async ({ page }) => {
  await freshBoot(page);
  await openInPlaceFromLanding(page, 'lensb-b1/solo', A, 'Solo World');
  const id = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/world`; }, id);
  page.on('dialog', d => void d.accept());
  await page.locator('[data-action="delete-world-permanent"]').click();
  await page.waitForTimeout(800);
  const s = await page.evaluate((id) => {
    const api = (window as any).__atlasTestApi;
    const st = api.getState();
    return {
      inRegistry: st.registry.worlds.some((w: any) => w.id === id),
      activeId: st.active?.worldId ?? null,
      hasStore: !!api.getActiveStore(),
    };
  }, id);
  // Correct: either the world is gone, or it was refused BEFORE its store closed.
  const broken = s.inRegistry && s.activeId === id && !s.hasStore;
  expect(broken, JSON.stringify(s)).toBe(false);
});

test('B2 with a root: deleting an in-place world never deletes a same-named folder inside the root', async ({ page }) => {
  await freshBoot(page);
  await openInPlaceFromLanding(page, 'lensb-b2-out/alpha', A, 'Outside Alpha');
  // A home folder that already holds a DIFFERENT world in a folder also named "alpha".
  await seed(page, {
    'lensb-b2-home/onlyworlds-atlas/.atlas-root': { version: 1 },
    'lensb-b2-home/onlyworlds-atlas/alpha/world.json': { id: B, name: 'Root Alpha' },
  }, 'lensb-b2-home');
  await page.locator('.atlas-worlds-header [data-action="open-folder"]').click();
  await page.waitForFunction(() => !!(window as any).__atlasTestApi.getState().atlasRoot);
  const idA = await page.evaluate((a) => (window as any).__atlasTestApi.getState().registry.worlds
    .find((w: any) => w.folder.handle_key === `world-${a}`).id, A);
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/world`; }, idA);
  await expect(page.locator('h1', { hasText: 'Outside Alpha' }).or(page.locator('[data-action="delete-world-permanent"]')).first()).toBeVisible();
  page.on('dialog', d => void d.accept());
  await page.locator('[data-action="delete-world-permanent"]').click();
  await page.waitForTimeout(800);
  expect(await exists(page, 'lensb-b2-home/onlyworlds-atlas/alpha/world.json'), 'the root world "Root Alpha" was deleted').toBe(true);
});

test('B3 a later root holding a same-id copy does not take over the in-place world\'s handle slot', async ({ page }) => {
  await freshBoot(page);
  await openInPlaceFromLanding(page, 'lensb-b3-out/agent', A, 'Agent Original');
  await seed(page, {
    'lensb-b3-home/onlyworlds-atlas/.atlas-root': { version: 1 },
    'lensb-b3-home/onlyworlds-atlas/agent-copy/world.json': { id: A, name: 'Agent Copy' },
  }, 'lensb-b3-home');
  await page.locator('.atlas-worlds-header [data-action="open-folder"]').click();
  await page.waitForFunction(() => !!(window as any).__atlasTestApi.getState().atlasRoot);
  await page.waitForTimeout(300);
  const sameKey = await page.evaluate((a) => (window as any).__atlasTestApi.getState().registry.worlds
    .filter((w: any) => w.folder.handle_key === `world-${a}`).map((w: any) => w.name), A);
  expect(sameKey, 'two registry entries share one vault slot').toHaveLength(1);
});

test('B4 rootless with a world: the example page offers "back to atlas", not "set up a local folder"', async ({ page }) => {
  await freshBoot(page);
  await openInPlaceFromLanding(page, 'lensb-b4/w', A, 'Demo Visitor');
  await page.evaluate(() => { window.location.hash = '#/demo'; });
  await page.waitForSelector('[data-action="demo-exit"]');
  await expect(page.locator('[data-action="demo-exit-back"]')).toHaveCount(1);
  await expect(page.locator('[data-action="demo-exit-setup"]')).toHaveCount(0);
});

// B5 (the finale's folder setup pointed at a world folder) moved with 1.17:
// the finale's Save it to a folder refuses a world folder as its destination,
// and tour-keep.spec holds that test.

test('B6 during the tour, Ctrl+K does not offer the world doors the sidebar locks', async ({ page }) => {
  await freshBoot(page);
  const ids = await page.evaluate(async () => {
    localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true }));
    try {
      const m = await import('/src/ui/command-palette.ts' as string);
      return m.searchPalette('add', []).concat(m.searchPalette('open', [])).map((r: any) => r.id);
    } finally {
      localStorage.removeItem('atlas_tour_v1');
    }
  });
  expect(ids).not.toContain('add-world');
  expect(ids).not.toContain('open-world-folder');
});

test('B7 a folder holding several world folders names what it found', async ({ page }) => {
  await freshBoot(page);
  await seed(page, {
    'lensb-b7/worlds/one/world.json': { id: A, name: 'One' },
    'lensb-b7/worlds/two/world.json': { id: B, name: 'Two' },
  }, 'lensb-b7/worlds');
  // A world folder opens from Other ways in (the landing's own link moved there, 2026-10-27).
  await page.click('[data-action="other-ways-in"]');
  await page.click('[data-modal="add-world"] [data-choice="open-folder"]');
  await page.waitForTimeout(500);
  const toasts = await page.locator('.ow-toast-message').allTextContents();
  expect(toasts.join(' | ')).toMatch(/2 world/);
});

test('B8 Escape and an outside click on the home-folder question settle it as cancel', async ({ page }) => {
  await freshBoot(page);
  await openInPlaceFromLanding(page, 'lensb-b8/w', A, 'Esc World');
  const ask = page.locator('[data-modal="home-folder"]');
  // 1.17: the home-folder question comes from the create dialog's folder row.
  await page.locator('.atlas-worlds-header [data-action="create-local"]').click();
  const dialog = page.locator('[data-modal="create-world"]');
  await dialog.locator('input[name="where"][value="folder"]').check();
  const askAgain = async () => {
    await dialog.locator('[data-action="pick"]').click();
    await expect(ask).toBeVisible();
  };
  await askAgain();
  await page.keyboard.press('Escape');
  await expect(ask).toHaveCount(0);
  await askAgain();
  await page.mouse.click(5, 5);
  await expect(ask).toHaveCount(0);
  // A third ask still works (no dangling promise / listener), and nothing was made.
  await askAgain();
  const made = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length);
  expect(made).toBe(1);
});

test('B9 a double-click on "add a world" leaves the chooser open', async ({ page }) => {
  await freshBoot(page);
  await openInPlaceFromLanding(page, 'lensb-b9/w', A, 'Dbl World');
  await page.locator('.atlas-worlds-header [data-action="add-world"]').dblclick();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-modal="add-world"]')).toBeVisible();
});
