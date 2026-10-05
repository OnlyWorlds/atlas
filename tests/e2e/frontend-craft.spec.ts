/**
 * S360 — the frontend-craft systemic half (lane A of the sweep). Each check
 * reads the RENDERED result (computed style, the real tab title, the live
 * region), not the rule that should produce it.
 */
import { test, expect, Page } from '@playwright/test';

async function setupWorld(page: Page, name: string) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('craft-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

test('the tab title follows the world, the room and the element', async ({ page }) => {
  await setupWorld(page, 'Hyperion');
  await expect(page).toHaveTitle('Hyperion · Atlas');
  const { w, id } = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const el = await store.createElement('character', { name: 'The Consul' });
    api.patchData(await store.listElements());
    return { w: api.getState().active.worldId, id: el.id };
  });
  await page.evaluate(({ w, id }) => { window.location.hash = `#/w/${w}/element/${id}`; }, { w, id });
  await expect(page).toHaveTitle('The Consul · Hyperion · Atlas');
  await page.evaluate((w) => { window.location.hash = `#/w/${w}/timeline`; }, w);
  await expect(page).toHaveTitle('Charts · Hyperion · Atlas');
});

test('chrome does not select, icons never copy, toasts are announced', async ({ page }) => {
  await setupWorld(page, 'Craft');
  const styles = await page.evaluate(() => {
    const us = (sel: string) => { const el = document.querySelector(sel); return el ? getComputedStyle(el).userSelect : 'MISSING'; };
    return {
      roomNav: us('.atlas-room-nav-btn'),
      icon: us('.material-symbols-outlined'),
      toastRole: document.getElementById('toast-container')?.getAttribute('aria-live'),
    };
  });
  expect(styles.roomNav).toBe('none');
  expect(styles.icon).toBe('none');
  expect(styles.toastRole).toBe('polite');
});
