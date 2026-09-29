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
  // Creating a world now flips the sidebar into elements mode (S255v3), so
  // world rows are no longer visible here — wait for the elements body instead.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
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
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toBeVisible({ timeout: 20000 });
}

/** Set the entry title via the unified header's click-to-edit name. */
async function setEntryTitle(page: Page, name: string) {
  const title = page.locator('.atlas-knowledge-entry-header .atlas-element-name');
  await title.click();
  const input = page.locator('.atlas-knowledge-entry-header input.atlas-element-name-input');
  await input.waitFor({ state: 'visible' });
  await input.fill(name);
  await input.press('Enter');
  // Wait for the commit to reflect before returning (deterministic under load).
  await expect(title).toHaveText(name);
}

test('knowledge room: nav button opens the room with an empty state', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);
  await expect(page.locator('.atlas-knowledge-empty')).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(0);
});

test('draft create flow: nothing persists until "create"', async ({ page }) => {
  test.slow(); // mounts the lazy TipTap editor twice (draft + saved) — slow under parallel load
  await setupWorld(page);
  await openKnowledge(page);

  // Open the draft editor — should NOT have created anything.
  await page.click('button.atlas-knowledge-new');
  await expect(page).toHaveURL(/\/knowledge\/new$/);
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveClass(/is-placeholder/);

  // Cancel → back to list, still empty (no entry was saved).
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-ghost');
  await expect(page.locator('.atlas-knowledge-empty')).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(0);

  // New again, fill name + prose (TipTap), then create.
  await page.click('button.atlas-knowledge-new');
  await setEntryTitle(page, 'the cursed village');
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('Barovia is cursed; a count rules from the castle.');
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-primary');

  // Lands on the saved entry's editor with the prose carried over.
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveText('the cursed village');
  await waitForKnowledgeEditor(page);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toContainText('Barovia is cursed');

  // Back to the list — the entry now appears.
  await page.click('.atlas-drillin-prefix');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the cursed village' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(1);
});

test('draft persists across navigation; cancel clears the stash', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);

  // Type into a draft, then leave it (back to list) — still no saved entry.
  await page.click('button.atlas-knowledge-new');
  await setEntryTitle(page, 'half-typed secret');
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('the abbot is not what he seems');
  await page.click('.atlas-drillin-prefix');
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(0);

  // Return to the draft — content restored from the per-world stash.
  await page.click('button.atlas-knowledge-new');
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveText('half-typed secret');
  await waitForKnowledgeEditor(page);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toContainText('the abbot is not what he seems');

  // Explicit cancel clears the stash — next draft starts fresh.
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-ghost');
  await page.click('button.atlas-knowledge-new');
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveClass(/is-placeholder/);
  await waitForKnowledgeEditor(page);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).not.toContainText('abbot');
});

test('saved entry: rename then revert both persist (no stale baseline)', async ({ page }) => {
  test.slow(); // entry editor mounts the lazy TipTap chunk — slow under parallel load
  await setupWorld(page);
  // Create the saved entry directly (the draft→create flow is covered above) —
  // keeps this rename-focused test light so it doesn't starve under contention.
  await createElement(page, 'narrative', { name: 'original', subtype: 'knowledge', story: '' });
  await openKnowledge(page);
  await page.click('.atlas-knowledge-row:has-text("original")');
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveText('original');

  // Rename → commit saves.
  await setEntryTitle(page, 'renamed');
  await page.waitForFunction(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.some((e: any) => e.type === 'narrative' && e.name === 'renamed');
  });

  // Revert to the original → commit must ALSO save (regression: build-time
  // baseline compare skipped the write when reverting to the original value).
  await setEntryTitle(page, 'original');
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
  await setEntryTitle(page, 'the curse');
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
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveText('the curse');
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
  await page.click('.atlas-room-tab:has-text("Knowers")');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the party' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'Ireena' })).toBeVisible();

  // Ireena's known-view: holds 2 entries (1 direct + 1 via the party).
  await page.click('.atlas-knowledge-row:has-text("Ireena")');
  await expect(page.locator('.atlas-knowledge-knower-header h2')).toContainText('Ireena');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the curse' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'private fear' })).toBeVisible();

  // Known world: one card for Barovia, compiled from BOTH entry texts.
  const card = page.locator('.atlas-knowledge-known-card', { hasText: 'Barovia' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('Barovia is cursed.');
  await expect(card).toContainText('The count watches her.');

  // Back returns to the knowers tab.
  await page.click('.atlas-drillin-prefix');
  await expect(page.locator('.atlas-room-tab.is-active')).toContainText('Knowers');
});

test('context pane graphs an open entry: narrator + circle holders appear as neighbors', async ({ page }) => {
  await setupWorld(page);
  const ireenaId = await createElement(page, 'character', { name: 'Ireena' });
  const partyId = await createElement(page, 'collective', {
    name: 'the party', subtype: 'circle', characters: [ireenaId],
  });
  const baroviaId = await createElement(page, 'location', { name: 'Barovia' });
  const entryId = await createElement(page, 'narrative', {
    name: 'the curse', subtype: 'knowledge',
    story: 'Barovia is cursed.', narrator: ireenaId, collectives: [partyId], locations: [baroviaId],
  });

  await openKnowledge(page);
  await page.click(`.atlas-knowledge-row:has-text("the curse")`);
  await expect(page).toHaveURL(new RegExp(`/knowledge/${entryId}$`));

  // Right-pane context tab graphs the entry: holders (narrator single-link +
  // circle multi-link) AND the subject all appear as neighbor nodes.
  // (Regression: single-link fields were invisible to the graph.)
  await page.locator('.atlas-tab[data-tab-kind="context"]').click();
  const pane = page.locator('.atlas-context-pane');
  await expect(pane.locator('.atlas-context-graph-node.is-center', { hasText: 'the curse' })).toBeVisible();
  await expect(pane.locator('.atlas-context-graph-node', { hasText: 'Ireena' })).toBeVisible();
  await expect(pane.locator('.atlas-context-graph-node', { hasText: 'the party' })).toBeVisible();
  await expect(pane.locator('.atlas-context-graph-node', { hasText: 'Barovia' })).toBeVisible();
});

test('unlink chip keeps prose text + field; About × is the explicit removal path', async ({ page }) => {
  await setupWorld(page);
  const baroviaId = await createElement(page, 'location', { name: 'Barovia' });
  const entryId = await createElement(page, 'narrative', {
    name: 'rumor', subtype: 'knowledge', story: '',
  });

  await openKnowledge(page);
  await page.click('.atlas-knowledge-row:has-text("rumor")');
  await waitForKnowledgeEditor(page);
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('All of @bar');
  await expect(page.locator('.atlas-mention-popover')).toBeVisible();
  await page.keyboard.press('Enter');
  await page.keyboard.type(' suffers.');

  // Debounced save derives the subject into `locations`.
  await expect.poll(async () => {
    const entry = await getElement(page, entryId);
    return Array.isArray(entry?.locations) && entry.locations.includes(baroviaId);
  }, { timeout: 5000 }).toBe(true);

  // Right-click the chip → Unlink: chip becomes plain text. The field is
  // RETAINED while the element's name still appears in the prose
  // (conservative rule in unlinkChip — the text still references Barovia);
  // explicit subject removal lives on the About chip ×.
  await page.click('.atlas-knowledge-prose-rich .atlas-element-chip', { button: 'right' });
  await page.click('.atlas-prose-context-menu [data-role="unlink-chip"]');
  await expect(page.locator('.atlas-knowledge-prose-rich .atlas-element-chip')).toHaveCount(0);
  await expect(page.locator('.atlas-knowledge-prose-rich .ProseMirror')).toContainText('Barovia');
  const entry = await getElement(page, entryId);
  expect(entry.locations).toContain(baroviaId);

  // About × — removes the subject from the matching Involves field.
  await page.locator('.atlas-knowledge-chip', { hasText: 'Barovia' })
    .locator('.atlas-knowledge-chip-remove').click();
  await expect.poll(async () => {
    const e = await getElement(page, entryId);
    return Array.isArray(e?.locations) ? e.locations.includes(baroviaId) : false;
  }, { timeout: 5000 }).toBe(false);
});

test('in-room delete: confirm dialog, entry removed, lands on the list', async ({ page }) => {
  await setupWorld(page);
  const entryId = await createElement(page, 'narrative', {
    name: 'doomed rumor', subtype: 'knowledge', story: 'Soon gone.',
  });

  await openKnowledge(page);
  await page.click('.atlas-knowledge-row:has-text("doomed rumor")');
  await expect(page).toHaveURL(new RegExp(`/knowledge/${entryId}$`));

  // NOTE: the confirm fires AFTER an awaited findDependents, i.e. async to
  // the click — await each dialog explicitly instead of stacking once-handlers.

  // First attempt: dismiss the confirm — nothing happens.
  const dismissed = page.waitForEvent('dialog').then(d => d.dismiss());
  await page.click('.atlas-knowledge-delete');
  await dismissed;
  await expect(page.locator('.atlas-knowledge-entry-header .atlas-element-name')).toHaveText('doomed rumor');

  // Second attempt: accept — entry deleted, back on the (now empty) list.
  const accepted = page.waitForEvent('dialog').then(d => d.accept());
  await page.click('.atlas-knowledge-delete');
  await accepted;
  await expect(page).toHaveURL(/\/knowledge$/);
  await expect(page.locator('.atlas-knowledge-empty')).toBeVisible();
  await page.waitForFunction((eid) => {
    const s = (window as any).__atlasTestApi.getState();
    return !s.data.elements.some((e: any) => e.id === eid);
  }, entryId);
});

test('missing entry id renders a not-found interim, not a hijacked URL', async ({ page }) => {
  await setupWorld(page);
  await openKnowledge(page);

  // Navigate to a knowledge id that doesn't exist.
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/knowledge/00000000-0000-0000-0000-000000000000`;
  });

  // Honest interim: URL stays, not-found copy shows, back button works.
  await expect(page.locator('.atlas-knowledge-empty-title')).toHaveText('Knowledge entry not found.');
  await expect(page).toHaveURL(/\/knowledge\/00000000-0000-0000-0000-000000000000$/);
  await page.click('.atlas-drillin-prefix');
  await expect(page).toHaveURL(/\/knowledge$/);
});

test('known-view lens dims unknown elements in the sidebar; banner × clears it', async ({ page }) => {
  await setupWorld(page);
  const ireenaId = await createElement(page, 'character', { name: 'Ireena' });
  const baroviaId = await createElement(page, 'location', { name: 'Barovia' });
  await createElement(page, 'location', { name: 'Vallaki' }); // Ireena knows nothing about it
  await createElement(page, 'narrative', {
    name: 'the curse', subtype: 'knowledge', story: 'Barovia is cursed.',
    narrator: ireenaId, locations: [baroviaId],
  });

  // Sidebar → elements mode so the list is visible alongside the known-view.
  await page.click('.atlas-mode-btn[data-action="mode-elements"]');
  await expect(page.locator('.atlas-row[data-element-id]').first()).toBeVisible();

  // Open Ireena's known-view, toggle the lens on.
  await openKnowledge(page);
  await page.click('.atlas-room-tab:has-text("Knowers")');
  await page.click('.atlas-knowledge-row:has-text("Ireena")');
  await page.click('.atlas-knowledge-lens-toggle');
  await expect(page.locator('.atlas-knowledge-lens-toggle')).toHaveClass(/is-active/);

  // Banner names the knower; the unknown location dims, the known one doesn't.
  await expect(page.locator('.atlas-lens-banner')).toBeVisible();
  await expect(page.locator('.atlas-lens-banner-label')).toContainText('Ireena');
  await expect(page.locator('.atlas-row.atlas-row-lens-dim[data-element-id]', { hasText: 'Vallaki' })).toBeVisible();
  await expect(page.locator(`.atlas-row[data-element-id="${baroviaId}"]`)).not.toHaveClass(/atlas-row-lens-dim/);
  await expect(page.locator(`.atlas-row[data-element-id="${ireenaId}"]`)).not.toHaveClass(/atlas-row-lens-dim/);

  // The lens persists across rooms — navigate to an element, still dimmed.
  await page.click(`.atlas-row[data-element-id="${baroviaId}"]`);
  await expect(page.locator('.atlas-row.atlas-row-lens-dim', { hasText: 'Vallaki' })).toBeVisible();

  // Banner × clears: dimming gone, banner hidden.
  await page.click('.atlas-lens-banner-off');
  await expect(page.locator('.atlas-row.atlas-row-lens-dim')).toHaveCount(0);
  await expect(page.locator('.atlas-lens-banner')).toBeHidden();
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
  await expect(page.locator('.atlas-knowledge-knower-header h2')).toContainText('the party');
});

test('two individual knowers promote to a circle (S265, the narrator single-link dead end)', async ({ page }) => {
  await setupWorld(page);
  const ireenaId = await createElement(page, 'character', { name: 'Ireena' });
  await createElement(page, 'character', { name: 'Bram' });
  const entryId = await createElement(page, 'narrative', {
    name: 'the secret', subtype: 'knowledge', story: 'A secret.', narrator: ireenaId,
  });
  await openKnowledge(page);
  await page.locator('.atlas-knowledge-row', { hasText: 'the secret' }).click();

  const who = page.locator('.atlas-knowledge-zone-who');
  await expect(who.locator('.atlas-knowledge-chip', { hasText: 'Ireena' })).toBeVisible();
  // With a narrator set, "+ character" offers the second knower instead of dead-ending.
  await who.locator('.atlas-knowledge-add', { hasText: '+ character' }).click();
  // The picker excludes the current narrator.
  await expect(page.locator('.atlas-picker-row', { hasText: 'Ireena' })).toHaveCount(0);
  await page.locator('.atlas-picker-row', { hasText: 'Bram' }).click();

  // The create modal IS the confirm — name prefilled from both knowers.
  await expect(page.locator('input[name="element-name"]')).toHaveValue('Ireena & Bram');
  await page.click('[data-action="create"]');

  // One holder chip remains: the circle. Narrator cleared, members wired.
  await expect(who.locator('.atlas-knowledge-chip')).toHaveCount(1);
  await expect(who.locator('.atlas-knowledge-chip', { hasText: 'Ireena & Bram' })).toBeVisible();
  await expect.poll(async () => (await getElement(page, entryId))?.narrator ?? null).toBeNull();
  const entry = await getElement(page, entryId);
  expect(entry.collectives).toHaveLength(1);
  const circle = await getElement(page, entry.collectives[0]);
  expect(circle.subtype).toBe('circle');
  expect([...circle.characters].sort()).toEqual([ireenaId, (await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.find((e: any) => e.name === 'Bram').id;
  }))].sort());
});

// S364 lane A4: a failed prose save was marked saved (the baseline advanced
// regardless), and leaving the entry inside the room captured nothing, so the
// text shown in the editor never reached disk. Now the baseline advances only
// on a landed write and leaving the entry retries what did not land.
test('saved entry: a prose save that fails is retried when you leave the entry', async ({ page }) => {
  test.slow();
  await setupWorld(page);
  const entryId = await createElement(page, 'narrative', { name: 'ledger', subtype: 'knowledge', story: '' });
  await openKnowledge(page);
  await page.click('.atlas-knowledge-row:has-text("ledger")');
  await waitForKnowledgeEditor(page);

  // The next story write fails once (a quota error, a locked file).
  await page.evaluate(() => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const real = store.updateElement.bind(store);
    let failed = false;
    store.updateElement = async (id: string, patch: any) => {
      if (!failed && patch && 'story' in patch) { failed = true; throw new Error('disk said no'); }
      return real(id, patch);
    };
  });
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.type('the tithe is overdue');
  await expect(page.locator('.ow-toast', { hasText: 'Could not update knowledge entry' })).toBeVisible();

  // Leave the entry without typing again: back to the list.
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/knowledge`;
  });
  await expect(page.locator('.atlas-knowledge-row:has-text("ledger")')).toBeVisible();
  await expect.poll(async () => (await getElement(page, entryId))?.story ?? '', { timeout: 5000 })
    .toContain('the tithe is overdue');
});

// S364 gate, lens C C1: the teardown capture (A4) must not write the typed
// text back to an entry being deleted.
test('deleting an entry right after typing writes nothing to it', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'narrative', { name: 'ledger', subtype: 'knowledge', story: 'hello' });
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = api.getState().registry;
    api.patchSlice('registry', { ...reg, editor_settings: { ...(reg.editor_settings ?? {}), confirm_before_delete: false } });
  });
  await openKnowledge(page);
  await page.click('.atlas-knowledge-row:has-text("ledger")');
  await waitForKnowledgeEditor(page);
  await page.evaluate(() => {
    const store = (window as any).__atlasTestApi.getActiveStore();
    const up = store.updateElement.bind(store);
    (window as any).__updates = 0;
    store.updateElement = async (id: string, patch: any) => { (window as any).__updates++; return up(id, patch); };
  });
  await page.locator('.atlas-knowledge-prose-rich .ProseMirror').click();
  await page.keyboard.press('End');
  await page.keyboard.type(' world');
  await page.click('.atlas-knowledge-delete'); // inside the save debounce
  await expect(page.locator('.atlas-knowledge-row:has-text("ledger")')).toHaveCount(0);
  await page.waitForTimeout(1500);
  expect(await page.evaluate(() => (window as any).__updates)).toBe(0);
  await expect(page.locator('.ow-toast', { hasText: 'Could not update knowledge entry' })).toHaveCount(0);
});

test('the link-all pill never covers an entry\'s prose (S365 gate lens C M7)', async ({ page }) => {
  await setupWorld(page);
  await createElement(page, 'character', { name: 'Ireena' });
  // A first line that runs to the right edge, where the pill sits.
  await createElement(page, 'narrative', {
    name: 'the long line', subtype: 'knowledge',
    story: `Ireena ${'a b '.repeat(150).trim()}`,
  });
  await openKnowledge(page);
  await page.click('.atlas-knowledge-row:has-text("the long line")');
  await expect(page.locator('.atlas-knowledge-prose-rich .atlas-writing-linkall-corner')).toBeVisible({ timeout: 20000 });
  // The INK, not the boxes.
  const hits = await page.evaluate(() => {
    const host = document.querySelector('.atlas-knowledge-prose-rich')!;
    const pill = host.querySelector('.atlas-writing-linkall-corner')!.getBoundingClientRect();
    const p = host.querySelector('.ProseMirror p')!;
    const range = document.createRange();
    range.selectNodeContents(p);
    return [...range.getClientRects()].filter(r =>
      r.width > 0 && r.left < pill.right && r.right > pill.left && r.top < pill.bottom && r.bottom > pill.top,
    ).length;
  });
  expect(hits).toBe(0);
});
