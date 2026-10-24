/**
 * Nothing moves when the icon font arrives (S465): the font is 4 MB and
 * `font-display: block`, and before it loads each icon is its ligature's word
 * laid out invisibly. A click aimed while it loaded landed beside its target
 * (front-door's and front-door-gate's lost Start a world clicks on a cold
 * runner, S461, S465). The font is held back here, the header's and the room
 * strip's buttons measured, the font let through, and measured again.
 */
import { test, expect } from '@playwright/test';

test('the header and the room strip keep their places when the icon font arrives', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/material-symbols-outlined*.woff2', async (route) => {
    await held;
    await route.continue();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    await api.resetAll();
  });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  // A world opened in place, so the header's icon row is there.
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const opfs = await navigator.storage.getDirectory();
    const dir = await opfs.getDirectoryHandle('font-shift-w', { create: true });
    const w = await (await dir.getFileHandle('world.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ id: '0192a000-aaaa-7bbb-8ccc-00000000f0e7', name: 'Font World' }));
    await w.close();
    api.setNextDirectory(dir);
  });
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Font World' })).toBeVisible();
  const boxes = () => page.evaluate(() => {
    const sel = ['.atlas-worlds-header [data-action="create-local"]', '.atlas-worlds-header [data-action="add-world"]', '.atlas-room-nav-strip .atlas-room-nav-btn'];
    return sel.map((s) => { const r = document.querySelector(s)?.getBoundingClientRect(); return r ? [s, Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] : [s, null]; });
  });
  // Settled with the font still held: only the font may move anything after this.
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => document.fonts.check('24px "Material Symbols Outlined"'))).toBe(false);
  const before = await boxes();
  release();
  await page.waitForFunction(() => document.fonts.check('24px "Material Symbols Outlined"'), null, { timeout: 30000 });
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const after = await boxes();
  for (const b of before) expect(b[1], `${b[0]} measured`).not.toBeNull();
  expect(after).toEqual(before);
});
