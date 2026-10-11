/**
 * Command palette e2e (Ctrl+K / `/`).
 *
 * Covers: open via both triggers · ranked element jump (Enter navigates to
 * the element room) · room jump by name · see-all hands the query to the
 * elements-sidebar filter · Esc closes without navigating.
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
    const sub = await root.getDirectoryHandle('cmdk-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'kpworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function seed(page: Page) {
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('character', { name: 'Aldric the Bold' });
    await store.createElement('location', { name: 'Old Harbor', description: 'A quiet dragon-plagued port.' });
    await store.createElement('character', { name: 'Marta', atlas_aliases: ['The Fox'] });
    api.patchData(await store.listElements());
  });
}

const panel = '[data-modal="command-palette"]';

test('Ctrl+K opens; typing ranks; Enter jumps to the element room', async ({ page }) => {
  await setupWorld(page);
  await seed(page);

  await page.keyboard.press('Control+k');
  await expect(page.locator(panel)).toBeVisible();

  await page.locator('[data-role="cmdk-input"]').fill('aldric');
  const active = page.locator('.atlas-cmdk-row.is-active');
  await expect(active).toContainText('Aldric the Bold');
  await page.screenshot({ path: 'Notes/ui-snapshots/2026-07-12/cmdk-results.png' });

  await page.keyboard.press('Enter');
  await expect(page.locator(panel)).toHaveCount(0);
  await expect(page).toHaveURL(/\/element\//);
  await expect(page.locator('.atlas-middle-header')).toContainText('Aldric the Bold');
});

test('alias and description matches surface; room jump works', async ({ page }) => {
  await setupWorld(page);
  await seed(page);

  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('fox');
  await expect(page.locator('.atlas-cmdk-row', { hasText: 'Marta' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(panel)).toHaveCount(0);

  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('knowl');
  await expect(page.locator('.atlas-cmdk-row.is-active')).toContainText('Knowledge');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/knowledge/);
});

test('`/` opens the palette; see-all hands the query to the sidebar filter', async ({ page }) => {
  await setupWorld(page);
  await seed(page);

  await page.keyboard.press('/');
  await expect(page.locator(panel)).toBeVisible();

  const input = page.locator('[data-role="cmdk-input"]');
  await input.fill('dragon');
  // Walk down past the results to the see-all row and pick it.
  const rows = page.locator('.atlas-cmdk-row');
  const count = await rows.count();
  for (let i = 1; i < count; i++) await page.keyboard.press('ArrowDown');
  await expect(page.locator('.atlas-cmdk-seeall.is-active')).toBeVisible();
  await page.keyboard.press('Enter');

  await expect(page.locator(panel)).toHaveCount(0);
  const search = page.locator('[data-role="elements-search"]');
  await expect(search).toHaveValue('dragon');
  // The filter narrowed the list to the description match.
  await expect(page.locator('[data-element-id]', { hasText: 'Old Harbor' })).toBeVisible();
  await expect(page.locator('[data-element-id]', { hasText: 'Marta' })).toHaveCount(0);
});

test('Esc closes without navigating; palette needs an active world', async ({ page }) => {
  await setupWorld(page);
  await seed(page);
  const before = await page.evaluate(() => window.location.hash);

  await page.keyboard.press('Control+k');
  await expect(page.locator(panel)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator(panel)).toHaveCount(0);
  const after = await page.evaluate(() => window.location.hash);
  expect(after).toBe(before);
});

/**
 * S306 — the palette routes to the room an element LIVES in.
 *
 * The bug this locks: every non-room result used to end in a bare
 * `navigate(elementHash(...))`, so Cmd+K on a map, a page, a knowledge entry
 * or a chapter dropped the user in the generic field editor instead of the
 * room that owns it — while the world home resolved all four correctly.
 * Asserting the URL (not a DOM detail) is the point: it is the one thing that
 * differs per room, and it fails if the palette ever stops asking
 * `core/element-room.ts`.
 */
test('the palette routes room-owning elements to their own rooms, not the field editor', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('map', { name: 'Harbor Chart' });
    await store.createElement('narrative', { name: 'Sealed Letter', subtype: 'knowledge' });
    await store.createElement('narrative', { name: 'Handout One', subtype: 'page' });
    await store.createElement('narrative', { name: 'Chapter Seven', supertype: 'Chapter' });
    api.patchData(await store.listElements());
  });

  const jump = async (query: string) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator(panel)).toBeVisible();
    await page.locator('[data-role="cmdk-input"]').fill(query);
    await expect(page.locator('.atlas-cmdk-row.is-active')).toContainText(query, { ignoreCase: true });
    await page.keyboard.press('Enter');
    await expect(page.locator(panel)).toHaveCount(0);
  };

  await jump('Sealed Letter');
  await expect(page).toHaveURL(/\/knowledge\//);

  await jump('Handout One');
  await expect(page).toHaveURL(/\/share\//);

  await jump('Chapter Seven');
  await expect(page).toHaveURL(/\/writing\//);

  // The map is the sharpest case: it must go through openMapTab, because
  // navigating to a map hash cannot activate an already-open background tab
  // (Captain's "recent map does nothing", S265). A map TAB is the evidence.
  await jump('Harbor Chart');
  await expect(page.locator('.atlas-right [data-tab-kind="map"]')).toHaveCount(1);
  // ...and the URL must MOVE. openMapTab alone only mutates right-pane state,
  // so on any surface where the right pane is hidden (writing focus/reading
  // mode, a tour before the rightpane capability) a tab-only jump is a dead
  // click with no feedback at all. The route is what those layouts follow.
  await expect(page).toHaveURL(/\/map\//);
});

/**
 * S306 close gate, HIGH: the palette's own "see all →" handoff still undid the
 * routing. The palette and the elements sidebar deliberately share their match
 * language, so one query reached both surfaces — and clicking the SAME row in
 * the sidebar opened the generic field editor while Enter in the palette opened
 * the room. When surface A hands work to surface B, B must keep A's promise.
 */
test('see-all hands off to the sidebar, and the sidebar routes the same way (S306 gate)', async ({ page }) => {
  await setupWorld(page);
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElement('narrative', { name: 'Sealed Letter', subtype: 'knowledge' });
    api.patchData(await store.listElements());
  });

  // Take the see-all path rather than Enter: this is the handoff under test.
  await page.keyboard.press('Control+k');
  await page.locator('[data-role="cmdk-input"]').fill('Sealed Letter');
  await page.locator('.atlas-cmdk-row[data-kind="see-all"], .atlas-cmdk-seeall').first().click();
  await expect(page.locator(panel)).toHaveCount(0);

  // The sidebar now lists it; clicking it must open the KNOWLEDGE room.
  const row = page.locator('[data-element-id]', { hasText: 'Sealed Letter' }).first();
  await expect(row).toBeVisible();
  await row.click();
  await expect(page).toHaveURL(/\/knowledge\//);
});

/**
 * S309 (Captain's ask): the palette was reachable by shortcut ALONE — the
 * app's only global search had no visible affordance. The room-nav strip now
 * carries a field-shaped search pill anchored right; clicking it opens the
 * SAME palette (one search, two doors — an inline twin could drift). Both
 * halves asserted: the pill exists when a world is active, and its click
 * opens the overlay.
 */
test('the room-nav search pill opens the command palette (S309)', async ({ page }) => {
  await setupWorld(page);
  const pill = page.locator('.atlas-room-nav-search');
  await expect(pill).toBeVisible();
  await pill.click();
  await expect(page.locator('[data-role="cmdk-input"]')).toBeVisible();
  // And it is the real palette, not a twin: typing filters as the palette does.
  await page.locator('[data-role="cmdk-input"]').fill('zzz-no-such-element');
  await expect(page.locator('.atlas-cmdk-empty, .atlas-cmdk-row').first()).toBeVisible();
});
