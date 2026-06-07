/**
 * Knowledge room e2e (DESIGN_KNOWLEDGE.md — Track A).
 *
 * Covers: room skeleton + empty state; the draft create flow (nothing
 * persists until "Create"; survives navigation via the per-world stash);
 * the embedded TipTap editor (K3) — @-mentions derive about-fields with
 * `collectives` EXCLUDED (mention ≠ holdership, convention #68); the
 * Knowers tab + known-view (K4); element-detail "Knowledge" surfacing (K6).
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
    const sub = await root.getDirectoryHandle('knowledge-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'kworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: 'kworld' })).toBeVisible();
}

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

/** Read an element from state by id. */
async function getElement(page: Page, id: string): Promise<any> {
  return await page.evaluate((eid) => {
    const state = (window as any).__atlasTestApi.getState();
    return state.data.elements.find((e: any) => e.id === eid) ?? null;
  }, id);
}

async function openKnowledge(page: Page) {
  await page.click('.atlas-room-nav-btn[data-room="knowledge"]');
  await expect(page.locator('.atlas-knowledge-room h1').first()).toHaveText('Knowledge');
}

/** Wait for the lazy-loaded TipTap editor inside the knowledge room. */
async function waitForKnowledgeEditor(page: Page) {
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toBeVisible({ timeout: 10000 });
}

test('knowledge room: nav button opens the room with an empty state', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);
  await expect(page.locator('.atlas-knowledge-empty')).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(0);
});

test('draft create flow: nothing persists until "create"', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);

  // Open the draft editor — should NOT have created anything.
  await page.click('button.atlas-knowledge-new');
  await expect(page).toHaveURL(/\/knowledge\/new$/);
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toHaveText('New knowledge entry');

  // Cancel → back to list, still empty (no entry was saved).
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-ghost');
  await expect(page.locator('.atlas-knowledge-empty')).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(0);

  // New again, fill name + prose (TipTap), then create.
  await page.click('button.atlas-knowledge-new');
  await page.fill('input.atlas-knowledge-name', 'the cursed village');
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('Barovia is cursed; a count rules from the castle.');
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-primary');

  // Lands on the saved entry's editor with the prose carried over.
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toHaveText('the cursed village');
  await waitForKnowledgeEditor(page);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toContainText('Barovia is cursed');

  // Back to the list — the entry now appears.
  await page.click('.atlas-knowledge-back');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the cursed village' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(1);
});

test('draft persists across navigation; cancel clears the stash', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);

  // Type into a draft, then leave it (back to list) — still no saved entry.
  await page.click('button.atlas-knowledge-new');
  await page.fill('input.atlas-knowledge-name', 'half-typed secret');
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('the abbot is not what he seems');
  await page.click('.atlas-knowledge-back');
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(0);

  // Return to the draft — content restored from the per-world stash.
  await page.click('button.atlas-knowledge-new');
  await expect(page.locator('input.atlas-knowledge-name')).toHaveValue('half-typed secret');
  await waitForKnowledgeEditor(page);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toContainText('the abbot is not what he seems');

  // Explicit cancel clears the stash — next draft starts fresh.
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-ghost');
  await page.click('button.atlas-knowledge-new');
  await expect(page.locator('input.atlas-knowledge-name')).toHaveValue('');
  await waitForKnowledgeEditor(page);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).not.toContainText('abbot');
});

test('saved entry: rename then revert both persist (no stale baseline)', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);

  await page.click('button.atlas-knowledge-new');
  await page.fill('input.atlas-knowledge-name', 'original');
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-primary');
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toHaveText('original');

  // Rename → blur saves.
  await page.fill('input.atlas-knowledge-name', 'renamed');
  await page.locator('input.atlas-knowledge-name').blur();
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.some((e: any) => e.type === 'narrative' && e.name === 'renamed');
  });

  // Revert to the original → blur must ALSO save (regression: build-time
  // baseline compare skipped the write when reverting to the original value).
  await page.fill('input.atlas-knowledge-name', 'original');
  await page.locator('input.atlas-knowledge-name').blur();
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.some((e: any) => e.type === 'narrative' && e.name === 'original');
  });
});

test('draft @-mention derives a non-removable about chip and persists as subject on create', async ({ page }) => {
  await setupWorld(page);
  const baroviaId = await createElement(page, 'location', { name: 'Barovia' });
  await openKnowledge(page);

  await page.click('button.atlas-knowledge-new');
  await page.fill('input.atlas-knowledge-name', 'the curse');
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('All of @bar');
  await expect(page.locator('.atlas-mention-popover')).toBeVisible();
  await expect(page.locator('.atlas-mention-item').first()).toContainText('Barovia');
  await page.keyboard.press('Enter');
  await page.keyboard.type(' lies under a curse.');

  // The mention shows up as a prose-derived About chip (not removable here).
  await expect(page.locator('.atlas-knowledge-chip.is-derived', { hasText: 'Barovia' })).toBeVisible();

  // Create — the derived subject lands in the matching Involves field.
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-primary');
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toHaveText('the curse');
  await page.waitForFunction((locId) => {
    const s = (window as any).__atlasTestApi.getState();
    const entry = s.data.elements.find((e: any) => e.type === 'narrative' && e.name === 'the curse');
    return entry && Array.isArray(entry.locations) && entry.locations.includes(locId);
  }, baroviaId);
});

test('saved entry: mentions derive about-fields, but a mentioned circle is NEVER added as holder', async ({ page }) => {
  await setupWorld(page);
  const charId = await createElement(page, 'character', { name: 'Ireena' });
  await createElement(page, 'collective', { name: 'the watch' });
  const entryId = await createElement(page, 'narrative', {
    name: 'rumor', subtype: 'knowledge', story: '',
  });

  await openKnowledge(page);
  await page.click(`.atlas-knowledge-row:has-text("rumor")`);
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();

  // Mention the character — derives into `characters` on save.
  await page.keyboard.type('@ire');
  await expect(page.locator('.atlas-mention-popover')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type(' is hiding. So say ');

  // Mention the collective — chip inserts, but holders must stay untouched.
  await page.keyboard.type('@wat');
  await expect(page.locator('.atlas-mention-popover')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type('.');

  // Debounced save lands: character derived as subject, collective NOT a holder.
  await expect.poll(async () => {
    const entry = await getElement(page, entryId);
    return Array.isArray(entry?.characters) && entry.characters.includes(charId);
  }, { timeout: 5000 }).toBe(true);
  const entry = await getElement(page, entryId);
  expect(entry.story).toContain('ow://character/');
  expect(entry.story).toContain('ow://collective/');
  expect(Array.isArray(entry.collectives) ? entry.collectives : []).toHaveLength(0);
});

test('knowers tab lists holders; known-view compiles held entries per element', async ({ page }) => {
  await setupWorld(page);
  const ireenaId = await createElement(page, 'character', { name: 'Ireena' });
  const partyId = await createElement(page, 'collective', {
    name: 'the party', subtype: 'circle', characters: [ireenaId],
  });
  const baroviaId = await createElement(page, 'location', { name: 'Barovia' });
  await createElement(page, 'narrative', {
    name: 'the curse', subtype: 'knowledge',
    story: 'Barovia is cursed.', collectives: [partyId], locations: [baroviaId],
  });
  await createElement(page, 'narrative', {
    name: 'private fear', subtype: 'knowledge',
    story: 'The count watches her.', narrator: ireenaId, locations: [baroviaId],
  });

  await openKnowledge(page);

  // Knowers tab lists the circle and the narrator.
  await page.click('.atlas-knowledge-tab:has-text("knowers")');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the party' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'Ireena' })).toBeVisible();

  // Ireena's known-view: holds 2 entries (1 direct + 1 via the party).
  await page.click('.atlas-knowledge-row:has-text("Ireena")');
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toContainText('Ireena');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the curse' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'private fear' })).toBeVisible();

  // Known world: one card for Barovia, compiled from BOTH entry texts.
  const card = page.locator('.atlas-knowledge-known-card', { hasText: 'Barovia' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Barovia is cursed.');
  await expect(card).toContainText('The count watches her.');

  // Back returns to the knowers tab.
  await page.click('.atlas-knowledge-back');
  await expect(page.locator('.atlas-knowledge-tab.is-active')).toHaveText('knowers');
});

test('element detail surfaces Knowledge: known by + subject of (K6)', async ({ page }) => {
  await setupWorld(page);
  const ireenaId = await createElement(page, 'character', { name: 'Ireena' });
  const partyId = await createElement(page, 'collective', {
    name: 'the party', subtype: 'circle', characters: [ireenaId],
  });
  const baroviaId = await createElement(page, 'location', { name: 'Barovia' });
  await createElement(page, 'narrative', {
    name: 'the curse', subtype: 'knowledge',
    story: 'Barovia is cursed.', collectives: [partyId], locations: [baroviaId],
  });

  // Open Barovia's element detail via URL.
  await page.evaluate((eid) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/element/${eid}`;
  }, baroviaId);

  const section = page.locator('.atlas-detail-refs-knowledge');
  await expect(section).toBeVisible();
  await expect(section).toContainText('Known by');
  await expect(section.locator('.atlas-link-chip', { hasText: 'the party' })).toBeVisible();
  await expect(section).toContainText('Subject of');
  await expect(section.locator('.atlas-link-chip', { hasText: 'the curse' })).toBeVisible();

  // "Known by" chip routes to the known-view.
  await section.locator('.atlas-link-chip', { hasText: 'the party' }).click();
  await expect(page).toHaveURL(new RegExp(`/knowledge/knower/${partyId}$`));
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toContainText('the party');
});
