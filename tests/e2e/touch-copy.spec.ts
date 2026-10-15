/**
 * #279: Atlas on a phone speaks touch. At 412 wide on a touch screen, in
 * Chromium and (tagged @firefox) Firefox, driven by .tap(): the first screen
 * and help point at Lantern, help names no key, right-click, hover, drag or
 * drop, and the Data room says choose. With a mouse, help keeps its
 * keyboard reference. The unit guard `tests/unit/touch-copy.test.ts` covers
 * every help room and tour phase; this proves the pointer query reaches them.
 */
import { test, expect, Page } from '@playwright/test';

const MOUSE_OR_KEY = /right-?click|\bdrag|\bdrop\b|\bctrl\b|⌘|shift\s*\+|\bhover\b|\benter\b|\besc\b|double-click|\bscroll to\b/i;

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

/** A world in this browser, built wide (the drawers are not the story), then narrowed. */
async function worldThenPhone(page: Page): Promise<string> {
  const wid = await makeWorld(page);
  await page.setViewportSize({ width: 412, height: 839 });
  return wid;
}

async function makeWorld(page: Page): Promise<string> {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('touch-copy-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'touchworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi.getState().active?.worldId));
  return await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
}

async function helpTextAt(page: Page, worldId: string, room: string): Promise<{ text: string; lantern: string | null }> {
  await page.evaluate((h) => { location.hash = h; }, `#/w/${worldId}/${room}`);
  await page.waitForTimeout(400);
  await page.locator('.atlas-room-nav-drawer-btn').first().tap();
  const help = page.locator('[data-action="help-shortcuts"]');
  await expect(help).toBeVisible();
  await help.tap();
  const modal = page.locator('[data-modal="help-overlay"]');
  await expect(modal).toBeVisible();
  const out = {
    text: (await modal.innerText()).replace(/\s+/g, ' '),
    lantern: await modal.locator('a[data-link="lantern"]').getAttribute('href').catch(() => null),
  };
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
  return out;
}

// Each touch test runs in Chromium (untagged) and in Firefox (tagged: the
// firefox project runs only @firefox, the chromium project skips it).
for (const tag of ['', '@firefox ']) test.describe(`${tag}on a touch screen`, () => {
  test.use({ hasTouch: true, viewport: { width: 1280, height: 800 } });

  test('the first screen points a phone at Lantern', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 839 });
    await freshBoot(page);
    const link = page.locator('[data-role="lantern-note"] a[data-link="lantern"]');
    await expect(link).toBeVisible();
    expect(await link.getAttribute('href')).toBe('https://lantern.onlyworlds.com');
  });

  test('help names no key, right-click, hover, drag or drop, and points at Lantern', async ({ page }) => {
    const wid = await worldThenPhone(page);
    for (const room of ['home', 'writing', 'timeline', 'import']) {
      const { text, lantern } = await helpTextAt(page, wid, room);
      expect(text, room).toContain('On a touch screen');
      expect(text, room).not.toContain('Keyboard and mouse');
      expect(text.match(MOUSE_OR_KEY)?.[0] ?? null, `${room}: ${text}`).toBeNull();
      expect(lantern, room).toBe('https://lantern.onlyworlds.com');
    }
  });

  test('Writing has a Find button: a tap finds a word, and its matches can be linked (#301)', async ({ page }) => {
    const wid = await worldThenPhone(page);
    const id = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const el = await api.getActiveStore().createElement('narrative', {
        name: 'find scene', supertype: 'Book', story: 'the orc met the orc and another orc joined them',
      });
      api.patchData(await api.getActiveStore().listElements());
      return el.id as string;
    });
    await page.evaluate(([w, n]) => { location.hash = `#/w/${w}/writing/${n}`; }, [wid, id]);
    await expect(page.locator('.atlas-writing-workspace-prose .ProseMirror')).toBeVisible();
    const find = page.locator('.atlas-writing-workspace-crumb-actions [data-action="find"]');
    await expect(find).toBeVisible();
    await find.tap();
    await expect(page.locator('.atlas-find-bar')).toHaveAttribute('data-state', 'shown');
    await page.locator('[data-role="find-input"]').fill('orc');
    await expect(page.locator('[data-role="count"]')).toContainText('1 of 3');
    await page.locator('[data-role="link-matches"]').tap();
    await expect(page.locator('[data-modal="pick-element"]')).toBeVisible();
  });

  test('Hide types: a tap on it, then on a type, keeps the type out of the full list (#301)', async ({ page }) => {
    const wid = await worldThenPhone(page);
    await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElement('character', { name: 'Ireena' });
      await store.createElement('location', { name: 'Barovia' });
      api.patchData(await store.listElements());
    });
    await page.evaluate((w) => { location.hash = `#/w/${w}/home`; }, wid);
    await page.locator('[data-drawer="sidebar"]').first().tap();
    const rows = page.locator('.atlas-sidebar [data-element-id]');
    await expect(rows.filter({ hasText: 'Ireena' })).toHaveCount(1);
    const character = page.locator('.atlas-filter-btn[data-filter-type="character"]');

    await page.locator('[data-action="hide-types"]').tap();
    await expect(page.locator('[data-action="hide-types"]')).toHaveAttribute('aria-pressed', 'true');
    await character.tap();
    await expect(character).toHaveClass(/\bmuted\b/);
    await expect(rows.filter({ hasText: 'Ireena' })).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Barovia' })).toHaveCount(1);

    // Done: a tap filters again, as it always did; the muted type stays out of the full list.
    await page.locator('[data-action="hide-types"]').tap();
    await expect(page.locator('[data-action="hide-types"]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('.atlas-filter-btn[data-filter-type="location"]').tap();
    await expect(page.locator('.atlas-filter-btn[data-filter-type="location"]')).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => [...(window as any).__atlasTestApi.getState().ui.mutedTypes])).toContain('character');
  });

  test('the Data room says choose, not drop', async ({ page }) => {
    const wid = await worldThenPhone(page);
    await page.evaluate((h) => { location.hash = h; }, `#/w/${wid}/import`);
    const lead = page.locator('.atlas-import-lead');
    await expect(lead).toBeVisible();
    const words = await page.locator('.atlas-import-panel[data-panel="in"]').innerText();
    expect(words).toContain('Choose it or paste it');
    expect(words.match(MOUSE_OR_KEY)?.[0] ?? null, words).toBeNull();
  });
});

test('with a mouse, help keeps its keyboard reference and says nothing of Lantern', async ({ page }) => {
  await freshBoot(page);
  await expect(page.locator('[data-role="lantern-note"]')).toHaveCount(0);
  await makeWorld(page);
  await page.locator('[data-action="help-shortcuts"]').click();
  const modal = page.locator('[data-modal="help-overlay"]');
  await expect(modal).toContainText('Keyboard and mouse');
  await expect(modal.locator('a[data-link="lantern"]')).toHaveCount(0);
  // With a mouse the type strip has no Hide types: a right-click mutes (#301).
  await expect(page.locator('[data-action="hide-types"]')).toHaveCount(0);
  // With a mouse, Writing's bar is as it was: Ctrl+F finds, no Find button (#301)
  await page.keyboard.press('Escape');
  const id = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const el = await api.getActiveStore().createElement('narrative', { name: 'mouse scene', supertype: 'Book', story: 'one orc' });
    api.patchData(await api.getActiveStore().listElements());
    return el.id as string;
  });
  await page.evaluate((n) => { location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/writing/${n}`; }, id);
  await expect(page.locator('.atlas-writing-workspace-crumb-actions [data-action="focus"]')).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-crumb-actions [data-action="find"]')).toHaveCount(0);
});
