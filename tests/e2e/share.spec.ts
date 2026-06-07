/**
 * Share room e2e (DESIGN_SHARING.md — Track B, S1 + S2).
 *
 * Covers: room shell + empty state; page create → detail (rename via blur
 * with the rename-revert discipline, intent change); delete with the async
 * confirm dialog; the not-found interim; the legacy /publish URL alias; the
 * block builder (heading + prose blocks, reorder/delete, the derived story
 * mirror, and the no-derive rule — page mentions never write element fields).
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
    const sub = await root.getDirectoryHandle('share-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'sworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'sworld' })).toBeVisible();
}

async function openShare(page: Page) {
  await page.click('.atlas-room-nav-btn[data-room="share"]');
  await expect(page.locator('.atlas-share-room h1').first()).toHaveText('Share');
}

test('share room: nav button opens the room with an empty state', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);
  await expect(page).toHaveURL(/\/share$/);
  await expect(page.locator('.atlas-share-empty')).toBeVisible();
  await expect(page.locator('.atlas-share-row')).toHaveCount(0);
});

test('create page → detail; rename + revert both persist; intent change sticks', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);

  // "+ new page" creates immediately and lands on the detail view.
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);
  await expect(page.locator('.atlas-share-detail-titlerow h1')).toHaveText('new page');
  await expect(page.locator('input.atlas-share-name')).toHaveValue('new page');

  // Rename → blur saves; title syncs on the data tick.
  await page.fill('input.atlas-share-name', 'barovia primer');
  await page.locator('input.atlas-share-name').blur();
  await expect(page.locator('.atlas-share-detail-titlerow h1')).toHaveText('barovia primer');

  // Revert to the original → blur must ALSO save (rename-revert discipline).
  await page.fill('input.atlas-share-name', 'new page');
  await page.locator('input.atlas-share-name').blur();
  await expect(page.locator('.atlas-share-detail-titlerow h1')).toHaveText('new page');
  await page.fill('input.atlas-share-name', 'barovia primer');
  await page.locator('input.atlas-share-name').blur();

  // Intent: defaults to show; change to reference persists to the element.
  await expect(page.locator('select.atlas-share-intent')).toHaveValue('show');
  await page.selectOption('select.atlas-share-intent', 'reference');
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.some((e: any) =>
      e.type === 'narrative' && e.subtype === 'page' && e.atlas_page_intent === 'reference');
  });

  // Back to the list — the page row shows name + intent chip + empty summary.
  await page.click('.atlas-share-back');
  await expect(page).toHaveURL(/\/share$/);
  const row = page.locator('.atlas-share-row', { hasText: 'barovia primer' });
  await expect(row).toBeVisible();
  await expect(row.locator('.atlas-share-intent-chip')).toHaveText('reference');
  await expect(row.locator('.atlas-share-row-meta')).toHaveText('empty');

  // A second create gets a unique default name.
  await page.click('button.atlas-share-new');
  await expect(page.locator('.atlas-share-detail-titlerow h1')).toHaveText('new page');
  await page.click('.atlas-share-back');
  await expect(page.locator('.atlas-share-row')).toHaveCount(2);
});

test('delete page: dismiss keeps it; accept removes it and lands on the list', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);

  // NOTE: the confirm fires AFTER an awaited findDependents, i.e. async to
  // the click — await each dialog explicitly instead of stacking once-handlers.
  const dismissed = page.waitForEvent('dialog').then(d => d.dismiss());
  await page.click('.atlas-share-delete');
  await dismissed;
  await expect(page.locator('.atlas-share-detail-titlerow h1')).toHaveText('new page');

  const accepted = page.waitForEvent('dialog').then(d => d.accept());
  await page.click('.atlas-share-delete');
  await accepted;
  await expect(page).toHaveURL(/\/share$/);
  await expect(page.locator('.atlas-share-empty')).toBeVisible();
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return !s.data.elements.some((e: any) => e.type === 'narrative' && e.subtype === 'page');
  });
});

test('missing page id renders a not-found interim, not a hijacked URL', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);

  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/share/00000000-0000-0000-0000-000000000000`;
  });

  await expect(page.locator('.atlas-share-empty-title')).toHaveText('Page not found.');
  await expect(page).toHaveURL(/\/share\/00000000-0000-0000-0000-000000000000$/);
  await page.click('.atlas-share-back');
  await expect(page).toHaveURL(/\/share$/);
});

/** Create an element directly via the active FolderStore (setup shortcut). */
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

/** Read the (single) page narrative from state. */
async function getPage(page: Page): Promise<any> {
  return await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page') ?? null;
  });
}

test('block builder: heading + prose blocks compose; story mirror derives; reorder + delete work', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);

  // Add a heading — opens in edit mode; type + Enter commits.
  await page.click('.atlas-share-block-add-btn:has-text("heading")');
  await expect(page.locator('input.atlas-share-heading-input')).toBeVisible();
  await page.fill('input.atlas-share-heading-input', 'The Domain');
  await page.keyboard.press('Enter');
  await expect(page.locator('h2.atlas-share-block-heading')).toHaveText('The Domain');

  // Add a prose block — TipTap mounts lazily; type + done commits.
  await page.click('.atlas-share-block-add-btn:has-text("text")');
  await expect(page.locator('.atlas-share-prose-rich .ProseMirror')).toBeVisible({ timeout: 10000 });
  await page.locator('.atlas-share-prose-rich .ProseMirror').click();
  await page.keyboard.type('The mists never lift.');
  await page.click('.atlas-share-block-done');

  // Static render shows the prose; the derived story mirror carries both blocks.
  await expect(page.locator('.atlas-share-block[data-block-kind="prose"]')).toContainText('The mists never lift.');
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    const p = s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page');
    return p && typeof p.story === 'string'
      && p.story.includes('# The Domain') && p.story.includes('The mists never lift.');
  });

  // Reorder: move the heading down — prose now renders first.
  const headingRow = page.locator('.atlas-share-block[data-block-kind="heading"]');
  await headingRow.hover();
  await headingRow.locator('.atlas-share-block-ctrl[title="Move down"]').click();
  await expect(page.locator('.atlas-share-block').first()).toHaveAttribute('data-block-kind', 'prose');
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    const p = s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page');
    return p && p.story.indexOf('The mists never lift.') < p.story.indexOf('# The Domain');
  });

  // Delete the heading (no confirm for headings); one block remains.
  await headingRow.hover();
  await headingRow.locator('.atlas-share-block-ctrl[title="Delete block"]').click();
  await expect(page.locator('.atlas-share-block')).toHaveCount(1);

  // List row reflects the block count.
  await page.click('.atlas-share-back');
  await expect(page.locator('.atlas-share-row-meta')).toHaveText('1 block');
});

test('page prose mentions render chips but NEVER write element fields (no derive)', async ({ page }) => {
  await setupWorld(page);
  const araliaId = await createElement(page, 'character', { name: 'Aralia' });
  await openShare(page);
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);

  await page.click('.atlas-share-block-add-btn:has-text("text")');
  await expect(page.locator('.atlas-share-prose-rich .ProseMirror')).toBeVisible({ timeout: 10000 });
  await page.locator('.atlas-share-prose-rich .ProseMirror').click();
  await page.keyboard.type('All hail @ara');
  await expect(page.locator('.atlas-mention-popover')).toBeVisible();
  await expect(page.locator('.atlas-mention-item').first()).toContainText('Aralia');
  await page.keyboard.press('Enter');
  await page.keyboard.type('!');
  await page.click('.atlas-share-block-done');

  // The chip is in the prose block's markdown (and the story mirror)…
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    const p = s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page');
    return p && typeof p.story === 'string' && p.story.includes('ow://character/');
  });
  // …but NO relation field was derived: page composition is presentation,
  // not worldbuilding data (unlike writing/knowledge narratives).
  const pageEl = await getPage(page);
  expect(Array.isArray(pageEl.characters) ? pageEl.characters : []).toHaveLength(0);
  expect(pageEl.story).toContain(araliaId);
});

test('element card: pick → compact card; full variant reveals chosen fields; preview renders the visitor view', async ({ page }) => {
  await setupWorld(page);
  const ireenaId = await createElement(page, 'character', {
    name: 'Ireena', description: 'The burgomaster\'s daughter.',
  });
  await createElement(page, 'location', { name: 'Vallaki' });
  await page.evaluate(async (id) => {
    // Give Ireena a relation so the card can render a resolved-name chip.
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const vallaki = (await store.listElements()).find((e: any) => e.name === 'Vallaki');
    await store.updateElement(id, { birthplace: vallaki.id });
    api.patchData(await store.listElements());
  }, ireenaId);

  await openShare(page);
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);

  // A stray pin must NOT surface in the generic picker (map artifacts are
  // drawn/placed, never picked — strip AND list share the rule).
  await createElement(page, 'pin', { name: 'stray pin', element_id: ireenaId, element_type: 'character' });

  // "+ element card" → picker → pick Ireena. Card opens in edit mode with a
  // live compact preview.
  await page.click('.atlas-share-block-add-btn:has-text("element card")');
  await expect(page.locator('.atlas-picker-search')).toBeVisible();
  await expect(page.locator('.atlas-picker-row', { hasText: 'stray pin' })).toHaveCount(0);
  await page.locator('.atlas-picker-row', { hasText: 'Ireena' }).click();
  await expect(page.locator('.atlas-share-card-edit-preview .atlas-share-card-name')).toHaveText('Ireena');

  // Switch to full + check two fields — the card preview shows them.
  await page.click('.atlas-share-card-edit-variants button:has-text("full")');
  await page.locator('.atlas-share-card-edit-fieldrow', { hasText: 'Description' }).locator('input').check();
  await page.locator('.atlas-share-card-edit-fieldrow', { hasText: 'Birthplace' }).locator('input').check();
  await expect(page.locator('.atlas-share-card-edit-preview')).toContainText('The burgomaster\'s daughter.');
  await expect(page.locator('.atlas-share-card-edit-preview .atlas-share-card-chip')).toContainText('Vallaki');
  await page.click('.atlas-share-block-done');

  // Static render shows the configured card; story mirror names the card.
  await expect(page.locator('.atlas-share-block[data-block-kind="element-card"] .atlas-share-card.is-full')).toBeVisible();
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    const p = s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page');
    return p && typeof p.story === 'string' && p.story.includes('[ Ireena — element card ]');
  });

  // Refs mirror carries the binding (the id-swap safety net).
  const pageEl = await getPage(page);
  expect(pageEl.atlas_page_refs).toEqual([ireenaId]);

  // Preview: visitor view shows title + card, no builder controls.
  await page.click('.atlas-share-preview-toggle');
  await expect(page.locator('.atlas-share-page-view-title')).toBeVisible();
  await expect(page.locator('.atlas-share-page-view .atlas-share-card-name')).toHaveText('Ireena');
  await expect(page.locator('.atlas-share-block-add')).toHaveCount(0);
  await expect(page.locator('.atlas-share-block-controls')).toHaveCount(0);

  // Back to the builder.
  await page.click('.atlas-share-preview-toggle');
  await expect(page.locator('.atlas-share-block-add')).toBeVisible();
});

test('legacy /publish URL aliases into the share room', async ({ page }) => {
  await setupWorld(page);

  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/publish`;
  });

  // The share room mounts (URL itself is left as-is — parse-level alias).
  await expect(page.locator('.atlas-share-room h1').first()).toHaveText('Share');
  await expect(page.locator('.atlas-room-nav-btn[data-room="share"]')).toHaveClass(/active/);
});
