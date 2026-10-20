/**
 * OW Style's button ladder (1.62, Studio style/RULES.md section 8; the
 * Captain's "looks good", h63 #8314): Entry is a solid fill, one per screen;
 * Standard the wash and edge; Quiet a neutral edge; a destructive action is
 * Standard in the danger colour. The front door takes the ladder's full shape
 * (studio style/control/ladder.json: 36 high, 6 round, 14px).
 */

import { test, expect, type Page } from '@playwright/test';

async function freshBoot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.evaluate((t) => localStorage.setItem('atlas_theme', t), theme);
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.mouse.move(1, 1);
}

type Look = { bg: string; edge: string; ink: string; h: number; radius: string; size: string; weight: string };

async function look(page: Page, selector: string): Promise<Look> {
  return page.locator(selector).first().evaluate((b) => {
    const s = getComputedStyle(b);
    return {
      bg: s.backgroundColor, edge: s.borderTopColor, ink: s.color,
      h: Math.round(b.getBoundingClientRect().height),
      radius: s.borderRadius, size: s.fontSize, weight: s.fontWeight,
    };
  });
}

const LADDER = {
  dark: {
    entry: { bg: 'rgb(34, 211, 238)', ink: 'rgb(3, 16, 20)' },
    standard: { bg: 'rgba(34, 211, 238, 0.14)', edge: 'rgba(34, 211, 238, 0.6)', ink: 'rgb(34, 211, 238)' },
  },
  light: {
    entry: { bg: 'rgb(14, 116, 144)', ink: 'rgb(255, 255, 255)' },
    // A light word on the wash is #155e75 (Seethe's corrected ladder, h63 #8801; conv. 157): #0e7490 read 4.27.
    standard: { bg: 'rgba(14, 116, 144, 0.14)', edge: 'rgba(14, 116, 144, 0.6)', ink: 'rgb(21, 94, 117)' },
  },
} as const;

for (const theme of ['dark', 'light'] as const) {
  test(`front door (${theme}): Start a world is the one Entry, Explore Moppetopia is Standard, both in the ladder's shape`, async ({ page }) => {
    await freshBoot(page, theme);
    const start = '.atlas-landing-btn[data-action="start-world"]';
    const demo = '.atlas-landing-btn[data-action="try-demo"]';
    await expect(page.locator(start)).toBeVisible();
    await expect(page.locator('.atlas-btn-entry:visible')).toHaveCount(1);

    const s = await look(page, start);
    const d = await look(page, demo);
    expect(s).toMatchObject({ ...LADDER[theme].entry, h: 36, radius: '6px', size: '14px', weight: '600' });
    expect(d).toMatchObject({ ...LADDER[theme].standard, h: 36, radius: '6px', size: '14px', weight: '500' });
    // The two doors used to share one wash (1.61): they must not read alike.
    expect(s.bg).not.toBe(d.bg);
    // The line of links under them is the Link rung: weight 500 (1.66.1).
    const link = '.atlas-landing-more-link';
    await expect(page.locator(link).first()).toBeVisible();
    expect((await look(page, link)).weight).toBe('500');
  });
}

test('Forget everything is the danger rung, not a browser-default button (both themes)', async ({ page }) => {
  for (const theme of ['dark', 'light'] as const) {
    await freshBoot(page, theme);
    await page.evaluate(async () => {
      const { runAddWorldAction } = await import('/src/setup/world-doors.ts');
      const { toastManager } = await import('/src/ui/toast-manager.ts');
      void (runAddWorldAction as any)('create-local', toastManager);
    });
    await page.waitForSelector('[data-modal="create-world"]');
    const where = page.locator('[data-modal="create-world"] input[name="where"][value="browser"]');
    if (await where.count()) await where.check();
    await page.fill('[data-modal="create-world"] input[name="world-name"]', 'Ladder Reach');
    await page.click('[data-modal="create-world"] [data-action="pick"]');
    await page.waitForSelector('[data-role="elements-search"]');
    const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await page.evaluate((w) => { window.location.hash = `#/w/${w}/settings/storage`; }, worldId);

    const danger = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--atlas-danger').trim());
    const opener = await look(page, '[data-action="forget-browser"]');
    await page.click('[data-action="forget-browser"]');
    await page.locator('[data-modal="forget-browser"] input[name="confirm-word"]').fill('forget');
    await page.mouse.move(1, 1);
    const go = await look(page, '[data-modal="forget-browser"] [data-action="forget"]');
    const cancel = await look(page, '[data-modal="forget-browser"] [data-action="cancel"]');

    const hex = (rgb: string) => '#' + (rgb.match(/\d+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
    for (const b of [opener, go]) {
      expect(hex(b.ink), `${theme}: the danger ink`).toBe(danger);
      expect(b.bg, `${theme}: a wash, not transparent or grey`).toMatch(/srgb|rgba/);
      expect(b.bg).not.toBe('rgba(0, 0, 0, 0)');
    }
    expect(go.radius).toBe(cancel.radius);
    expect(go.h).toBe(cancel.h);
    await page.keyboard.press('Escape');
  }
});
