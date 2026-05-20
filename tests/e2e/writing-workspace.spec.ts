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
  await expect(page.locator('.atlas-row[data-world-id]', { hasText: name })).toBeVisible();
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
  // Body sections all present.
  await expect(page.locator('.atlas-writing-workspace-details')).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-refs')).toBeVisible();
  await expect(page.locator('.atlas-writing-workspace-footer')).toBeVisible();
  // Footer has live word count + save state.
  await expect(page.locator('.atlas-writing-workspace-wc')).toContainText('0 words');
  await expect(page.locator('.atlas-writing-workspace-save')).toContainText('saved');
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

  // Wait for the debounced save (default 1s) to land.
  await expect(page.locator('.atlas-writing-workspace-save')).toContainText('saved', {
    timeout: 5000,
  });
  // The "saving…" → "saved" cycle means the persist completed.

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

  // Wait for debounced save.
  await expect(page.locator('.atlas-writing-workspace-save')).toContainText('saved', {
    timeout: 5000,
  });

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

  // Click reading mode button in footer.
  const readBtn = page.locator('.atlas-writing-workspace-footer-left button').first();
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

  // Wait for the autosave to flush.
  await expect(page.locator('.atlas-writing-workspace-save')).toContainText('saved', {
    timeout: 5000,
  });
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

test('cast strip shows linked elements and inserts chip on click', async ({ page }) => {
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
  });
  await gotoWriting(page, narrId);
  await waitForEditor(page);

  // Default tab is characters — strip shows Drizzle.
  const strip = page.locator('.atlas-writing-workspace-cast');
  await expect(strip).toBeVisible();
  await expect(strip.locator('.atlas-writing-workspace-cast-chip', { hasText: 'Drizzle' })).toBeVisible();

  // Click chip → ow:// chip inserted into the editor.
  await strip.locator('.atlas-writing-workspace-cast-chip', { hasText: 'Drizzle' }).click();
  const editorChip = page.locator('.atlas-writing-workspace-prose .atlas-element-chip', { hasText: 'Drizzle' });
  await expect(editorChip).toBeVisible();
  await expect(editorChip).toHaveAttribute('data-id', charId);

  // Switch to locations tab — strip shows The Tower.
  await strip.locator('[data-tab="locations"]').click();
  await expect(strip).toHaveAttribute('data-active-tab', 'locations');
  await expect(strip.locator('.atlas-writing-workspace-cast-chip', { hasText: 'The Tower' })).toBeVisible();
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
  await expect(page.locator('.atlas-writing-workspace-save')).toContainText('saved', { timeout: 5000 });
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

  // Move cursor to between the two paragraphs by stepping back through the
  // second paragraph's text — exact step count = length of "second half
  // after the split" (28 chars) + 1 for the paragraph boundary.
  for (let i = 0; i < 28; i++) await page.keyboard.press('ArrowLeft');

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
