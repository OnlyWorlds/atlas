/**
 * Create-from-link-field e2e (S264). A zero-candidate link field's click opens
 * the create modal LOCKED to the target type; the new element auto-links into
 * the field and the user STAYS on the current element (no navigation jump).
 * With candidates present, the same click opens the ordinary picker.
 */

import { test, expect, Page } from '@playwright/test';

async function freshBoot(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

async function setupWorld(page: Page) {
  await freshBoot(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle('link-create-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'linkworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const created = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return created.id;
  }, { type, data });
}

async function openElement(page: Page, id: string) {
  await page.evaluate((eid) => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/element/${eid}`;
  }, id);
  await expect(page.locator('.atlas-detail')).toBeVisible();
}

test('a zero-candidate link field creates its target and auto-links, staying put', async ({ page }) => {
  await setupWorld(page);
  const galeId = await createElement(page, 'character', { name: 'Gale' });
  await openElement(page, galeId);

  // birthplace targets location — no locations exist → the create affordance.
  const pick = page.locator('.atlas-field[data-field="birthplace"] .atlas-link-pick');
  await expect(pick).toHaveAttribute('title', /create one/);
  await pick.click();

  // The modal is LOCKED to location: exactly one selectable type button.
  const modal = page.locator('[data-modal="create-element"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('.atlas-create-type-btn')).toHaveCount(1);
  await expect(modal.locator('.atlas-create-type-btn[data-type="location"].active')).toBeVisible();

  await page.fill('input[name="element-name"]', 'Old Harbor');
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toHaveCount(0);

  // Auto-linked, and we never left Gale's page.
  await expect(page.locator('.atlas-field[data-field="birthplace"] .atlas-link-chip')).toHaveText(/Old Harbor/);
  expect(await page.evaluate(() => window.location.hash)).toContain(`/element/${galeId}`);
  expect(await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.find((e: any) => e.id === id)?.birthplace ?? null;
  }, galeId)).not.toBeNull();
});

test('a multi-link field with zero candidates also routes to create', async ({ page }) => {
  await setupWorld(page);
  const galeId = await createElement(page, 'character', { name: 'Gale' });
  await openElement(page, galeId);

  // species (multi-link → species) — none exist.
  const pick = page.locator('.atlas-field[data-field="species"] .atlas-link-pick');
  await expect(pick).toHaveAttribute('title', /create one/);
  await pick.click();
  const modal = page.locator('[data-modal="create-element"]');
  await expect(modal.locator('.atlas-create-type-btn[data-type="species"].active')).toBeVisible();
  await page.fill('input[name="element-name"]', 'Emberfolk');
  await modal.locator('[data-action="create"]').click();
  await expect(page.locator('.atlas-field[data-field="species"] .atlas-link-chip')).toHaveText(/Emberfolk/);
});

test('with candidates present the click opens the picker, not the create modal', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'location', { name: 'Old Harbor' });
  const galeId = await createElement(page, 'character', { name: 'Gale' });
  await openElement(page, galeId);

  const pick = page.locator('.atlas-field[data-field="birthplace"] .atlas-link-pick');
  await expect(pick).toHaveAttribute('title', /Pick a location/);
  await pick.click();
  await expect(page.locator('.atlas-picker-panel')).toBeVisible();
  await expect(page.locator('[data-modal="create-element"]')).toHaveCount(0);
});

test('clicking an empty link field BODY (not just the icon) opens the picker (S313)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'location', { name: 'Old Harbor' });
  const galeId = await createElement(page, 'character', { name: 'Gale' });
  await openElement(page, galeId);

  const row = page.locator('.atlas-field[data-field="birthplace"] .atlas-link-row');
  await expect(row).toHaveClass(/atlas-link-row-clickable/);
  // Click the row body toward the LEFT edge — away from the pick icon, which
  // sits margin-left:auto at the far right. Proves the body itself is the target.
  await row.click({ position: { x: 8, y: 8 } });
  await expect(page.locator('.atlas-picker-panel')).toBeVisible();
});
