/**
 * Knowledge room (DESIGN_KNOWLEDGE.md — Track A).
 *
 * Covers the room skeleton + the draft create flow: opening "new" must NOT
 * persist anything; only "create" writes the entry. This is the behaviour
 * Captain flagged (premature save + jump) — lock it.
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

async function openKnowledge(page: Page) {
  await page.click('.atlas-room-nav-btn[data-room="knowledge"]');
  await expect(page.locator('.atlas-knowledge-room h1')).toHaveText('Knowledge');
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

  // New again, fill name + prose, then create.
  await page.click('button.atlas-knowledge-new');
  await page.fill('input.atlas-knowledge-name', 'the cursed village');
  await page.fill('textarea.atlas-knowledge-prose', 'Barovia is cursed; a count rules from the castle.');
  await page.click('.atlas-knowledge-draft-actions button.atlas-btn-primary');

  // Lands on the saved entry's editor.
  await expect(page.locator('.atlas-knowledge-detail-titlerow h1')).toHaveText('the cursed village');

  // Back to the list — the entry now appears.
  await page.click('.atlas-knowledge-back');
  await expect(page.locator('.atlas-knowledge-row', { hasText: 'the cursed village' })).toBeVisible();
  await expect(page.locator('.atlas-knowledge-row')).toHaveCount(1);
});
