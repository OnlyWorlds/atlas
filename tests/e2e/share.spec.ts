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
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'sworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a world flips the sidebar into elements mode (S255v3) — the
  // elements-search input is the mode-independent signal that creation
  // finished, since world rows are no longer visible in that mode.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function openShare(page: Page) {
  await page.click('.atlas-room-nav-btn[data-room="share"]');
  await expect(page.locator('.atlas-share-room h1').first()).toHaveText('Pages');
}

test('share room: nav button opens the room with an empty state', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);
  await expect(page).toHaveURL(/\/share$/);
  await expect(page.locator('.atlas-share-empty')).toBeVisible();
  await expect(page.locator('.atlas-share-row')).toHaveCount(0);
});

/** Set the page title via the unified header's click-to-edit name. */
async function setPageTitle(page: Page, name: string) {
  const title = page.locator('.atlas-share-detail-header .atlas-element-name');
  await title.click();
  const input = page.locator('.atlas-share-detail-header input.atlas-element-name-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(name);
  await input.press('Enter');
  // Wait for the commit to reflect before returning (deterministic under load).
  await expect(title).toHaveText(name);
}

test('create page → detail; rename + revert both persist; intent stays hidden but defaulted', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);

  // "+ new page" creates immediately and lands on the detail view.
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);
  // S369: a new page opens on its name, ready to type; Escape keeps the default.
  await expect(page.locator('.atlas-share-detail-header input.atlas-element-name-input')).toHaveValue('new page');
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-share-detail-header .atlas-element-name')).toHaveText('new page');
  await expect(page.locator('[data-action="copy-payload"]')).toBeVisible();
  // T-S7: Theme + Publish sit behind the meta summary row — expand first.
  await page.click('.atlas-share-meta-summary');
  // S4 gating: a local-only world can't publish — the section says why and
  // offers no controls.
  await expect(page.locator('.atlas-share-publish-hint')).toContainText('online world');
  await expect(page.locator('[data-action="publish"]')).toHaveCount(0);

  // Rename → commit saves; title is the header's editable name.
  await setPageTitle(page, 'barovia primer');
  await expect(page.locator('.atlas-share-detail-header .atlas-element-name')).toHaveText('barovia primer');

  // Revert to the original → commit must ALSO save (rename-revert discipline).
  await setPageTitle(page, 'new page');
  await expect(page.locator('.atlas-share-detail-header .atlas-element-name')).toHaveText('new page');
  await setPageTitle(page, 'barovia primer');

  // D5 (v1): the intent PICKER is gone from the UI — but the FIELD must
  // stay defaulted on the element (hidden ≠ deleted; the wire expects it).
  await expect(page.locator('select.atlas-share-intent')).toHaveCount(0);
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.some((e: any) =>
      e.type === 'narrative' && e.subtype === 'page' && e.atlas_page_intent === 'show');
  });

  // Back to the list — the page row shows name + empty summary (no intent chip).
  await page.click('.atlas-drillin-prefix');
  await expect(page).toHaveURL(/\/share$/);
  const row = page.locator('.atlas-share-row', { hasText: 'barovia primer' });
  await expect(row).toBeVisible();
  await expect(row.locator('.atlas-share-intent-chip')).toHaveCount(0);
  await expect(row.locator('.atlas-share-row-meta')).toHaveText('empty');

  // A second create gets a unique default name.
  await page.click('button.atlas-share-new');
  await expect(page.locator('.atlas-share-detail-header input.atlas-element-name-input')).toHaveValue('new page');
  await page.keyboard.press('Escape');
  await expect(page.locator('.atlas-share-detail-header .atlas-element-name')).toHaveText('new page');
  await page.click('.atlas-drillin-prefix');
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
  await expect(page.locator('.atlas-share-detail-header .atlas-element-name')).toHaveText('new page');

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
  await page.click('.atlas-drillin-prefix');
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

test('block builder: Escape commits an open heading edit (same as Enter/blur) — B-B9', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);

  await page.click('.atlas-share-block-add-btn:has-text("heading")');
  await expect(page.locator('input.atlas-share-heading-input')).toBeVisible();
  await page.fill('input.atlas-share-heading-input', 'Barovia');
  await page.keyboard.press('Escape');

  // Escape commits — the block leaves edit mode with the typed text saved,
  // it does not discard back to the pre-edit value.
  await expect(page.locator('input.atlas-share-heading-input')).toHaveCount(0);
  await expect(page.locator('h2.atlas-share-block-heading')).toHaveText('Barovia');
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    const p = s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page');
    return p && typeof p.story === 'string' && p.story.includes('# Barovia');
  });
});

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
  await page.click('.atlas-drillin-prefix');
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

  // And in the VISITOR preview (payload-true), the mention renders as plain
  // text — Aralia isn't card-included, so the prose link discloses nothing
  // (no chip element, no data-id; contract §5.1).
  await page.click('.atlas-share-preview-toggle:not([data-action])');
  const proseView = page.locator('.atlas-share-page-view .atlas-writing-compiled-prose');
  await expect(proseView).toContainText('All hail Aralia');
  await expect(proseView.locator('.atlas-element-chip')).toHaveCount(0);
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
  await page.click('.atlas-share-block-add-btn:has-text("+ element")');
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
    return p && typeof p.story === 'string' && p.story.includes('[ Ireena · element card ]');
  });

  // Refs mirror carries the binding (the id-swap safety net).
  const pageEl = await getPage(page);
  expect(pageEl.atlas_page_refs).toEqual([ireenaId]);

  // Preview: visitor view shows title + card, no builder controls. The
  // preview renders FROM THE PUBLISH PAYLOAD (contract §5.1) — Vallaki is
  // NOT card-included, so Ireena's birthplace renders as PLAIN TEXT (no chip,
  // no styling: non-disclosure leaks nothing).
  await page.click('.atlas-share-preview-toggle:not([data-action])');
  await expect(page.locator('.atlas-share-page-view-title')).toBeVisible();
  await expect(page.locator('.atlas-share-page-view .atlas-share-card-name')).toHaveText('Ireena');
  await expect(page.locator('.atlas-share-block-add')).toHaveCount(0);
  await expect(page.locator('.atlas-share-block-controls')).toHaveCount(0);
  const birthplaceRow = page.locator('.atlas-share-page-view .atlas-share-card-field', { hasText: 'Birthplace' });
  await expect(birthplaceRow).toContainText('Vallaki');
  await expect(birthplaceRow.locator('.atlas-share-card-chip')).toHaveCount(0);

  // Back to the builder; card Vallaki too → the disclosure flips: now the
  // birthplace token carries a ref and renders as a chip.
  await page.click('.atlas-share-preview-toggle:not([data-action])');
  await expect(page.locator('.atlas-share-block-add')).toBeVisible();
  await page.click('.atlas-share-block-add-btn:has-text("+ element")');
  await page.locator('.atlas-picker-row', { hasText: 'Vallaki' }).click();
  await page.click('.atlas-share-block-done');
  await page.click('.atlas-share-preview-toggle:not([data-action])');
  await expect(
    page.locator('.atlas-share-page-view .atlas-share-card-field', { hasText: 'Birthplace' })
      .locator('.atlas-share-card-chip'),
  ).toContainText('Vallaki');

  // Back to the builder.
  await page.click('.atlas-share-preview-toggle:not([data-action])');
  await expect(page.locator('.atlas-share-block-add')).toBeVisible();

  // "Featured in": the card binding reaches the reverse scan via the flat
  // atlas_page_refs mirror — Ireena's element detail lists the page, and the
  // chip routes back to the share room (not the writing room).
  await page.evaluate((id) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/element/${id}`;
  }, ireenaId);
  const featured = page.locator('.atlas-detail-refs-pages');
  await expect(featured).toBeVisible();
  await expect(featured.locator('.atlas-detail-section-header span').first()).toHaveText('Featured in');
  await featured.locator('.atlas-link-chip', { hasText: 'new page' }).click();
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);
});

test('circle block: the Knowledge bridge mints a page; compiled entries render; preview is disclosure-true', async ({ page }) => {
  await setupWorld(page);
  // Knowledge fixtures: Ireena ∈ "the party" (a circle) which holds one entry
  // whose prose mentions Ireena via an ow:// link.
  const ireenaId = await createElement(page, 'character', { name: 'Ireena' });
  const circleId = await createElement(page, 'collective', {
    name: 'the party', subtype: 'circle', characters: [ireenaId],
  });
  await createElement(page, 'narrative', {
    name: 'the mists', subtype: 'knowledge', collectives: [circleId],
    story: `The mists never lift. [Ireena](ow://character/${ireenaId}) hides.`,
  });

  // Known-view → the bridge button mints a reference page with a circle block.
  await page.evaluate((id) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/knowledge/knower/${id}`;
  }, circleId);
  await expect(page.locator('.atlas-knowledge-knower-header h2')).toContainText('the party');
  await page.locator('.atlas-knowledge-allfields', { hasText: 'create page' }).click();

  // Lands in the share room: circle block statically rendered with the
  // compiled entry; story mirror names it; intent prefilled to reference.
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);
  await expect(page.locator('.atlas-share-detail-header .atlas-element-name')).toHaveText('what the party know');
  const circleBlock = page.locator('.atlas-share-block[data-block-kind="circle"]');
  await expect(circleBlock.locator('.atlas-share-circle-name')).toHaveText('the party');
  await expect(circleBlock.locator('.atlas-share-circle-entry-title')).toHaveText('the mists');
  await expect(circleBlock).toContainText('The mists never lift.');
  // D5: no picker — the bridge-minted page still carries intent 'reference'
  // in the model (hidden field, wire compat).
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    const p = s.data.elements.find((e: any) => e.type === 'narrative' && e.subtype === 'page');
    return p && p.atlas_page_intent === 'reference'
      && typeof p.story === 'string' && p.story.includes('[ the party · circle knowledge ]');
  });

  // Visitor preview (payload-true): the FROZEN entry renders; the prose
  // mention of Ireena is plain text — she isn't card-included (§5.1).
  await page.click('.atlas-share-preview-toggle:not([data-action])');
  const previewCircle = page.locator('.atlas-share-page-view .atlas-share-circle');
  await expect(previewCircle.locator('.atlas-share-circle-entry-title')).toHaveText('the mists');
  await expect(previewCircle).toContainText('Ireena hides.');
  await expect(previewCircle.locator('.atlas-element-chip')).toHaveCount(0);
  await page.click('.atlas-share-preview-toggle:not([data-action])');

  // Builder "+ circle" flow: picker restricted to collectives → editor preview.
  await page.click('.atlas-share-block-add-btn:has-text("circle")');
  await expect(page.locator('.atlas-picker-search')).toBeVisible();
  await expect(page.locator('.atlas-picker-row', { hasText: 'Ireena' })).toHaveCount(0);
  await page.locator('.atlas-picker-row', { hasText: 'the party' }).click();
  await expect(page.locator('.atlas-share-circle-edit .atlas-share-circle-name')).toHaveText('the party');
  await page.click('.atlas-share-block-done');
  await expect(page.locator('.atlas-share-block[data-block-kind="circle"]')).toHaveCount(2);
});

test('legacy /publish URL aliases into the share room', async ({ page }) => {
  await setupWorld(page);

  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/publish`;
  });

  // The share room mounts (URL itself is left as-is — parse-level alias).
  await expect(page.locator('.atlas-share-room h1').first()).toHaveText('Pages');
  await expect(page.locator('.atlas-room-nav-btn[data-room="share"]')).toHaveClass(/active/);
});

test('map block: a pin moved elsewhere re-renders on the open page (no re-add needed)', async ({ page }) => {
  await setupWorld(page);

  // Seed: character + web-imaged map + one pin at 25%/25%.
  const ids = await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const char = await store.createElement('character', { name: 'Frodo' });
    const map = await store.createElement('map', {
      name: 'Overworld', image_url: 'https://example.com/map.png', width: 1000, height: 800,
    });
    const pin = await store.createPin({
      name: 'camp', map_id: map.id, element_id: char.id, element_type: 'character', x: 250, y: 200,
    });
    api.patchData(await store.listElements());
    return { pinId: pin.id };
  });

  await openShare(page);
  await page.click('button.atlas-share-new');
  await expect(page).toHaveURL(/\/share\/[0-9a-f-]+$/);

  await page.click('.atlas-share-block-add-btn:has-text("map")');
  await page.locator('.atlas-picker-row', { hasText: 'Overworld' }).click();
  await page.click('.atlas-share-block-done');
  const dot = page.locator('.atlas-share-map-pin');
  await expect(dot).toHaveAttribute('style', /left: 25%/);

  // Move the pin the way the map tab's drag handler does (store write +
  // data patch) — the OPEN page's map block must follow without any block
  // re-add or room re-mount (2026-07-19 regression: the tick gated on the
  // block-stack JSON and never saw element changes).
  await page.evaluate(async ({ pinId }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.updatePin(pinId, { x: 750, y: 600 });
    api.patchData(await store.listElements());
  }, ids);

  await expect(page.locator('.atlas-share-map-pin')).toHaveAttribute('style', /left: 75%/);
  // y 600 of 800 is stored from the BOTTOM (the schema's origin, S361), so it
  // draws a quarter of the way down: the one conversion is at the freeze.
  await expect(page.locator('.atlas-share-map-pin')).toHaveAttribute('style', /top: 25%/);
});

test('map block: labels follow show\'s rule (S382, #121): a name prints once, no label on another pin or label', async ({ page }) => {
  await setupWorld(page);
  // The label pass measures laid-out ink once the image has its size, so the
  // map needs an image that loads: serve one for the fixture URL.
  await page.route('https://example.com/space.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="800"><rect width="1000" height="800" fill="#123"/></svg>',
  }));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', {
      name: 'Space', image_url: 'https://example.com/space.svg', width: 1000, height: 800,
    });
    // Moppetopia's shapes: a place inside the zone of its own name, and a
    // tight cluster whose labels cannot all sit above their dots.
    const pin = async (name: string, x: number, y: number) => {
      const loc = await store.createElement('location', { name });
      await store.createPin({ map_id: map.id, element_id: loc.id, element_type: 'location', x, y });
    };
    await pin('Snack Nebula', 700, 500);
    const cluster = ['Feltropolis', 'The Leaky Bucket', 'USS Fuzzball', 'Drip Drop', 'Crumblefields', 'Stale Vengeance'];
    for (let i = 0; i < cluster.length; i++) await pin(cluster[i], 300 + (i % 3) * 25, 400 + Math.floor(i / 3) * 20);
    const zone = await store.createElement('zone', { name: 'Snack Nebula', atlas_shape: 'polygon' });
    const pts = [[550, 350], [850, 350], [850, 650], [550, 650]];
    for (let i = 0; i < pts.length; i++) {
      await store.createMarker({ name: `Snack Nebula - Point ${i}`, map_id: map.id, zone_id: zone.id, x: pts[i][0], y: pts[i][1], order: i });
    }
    api.patchData(await store.listElements());
  });

  await openShare(page);
  await page.click('button.atlas-share-new');
  await page.click('.atlas-share-block-add-btn:has-text("map")');
  await page.locator('.atlas-picker-row', { hasText: 'Space' }).click();
  await page.click('.atlas-share-block-done');
  await expect(page.locator('.atlas-share-map-pin')).toHaveCount(7);

  const measure = () => page.locator('.atlas-share-map-frame').evaluate((frame) => {
    const ov = (a: DOMRect, b: DOMRect) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    const dots = Array.from(frame.querySelectorAll<HTMLElement>('.atlas-share-map-pin'));
    const labels = Array.from(frame.querySelectorAll<HTMLElement>('.atlas-share-map-pin-label.is-static, .atlas-share-map-zone-label'))
      .filter(l => !l.hidden && getComputedStyle(l).display !== 'none');
    let onDot = 0, onLabel = 0;
    for (const l of labels) for (const d of dots) if (l.parentElement !== d && ov(l.getBoundingClientRect(), d.getBoundingClientRect())) onDot++;
    for (let a = 0; a < labels.length; a++) for (let b = a + 1; b < labels.length; b++) {
      if (ov(labels[a].getBoundingClientRect(), labels[b].getBoundingClientRect())) onLabel++;
    }
    const names = labels.map(l => l.textContent!.trim());
    return { onDot, onLabel, snack: names.filter(n => n === 'Snack Nebula').length, shown: names.length };
  });
  // The pass runs a frame after the image lands: poll the settled state.
  await expect.poll(measure).toMatchObject({ onDot: 0, onLabel: 0, snack: 1 });
  expect((await measure()).shown).toBeGreaterThan(1);
});

async function readPayloadMapZones(page: Page) {
  return page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const els = await api.getActiveStore().listElements();
    const pageId = window.location.hash.match(/\/share\/([0-9a-f-]+)/)?.[1];
    const pageEl = els.find((e: any) => e.id === pageId);
    const { buildPagePayload } = await import('/src/core/share-payload.ts');
    const mapBlock = buildPagePayload(pageEl, els, []).blocks.find((b: any) => b.kind === 'map');
    return (mapBlock?.zones ?? []).map((z: any) => z.name);
  });
}

test('map block: per-zone include-list — render, curate one off, freeze the rest', async ({ page }) => {
  await setupWorld(page);

  // Seed: web-imaged map + TWO polygon zones (The Marsh, The Ridge).
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const map = await store.createElement('map', {
      name: 'Overworld', image_url: 'https://example.com/map.png', width: 1000, height: 800,
    });
    const mk = async (zoneName: string, pts: number[][]) => {
      const zone = await store.createElement('zone', { name: zoneName, atlas_shape: 'polygon' });
      for (let i = 0; i < pts.length; i++) {
        await store.createMarker({
          name: `${zoneName} - Point ${i}`, map_id: map.id, zone_id: zone.id,
          x: pts[i][0], y: pts[i][1], order: i,
        });
      }
    };
    await mk('The Marsh', [[100, 100], [400, 100], [250, 350]]);
    await mk('The Ridge', [[600, 500], [900, 500], [750, 750]]);
    api.patchData(await store.listElements());
  });

  await openShare(page);
  await page.click('button.atlas-share-new');
  await page.click('.atlas-share-block-add-btn:has-text("map")');
  await page.locator('.atlas-picker-row', { hasText: 'Overworld' }).click();

  // Default: all zones checked, both render, both freeze.
  await page.click('.atlas-share-block-done');
  await expect(page.locator('.atlas-share-map-zone')).toHaveCount(2);
  await expect(page.locator('.atlas-share-map-zones title')).toHaveText(['The Marsh', 'The Ridge']);
  expect(await readPayloadMapZones(page)).toEqual(['The Marsh', 'The Ridge']);

  // Curate: uncheck The Marsh in the per-zone checklist — only The Ridge survives.
  await page.locator('.atlas-share-map').click();
  await page.locator('.atlas-share-card-edit-fieldrow', { hasText: 'The Marsh' }).locator('input').uncheck();
  await page.click('.atlas-share-block-done');
  await expect(page.locator('.atlas-share-map-zone')).toHaveCount(1);
  await expect(page.locator('.atlas-share-map-zones title')).toHaveText(['The Ridge']);
  expect(await readPayloadMapZones(page)).toEqual(['The Ridge']);

  // Uncheck the last one too — empty include-list = no zones on the wire.
  await page.locator('.atlas-share-map').click();
  await page.locator('.atlas-share-card-edit-fieldrow', { hasText: 'The Ridge' }).locator('input').uncheck();
  await page.click('.atlas-share-block-done');
  await expect(page.locator('.atlas-share-map-zone')).toHaveCount(0);
  expect(await readPayloadMapZones(page)).toEqual([]);
});

test('prose selection bubble: bold + link-to-existing with preserved label (alias recorded)', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Frodo' });
    api.patchData(await store.listElements());
  });

  await openShare(page);
  await page.click('button.atlas-share-new');
  await page.click('.atlas-share-block-add-btn:has-text("text")');
  const pm = page.locator('.atlas-share-prose-rich .ProseMirror');
  await pm.click();
  await page.keyboard.type('A weary halfling rested here.');

  // Select "weary halfling" — the bubble appears above the selection.
  await page.evaluate(() => {
    const host = document.querySelector('.atlas-share-prose-rich .ProseMirror')!;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode()!;
    const t = tn.textContent!;
    const range = document.createRange();
    range.setStart(tn, t.indexOf('weary'));
    range.setEnd(tn, t.indexOf('halfling') + 'halfling'.length);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  const bubble = page.locator('.atlas-prose-bubble');
  await expect(bubble).toHaveClass(/is-visible/);

  // Bold via the bubble — StarterKit mark, now visible in the UI.
  await bubble.locator('[data-role="bold"]').click();
  await expect(pm.locator('strong')).toHaveText('weary halfling');
  await expect(bubble.locator('[data-role="bold"]')).toHaveClass(/is-active/);
  await bubble.locator('[data-role="bold"]').click(); // toggle back off
  await expect(pm.locator('strong')).toHaveCount(0);

  // Link the same selection to Frodo — chip keeps the SELECTED words as its
  // label, and the label is recorded as an alias so chip-label sync can't
  // rename it to "Frodo" on the next data tick.
  await bubble.locator('[data-role="link"]').click();
  await page.locator('.atlas-picker-row', { hasText: 'Frodo' }).click();
  const chip = pm.locator('.atlas-element-chip');
  await expect(chip).toHaveText('weary halfling');
  await expect.poll(async () => await page.evaluate(() => {
    const el = (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.name === 'Frodo');
    return el?.atlas_aliases ?? null;
  })).toEqual(['weary halfling']);
  await expect(chip).toHaveText('weary halfling');

  // Right-click menu offers the same action for discoverability.
  await page.evaluate(() => {
    const host = document.querySelector('.atlas-share-prose-rich .ProseMirror')!;
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode()!;
    const range = document.createRange();
    range.setStart(tn, 0);
    range.setEnd(tn, 1);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });
  await pm.click({ button: 'right', position: { x: 8, y: 10 } });
  await expect(page.locator('.atlas-prose-context-menu-item', { hasText: 'Link to existing element' })).toBeVisible();
  await page.keyboard.press('Escape');
});

/**
 * S323 — the preview must show the ARTIFACT, not the app theme.
 *
 * A page carries its own `data-mode`; the app carries a separate theme. Dark
 * had no CSS rules at all until now — it was inherited free from a shell that
 * was always dark — so once light mode shipped, a dark page previewed as dark
 * ink on light paper while the same payload rendered correctly dark in the
 * `show` viewer. The preview was showing a different artifact than the one
 * that publishes, which is the one thing a payload-true preview may not do.
 *
 * Asserted as an OUTCOME (measured luminance of the rendered article) rather
 * than a restatement of the CSS, and in BOTH themes so the dark path cannot
 * silently drift either.
 */
test('a dark page previews dark even while the app is in light mode', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'character', { name: 'Ireena', description: 'The daughter.' });

  await openShare(page);
  await page.click('button.atlas-share-new');
  await page.click('.atlas-share-block-add-btn:has-text("+ element")');
  await page.locator('.atlas-picker-row', { hasText: 'Ireena' }).click();
  await page.click('.atlas-share-block-done');
  await page.click('.atlas-share-preview-toggle');

  const article = page.locator('.atlas-share-page-view');
  await expect(article).toHaveAttribute('data-mode', 'dark');

  const read = async () => await article.evaluate((el) => {
    const cs = getComputedStyle(el);
    const value = el.querySelector('.atlas-share-card-field-value');
    const lum = (c: string) => {
      const m = c.match(/\d+(\.\d+)?/g);
      if (!m) return -1;
      return (Number(m[0]) * 0.299 + Number(m[1]) * 0.587 + Number(m[2]) * 0.114);
    };
    return {
      bgLum: lum(cs.backgroundColor),
      textLum: lum(cs.color),
      fieldLum: value ? lum(getComputedStyle(value).color) : -1,
    };
  });

  // Dark theme: the article and every token-driven descendant read light-on-dark.
  const inDark = await read();
  expect(inDark.bgLum).toBeLessThan(40);
  expect(inDark.textLum).toBeGreaterThan(150);
  expect(inDark.fieldLum).toBeGreaterThan(150);

  // Flip the APP to light. The page is still a dark page.
  await page.evaluate(() => {
    localStorage.setItem('atlas_theme', 'light');
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  const inLight = await read();
  expect(inLight.bgLum).toBeLessThan(40);
  expect(inLight.textLum).toBeGreaterThan(150);
  // The token-driven card field is the one the triplet re-pin alone missed:
  // the light block defines --atlas-text as a flat literal.
  expect(inLight.fieldLum).toBeGreaterThan(150);
});

// S364 lane A5: a charts refresh (the id-swap / re-key signal, or the first
// readCharts landing after a deep-linked page opens) rebuilt the block list
// under an open text block, remounting its editor from the in-memory block,
// which did not hold the pending text yet: typing jumped back and lost focus.
test('an open text block survives a charts refresh', async ({ page }) => {
  await setupWorld(page);
  await openShare(page);
  await page.click('button.atlas-share-new');
  await page.click('.atlas-share-block-add-btn:has-text("text")');
  const pm = page.locator('.atlas-share-prose-rich .ProseMirror');
  await expect(pm).toBeVisible({ timeout: 10000 });
  await pm.click();
  await page.keyboard.type('The mists never lift');
  // Mark the live editor node, then fire the refresh inside the save debounce.
  await page.evaluate(() => {
    (document.querySelector('.atlas-share-prose-rich .ProseMirror') as HTMLElement).dataset.probe = 'same-node';
    window.dispatchEvent(new Event('atlas:charts-changed'));
  });
  await page.waitForTimeout(150); // let readCharts resolve and the refresh run
  await expect(page.locator('.atlas-share-prose-rich .ProseMirror[data-probe="same-node"]')).toHaveCount(1);
  await page.keyboard.type(', ever.');
  await expect(pm).toContainText('The mists never lift, ever.');
});
