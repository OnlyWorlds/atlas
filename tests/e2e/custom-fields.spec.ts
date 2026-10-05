/**
 * Custom fields section e2e (D9).
 *
 * Covers: section renders existing custom fields (clean labels, machinery
 * hidden, add row present) · add-field flow (name → auto x_ prefix → value
 * editor auto-opens → save) · collision rejection hint · delete via ×
 * (confirm for populated, silent for empty; row disappears — null tombstone).
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
    const sub = await root.getDirectoryHandle('custom-fields-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'cfworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(
  page: Page,
  type: string,
  data: Record<string, unknown>,
): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) throw new Error('no active store');
    const created = await store.createElement(type, data);
    const all = await store.listElements();
    api.patchData(all);
    return created.id;
  }, { type, data });
}

async function openElement(page: Page, id: string) {
  await page.evaluate((eid) => {
    const state = (window as any).__atlasTestApi.getState();
    const worldId = state.active?.worldId;
    window.location.hash = `#/w/${worldId}/element/${eid}`;
  }, id);
  await expect(page.locator('.atlas-detail')).toBeVisible();
}

const section = '.atlas-custom-fields-section';

test('section renders custom fields with clean labels; machinery hidden; add row present', async ({ page }) => {
  await setupWorld(page);
  const id = await createElement(page, 'character', {
    name: 'Hero',
    x_mood: 'grim',
    shadow_note: 'hidden lore',
    x_gone: null,
    atlas_dismissed_suggestions: ['zz'],
  });
  await openElement(page, id);

  const sec = page.locator(section);
  await expect(sec).toBeVisible();
  await expect(sec.locator('.atlas-detail-section-header span').first()).toHaveText('Custom fields');

  // Clean labels, prefix in the tooltip only.
  const moodRow = sec.locator('[data-field="x_mood"]');
  await expect(moodRow.locator('.atlas-field-label span').first()).toHaveText('Mood');
  await expect(moodRow.locator('.atlas-field-value')).toHaveText('grim');
  await expect(sec.locator('[data-field="shadow_note"] .atlas-field-label span').first()).toHaveText('Note');

  // Machinery + tombstones don't render as rows.
  await expect(sec.locator('[data-field="x_gone"]')).toHaveCount(0);
  await expect(sec.locator('[data-field="atlas_dismissed_suggestions"]')).toHaveCount(0);

  // The add row is there.
  await expect(sec.locator('.atlas-custom-add-btn')).toBeVisible();

  await page.screenshot({ path: 'Notes/ui-snapshots/2026-07-12/d9-section-rows.png' });
});

test('empty state: section still renders with just the add row', async ({ page }) => {
  await setupWorld(page);
  const id = await createElement(page, 'character', { name: 'Plain' });
  await openElement(page, id);
  const sec = page.locator(section);
  await expect(sec.locator('.atlas-custom-add-btn')).toBeVisible();
  await expect(sec.locator('.atlas-field')).toHaveCount(0);
});

test('add-field flow: name → x_ prefix → value editor auto-opens → save', async ({ page }) => {
  // Short viewport = long scroll distance to the custom section. The popover
  // mispositioning only reproduces when the pane's saved scrollTop is large
  // (the bug measured the anchor against the unscrolled layout).
  await page.setViewportSize({ width: 1280, height: 420 });
  await setupWorld(page);
  const id = await createElement(page, 'character', { name: 'Adder' });
  await openElement(page, id);

  await page.click(`${section} .atlas-custom-add-btn`);
  const input = page.locator(`${section} .atlas-custom-add-input`);
  await input.fill('battle cry');
  await input.press('Enter');

  // Row appears with the clean label; the value editor auto-opened.
  const row = page.locator(`${section} [data-field="x_battle_cry"]`);
  await expect(row.locator('.atlas-field-label span').first()).toHaveText('Battle Cry');
  const popover = page.locator('.atlas-edit-popover');
  await expect(popover).toBeVisible();

  // The popover must open AT the field, not at the bottom of the page — the
  // anchor rect must be measured AFTER element-detail's scroll restore
  // (Captain's live find: a microtask-timed click measured the unscrolled
  // layout and the editor landed a page below the row).
  const rowBox = await row.boundingBox();
  const popBox = await popover.boundingBox();
  expect(rowBox).toBeTruthy();
  expect(popBox).toBeTruthy();
  expect(Math.abs(popBox!.y - rowBox!.y)).toBeLessThan(250);
  await popover.locator('input.atlas-input').fill('For the Shire!');
  await popover.locator('input.atlas-input').press('Enter');

  await expect(row.locator('.atlas-field-value')).toHaveText('For the Shire!');

  // Persisted on disk with the prefixed key.
  const stored = await page.evaluate(async (eid) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const el = await store.getElement(eid);
    return el?.x_battle_cry;
  }, id);
  expect(stored).toBe('For the Shire!');

  await page.screenshot({ path: 'Notes/ui-snapshots/2026-07-12/d9-added-field.png' });
});

test('collision with a schema field is rejected with a hint', async ({ page }) => {
  await setupWorld(page);
  const id = await createElement(page, 'character', { name: 'Collider' });
  await openElement(page, id);

  await page.click(`${section} .atlas-custom-add-btn`);
  const input = page.locator(`${section} .atlas-custom-add-input`);
  await input.fill('height');
  await input.press('Enter');

  await expect(page.locator(`${section} .atlas-custom-add-hint`)).toContainText('built-in');
  await expect(page.locator(`${section} [data-field="x_height"]`)).toHaveCount(0);
});

test('delete: populated field asks to confirm, row disappears, null tombstone on disk', async ({ page }) => {
  await setupWorld(page);
  const id = await createElement(page, 'character', { name: 'Deleter', x_mood: 'grim' });
  await openElement(page, id);

  const row = page.locator(`${section} [data-field="x_mood"]`);
  await expect(row).toBeVisible();

  page.once('dialog', d => { void d.accept(); });
  await row.hover();
  await row.locator('.atlas-field-remove').click();

  await expect(page.locator(`${section} [data-field="x_mood"]`)).toHaveCount(0);

  const stored = await page.evaluate(async (eid) => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const el = await store.getElement(eid);
    return { hasKey: 'x_mood' in el, value: el.x_mood };
  }, id);
  expect(stored.hasKey).toBe(true);
  expect(stored.value).toBeNull();
});
