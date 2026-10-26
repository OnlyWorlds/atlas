/**
 * Phase 3 — Link Existing API World UI surface.
 *
 * Verifies that the `+ link api` button + modal layout are wired up. The
 * actual network-driven link flow runs against the real OW API in Titus's
 * manual smoke (Bout I); browser-side MSW interception would need a service
 * worker installation that's deferred.
 *
 * Covered here:
 *   - `+ link api` button appears when an atlas root is set, not before.
 *   - Modal opens with the right fields (api-key, pin, display-name).
 *   - PIN field is pre-filled from `registry.pin` when set in settings.
 *   - Cancel button closes the modal cleanly.
 *   - Escape key closes the modal cleanly.
 *   - Submitting empty fields shows a validation error inline.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    await (window as any).__atlasTestApi.resetAll();
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupAtlasRoot(page: Page, dirName: string = 'link-api-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
});

test('+ link api button is hidden until atlas root is configured', async ({ page }) => {
  await expect(page.locator('[data-action="link-api"]')).toHaveCount(0);
  await setupAtlasRoot(page);
  await expect(page.locator('[data-action="link-api"]')).toBeVisible();
});

test('+ link api opens a modal with api-key, pin, and display-name fields', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');

  await expect(page.locator('[data-modal="link-world"]')).toBeVisible();
  await expect(page.locator('input[name="api-key"]')).toBeVisible();
  await expect(page.locator('input[name="api-pin"]')).toBeVisible();
  await expect(page.locator('input[name="display-name"]')).toBeVisible();
  await expect(page.locator('[data-modal="link-world"] [data-action="link"]')).toBeVisible();
  // The busy exits show only while a link runs (a class's `display`
  // beat the `hidden` attribute, so they showed from the start).
  await expect(page.locator('[data-modal="link-world"] [data-action="cancel-link"]')).toBeHidden();
  await expect(page.locator('[data-modal="link-world"] [data-action="finish-early"]')).toBeHidden();
});

test('link modal pin field is pre-filled from registry.pin', async ({ page }) => {
  await setupAtlasRoot(page);
  // Seed PIN via the test API — registry update + state hydration in one go.
  await page.evaluate(() => {
    const raw = localStorage.getItem('atlas_worlds_registry')!;
    const reg = JSON.parse(raw);
    reg.pin = '9876';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  });
  // Reload to hydrate the pin into state.
  await page.reload();
  await page.waitForSelector('.atlas-shell');

  await page.click('[data-action="link-api"]');
  await expect(page.locator('input[name="api-pin"]')).toHaveValue('9876');
});

test('link modal cancel button closes without side-effects', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');
  await expect(page.locator('[data-modal="link-world"]')).toBeVisible();
  await page.click('[data-modal="link-world"] [data-action="cancel"]');
  await expect(page.locator('[data-modal="link-world"]')).toHaveCount(0);
  // No worlds appeared in the sidebar.
  await expect(page.locator('.atlas-row[data-world-id]')).toHaveCount(0);
});

test('link modal Escape key closes the modal', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');
  await expect(page.locator('[data-modal="link-world"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-modal="link-world"]')).toHaveCount(0);
});

test('link modal submit with empty fields shows inline error', async ({ page }) => {
  await setupAtlasRoot(page);
  await page.click('[data-action="link-api"]');
  // Clear any pre-filled PIN first so both fields are empty.
  await page.fill('input[name="api-pin"]', '');
  await page.click('[data-modal="link-world"] [data-action="link"]');
  await expect(page.locator('[data-modal="link-world"] [data-role="error"]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// Titus: a long link needs a way out that says what it does, and a
// stray click must not close it. The keel wire is mocked with page.route: one
// big character list, everything else empty.
// ---------------------------------------------------------------------------

const V2 = 'https://www.onlyworlds.com/api/v2';
const WORLD_ID = '11111111-2222-4333-8444-555555555555';

async function mockKeel(page: Page, characters: number) {
  const now = '2026-09-28T12:00:00.000Z';
  const chars = Array.from({ length: characters }, (_, i) => ({
    id: `c0000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    type: 'character', name: `Character ${i}`, updated_at: now, created_at: now,
  }));
  await page.route(`${V2}/**`, async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace('/api/v2', '');
    if (path === '/me') return route.fulfill({ json: { role: 'owner' } });
    if (path === '/world' || path === '/world/') {
      return route.fulfill({ json: { id: WORLD_ID, name: 'Big World', updated_at: now } });
    }
    const type = path.split('/').filter(Boolean)[0];
    const data = type === 'character' ? chars : [];
    return route.fulfill({ json: { data, has_more: false, next_cursor: null } });
  });
}

async function openLinkAndSubmit(page: Page) {
  await page.click('[data-action="link-api"]');
  await page.fill('input[name="api-key"]', 'ow_w_testkey');
  await page.fill('input[name="api-pin"]', '1234');
  await page.click('[data-modal="link-world"] [data-action="link"]');
}

async function worldFolders(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('link-api-root');
    const names: string[] = [];
    // @ts-expect-error values() is FS Access API
    for await (const e of sub.values()) {
      if (e.kind !== 'directory') continue;
      // @ts-expect-error values() is FS Access API
      for await (const w of e.values()) if (w.kind === 'directory') names.push(`${e.name}/${w.name}`);
    }
    return names;
  });
}

test('a running link ignores outside clicks and Escape, and Stop keeps what has downloaded', async ({ page }) => {
  await setupAtlasRoot(page);
  await mockKeel(page, 1500);
  await openLinkAndSubmit(page);
  const modal = page.locator('[data-modal="link-world"]');
  await expect(modal.locator('[data-action="finish-early"]')).toBeVisible();
  await expect(modal.locator('[data-role="progress"]')).toContainText('Downloading');

  // A stray click on the backdrop and an Escape do nothing while it runs.
  await page.mouse.click(5, 5);
  await page.keyboard.press('Escape');
  await expect(modal).toBeVisible();

  await modal.locator('[data-action="finish-early"]').click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'of 1500 elements' })).toBeVisible();
  const state = await page.evaluate(() => {
    const st = (window as any).__atlasTestApi.getState();
    const w = st.registry.worlds.find((x: any) => x.api?.world_id === '11111111-2222-4333-8444-555555555555');
    return { linked: w?.state, count: st.data.elements.length };
  });
  expect(state.linked).toBe('api-linked');
  expect(state.count).toBeGreaterThan(0);
  expect(state.count).toBeLessThan(1500);
});

test('Cancel link leaves the world you were in open and writable', async ({ page }) => {
  // The link flow used to close the prior world's store
  // BEFORE downloading, so Cancel left the UI on world A with no store behind
  // it: prose dropped silently, edits toasted "No active store".
  await setupAtlasRoot(page);
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Home World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  const { worldId, charId } = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const ch = await api.getActiveStore().createElement('character', { name: 'Keeper' });
    api.patchData(await api.getActiveStore().listElements());
    return { worldId: api.getState().active.worldId, charId: ch.id };
  });

  await mockKeel(page, 1500);
  await page.getByRole('button', { name: 'Worlds', exact: true }).click();
  await openLinkAndSubmit(page);
  const modal = page.locator('[data-modal="link-world"]');
  await expect(modal.locator('[data-role="progress"]')).toContainText('Downloading');
  await modal.locator('[data-action="cancel-link"]').click();
  await expect(modal).toHaveCount(0);

  const after = await page.evaluate(async (id) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) return { store: false };
    await store.updateElement(id, { description: 'still here' });
    const back = await store.getElement(id);
    return { store: true, active: api.getState().active?.worldId, description: back?.description };
  }, charId);
  expect(after).toEqual({ store: true, active: worldId, description: 'still here' });
});

test('Cancel link removes the new folder and registers nothing', async ({ page }) => {
  await setupAtlasRoot(page);
  await mockKeel(page, 1500);
  const before = await worldFolders(page);
  await openLinkAndSubmit(page);
  const modal = page.locator('[data-modal="link-world"]');
  await expect(modal.locator('[data-role="progress"]')).toContainText('Downloading');
  await modal.locator('[data-action="cancel-link"]').click();
  await expect(modal).toHaveCount(0);
  await expect(page.locator('.ow-toast', { hasText: 'Download cancelled' })).toBeVisible();
  expect(await worldFolders(page)).toEqual(before);
  const linked = await page.evaluate(() => (window as any).__atlasTestApi.getState().registry.worlds.length);
  expect(linked).toBe(0);
});
