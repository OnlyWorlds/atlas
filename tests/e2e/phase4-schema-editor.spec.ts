/**
 * Bout B — schema-driven element detail editor + picker + relations.
 *
 * Tests the full FIELD_SCHEMA rendering: multiple sections, collapse toggle,
 * single-link + multi-link fields backed by the picker modal, and the
 * "Referenced By" reverse-link section.
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

async function setupAtlasRoot(page: Page, dirName: string = 'schema-test-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a local world flips the sidebar to elements mode automatically
  // (S255v3) — wait for the elements body rather than a worlds-list row.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, name: string) {
  await page.click('[data-action="create-element"]');
  await page.fill('input[name="element-name"]', name);
  await page.click(`.atlas-create-type-btn[data-type="${type}"]`);
  await page.click('[data-modal="create-element"] [data-action="create"]');
  await expect(page.locator('.atlas-row[data-element-id]', { hasText: name })).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'schema world');
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
});

test('schema-driven detail renders multiple sections with Base collapsible', async ({ page }) => {
  await createElement(page, 'character', 'Aragorn');

  // Detail view has section headers — the first is "Base", and it collapses
  // like every other section (Captain, S311: it was the one hardcoded
  // always-expanded section).
  const sections = page.locator('.atlas-detail-section');
  await expect(sections.first()).toBeVisible();
  await expect(sections.first().locator('.atlas-detail-section-header')).toContainText('Base');
  await expect(sections.first().locator('.atlas-detail-section-header')).not.toHaveClass(/no-toggle/);
  await expect(sections.first().locator('.atlas-detail-section-body')).toBeVisible();
  await sections.first().locator('.atlas-detail-section-header').click();
  await expect(sections.first().locator('.atlas-detail-section-body')).toHaveCount(0);
  // Re-expand so later assertions in this file never inherit a collapsed Base.
  await sections.first().locator('.atlas-detail-section-header').click();
  await expect(sections.first().locator('.atlas-detail-section-body')).toBeVisible();

  // Multiple sections exist (Base + at least one schema section).
  const count = await sections.count();
  expect(count).toBeGreaterThanOrEqual(2);
});

test('section collapse toggle keeps state across re-renders', async ({ page }) => {
  await createElement(page, 'character', 'Boromir');

  // Find a schema section (not the first one, which is Base).
  const sections = page.locator('.atlas-detail-section');
  const collapsible = sections.nth(1);
  const header = collapsible.locator('.atlas-detail-section-header');
  await expect(header).not.toHaveClass(/no-toggle/);

  // Initially expanded — body visible.
  await expect(collapsible.locator('.atlas-detail-section-body')).toBeVisible();
  await header.click();
  await expect(collapsible.locator('.atlas-detail-section-body')).toHaveCount(0);

  // Edit the name via the header (causes a re-render) — the section should stay
  // collapsed. Name lives in the header title now, not a Base field (F1, conv #80).
  const title = page.locator('.atlas-middle-header h2.atlas-element-name');
  await title.click();
  const nameInput = page.locator('.atlas-middle-header input.atlas-element-name-input');
  await nameInput.waitFor({ state: 'visible' });
  await nameInput.fill('Boromir of Gondor');
  await nameInput.press('Enter');
  await expect(page.locator('.atlas-middle-header h2')).toContainText('Boromir of Gondor');
  // Still collapsed?
  await expect(sections.nth(1).locator('.atlas-detail-section-body')).toHaveCount(0);
});

test('single-link field opens picker, persists link as chip', async ({ page }) => {
  await createElement(page, 'location', 'Rivendell');
  // Switch back to elements and create a character (will land on detail).
  await page.click('.atlas-row[data-element-id]:has-text("Rivendell")');
  await createElement(page, 'character', 'Elrond');

  // Find a single-link field — character.birthplace is single_link → location.
  // We can locate it by scrolling, but it's enough to click its pick button.
  // birthplace is in a non-Base section. Use the data label.
  const birthplaceRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Birthplace' }) });
  await expect(birthplaceRow).toBeVisible();
  await birthplaceRow.locator('.atlas-link-pick').click();

  // Picker opens, shows Rivendell.
  await expect(page.locator('[data-modal="pick-element"]')).toBeVisible();
  await page.click('.atlas-picker-row[data-element-id]');

  // Picker closes; chip appears in the field.
  await expect(page.locator('[data-modal="pick-element"]')).toHaveCount(0);
  await expect(birthplaceRow.locator('.atlas-link-chip')).toContainText('Rivendell');
});

test('multi-link field — add and remove related elements', async ({ page }) => {
  await createElement(page, 'species', 'Elf');
  await page.click('.atlas-row[data-element-id]:has-text("Elf")');
  await createElement(page, 'species', 'Hobbit');
  await page.click('.atlas-row[data-element-id]:has-text("Hobbit")');
  await createElement(page, 'character', 'Frodo');

  // character has `species` multi_link. Find that row.
  const speciesRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Species' }) });
  await expect(speciesRow).toBeVisible();

  // Add Elf.
  await speciesRow.locator('.atlas-link-pick').click();
  await page.click('.atlas-picker-row:has-text("Elf")');
  await expect(speciesRow.locator('.atlas-link-chip', { hasText: 'Elf' })).toBeVisible();

  // Add Hobbit.
  await speciesRow.locator('.atlas-link-pick').click();
  // Elf should be excluded from the picker.
  await expect(page.locator('.atlas-picker-row:has-text("Elf")')).toHaveCount(0);
  await page.click('.atlas-picker-row:has-text("Hobbit")');
  await expect(speciesRow.locator('.atlas-link-chip', { hasText: 'Hobbit' })).toBeVisible();
  await expect(speciesRow.locator('.atlas-link-chip')).toHaveCount(2);

  // Remove Elf via the chip's close icon.
  await speciesRow.locator('.atlas-link-chip:has-text("Elf") .atlas-link-chip-remove').click();
  await expect(speciesRow.locator('.atlas-link-chip', { hasText: 'Elf' })).toHaveCount(0);
  await expect(speciesRow.locator('.atlas-link-chip')).toHaveCount(1);
});

test('clicking a link chip navigates to the linked element', async ({ page }) => {
  await createElement(page, 'location', 'Bag End');
  await page.click('.atlas-row[data-element-id]:has-text("Bag End")');
  await createElement(page, 'character', 'Bilbo');

  const birthplaceRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Birthplace' }) });
  await birthplaceRow.locator('.atlas-link-pick').click();
  await page.click('.atlas-picker-row:has-text("Bag End")');
  await expect(birthplaceRow.locator('.atlas-link-chip', { hasText: 'Bag End' })).toBeVisible();

  // Click the chip name (NOT the close icon).
  await birthplaceRow.locator('.atlas-link-chip span:has-text("Bag End")').click();

  // Now showing Bag End's detail.
  await expect(page.locator('.atlas-middle-header h2')).toContainText('Bag End');
  expect(await page.evaluate(() => window.location.hash)).toMatch(/\/element\/[0-9a-f-]+$/);
});

test('referenced-by section appears on the target after linking', async ({ page }) => {
  await createElement(page, 'location', 'Mordor');
  await page.click('.atlas-row[data-element-id]:has-text("Mordor")');
  await createElement(page, 'character', 'Sauron');

  // Sauron.birthplace = Mordor
  const birthplaceRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Birthplace' }) });
  await birthplaceRow.locator('.atlas-link-pick').click();
  await page.click('.atlas-picker-row:has-text("Mordor")');
  await expect(birthplaceRow.locator('.atlas-link-chip', { hasText: 'Mordor' })).toBeVisible();

  // Navigate back to Mordor — referenced-by should list Sauron.
  await page.click('.atlas-row[data-element-id]:has-text("Mordor")');
  await expect(page.locator('.atlas-middle-header h2')).toContainText('Mordor');

  const refs = page.locator('.atlas-detail-section', { has: page.locator('.atlas-detail-section-header', { hasText: 'Linked from' }) });
  await expect(refs).toBeVisible();
  await expect(refs.locator('.atlas-link-chip')).toContainText('Sauron');
});

test('picker search filters list by name', async ({ page }) => {
  // Make several species so the picker has rows to search through.
  await createElement(page, 'species', 'Elf');
  await page.click('.atlas-row[data-element-id]:has-text("Elf")');
  await createElement(page, 'species', 'Dwarf');
  await page.click('.atlas-row[data-element-id]:has-text("Dwarf")');
  await createElement(page, 'species', 'Hobbit');
  await page.click('.atlas-row[data-element-id]:has-text("Hobbit")');
  await createElement(page, 'character', 'Frodo');

  // Open species multi-link picker — all 3 species visible.
  const speciesRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Species' }) });
  await speciesRow.locator('.atlas-link-pick').click();
  await expect(page.locator('[data-modal="pick-element"]')).toBeVisible();
  await expect(page.locator('.atlas-picker-row')).toHaveCount(3);

  // Search "el" → only Elf matches (Dwarf and Hobbit don't contain "el").
  await page.fill('[data-modal="pick-element"] [data-role="picker-search"]', 'el');
  await expect(page.locator('.atlas-picker-row')).toHaveCount(1);
  await expect(page.locator('.atlas-picker-row')).toContainText('Elf');
});

test('picker excludes already-linked targets in multi-link', async ({ page }) => {
  await createElement(page, 'species', 'Elf');
  await page.click('.atlas-row[data-element-id]:has-text("Elf")');
  await createElement(page, 'species', 'Hobbit');
  await page.click('.atlas-row[data-element-id]:has-text("Hobbit")');
  await createElement(page, 'character', 'Pippin');

  const speciesRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Species' }) });

  // Add Elf first.
  await speciesRow.locator('.atlas-link-pick').click();
  await page.click('.atlas-picker-row:has-text("Elf")');
  await expect(speciesRow.locator('.atlas-link-chip', { hasText: 'Elf' })).toBeVisible();

  // Open picker again — Elf should NOT be in the list (excludeIds), Hobbit should be.
  await speciesRow.locator('.atlas-link-pick').click();
  await expect(page.locator('.atlas-picker-row:has-text("Elf")')).toHaveCount(0);
  await expect(page.locator('.atlas-picker-row:has-text("Hobbit")')).toBeVisible();
});

test('scroll position is preserved across field link/delink re-renders', async ({ page }) => {
  // Build enough data so the element-detail body actually scrolls.
  await createElement(page, 'species', 'Hobbit');
  await page.click('.atlas-row[data-element-id]:has-text("Hobbit")');
  await createElement(page, 'character', 'Bilbo');

  const body = page.locator('.atlas-middle-body[data-element-id]');
  await expect(body).toBeVisible();

  // Force a scroll on the body. Use a generous value; gets clamped to scrollHeight - clientHeight.
  await body.evaluate((el) => { el.scrollTop = 200; });
  const before = await body.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);

  // Link a species (causes re-render via picker resolve + folder update).
  const speciesRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Species' }) });
  await speciesRow.locator('.atlas-link-pick').click();
  await page.click('.atlas-picker-row:has-text("Hobbit")');
  await expect(speciesRow.locator('.atlas-link-chip', { hasText: 'Hobbit' })).toBeVisible();

  // After link insert + re-render, scrollTop should be restored close to `before`.
  // Small drift tolerance — content height changes when the chip is added but
  // the saved scrollTop should land within a few px of the original.
  const after = await body.evaluate((el) => el.scrollTop);
  expect(Math.abs(after - before)).toBeLessThan(20);

  // De-link via the chip remove — another re-render. Same scrollTop expected.
  await speciesRow.locator('.atlas-link-chip:has-text("Hobbit") .atlas-link-chip-remove').click();
  await expect(speciesRow.locator('.atlas-link-chip')).toHaveCount(0);

  const afterDelink = await body.evaluate((el) => el.scrollTop);
  expect(Math.abs(afterDelink - before)).toBeLessThan(20);
});

test('picker cancel via Escape leaves the field untouched', async ({ page }) => {
  await createElement(page, 'location', 'Shire');
  await page.click('.atlas-row[data-element-id]:has-text("Shire")');
  await createElement(page, 'character', 'Sam');

  const birthplaceRow = page.locator('.atlas-field', { has: page.locator('.atlas-field-label', { hasText: 'Birthplace' }) });

  await birthplaceRow.locator('.atlas-link-pick').click();
  await expect(page.locator('[data-modal="pick-element"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-modal="pick-element"]')).toHaveCount(0);

  // Field still empty.
  await expect(birthplaceRow.locator('.atlas-link-chip')).toHaveCount(0);
});
