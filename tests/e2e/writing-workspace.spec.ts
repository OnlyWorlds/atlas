/**
 * Writing workspace e2e — locks in v1.5 behavior so v2 changes have a
 * safety net. Covers mount + prose save round-trip + @ picker + chip
 * insertion + auto-derive + reading mode + focus mode + empty state.
 *
 * Tests use the FolderStore directly (via __atlasTestApi.getActiveStore())
 * for setup so the workspace is the unit under test, not the
 * narrative-create UX. Authoring flows are covered in their own specs.
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

async function setupAtlasRoot(page: Page, dirName: string = 'writing-test-root') {
  await page.evaluate(async (name) => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    const sub = await root.getDirectoryHandle(name, { create: true });
    api.setNextDirectory(sub);
  }, dirName);
  await page.click('[data-action="setup-atlas"]');
  await page.waitForSelector('[data-action="create-local"]');
}

async function createWorld(page: Page, name: string) {
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', name);
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  // Creating a local world now flips the sidebar into elements mode
  // automatically (S255v3) — the elements-search input is the mode-
  // independent signal that world creation completed.
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

/**
 * Create an element directly via the active FolderStore — bypasses UI so
 * the test focuses on the workspace surface. Returns the created element's id.
 */
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

/** Navigate to writing room for the active world. */
async function gotoWriting(page: Page, narrativeId?: string) {
  await page.evaluate((nid) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    const worldId = m[1];
    window.location.hash = nid
      ? `#/w/${worldId}/writing/${nid}`
      : `#/w/${worldId}/writing`;
  }, narrativeId);
}

/** Wait for TipTap to finish mounting (ProseMirror contenteditable ready). */
async function waitForEditor(page: Page) {
  await expect(page.locator('.atlas-writing-workspace')).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-prose .ProseMirror')).toBeVisible();
  // Editor is ready when it's focusable.
  await page.locator('.atlas-writing-workspace-prose .ProseMirror').click();
}

/** Read the active narrative from state. */
async function getNarrative(page: Page, id: string): Promise<any> {
  return await page.evaluate((nid) => {
    const state = (window as any).__atlasTestApi.getState();
    return state.data.elements.find((e: any) => e.id === nid) ?? null;
  }, id);
}

test('workspace mounts when a narrative is selected', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'first scene',
    supertype: 'Book',
  });

  await gotoWriting(page, id);
  await waitForEditor(page);

  // Header reuses element-detail-header — narrative name appears in it.
  await expect(page.locator('.atlas-middle-header')).toContainText('first scene');
  // Sticky bar with breadcrumb + action icons sits below the header.
  await expect(page.locator('.atlas-writing-workspace-crumb')).toBeVisible();
  // Prose surface (TipTap) is the body's main content.
  await expect(page.locator('.atlas-writing-workspace-prose')).toBeVisible();
  // Ambient word-count widget shows live count in bottom-right corner.
  await expect(page.locator('.atlas-writing-workspace-wc-corner')).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-wc')).toContainText('0 words');
});

test('typed prose persists as markdown + richtext JSON', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'second scene',
    supertype: 'Book',
  });

  await gotoWriting(page, id);
  await waitForEditor(page);

  // Type some prose into the editor.
  await page.locator('.atlas-writing-workspace-prose .ProseMirror').click();
  await page.keyboard.type('the goblin rolled the dice');

  // Word count updates live (no debounce on display).
  await expect(page.locator('.atlas-writing-workspace-wc')).toContainText('5 words');

  // Wait for the debounced save (default 1s) to flush into the folder. Poll
  // the narrative file directly rather than a visual indicator — the legacy
  // save-state span was removed when the footer collapsed into the ambient
  // word-count corner. The element-header sync dot reflects dirty/synced
  // for api-linked worlds but is always 'local' here.
  await expect.poll(async () => (await getNarrative(page, id))?.story ?? '', {
    timeout: 5000,
  }).toContain('the goblin rolled the dice');

  const narr = await getNarrative(page, id);
  expect(narr.story).toContain('the goblin rolled the dice');
  expect(narr.atlas_richtext_json).toBeTruthy();
  expect(typeof narr.atlas_richtext_json).toBe('object');
});

test('@ picker inserts a chip and auto-derives the relation field', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');

  // Set up a character to be @-linkable.
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
  });
  const narrId = await createElement(page, 'narrative', {
    name: 'mention scene',
    supertype: 'Book',
  });

  await gotoWriting(page, narrId);
  await waitForEditor(page);

  // Type @ to open the picker, then partial name to filter.
  await page.locator('.atlas-writing-workspace-prose .ProseMirror').click();
  await page.keyboard.type('@dri');
  await expect(page.locator('.atlas-mention-popover')).toBeVisible();
  await expect(page.locator('.atlas-mention-item').first()).toContainText('Drizzle');
  await page.keyboard.press('Enter');
  await expect(page.locator('.atlas-mention-popover')).toHaveCount(0);

  // Chip rendered inline.
  const chip = page.locator('.atlas-writing-workspace-prose .atlas-element-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('Drizzle');
  await expect(chip).toHaveAttribute('data-id', charId);
  await expect(chip).toHaveAttribute('data-type', 'character');

  // Wait for debounced save — poll the narrative file directly.
  await expect.poll(async () => (await getNarrative(page, narrId))?.story ?? '', {
    timeout: 5000,
  }).toContain(`[Drizzle](ow://character/${charId})`);

  // Verify markdown serialization, atlas_richtext_json shape, and auto-derived
  // characters relation.
  const narr = await getNarrative(page, narrId);
  expect(narr.story).toContain(`[Drizzle](ow://character/${charId})`);
  expect(narr.atlas_richtext_json).toBeTruthy();
  expect(Array.isArray(narr.characters)).toBe(true);
  expect(narr.characters).toContain(charId);
});

test('reading mode toggle adds is-reading-mode class', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'read scene',
    supertype: 'Book',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  const workspace = page.locator('.atlas-writing-workspace');
  await expect(workspace).not.toHaveClass(/is-reading-mode/);

  // Click reading-mode button in the sticky bar.
  const readBtn = page.locator('.atlas-writing-workspace-action[data-action="reading"]');
  await readBtn.click();
  await expect(workspace).toHaveClass(/is-reading-mode/);
  await expect(readBtn).toHaveAttribute('aria-pressed', 'true');

  // Click again → off.
  await readBtn.click();
  await expect(workspace).not.toHaveClass(/is-reading-mode/);
  await expect(readBtn).toHaveAttribute('aria-pressed', 'false');
});

test('focus mode toggle hides shell chrome', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'focus scene',
    supertype: 'Book',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  const workspace = page.locator('.atlas-writing-workspace');
  const sidebar = page.locator('.atlas-sidebar');

  await expect(workspace).not.toHaveClass(/is-focus-mode/);
  await expect(sidebar).toBeVisible();

  // Dispatch the focus-toggle custom event (same as Cmd+Shift+F).
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('atlas:writing-focus-toggle'));
  });

  await expect(workspace).toHaveClass(/is-focus-mode/);
  // Sidebar collapses via :has() in CSS. Becomes display:none → not visible.
  await expect(sidebar).not.toBeVisible();

  // Esc exits focus mode.
  await page.keyboard.press('Escape');
  await expect(workspace).not.toHaveClass(/is-focus-mode/);
  await expect(sidebar).toBeVisible();
});

test('self-heal populates stale relation fields on mount', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');

  // Set up a character and a narrative whose `story` already mentions that
  // character via ow:// — but whose `characters` relation is empty (the
  // legacy markdown-only case).
  const charId = await createElement(page, 'character', { name: 'legacy char' });
  const narrId = await createElement(page, 'narrative', {
    name: 'stale narr',
    supertype: 'Book',
    story: `the [legacy char](ow://character/${charId}) appears here`,
    characters: [],
  });

  // Pre-mount, the relation is still empty.
  let narr = await getNarrative(page, narrId);
  expect(narr.characters).toEqual([]);

  await gotoWriting(page, narrId);
  await waitForEditor(page);

  // After mount, self-heal fires (one microtask + folder write). Wait for it.
  await expect.poll(async () => {
    const n = await getNarrative(page, narrId);
    return n.characters;
  }, { timeout: 5000 }).toContain(charId);

  // The store wasn't a no-op write — `story` itself is unchanged, only
  // relations were updated.
  narr = await getNarrative(page, narrId);
  expect(narr.story).toContain(`ow://character/${charId}`);
});

test('Mentioned-in section surfaces narratives that link to an element', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');

  // Make a character + two narratives that link to it (one via the
  // relation field directly, simulating auto-derive already having run).
  const charId = await createElement(page, 'character', { name: 'cast char' });
  const sceneAId = await createElement(page, 'narrative', {
    name: 'scene a',
    supertype: 'Book',
    characters: [charId],
  });

  // Open the character's element-detail.
  await page.evaluate((id) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no world');
    window.location.hash = `#/w/${m[1]}/element/${id}`;
  }, charId);

  // The "Mentioned in" section appears with our narrative chip.
  await expect(page.locator('.atlas-detail-refs-mentioned')).toBeVisible();
  await expect(
    page.locator('.atlas-detail-refs-mentioned .atlas-link-chip', { hasText: 'scene a' })
  ).toBeVisible();

  // Clicking the narrative chip lands in the writing room, not element-detail.
  await page.locator('.atlas-detail-refs-mentioned .atlas-link-chip', { hasText: 'scene a' }).click();
  await expect.poll(() => page.url()).toMatch(/\/writing\//);
  expect(await page.evaluate(() => window.location.hash)).toContain(`/writing/${sceneAId}`);
});

test('session word goal — set, render progress ring, clear', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'goal scene',
    supertype: 'Book',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  // No goal initially — no ring rendered.
  const wcBtn = page.locator('.atlas-writing-workspace-wc-btn');
  await expect(wcBtn).toBeVisible();
  await expect(wcBtn.locator('.atlas-writing-workspace-wc-ring')).toHaveCount(0);

  // Click the count → popover opens with empty input.
  await wcBtn.click();
  const popover = page.locator('.atlas-wc-goal-popover');
  await expect(popover).toBeVisible();
  await popover.locator('input').fill('100');
  await popover.locator('.atlas-wc-goal-set').click();

  // Popover closes; ring appears.
  await expect(popover).toHaveCount(0);
  await expect(wcBtn).toHaveAttribute('data-has-goal', 'true');
  await expect(wcBtn.locator('.atlas-writing-workspace-wc-ring')).toBeVisible();
  await expect(wcBtn.locator('.atlas-writing-workspace-wc-goal')).toContainText('100');

  // Type words — ring fills as progress accumulates.
  await page.locator('.atlas-writing-workspace-prose .ProseMirror').click();
  await page.keyboard.type('one two three four five six seven');
  await expect(wcBtn.locator('.atlas-writing-workspace-wc')).toContainText('7 words');

  // Open again, clear.
  await wcBtn.click();
  await expect(page.locator('.atlas-wc-goal-popover')).toBeVisible();
  await page.locator('.atlas-wc-goal-clear').click();
  await expect(page.locator('.atlas-wc-goal-popover')).toHaveCount(0);
  await expect(wcBtn).not.toHaveAttribute('data-has-goal', 'true');
  await expect(wcBtn.locator('.atlas-writing-workspace-wc-ring')).toHaveCount(0);
});

test('find bar: Ctrl+F opens, navigates, Esc closes', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'find scene',
    supertype: 'Book',
    story: 'the orc met the orc and another orc joined them',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  // Ctrl+F → bar opens.
  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.press('Control+f');
  const bar = page.locator('.atlas-find-bar');
  await expect(bar).toHaveAttribute('data-state', 'shown');
  await expect(bar).toHaveAttribute('data-mode', 'find');

  // Type query — matches found.
  await page.locator('[data-role="find-input"]').fill('orc');
  await expect(page.locator('[data-role="count"]')).toContainText('1 of 3');
  await expect(page.locator('.atlas-search-match')).toHaveCount(3);
  await expect(page.locator('.atlas-search-match.is-current')).toHaveCount(1);

  // Enter advances to next match.
  await page.locator('[data-role="find-input"]').press('Enter');
  await expect(page.locator('[data-role="count"]')).toContainText('2 of 3');

  // Esc closes and clears highlight.
  await page.locator('[data-role="find-input"]').press('Escape');
  await expect(bar).toHaveAttribute('data-state', 'hidden');
  await expect(page.locator('.atlas-search-match')).toHaveCount(0);
});

test('find bar: Ctrl+H replace-all updates prose and triggers save', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'replace scene',
    supertype: 'Book',
    story: 'the orc met the orc and another orc joined them',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.press('Control+h');
  const bar = page.locator('.atlas-find-bar');
  await expect(bar).toHaveAttribute('data-mode', 'replace');
  await expect(bar.locator('[data-role="replace-row"]')).toBeVisible();

  await page.locator('[data-role="find-input"]').fill('orc');
  await page.locator('[data-role="replace-input"]').fill('goblin');
  await page.locator('[data-role="replace-all"]').click();

  // Prose visibly updated to all goblins.
  await expect(prose).toContainText('the goblin met the goblin and another goblin joined them');
  // Count drops to 0 of 0 since "orc" no longer appears.
  await expect(page.locator('[data-role="count"]')).toContainText(/0 of 0|No matches/);

  // Wait for the autosave to flush — poll the narrative file.
  await expect.poll(async () => (await getNarrative(page, id))?.story ?? '', {
    timeout: 5000,
  }).toContain('the goblin met the goblin and another goblin joined them');
  const narr = await getNarrative(page, id);
  expect(narr.story).toContain('the goblin met the goblin and another goblin joined them');
});

test('font family setting applies live to the workspace', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'font scene',
    supertype: 'Book',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  // Default — sans stack.
  const workspaceRoot = page.locator('.atlas-writing-workspace');
  const initialFamily = await workspaceRoot.evaluate(
    el => (el as HTMLElement).style.getPropertyValue('--atlas-prose-font-family'),
  );
  expect(initialFamily).toContain('system-ui');

  // Switch to Serif via Settings → Writing.
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no world');
    window.location.hash = `#/w/${m[1]}/settings/writing`;
  });
  const familySelect = page.locator('select[data-setting="writing_font_family"]');
  await expect(familySelect).toBeVisible();
  await familySelect.selectOption('serif');

  // Navigate back to the writing room — the CSS var should reflect the new family.
  await gotoWriting(page, id);
  await waitForEditor(page);
  await expect.poll(async () =>
    await workspaceRoot.evaluate(
      el => (el as HTMLElement).style.getPropertyValue('--atlas-prose-font-family'),
    ),
  ).toContain('Georgia');
});

test('context pane Cast shows Featured/Planned distinction by prose content', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');

  const charId = await createElement(page, 'character', { name: 'Drizzle' });
  const locId = await createElement(page, 'location', { name: 'The Tower' });
  const narrId = await createElement(page, 'narrative', {
    name: 'cast scene',
    supertype: 'Book',
    characters: [charId],
    locations: [locId],
    // Prose mentions only Drizzle. The Tower is in the link field but not
    // in the prose — Featured for Drizzle, Planned for The Tower.
    story: `Hello [Drizzle](ow://character/${charId}) is here.`,
  });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  // Session 231: context tab no longer auto-opens on writing-mode entry.
  // Click it explicitly to surface the pane.
  await page.locator('.atlas-tab[data-tab-kind="context"]').click();

  const pane = page.locator('.atlas-context-pane');
  await expect(pane).toBeVisible();
  const castCol = pane.locator('.atlas-context-pane-list-cast');
  const drizzleRow = castCol.locator('.atlas-context-pane-row', { hasText: 'Drizzle' });
  const towerRow = castCol.locator('.atlas-context-pane-row', { hasText: 'The Tower' });
  await expect(drizzleRow).toBeVisible();
  await expect(towerRow).toBeVisible();

  // Drizzle = Featured (in prose). The Tower = Planned (only in field).
  await expect(drizzleRow).toHaveClass(/is-featured/);
  await expect(towerRow).toHaveClass(/is-planned/);
  await expect(drizzleRow.locator('.atlas-context-pane-row-status-featured')).toBeVisible();
  await expect(towerRow.locator('.atlas-context-pane-row-status-planned')).toBeVisible();
});

test('add-to-cast with no selection inserts chip at cursor (session 230 semantic)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');

  const charId = await createElement(page, 'character', { name: 'NewChar' });
  const narrId = await createElement(page, 'narrative', {
    name: 'target scene',
    supertype: 'Book',
  });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  // Fire the add-to-cast event programmatically. With no selection, the
  // session 230 semantic is: insert chip at cursor (no separate Planned-
  // only path — UNION-on-save handles the field side).
  await page.locator('.atlas-writing-workspace-prose .ProseMirror').click();
  await page.evaluate(
    ({ id }) => {
      document.dispatchEvent(new CustomEvent('atlas:context-add-to-cast', {
        detail: { id, type: 'character', name: 'NewChar' },
      }));
    },
    { id: charId },
  );

  // Chip is inserted into prose with the canonical name.
  const chip = page.locator('.atlas-writing-workspace-prose .atlas-element-chip', { hasText: 'NewChar' });
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-id', charId);

  // UNION-on-save adds the id to narrative.characters after the debounced save.
  await expect.poll(async () => {
    const narr = await page.evaluate((id) => {
      const state = (window as any).__atlasTestApi.getState();
      return state.data.elements.find((e: any) => e.id === id) ?? null;
    }, narrId);
    return narr?.characters ?? [];
  }, { timeout: 5000 }).toContain(charId);
});

test('inline create from selection — modal pre-fills, suppresses navigate, replaces with chip', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'inline create scene',
    supertype: 'Book',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  // Type some prose then select the word we want to convert. We use the
  // native Selection API + a selectionchange dispatch so ProseMirror syncs
  // its internal state to the DOM selection — pure keyboard.press for
  // selection has proven flaky across run modes (isolation vs full suite).
  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.type('Halloway is a noble lord');

  // Set DOM selection to span the first 8 chars and force PM to sync.
  await page.evaluate(() => {
    const pm = document.querySelector('.atlas-writing-workspace-prose .ProseMirror') as HTMLElement | null;
    if (!pm) return;
    const para = pm.querySelector('p');
    const textNode = para?.firstChild;
    if (!textNode) return;
    pm.focus();
    const range = document.createRange();
    range.setStart(textNode, 0);
    range.setEnd(textNode, 8);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    // ProseMirror watches selectionchange to sync its EditorState selection
    // to the DOM. Dispatch one so PM picks up the range immediately.
    document.dispatchEvent(new Event('selectionchange'));
  });

  // Dispatch the inline-create custom event.
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('atlas:writing-inline-create'));
  });

  // The element-create modal opens with selected text pre-filled.
  // The selection may include a trailing space ("Halloway " vs "Halloway")
  // depending on how the test's Shift+ArrowRight stream landed — assert on
  // the leading word and trust the workspace's trim() to clean it.
  const modal = page.locator('[data-modal="create-element"]');
  await expect(modal).toBeVisible();
  const nameInput = modal.locator('input[name="element-name"]');
  await expect(nameInput).not.toHaveValue('');
  const nameValue = await nameInput.inputValue();
  // The exact selection extent depends on how Playwright's key events
  // map onto ProseMirror's selection model — we don't pin a length here.
  // What matters is the modal received non-empty text from the selection.
  expect(nameValue.length).toBeGreaterThanOrEqual(4);
  expect('Halloway'.startsWith(nameValue.trim())).toBe(true);

  // Overwrite the modal field with the canonical name so the rest of the
  // test exercises the chip-insertion + suppress-navigate paths cleanly.
  await nameInput.fill('Halloway');

  // Pick character type + submit.
  await modal.locator('.atlas-create-type-btn[data-type="character"]').click();
  await modal.locator('[data-action="create"]').click();
  await expect(modal).toHaveCount(0);

  // We stayed in the writing room (suppressNavigate worked).
  expect(await page.evaluate(() => window.location.hash)).toContain(`/writing/${id}`);

  // A new character was created.
  const newCharId = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi.getState();
    const chars = state.data.elements.filter((e: any) => e.type === 'character');
    return chars[chars.length - 1]?.id ?? null;
  });
  expect(newCharId).toBeTruthy();

  // The selected text was replaced with a chip pointing at the new character.
  const chip = page.locator(`.atlas-writing-workspace-prose .atlas-element-chip[data-id="${newCharId}"]`);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveAttribute('data-type', 'character');

  // Wait for autosave; verify story contains the ow:// link and characters
  // relation got auto-derived to include the new id.
  await expect.poll(async () => (await getNarrative(page, id))?.story ?? '', {
    timeout: 5000,
  }).toContain(`ow://character/${newCharId}`);
  const narr = await getNarrative(page, id);
  expect(narr.story).toContain(`ow://character/${newCharId}`);
  expect(Array.isArray(narr.characters)).toBe(true);
  expect(narr.characters).toContain(newCharId);
});

test('autolink: matching name gets a hint underline, Tab converts to chip', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');

  const charId = await createElement(page, 'character', { name: 'Drizzle' });
  const narrId = await createElement(page, 'narrative', {
    name: 'auto scene',
    supertype: 'Book',
  });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  // Type prose that mentions Drizzle WITHOUT using @. Autolink should
  // decorate the word as a Tab-to-accept candidate. Cursor lands at end
  // of typed text, which is immediately AFTER "Drizzle".
  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.type('a Drizzle');

  // Hint underline appears on "Drizzle".
  const hint = page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Drizzle' });
  await expect(hint).toBeVisible();

  // Tab converts the hint into a real chip. Dispatch the keydown directly
  // via JS — Playwright's keyboard.press('Tab') in contenteditable behaves
  // inconsistently across runners (occasionally moves focus instead of
  // dispatching to ProseMirror's handleKeyDown).
  await page.evaluate(() => {
    const pm = document.querySelector('.atlas-writing-workspace-prose .ProseMirror') as HTMLElement | null;
    if (!pm) return;
    pm.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Tab',
      code: 'Tab',
      bubbles: true,
      cancelable: true,
    }));
  });

  const chip = page.locator(`.atlas-writing-workspace-prose .atlas-element-chip[data-id="${charId}"]`);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('Drizzle');

  // Once chipped, the hint disappears (first-mention rule).
  await expect(page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Drizzle' })).toHaveCount(0);
});

test('autolink: ambiguous names are suppressed (no hint when 2+ matches)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  // Two characters share the name — autolink should NOT decorate.
  await createElement(page, 'character', { name: 'John' });
  await createElement(page, 'character', { name: 'John' });
  const narrId = await createElement(page, 'narrative', {
    name: 'amb scene',
    supertype: 'Book',
  });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.type('John walked into the room');

  // No autolink hint for the ambiguous name.
  await expect(page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'John' })).toHaveCount(0);
});

test('autolink: a plain CLICK on a dotted word links it (S313 click-to-link)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'click world');
  const charId = await createElement(page, 'character', { name: 'Marigold' });
  const narrId = await createElement(page, 'narrative', { name: 'click scene', supertype: 'Book' });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.type('and then Marigold arrived');

  const hint = page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Marigold' });
  await expect(hint).toBeVisible();
  // The whole point of S313: no Tab, no cursor-in-hint precondition, no focus
  // dance — one click on the dotted word promotes it. This is the gesture that
  // works "even if the page isn't selected".
  await hint.click();

  const chip = page.locator(`.atlas-writing-workspace-prose .atlas-element-chip[data-id="${charId}"]`);
  await expect(chip).toBeVisible();
  await expect(chip).toHaveText('Marigold');
  await expect(page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Marigold' })).toHaveCount(0);
});

test('autolink: HOVERING a dotted word makes Tab link THAT word, not the first (S313)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'hover world');
  await createElement(page, 'character', { name: 'Alderly' });
  const borrowId = await createElement(page, 'character', { name: 'Borrow' });
  const narrId = await createElement(page, 'narrative', { name: 'hover scene', supertype: 'Book' });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  // Two unambiguous names; the caret ends after "dawn", off BOTH hints — so a
  // cursor/order-based Tab would grab the first (Alderly). The bug Captain hit.
  await page.keyboard.type('Alderly met Borrow at dawn');
  const hintBorrow = page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Borrow' });
  await expect(hintBorrow).toBeVisible();

  // Hover the SECOND word, then Tab. Hover authority means the hovered word
  // links — real `.hover()` fires the mouseover the plugin tracks; Tab is
  // dispatched to ProseMirror's handler (same synthetic-keydown route the
  // sibling autolink test uses, since keyboard.press('Tab') is flaky in CE).
  await hintBorrow.hover();
  await page.evaluate(() => {
    const pm = document.querySelector('.atlas-writing-workspace-prose .ProseMirror') as HTMLElement | null;
    pm?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', bubbles: true, cancelable: true }));
  });

  // Borrow linked; Alderly (the first) stays a hint — proof hover, not order, chose.
  await expect(page.locator(`.atlas-writing-workspace-prose .atlas-element-chip[data-id="${borrowId}"]`)).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Alderly' })).toBeVisible();
});

test('chip preview: right-clicking a chip dismisses the hover preview so the menu is not obscured (S313)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'menu world');
  await createElement(page, 'character', { name: 'Quill', description: 'a scribe of the tower' });
  const narrId = await createElement(page, 'narrative', { name: 'menu scene', supertype: 'Book' });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.type('here is Quill today');
  const hint = page.locator('.atlas-writing-workspace-prose .atlas-autolink-hint', { hasText: 'Quill' });
  await expect(hint).toBeVisible();
  await hint.click(); // link it → a chip

  const chip = page.locator('.atlas-writing-workspace-prose .atlas-element-chip', { hasText: 'Quill' });
  await expect(chip).toBeVisible();

  // Hover opens the preview card (z-index 9500, above the menu's 1000).
  await chip.hover();
  await expect(page.locator('.atlas-chip-preview[data-state="shown"]')).toBeVisible();

  // Right-click: the context menu must appear AND the preview must vanish, so
  // the Unlink action is never hidden behind the card (Captain's report).
  await chip.click({ button: 'right' });
  await expect(page.locator('.atlas-prose-context-menu')).toBeVisible();
  await expect(page.locator('.atlas-chip-preview[data-state="shown"]')).toHaveCount(0);
});

test('split: divides current narrative at cursor into a new sibling', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'scene a',
    supertype: 'Book',
    order: 0,
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  // Type two paragraphs of prose. Cursor lands at the end after typing.
  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.type('first half of the scene');
  await page.keyboard.press('Enter');
  await page.keyboard.type('second half after the split');

  // Place the cursor at the boundary between the two paragraphs (end of the
  // first) by setting the DOM selection directly, NOT via keyboard presses.
  // Caret-navigation keypresses (the historic 28×ArrowLeft) are unreliable in
  // a contenteditable under load — Playwright "occasionally moves focus
  // instead of dispatching to ProseMirror" (see the autolink test's Tab
  // workaround above), leaving the cursor at the doc end where the split
  // correctly bails ("nothing after the cursor") — the suite-only flake.
  // Setting the selection programmatically + nudging ProseMirror's
  // DOMObserver via `selectionchange` is deterministic and focus-safe.
  await page.evaluate(() => {
    const pm = document.querySelector('.atlas-writing-workspace-prose .ProseMirror') as HTMLElement | null;
    if (!pm) return;
    pm.focus();
    const firstPara = pm.querySelector('p');
    const node = firstPara?.firstChild;
    if (!node) return;
    const len = node.textContent?.length ?? 0;
    const range = document.createRange();
    range.setStart(node, len);
    range.collapse(true);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  });

  // Dispatch the split custom event.
  await page.evaluate(() => {
    document.dispatchEvent(new CustomEvent('atlas:writing-split'));
  });

  // Confirm modal opens with a name input and a non-empty preview.
  const modal = page.locator('[data-modal="writing-split"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('input[name="new-name"]')).toBeVisible();
  await expect(modal.locator('.atlas-split-preview')).not.toBeEmpty();

  // Submit with a name.
  await modal.locator('input[name="new-name"]').fill('scene b');
  await modal.locator('[data-role="confirm"]').click();
  await expect(modal).toHaveCount(0);

  // After successful split: navigated to the new narrative. URL contains
  // a different narrative id than the original.
  await expect.poll(() => page.url()).toMatch(/\/writing\//);
  const currentHash = await page.evaluate(() => window.location.hash);
  expect(currentHash).not.toContain(`/writing/${id}`);

  // Verify the new narrative has the after-cursor story and the original
  // narrative has the before-cursor story only.
  const allNarratives = await page.evaluate(() => {
    const state = (window as any).__atlasTestApi.getState();
    return state.data.elements.filter((e: any) => e.type === 'narrative');
  });
  const original = allNarratives.find((n: any) => n.id === id);
  const newOne = allNarratives.find((n: any) => n.name === 'scene b');
  expect(original).toBeTruthy();
  expect(newOne).toBeTruthy();
  // Each narrative now holds part of the original prose, with no overlap.
  expect(original.story).toContain('first half');
  expect(newOne.story).not.toContain('first half');
  expect(newOne.story.length).toBeGreaterThan(0);
  expect(newOne.story).not.toEqual(original.story);
  // New sibling sits after the original in order.
  expect(newOne.order).toBe(1);
  expect(newOne.supertype).toBe('Book');
});

test('empty narrative shows initial empty paragraph', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'wrk world');
  const id = await createElement(page, 'narrative', {
    name: 'empty scene',
    supertype: 'Book',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  // ProseMirror has at least an empty paragraph.
  const proseRoot = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await expect(proseRoot).toBeVisible();
  // Default empty doc renders a single paragraph; no chips, no text.
  await expect(proseRoot.locator('.atlas-element-chip')).toHaveCount(0);
  await expect(page.locator('.atlas-writing-workspace-wc')).toContainText('0 words');
});

test('link-all corner icon: counts candidates, one click chips them all (S265)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'linkall-root');
  await createWorld(page, 'linkall world');
  await createElement(page, 'character', { name: 'Aralia' });
  await createElement(page, 'character', { name: 'Bram' });
  const nid = await createElement(page, 'narrative', {
    name: 'the meeting', supertype: 'Book', story: 'Aralia met Bram at dawn.',
  });

  await gotoWriting(page, nid);
  await waitForEditor(page);

  const corner = page.locator('.atlas-writing-linkall-corner');
  await expect(corner).toBeVisible();
  await expect(corner.locator('.atlas-writing-linkall-count')).toHaveText('2');

  await corner.click();
  await expect(page.locator('.atlas-writing-workspace-prose .atlas-element-chip')).toHaveCount(2);
  // All candidates linked → the affordance retires itself.
  await expect(corner).toBeHidden();
});

test('tree bulk link: right-click a book links mentions in its closed scenes, story + sidecar + derive (S265)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'bulklink-root');
  await createWorld(page, 'bulklink world');
  const aralia = await createElement(page, 'character', { name: 'Aralia' });
  const bookId = await createElement(page, 'narrative', { name: 'the tome', supertype: 'Book' });
  const chapId = await createElement(page, 'narrative', {
    name: 'first chapter', supertype: 'Chapter', parent_narrative: bookId,
    story: 'Aralia rides north.',
  });

  // Writing room with NO narrative open — the chapter stays a closed doc,
  // exercising the disk path (story + relation derive).
  await gotoWriting(page);
  const bookRow = page.locator('.atlas-writing-tree-row', { hasText: 'the tome' });
  await expect(bookRow).toBeVisible();

  page.once('dialog', d => void d.accept());
  await bookRow.click({ button: 'right' });
  await page.locator('.atlas-prose-context-menu [data-role="bulk-link"]').click();

  await expect(page.locator('.ow-toast', { hasText: 'Linked 1 mention' })).toBeVisible();
  await expect.poll(async () => await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.find((e: any) => e.id === id)?.story ?? '';
  }, chapId)).toBe(`[Aralia](ow://character/${aralia}) rides north.`);
  // Convention #50 derive rode the bulk write.
  const chap = await page.evaluate((id) => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.find((e: any) => e.id === id) ?? null;
  }, chapId);
  expect(chap.characters).toContain(aralia);
});

test('tree row hover "+" creates the child tier inside that row (S265)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'rowadd-root');
  await createWorld(page, 'rowadd world');
  const bookId = await createElement(page, 'narrative', { name: 'the tome', supertype: 'Book' });

  await gotoWriting(page);
  const bookRow = page.locator('.atlas-writing-tree-row', { hasText: 'the tome' });
  await expect(bookRow).toBeVisible();
  // Only "+ new book" remains in the header — the draft button retired.
  await expect(page.locator('.atlas-writing-sidebar-create-btn')).toHaveCount(1);

  await bookRow.hover();
  await bookRow.locator('.atlas-writing-tree-row-add').click();
  await page.fill('input[name="narrative-name"]', 'first chapter');
  await page.click('[data-action="create"]');

  // The new chapter lands INSIDE the book and opens.
  const chapRow = page.locator('.atlas-writing-tree-row', { hasText: 'first chapter' });
  await expect(chapRow).toBeVisible();
  const chap = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return s.data.elements.find((e: any) => e.name === 'first chapter') ?? null;
  });
  expect(chap.parent_narrative).toBe(bookId);
  expect(chap.supertype).toBe('Chapter');
});

test('right-click "Link to existing element" chips the selection and records an alias', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'writing-linkexisting-root');
  await createWorld(page, 'lworld');
  const heroId = await createElement(page, 'character', { name: 'Frodo' });
  const narrativeId = await createElement(page, 'narrative', {
    name: 'Scene 1', supertype: 'Book', story: 'A weary halfling rested here.',
  });
  await gotoWriting(page, narrativeId);
  await waitForEditor(page);

  // Select "weary halfling" inside the prose.
  await page.evaluate(() => {
    const pm = document.querySelector('.atlas-writing-workspace-prose .ProseMirror')!;
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
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

  // Right-click the selection → the new menu item → picker → Frodo.
  await page.locator('.atlas-writing-workspace-prose .ProseMirror').click({
    button: 'right',
    position: { x: 60, y: 10 },
  });
  await page.locator('.atlas-prose-context-menu-item', { hasText: 'Link to existing element' }).click();
  await page.locator('.atlas-picker-row', { hasText: 'Frodo' }).click();

  // Chip carries the SELECTED text as label (not the element name)…
  const chip = page.locator('.atlas-writing-workspace-prose .atlas-element-chip');
  await expect(chip).toHaveText('weary halfling');
  await expect(chip).toHaveAttribute('data-id', heroId);

  // …and the label survives sync because it was recorded as an alias.
  await expect.poll(async () => await page.evaluate((id) => {
    const el = (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id);
    return el?.atlas_aliases ?? null;
  }, heroId)).toEqual(['weary halfling']);
  await expect(chip).toHaveText('weary halfling');
});

// ===========================================================================
// Writing-tree delete (S310, Bout W)
//
// Guards a verified data-loss path: before S310, deleting a Book with the
// confirm preference OFF destroyed its entire subtree with no dialog at all
// (measured live: 8 of 9 elements gone on one click, no undo anywhere).
// ===========================================================================

/** Build Book > Chapter > 2 Scenes, plus an off-tree narrative under the chapter. */
async function createManuscript(page: Page) {
  const book = await createElement(page, 'narrative', { name: 'The Cycle', supertype: 'Book' });
  const chapter = await createElement(page, 'narrative', {
    name: 'Chapter One', supertype: 'Chapter', parent_narrative: book,
  });
  const sceneA = await createElement(page, 'narrative', {
    name: 'Scene A', supertype: 'Scene', parent_narrative: chapter,
  });
  const sceneB = await createElement(page, 'narrative', {
    name: 'Scene B', supertype: 'Scene', parent_narrative: chapter,
  });
  // Free-texted supertype: INVISIBLE in the writing tree (buildNarrativeIndex
  // filters by tier label) but still deleted by the cascade. The confirm has
  // to name it or the user loses prose the UI never showed them.
  const offTree = await createElement(page, 'narrative', {
    name: 'Interlude', supertype: 'Interlude', parent_narrative: chapter,
  });
  const survivor = await createElement(page, 'narrative', {
    name: 'Other Book', supertype: 'Book',
  });
  return { book, chapter, sceneA, sceneB, offTree, survivor };
}

/**
 * Mark the world's writing room as set up, the way "Save and start writing"
 * does. Needed because `isWritingInitialized` returns FALSE for a world whose
 * chain contains a member with a non-label supertype — our off-tree Interlude
 * is exactly such a member, so without this the "Set up writing" screen takes
 * the middle pane and the header (with its delete button) never renders.
 * Read off the failed-test screenshot plus `writing-helpers.ts:260-300`,
 * rather than guessed at.
 *
 * This models the realistic path to an off-tree narrative: the user sets up
 * writing, then later free-texts one narrative's supertype, which
 * DESIGN_WRITING.md documents as removing it from the tree.
 */
async function markWritingInitialized(page: Page) {
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = JSON.parse(JSON.stringify(api.getState().registry));
    const worldId = window.location.hash.match(/#\/w\/([^/]+)/)?.[1];
    const entry = reg.worlds.find((w: any) => w.id === worldId);
    if (entry) {
      entry.writing_labels = { l1: 'Book', l2: 'Chapter', l3: 'Scene', l4: 'Draft' };
      entry.writing_initialized = true;
    }
    localStorage.setItem('atlas_registry_v1', JSON.stringify(reg));
    api.patchSlice('registry', reg);
  });
}

/**
 * Elements currently on disk, or -1 while the page is not ready to answer.
 *
 * Returns a SENTINEL rather than throwing because this is called inside
 * `expect.poll`: a throw fails the poll outright, while a wrong-but-valid
 * value lets it retry. Under a loaded 4-worker run the deleting-the-open-
 * narrative test caught `__atlasTestApi` momentarily undefined mid-navigation
 * and failed on a transient rather than on the behaviour under test. The
 * assertion still has to REACH the expected count, so nothing is weakened.
 */
async function elementCount(page: Page): Promise<number> {
  return await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    if (!api) return -1;
    const store = api.getActiveStore();
    if (!store) return -1;
    return (await store.listElements()).length;
  });
}

test('writing tree: delete names the whole subtree in the user vocabulary', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-delete-root');
  await createWorld(page, 'delete world');
  const ids = await createManuscript(page);
  await gotoWriting(page, ids.book);

  // The off-tree narrative is genuinely absent from the tree — this is what
  // makes naming it in the confirm load-bearing rather than cosmetic.
  await expect(page.locator('.atlas-writing-tree-row', { hasText: 'Chapter One' })).toBeVisible();
  await expect(page.locator('.atlas-writing-tree-row', { hasText: 'Interlude' })).toHaveCount(0);

  const messages: string[] = [];
  page.on('dialog', d => { messages.push(d.message()); void d.dismiss(); });

  await page.locator('.atlas-writing-tree-row', { hasText: 'Chapter One' }).first()
    .click({ button: 'right' });
  await page.locator('[data-role="delete-narrative"]').click();

  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toBe(
    'Delete "Chapter One"? This also deletes 2 scenes and 1 other narrative. This cannot be undone.',
  );
  // Dismissed = nothing lost.
  // Poll rather than read once: the helper returns -1 while the page is not
  // ready, and a dismissed dialog means the steady state IS 6.
  await expect.poll(() => elementCount(page)).toBe(6);
});

test('writing tree: accepting deletes the subtree and leaves siblings alone', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-delete-root-2');
  await createWorld(page, 'delete world 2');
  const ids = await createManuscript(page);
  await gotoWriting(page, ids.book);
  page.on('dialog', d => d.accept());

  await page.locator('.atlas-writing-tree-row', { hasText: 'Chapter One' }).first()
    .click({ button: 'right' });
  await page.locator('[data-role="delete-narrative"]').click();

  // chapter + 2 scenes + the off-tree interlude == 4 gone; book and the
  // unrelated second book survive.
  await expect.poll(() => elementCount(page)).toBe(2);
  await expect(page.locator('.atlas-writing-tree-row', { hasText: 'The Cycle' })).toBeVisible();
  await expect(page.locator('.atlas-writing-tree-row', { hasText: 'Other Book' })).toBeVisible();
});

test('writing tree: deleting the open narrative navigates out of the doomed subtree', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-delete-root-3');
  await createWorld(page, 'delete world 3');
  const ids = await createManuscript(page);
  // Open a SCENE, then delete its parent chapter. The URL is the source of
  // truth for what the workspace renders, so it must move before the element
  // disappears — otherwise the middle pane sits on a deleted narrative.
  await gotoWriting(page, ids.sceneA);
  await markWritingInitialized(page);
  await gotoWriting(page, ids.sceneA);
  await waitForEditor(page);
  page.on('dialog', d => d.accept());

  await page.locator('.atlas-writing-tree-row', { hasText: 'Chapter One' }).first()
    .click({ button: 'right' });
  await page.locator('[data-role="delete-narrative"]').click();

  await expect.poll(() => page.evaluate(() => window.location.hash))
    .toMatch(/\/writing$/);
  // POLL the count, never read it once: the handler navigates BEFORE it
  // awaits the delete, so the route change is a sync point that PRECEDES the
  // work under test. Asserting the count immediately after the route settles
  // reads the world mid-delete and fails on correct code.
  await expect.poll(() => elementCount(page)).toBe(2);
});

test('the confirm FLOOR fires even when the user turned confirmations off', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-delete-root-4');
  await createWorld(page, 'delete world 4');
  const ids = await createManuscript(page);

  // Turn the preference OFF through the registry, the way Settings does.
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = JSON.parse(JSON.stringify(api.getState().registry));
    reg.editor_settings = { ...(reg.editor_settings || {}), confirm_before_delete: false };
    localStorage.setItem('atlas_registry_v1', JSON.stringify(reg));
    api.patchSlice('registry', reg);
  });

  await markWritingInitialized(page);
  await gotoWriting(page, ids.book);
  await expect(page.locator('[data-action="delete-element"]')).toBeVisible();
  const messages: string[] = [];
  page.on('dialog', d => { messages.push(d.message()); void d.dismiss(); });

  // The header trash — the exact path that silently destroyed a manuscript.
  await page.locator('[data-action="delete-element"]').click();

  await expect.poll(() => messages.length).toBe(1);
  expect(messages[0]).toContain('This cannot be undone.');
  // Poll rather than read once: the helper returns -1 while the page is not
  // ready, and a dismissed dialog means the steady state IS 6.
  await expect.poll(() => elementCount(page)).toBe(6);
});

test('a childless narrative still honours the confirm preference being off', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-delete-root-5');
  await createWorld(page, 'delete world 5');
  const lone = await createElement(page, 'narrative', { name: 'Lone Scene', supertype: 'Scene' });
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = JSON.parse(JSON.stringify(api.getState().registry));
    reg.editor_settings = { ...(reg.editor_settings || {}), confirm_before_delete: false };
    localStorage.setItem('atlas_registry_v1', JSON.stringify(reg));
    api.patchSlice('registry', reg);
  });
  await gotoWriting(page, lone);

  let dialogs = 0;
  page.on('dialog', d => { dialogs += 1; void d.accept(); });
  await page.locator('[data-action="delete-element"]').click();

  // No cascade means the floor does not apply: the preference is respected.
  await expect.poll(() => elementCount(page)).toBe(0);
  expect(dialogs).toBe(0);
});

test('the tree Delete item is HIDDEN during the tour (it would soft-lock it)', async ({ page }) => {
  // The absent half of the pair. The tour's writing beat reveals a Book and
  // its Chapter and gates advance on chips inside that chapter's story, so a
  // cascade delete of the book leaves the gate permanently unsatisfiable and
  // renders no Next — a soft-locked tour with no self-heal (`revealOne` only
  // re-creates on step entry). The writing tree is fully reachable while
  // touring: there is no overlay and `.atlas-tour-locked` is deliberately not
  // pointer-events:none.
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-delete-root-tour');
  await createWorld(page, 'delete world tour');
  const ids = await createManuscript(page);
  await markWritingInitialized(page);

  // Raise the tour's presence flag the way the engine does (isTourFlagActive
  // is a pure localStorage read, deliberately engine-free).
  await page.evaluate(() => {
    localStorage.setItem('atlas_tour_v1', JSON.stringify({ active: true }));
  });
  await gotoWriting(page, ids.book);

  await page.locator('.atlas-writing-tree-row', { hasText: 'Chapter One' }).first()
    .click({ button: 'right' });

  // The menu still opens with its reversible items…
  await expect(page.locator('[data-role="bulk-link"]')).toBeVisible();
  // …and the destructive one is simply not there.
  await expect(page.locator('[data-role="delete-narrative"]')).toHaveCount(0);
});

test('compiled view counts the whole assembled tree, not zero', async ({ page }) => {
  // The compiled view has no editor handle. The ambient widget used to read
  // its count straight off that handle, so every parent narrative reported
  // "0 words" under a fully assembled manuscript (visible in the launch
  // screenshots). The count now walks the compiled tree.
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-compiled-wc-root');
  await createWorld(page, 'compiled wc world');

  const book = await createElement(page, 'narrative', {
    name: 'The Counted Book', supertype: 'Book', story: 'Two words.',
  });
  await createElement(page, 'narrative', {
    name: 'Counted Chapter', supertype: 'Chapter', parent_narrative: book,
    story: 'Exactly five more words here.',
  });
  await createElement(page, 'narrative', {
    name: 'Counted Scene', supertype: 'Scene', parent_narrative: book,
    // A chip counts as the words a reader sees: "the Counted Chapter" = 3.
    story: 'See [the Counted Chapter](ow://narrative/nope-missing) now.',
  });
  await markWritingInitialized(page);

  await gotoWriting(page, book);

  // A parent defaults to the compiled view: read-only assembly, no editor.
  await expect(page.locator('.atlas-writing-compiled')).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-prose .ProseMirror')).toHaveCount(0);

  // 2 (book) + 5 (chapter) + 5 (scene, chip label counted, target dropped).
  await expect(page.locator('.atlas-writing-workspace-wc')).toContainText('12 words');
  await expect(page.locator('.atlas-writing-workspace-wc')).not.toContainText('0 words');
});

/**
 * S323 — the room-exit data-loss class.
 *
 * `persistSnapshot` used to resolve its write target from the LIVE url and
 * bail when that disagreed with the mounted editor. Leaving the writing room
 * empties the route of any narrative id, so the lookup returned null, the
 * guard dropped the write, and `flushPendingSave` had already cleared the
 * pending snapshot — the text was gone from the editor, from state and from
 * disk, with no toast. Atlas has no undo.
 *
 * The gesture matters: switching to another narrative INSIDE the tree always
 * worked (the route still carries a narrative id), so a test built on that
 * route passes against the broken code. This drives the gesture that actually
 * lost text — type, then click another ROOM inside the debounce window.
 *
 * Revert-checked: restoring the `getActiveNarrative()`-derived guard fails
 * this test on the disk assertion.
 */
test('prose typed before leaving the writing ROOM still reaches disk', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-roomexit-root');
  await createWorld(page, 'room exit world');

  const id = await createElement(page, 'narrative', {
    name: 'Exit Chapter',
    supertype: 'Book',
    story: 'first line.',
  });
  await markWritingInitialized(page);

  // Widen the debounce so the flush is genuinely pending when we navigate —
  // this is a real user-facing setting, not a test hook, and the default
  // (1000ms) is reachable by any fast typist.
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = JSON.parse(JSON.stringify(api.getState().registry));
    reg.sync_debounce_ms = 8000;
    api.patchSlice('registry', reg);
  });

  await gotoWriting(page, id);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.press('End');
  await prose.pressSequentially(' canary text');

  // Leave the room while the save is still pending.
  await page.locator('.atlas-room-nav-btn[data-room="home"]').click();
  await expect(page.locator('.atlas-writing-workspace')).toHaveCount(0);

  // The write is addressed to the element it came from, so it lands even
  // though the route no longer names any narrative.
  await expect.poll(async () => await page.evaluate(async (nid) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) return '';
    const els = await store.listElements();
    return (els.find((e: any) => e.id === nid)?.story as string) ?? '';
  }, id), { timeout: 15000 }).toContain('canary text');
});

/**
 * The other half of the same contract: a late write for the PREVIOUS
 * narrative must not touch the one now open, and must not tell the new
 * editor its text is already saved (the baseline travels with the snapshot).
 */
test('switching narratives saves the old one without polluting the new one', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-switch-root');
  await createWorld(page, 'switch world');

  const alpha = await createElement(page, 'narrative', {
    name: 'Alpha Book', supertype: 'Book', story: 'alpha start.',
  });
  const beta = await createElement(page, 'narrative', {
    name: 'Beta Book', supertype: 'Book',
  });
  await markWritingInitialized(page);

  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const reg = JSON.parse(JSON.stringify(api.getState().registry));
    reg.sync_debounce_ms = 8000;
    api.patchSlice('registry', reg);
  });

  await gotoWriting(page, alpha);
  await waitForEditor(page);
  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.press('End');
  await prose.pressSequentially(' alpha canary');

  await page.locator('.atlas-writing-tree-name', { hasText: 'Beta Book' }).click();
  await expect(page).toHaveURL(new RegExp(`/writing/${beta}`));

  const stories = async () => await page.evaluate(async (ids) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) return { a: '', b: '' };
    const els = await store.listElements();
    return {
      a: (els.find((e: any) => e.id === ids.alpha)?.story as string) ?? '',
      b: (els.find((e: any) => e.id === ids.beta)?.story as string) ?? '',
    };
  }, { alpha, beta });

  await expect.poll(async () => (await stories()).a, { timeout: 15000 }).toContain('alpha canary');
  expect((await stories()).b).toBe('');
});

/**
 * S355 — the find bar's "Link to element" (a Discord request: search the
 * text for a word and link every one of them to a chosen element). Unlike
 * link-all this is NOT first-mention: the writer named the word and picked
 * the target, so every match links, labels verbatim, in one undoable step.
 */
test('find bar: "Link to element" links every match in a scene and records the alias', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-find-link-root');
  await createWorld(page, 'find link world');
  const chief = await createElement(page, 'character', { name: 'Orc Chief' });
  const id = await createElement(page, 'narrative', {
    name: 'link scene',
    supertype: 'Book',
    story: 'the orc met the Orc and another orc joined them',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);

  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');
  await prose.click();
  await page.keyboard.press('Control+f');
  const bar = page.locator('.atlas-find-bar');
  await expect(bar).toHaveAttribute('data-state', 'shown');
  const linkBtn = bar.locator('[data-role="link-matches"]');
  await expect(linkBtn).toBeDisabled();

  await page.locator('[data-role="find-input"]').fill('orc');
  await expect(page.locator('[data-role="count"]')).toContainText('1 of 3');
  await expect(linkBtn).toBeEnabled();
  await linkBtn.click();

  await expect(page.locator('.atlas-picker-panel')).toBeVisible();
  await page.locator('.atlas-picker-row', { hasText: 'Orc Chief' }).click();

  // Three chips, each keeping the writer's own casing (THE LABEL LAW).
  const chips = prose.locator('.atlas-element-chip');
  await expect(chips).toHaveCount(3);
  await expect(chips.nth(0)).toHaveText('orc');
  await expect(chips.nth(1)).toHaveText('Orc');
  await expect(chips.nth(2)).toHaveText('orc');
  await expect(prose).toContainText('the orc met the Orc and another orc joined them');
  // Linked text is chip label now, so the query finds nothing left.
  await expect(page.locator('[data-role="count"]')).toContainText(/No matches|0 of 0/);
  await expect(page.locator('.ow-toast', { hasText: 'Linked 3 mentions to Orc Chief' })).toBeVisible();

  // On disk: three ow:// links to the chief, and "orc" learned as an alias.
  await expect.poll(async () => {
    const n = await getNarrative(page, id);
    return (n?.story.match(/\]\(ow:\/\/character\//g) ?? []).length;
  }, { timeout: 5000 }).toBe(3);
  const narr = await getNarrative(page, id);
  expect(narr.story).toBe(
    `the [orc](ow://character/${chief}) met the [Orc](ow://character/${chief}) and another [orc](ow://character/${chief}) joined them`,
  );
  const chiefEl = await getNarrative(page, chief);
  expect(chiefEl.atlas_aliases).toEqual(['orc']);

  // One transaction: Ctrl+Z restores the plain text.
  await page.locator('[data-role="find-input"]').press('Escape');
  await prose.click();
  await page.keyboard.press('Control+z');
  await expect(chips).toHaveCount(0);
  await expect(prose).toContainText('the orc met the Orc and another orc joined them');
});

test('compiled view: find searches every scene and "Link to element" writes them all', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-compiled-find-root');
  await createWorld(page, 'compiled find world');
  const chief = await createElement(page, 'character', { name: 'Orc Chief' });
  const book = await createElement(page, 'narrative', {
    name: 'The Orc Book', supertype: 'Book', story: 'An orc opens the book.',
  });
  const sceneA = await createElement(page, 'narrative', {
    name: 'Scene A', supertype: 'Scene', parent_narrative: book,
    story: 'The orc marched. Nobody saw the orc leave.',
  });
  const sceneB = await createElement(page, 'narrative', {
    name: 'Scene B', supertype: 'Scene', parent_narrative: book,
    story: `No orcs here, only an [orc](ow://character/${chief}) already linked.`,
  });
  await markWritingInitialized(page);
  await gotoWriting(page, book);

  const compiled = page.locator('.atlas-writing-compiled');
  await expect(compiled).toBeVisible();
  await compiled.click();

  // Ctrl+H on a rendering opens FIND: there is nothing to replace in place.
  await page.keyboard.press('Control+h');
  const bar = page.locator('.atlas-find-bar');
  await expect(bar).toHaveAttribute('data-state', 'shown');
  await expect(bar).toHaveAttribute('data-mode', 'find');
  await expect(bar).toHaveAttribute('data-readonly', 'true');
  await expect(bar.locator('[data-role="replace-row"]')).toBeHidden();

  // Whole-word "orc": book 1 + scene A 2 + scene B 0 (the "orcs" and the
  // existing chip are both skipped) = 3, highlighted across sections.
  await page.locator('[data-role="find-input"]').fill('orc');
  await page.locator('[data-role="word-toggle"]').click();
  await expect(page.locator('[data-role="count"]')).toContainText('1 of 3');
  await expect(compiled.locator('mark.atlas-search-match')).toHaveCount(3);
  await expect(compiled.locator('mark.atlas-search-match.is-current')).toHaveCount(1);
  // Document order: "1 of 3" is the book's own line, not the last scene's.
  await expect(compiled.locator('mark.atlas-search-match').first()).toHaveClass(/is-current/);
  await page.locator('[data-role="find-input"]').press('Enter');
  await expect(page.locator('[data-role="count"]')).toContainText('2 of 3');
  await expect(compiled.locator('mark.atlas-search-match').nth(1)).toHaveClass(/is-current/);

  await bar.locator('[data-role="link-matches"]').click();
  await expect(page.locator('.atlas-picker-panel')).toBeVisible();
  await page.locator('.atlas-picker-row', { hasText: 'Orc Chief' }).click();

  await expect(page.locator('.ow-toast', { hasText: 'Linked 3 mentions to Orc Chief across 2 narratives' })).toBeVisible();
  // The rendering re-drew from the written files: four chips now (three new
  // plus scene B's existing one), no matches left. Every chip shows the
  // writer's word, never the element's name (the label law, Captain S355).
  await expect(compiled.locator('.atlas-element-chip')).toHaveCount(4);
  await expect(compiled.locator('.atlas-element-chip')).toHaveText(['orc', 'orc', 'orc', 'orc']);
  await expect(compiled).not.toContainText('Orc Chief');
  await expect(page.locator('[data-role="count"]')).toContainText(/No matches|0 of 0/);

  const bookEl = await getNarrative(page, book);
  expect(bookEl.story).toBe(`An [orc](ow://character/${chief}) opens the book.`);
  const a = await getNarrative(page, sceneA);
  expect(a.story).toBe(`The [orc](ow://character/${chief}) marched. Nobody saw the [orc](ow://character/${chief}) leave.`);
  const b = await getNarrative(page, sceneB);
  expect(b.story).toBe(`No orcs here, only an [orc](ow://character/${chief}) already linked.`);
  // Linking derives the relation field on each changed narrative (conv. #50).
  expect(a.characters).toContain(chief);
  const chiefEl = await getNarrative(page, chief);
  expect(chiefEl.atlas_aliases).toEqual(['orc']);
});

test('find bar: Ctrl+F and Ctrl+H seed the box from the selection, and a padded term never links its spaces', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-find-prefill-root');
  await createWorld(page, 'find prefill world');
  const chief = await createElement(page, 'character', { name: 'Orc Chief' });
  const id = await createElement(page, 'narrative', {
    name: 'prefill scene', supertype: 'Book', story: 'the orc met an orc.',
  });
  await gotoWriting(page, id);
  await waitForEditor(page);
  const prose = page.locator('.atlas-writing-workspace-prose .ProseMirror');

  // Select the whole line (End, Shift+Home), then Ctrl+F: the box is seeded.
  await prose.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toBe('the orc met an orc.');
  await page.keyboard.press('Control+f');
  const find = page.locator('[data-role="find-input"]');
  await expect(find).toHaveValue('the orc met an orc.');
  await expect(page.locator('[data-role="count"]')).toContainText('1 of 1');

  // Now search a padded form on purpose: "orc " matches once ("orc." does
  // not), and the chip must be "orc", the space staying prose.
  await find.fill('orc ');
  await expect(page.locator('[data-role="count"]')).toContainText('1 of 1');
  await page.locator('[data-role="link-matches"]').click();
  await page.locator('.atlas-picker-row', { hasText: 'Orc Chief' }).click();
  const chips = prose.locator('.atlas-element-chip');
  await expect(chips).toHaveCount(1);
  await expect(chips.first()).toHaveText('orc');
  await expect(prose).toHaveText('the orc met an orc.');

  // The label survives the chip-label sync tick (alias recorded first).
  await expect.poll(async () => (await getNarrative(page, chief))?.atlas_aliases ?? []).toEqual(['orc']);
  await page.waitForTimeout(1500);
  await expect(chips.first()).toHaveText('orc');
  const narr = await getNarrative(page, id);
  expect(narr.story).toBe(`the [orc](ow://character/${chief}) met an orc.`);

  // Ctrl+H with a selection seeds the box too.
  await find.press('Escape');
  await prose.click();
  await page.keyboard.press('End');
  await page.keyboard.press('Shift+Home');
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('met an orc.');
  await page.keyboard.press('Control+h');
  await expect(page.locator('.atlas-find-bar')).toHaveAttribute('data-mode', 'replace');
  await expect(find).toHaveValue(/met an orc\.$/);
});

test('find bar: Ctrl+F still opens after switching scenes inside the room', async ({ page }) => {
  // mountForNarrative wipes root.innerHTML; a find bar built for the first
  // scene was left detached, so the shortcut opened an invisible bar.
  await freshBoot(page);
  await setupAtlasRoot(page, 'wrk-find-switch-root');
  await createWorld(page, 'find switch world');
  const one = await createElement(page, 'narrative', { name: 'one', supertype: 'Book', story: 'alpha' });
  const two = await createElement(page, 'narrative', { name: 'two', supertype: 'Book', story: 'beta' });
  await gotoWriting(page, one);
  await waitForEditor(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('.atlas-find-bar')).toBeVisible();
  await page.locator('[data-role="find-input"]').press('Escape');

  await gotoWriting(page, two);
  await waitForEditor(page);
  await page.keyboard.press('Control+f');
  await expect(page.locator('.atlas-find-bar')).toBeVisible();
  await page.locator('[data-role="find-input"]').fill('beta');
  await expect(page.locator('[data-role="count"]')).toContainText('1 of 1');
});
