/**
 * Context pane e2e — locks in the tool-global behavior introduced in
 * session 231:
 *   - Context tab is permanent + leftmost on fresh boot.
 *   - Element route → graph + preview, no lists, "open in detail" hidden
 *     when previewing the subject (already on its detail page).
 *   - Home / unfocused routes → empty state copy.
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

async function setupAtlasRoot(page: Page, dirName: string = 'context-pane-test-root') {
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

async function gotoElement(page: Page, elementId: string) {
  await page.evaluate((id) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/element/${id}`;
  }, elementId);
}

async function gotoHome(page: Page) {
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}`;
  });
}

async function openContextTab(page: Page) {
  await page.locator('.atlas-tab[data-tab-kind="context"]').click();
}

test('context tab is permanent leftmost on fresh boot', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const tabs = page.locator('.atlas-tab');
  // First tab is context, second is maps.
  await expect(tabs.first()).toHaveAttribute('data-tab-kind', 'context');
  await expect(tabs.nth(1)).toHaveAttribute('data-tab-kind', 'map-index');
});

test('element route: context pane shows graph + element preview', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    description: 'A daring hero of the realm.',
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  await expect(pane).toBeVisible();

  // Graph mounts with subject as center node.
  await expect(pane.locator('.atlas-context-graph-node.is-center')).toBeVisible();

  // Preview shows subject by default.
  const preview = pane.locator('.atlas-context-preview');
  await expect(preview).toBeVisible();
  await expect(preview.locator('.atlas-context-preview-name')).toHaveText('Drizzle');

  // "open in detail" is HIDDEN when previewing the subject (already on its
  // detail page in the middle pane).
  await expect(preview.locator('.atlas-btn-secondary', { hasText: 'open in detail' })).toHaveCount(0);

  // No lists in element mode.
  await expect(pane.locator('.atlas-context-pane-lists')).toHaveCount(0);
});

test('element route: clicking a neighbor swaps the preview and shows "open in detail"', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  // Click the non-center node (Wulfgar).
  const friendNode = pane.locator('.atlas-context-graph-node:not(.is-center)').first();
  await friendNode.click();

  const preview = pane.locator('.atlas-context-preview');
  await expect(preview.locator('.atlas-context-preview-name')).toHaveText('Wulfgar');
  // Now "open in detail" SHOULD show (Wulfgar isn't the subject).
  await expect(preview.locator('.atlas-btn-secondary', { hasText: 'open in detail' })).toBeVisible();
});

test('home route: context pane shows empty state copy', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  await gotoHome(page);
  await openContextTab(page);

  const empty = page.locator('.atlas-context-pane-empty');
  await expect(empty).toBeVisible();
  await expect(empty).toContainText(/open an element|narrative/i);
});

test('breadcrumb appears after recenter; home chip returns to subject', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  // No breadcrumb at home.
  await expect(pane.locator('.atlas-context-graph-trail')).toHaveCount(0);

  // Recenter on neighbor.
  await pane.locator('.atlas-context-graph-node:not(.is-center)').first().click();

  const trail = pane.locator('.atlas-context-graph-trail');
  await expect(trail).toBeVisible();
  // Home chip + current entry.
  await expect(trail.locator('.atlas-context-graph-trail-chip', { hasText: 'Drizzle' })).toBeVisible();
  await expect(trail.locator('.atlas-context-graph-trail-current', { hasText: 'Wulfgar' })).toBeVisible();

  // Click home chip → trail disappears, subject is center.
  await trail.locator('.atlas-context-graph-trail-chip', { hasText: 'Drizzle' }).click();
  await expect(pane.locator('.atlas-context-graph-trail')).toHaveCount(0);
  await expect(pane.locator('.atlas-context-graph-node.is-center')).toHaveText(/Drizzle/);
});

test('right-click node opens action menu', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  const friendNode = pane.locator('.atlas-context-graph-node:not(.is-center)').first();
  await friendNode.click({ button: 'right' });

  const menu = page.locator('.atlas-context-graph-node-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.atlas-context-graph-node-menu-item', { hasText: 'Open as element' })).toBeVisible();
  await expect(menu.locator('.atlas-context-graph-node-menu-item', { hasText: 'Copy ID' })).toBeVisible();
  // Not in writing mode → no "Add to story".
  await expect(menu.locator('.atlas-context-graph-node-menu-item', { hasText: 'Add to story' })).toHaveCount(0);

  // Esc closes.
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
});

test('toolbar: type chip toggles hide that type in the graph', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const locId = await createElement(page, 'location', { name: 'The Tower' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    locations: [locId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  await expect(pane.locator('.atlas-context-pane-toolbar')).toBeVisible();

  // Location node should be visible initially.
  await expect(
    pane.locator('.atlas-context-graph-node:not(.is-center)').filter({ hasText: 'The Tower' })
  ).toBeVisible();

  // Toggle off the location chip.
  await pane.locator('.atlas-context-pane-toolbar-chip[data-type="location"]').click();

  // Tower disappears from graph.
  await expect(
    pane.locator('.atlas-context-graph-node:not(.is-center)').filter({ hasText: 'The Tower' })
  ).toHaveCount(0);

  // Chip persists with is-off styling.
  await expect(
    pane.locator('.atlas-context-pane-toolbar-chip[data-type="location"]')
  ).toHaveClass(/is-off/);

  // Toggle back on — Tower returns.
  await pane.locator('.atlas-context-pane-toolbar-chip[data-type="location"]').click();
  await expect(
    pane.locator('.atlas-context-graph-node:not(.is-center)').filter({ hasText: 'The Tower' })
  ).toBeVisible();
});

test('toolbar: hop toggle 1-hop hides adjacent nodes', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  // Wulfgar is adjacent (linked from Drizzle), The Far Tower is 2-hop (linked
  // from Wulfgar). Default hop in element mode = 2, so Far Tower shows.
  const farTowerId = await createElement(page, 'location', { name: 'The Far Tower' });
  const friendId = await createElement(page, 'character', {
    name: 'Wulfgar',
    locations: [farTowerId],
  });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');

  // 2-hop is default for element view → Far Tower visible as adjacent.
  await expect(
    pane.locator('.atlas-context-graph-node').filter({ hasText: 'The Far Tower' })
  ).toBeVisible();

  // Click 1-hop segment.
  await pane.locator('.atlas-context-pane-toolbar-hop-seg[title="1-hop"]').click();

  // Far Tower (2-hop) disappears; Wulfgar (1-hop) stays.
  await expect(
    pane.locator('.atlas-context-graph-node').filter({ hasText: 'The Far Tower' })
  ).toHaveCount(0);
  await expect(
    pane.locator('.atlas-context-graph-node').filter({ hasText: 'Wulfgar' })
  ).toBeVisible();
});

test('lock layout: surviving nodes do not move when a type is hidden', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const locId = await createElement(page, 'location', { name: 'Tower' });
  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
    locations: [locId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');

  // Enable lock-layout.
  await pane.locator('.atlas-context-pane-toolbar-lock-btn').click();
  await expect(pane.locator('.atlas-context-pane-toolbar-lock-btn')).toHaveClass(/is-on/);

  // Capture Wulfgar's position before filter toggle.
  const wulfgarBefore = await pane
    .locator('.atlas-context-graph-node').filter({ hasText: 'Wulfgar' })
    .boundingBox();
  expect(wulfgarBefore).not.toBeNull();

  // Hide Locations.
  await pane.locator('.atlas-context-pane-toolbar-chip[data-type="location"]').click();

  // Tower is hidden (lock-layout uses display: none rather than removing the
  // DOM node, so toBeHidden — not toHaveCount(0) — is the right assertion).
  await expect(
    pane.locator('.atlas-context-graph-node').filter({ hasText: 'Tower' })
  ).toBeHidden();

  // Wulfgar is in the same position (no jump).
  const wulfgarAfter = await pane
    .locator('.atlas-context-graph-node').filter({ hasText: 'Wulfgar' })
    .boundingBox();
  expect(wulfgarAfter).not.toBeNull();
  expect(wulfgarAfter!.x).toBeCloseTo(wulfgarBefore!.x, 0);
  expect(wulfgarAfter!.y).toBeCloseTo(wulfgarBefore!.y, 0);
});

test('toolbar: hop preference persists in registry', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  await pane.locator('.atlas-context-pane-toolbar-hop-seg[title="1-hop"]').click();

  // Verify the registry entry now has context_hop_depth: 1.
  const persisted = await page.evaluate(() => {
    const reg = (window as any).__atlasTestApi.getState().registry;
    return reg.worlds[0]?.context_hop_depth;
  });
  expect(persisted).toBe(1);
});

test('zoom: wheel reveals fit-to-view button; click resets', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  const charId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await gotoElement(page, charId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  // No fit button at identity transform.
  await expect(pane.locator('.atlas-context-graph-fit')).toHaveCount(0);

  // Wheel zoom in over the graph slot.
  const graph = pane.locator('.atlas-context-pane-graph');
  const box = await graph.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -120);

  // Fit button appears.
  const fit = pane.locator('.atlas-context-graph-fit');
  await expect(fit).toBeVisible();

  // Click resets.
  await fit.click();
  await expect(pane.locator('.atlas-context-graph-fit')).toHaveCount(0);
});

test('hop: 3-hop reveals a node two rings out from the subject', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  // Chain: Drizzle → Wulfgar (ring 1) → Bruenor (ring 2) → Catti-brie (ring 3).
  const cattiId = await createElement(page, 'character', { name: 'Catti-brie' });
  const bruenorId = await createElement(page, 'character', {
    name: 'Bruenor',
    characters: [cattiId],
  });
  const wulfgarId = await createElement(page, 'character', {
    name: 'Wulfgar',
    characters: [bruenorId],
  });
  const drizzleId = await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [wulfgarId],
  });
  await gotoElement(page, drizzleId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  // 2-hop default for element view → Wulfgar (ring 1) + Bruenor (ring 2) visible.
  // Catti-brie (ring 3) NOT visible.
  await expect(pane.locator('.atlas-context-graph-node').filter({ hasText: 'Bruenor' })).toBeVisible();
  await expect(pane.locator('.atlas-context-graph-node').filter({ hasText: 'Catti-brie' })).toHaveCount(0);

  // Click 3-hop segment.
  await pane.locator('.atlas-context-pane-toolbar-hop-seg[title="3-hop"]').click();

  // Now Catti-brie shows.
  await expect(pane.locator('.atlas-context-graph-node').filter({ hasText: 'Catti-brie' })).toBeVisible();
});

test('settings: edge coloring toggle persists and routes back to graph', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const friendId = await createElement(page, 'character', { name: 'Wulfgar' });
  await createElement(page, 'character', {
    name: 'Drizzle',
    characters: [friendId],
  });
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/settings/context`;
  });
  await expect(page.locator('.atlas-settings')).toBeVisible();
  await page.locator('.atlas-settings input[data-setting="context_edge_color"]').check();

  const persisted = await page.evaluate(() => {
    const reg = (window as any).__atlasTestApi.getState().registry;
    return reg.worlds[0]?.context_edge_color;
  });
  expect(persisted).toBe(true);
});

test('settings: Context tab renders and persists hop depth', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  // Navigate to /settings/context for the active world.
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/settings/context`;
  });
  await expect(page.locator('.atlas-settings')).toBeVisible();
  const sel = page.locator('.atlas-settings select[data-setting="context_hop_depth"]');
  await expect(sel).toBeVisible();

  // Pick 2-hop.
  await sel.selectOption('2');

  // Registry has 2.
  const persisted = await page.evaluate(() => {
    const reg = (window as any).__atlasTestApi.getState().registry;
    return reg.worlds[0]?.context_hop_depth;
  });
  expect(persisted).toBe(2);

  // Toggle lock-layout via the settings checkbox.
  await page.locator('.atlas-settings input[data-setting="context_lock_layout"]').check();
  const lockPersisted = await page.evaluate(() => {
    const reg = (window as any).__atlasTestApi.getState().registry;
    return reg.worlds[0]?.context_lock_layout;
  });
  expect(lockPersisted).toBe(true);
});

test('knowledge list: context pane anchors on the most-held entry with a caption (K7)', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const knowerId = await createElement(page, 'character', { name: 'Sage' });
  await createElement(page, 'narrative', {
    name: 'The Secret',
    subtype: 'knowledge',
    narrator: knowerId,
  });

  // Knowledge LIST route (no open entry/knower).
  await page.evaluate(() => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/knowledge`;
  });
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  // Anchored graph centers on the knowledge entry instead of showing empty text.
  await expect(pane.locator('.atlas-context-graph-node.is-center')).toHaveText(/The Secret/);
  // Caption explains WHY this entry is shown (T-CX3).
  const caption = pane.locator('.atlas-context-pane-caption');
  await expect(caption).toBeVisible();
  await expect(caption).toContainText(/most widely held/i);
});

test('share page: context pane anchors on the first carded element', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const heroId = await createElement(page, 'character', { name: 'Protagonist' });
  const pageId = await createElement(page, 'narrative', {
    name: 'My Page',
    subtype: 'page',
    atlas_page_blocks: [
      { id: 'block-1', kind: 'element-card', elementId: heroId, variant: 'compact', fields: [] },
    ],
    atlas_page_refs: [heroId],
  });

  await page.evaluate((id) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/share/${id}`;
  }, pageId);
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  await expect(pane.locator('.atlas-context-graph-node.is-center')).toHaveText(/Protagonist/);
  await expect(pane.locator('.atlas-context-pane-caption')).toContainText(/first featured element/i);
});

test('right-click "Add to story" appears in writing mode only', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'ctx world');

  const charId = await createElement(page, 'character', { name: 'Wulfgar' });
  const narrId = await createElement(page, 'narrative', {
    name: 'a scene',
    supertype: 'Book',
    characters: [charId],
  });
  await page.evaluate((id) => {
    const m = window.location.hash.match(/#\/w\/([^/]+)/);
    if (!m) throw new Error('no active world in URL');
    window.location.hash = `#/w/${m[1]}/writing/${id}`;
  }, narrId);
  await page.waitForSelector('.atlas-writing-workspace');
  await openContextTab(page);

  const pane = page.locator('.atlas-context-pane');
  // Right-click the cast member (Wulfgar) — non-subject node, narrative subject.
  await pane.locator('.atlas-context-graph-node:not(.is-center)').first().click({ button: 'right' });

  const menu = page.locator('.atlas-context-graph-node-menu');
  await expect(menu.locator('.atlas-context-graph-node-menu-item', { hasText: 'Add to story' })).toBeVisible();
});

test('the right-pane tab bar never becomes a vertical scroll container', async ({ page }) => {
  // `overflow-x: auto` alone COMPUTES overflow-y to auto, which made this 39px
  // strip a vertical scroll container. On a fractional device pixel ratio a tab
  // rounds a hair taller than the client box and Chromium paints a hairline
  // vertical scrollbar down the bar's right edge — visible in the v1.0 launch
  // screenshots. Asserted as an OUTCOME (no vertical scroll room, no scrollbar
  // width) rather than a restatement of the CSS rule, including under a tab
  // forced taller than the bar.
  await freshBoot(page);
  await setupAtlasRoot(page);
  await createWorld(page, 'tabbar world');
  await openContextTab(page);

  const measured = await page.evaluate(() => {
    const bar = document.querySelector('.atlas-tab-bar') as HTMLElement;
    if (!bar) throw new Error('no tab bar');
    const tab = bar.querySelector('.atlas-tab') as HTMLElement;
    const natural = {
      vRoom: bar.scrollHeight - bar.clientHeight,
      barWidthLostToScrollbar: bar.offsetWidth - bar.clientWidth,
    };
    // Force the exact rounding condition the artifact needs.
    tab.style.paddingTop = '8px';
    const forced = {
      vRoom: bar.scrollHeight - bar.clientHeight,
      barWidthLostToScrollbar: bar.offsetWidth - bar.clientWidth,
    };
    tab.style.paddingTop = '';
    return { natural, forced, overflowY: getComputedStyle(bar).overflowY };
  });

  expect(measured.overflowY).toBe('hidden');
  expect(measured.natural.vRoom).toBe(0);
  expect(measured.forced.vRoom).toBe(0);
  expect(measured.forced.barWidthLostToScrollbar).toBe(0);
});

/**
 * S355 — unlinked mentions in the element preview (a Discord ask: "if I make
 * a new element, is there a way to search for matching words and link those
 * all at once"). The preview line is the standing home; "Link all" writes
 * every listed narrative on disk and the card rebuilds.
 */
test('element preview lists unlinked mentions and "Link all" links them across narratives', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'ctx-mentions-root');
  await createWorld(page, 'mentions world');
  const chief = await createElement(page, 'character', { name: 'Orc Chief', atlas_aliases: ['orc'] });
  const a = await createElement(page, 'narrative', {
    name: 'Scene A', supertype: 'Scene', story: 'The orc marched. The Orc Chief watched the orcs.',
  });
  const b = await createElement(page, 'narrative', {
    name: 'Scene B', supertype: 'Scene', story: `An [orc](ow://character/${chief}) already linked, and an orc not.`,
  });
  await createElement(page, 'narrative', { name: 'Scene C', supertype: 'Scene', story: 'Nothing here.' });

  await gotoElement(page, chief);
  await openContextTab(page);
  const preview = page.locator('.atlas-context-pane .atlas-context-preview');
  await expect(preview.locator('.atlas-context-preview-name')).toHaveText('Orc Chief');

  const line = preview.locator('.atlas-context-preview-mentions');
  await expect(line).toBeVisible();
  await expect(line).toContainText('Mentioned, unlinked (3 in 2 scenes):');
  await expect(line).toContainText('Scene A (2)');
  await expect(line).toContainText('Scene B');
  await expect(line).not.toContainText('Scene C');

  await line.locator('[data-action="link-mentions"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Linked 3 mentions of Orc Chief across 2 scenes' })).toBeVisible();

  // The card rebuilt: the line is gone, the backlinks line now names both scenes.
  await expect(preview.locator('.atlas-context-preview-mentions')).toHaveCount(0);
  await expect(preview.locator('.atlas-context-preview-backlinks')).toContainText('Linked from (2):');

  const storyA = await page.evaluate((id) =>
    (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.story, a);
  expect(storyA).toBe(`The [orc](ow://character/${chief}) marched. The [Orc Chief](ow://character/${chief}) watched the orcs.`);
  const storyB = await page.evaluate((id) =>
    (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.id === id)?.story, b);
  expect(storyB).toBe(`An [orc](ow://character/${chief}) already linked, and an [orc](ow://character/${chief}) not.`);
});

test('the create modal nudges when the new name already sits in prose', async ({ page }) => {
  await freshBoot(page);
  await setupAtlasRoot(page, 'ctx-create-nudge-root');
  await createWorld(page, 'nudge world');
  await createElement(page, 'narrative', { name: 'Scene A', supertype: 'Scene', story: 'Vera stood. Vera sat.' });
  await createElement(page, 'narrative', { name: 'Scene B', supertype: 'Scene', story: 'Vera left.' });

  await page.click('[data-action="create-element"]');
  const modal = page.locator('[data-modal="create-element"]');
  await expect(modal).toBeVisible();
  await modal.locator('.atlas-create-type-btn[data-type="character"]').click();
  await modal.locator('input[name="element-name"]').fill('Vera');
  await modal.locator('[data-action="create"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Created character: Vera · appears in 2 narratives, unlinked' })).toBeVisible();
});
