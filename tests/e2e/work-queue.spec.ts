/**
 * Work-queue rail e2e (Act 1, Bout 1.1). Locks the undated backlog shown in the
 * charts ambient rail: dateable elements with no date appear grouped with a
 * count; non-dateable types (Object, Species) never appear; clicking an item
 * opens its element room (where a date can be added). Bout 1.2 will make these
 * draggable straight onto the axis.
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
    const sub = await root.getDirectoryHandle('work-queue-test-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'queueworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
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

async function openCharts(page: Page) {
  await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    window.location.hash = `#/w/${s.active.worldId}/timeline`;
  });
  await expect(page.locator('.atlas-timeline-room h1')).toHaveText('Charts');
}

test('the undated backlog lists dateable elements, excludes non-dateable types, and opens the editor', async ({ page }) => {
  await setupWorld(page);
  // Two dated (so the chart renders) + undated dateable + non-dateable.
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  await createElement(page, 'character', { name: 'Aldric', birth_date: 10 });
  await createElement(page, 'event', { name: 'The Prophecy' });        // undated → queue
  await createElement(page, 'character', { name: 'The Wanderer' });    // undated → queue
  await createElement(page, 'object', { name: 'The Iron Crown' });     // NOT dateable → excluded
  await createElement(page, 'species', { name: 'Highland Folk' });     // NOT dateable → excluded
  await openCharts(page);

  // The section shows with the undated count (2 dateable undated).
  const head = page.locator('.atlas-timeline-rail-undated-head');
  await expect(head).toBeVisible();
  await expect(head.locator('.atlas-timeline-rail-undated-count')).toHaveText('2');

  // Both undated dateable elements appear (order is store-iteration, not
  // asserted); the non-dateable ones never do.
  const items = page.locator('.atlas-timeline-rail-undated-item');
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: 'The Prophecy' })).toHaveCount(1);
  await expect(items.filter({ hasText: 'The Wanderer' })).toHaveCount(1);
  await expect(page.locator('.atlas-timeline-rail-undated', { hasText: 'The Iron Crown' })).toHaveCount(0);
  await expect(page.locator('.atlas-timeline-rail-undated', { hasText: 'Highland Folk' })).toHaveCount(0);

  // Clicking an item opens its element room (to add a date there).
  await items.filter({ hasText: 'The Prophecy' }).click();
  await expect(page).toHaveURL(/\/element\//);
});

test('the undated backlog excludes non-story narratives (share pages, knowledge entries) but keeps story narratives', async ({ page }) => {
  await setupWorld(page);
  // One dated element so the chart renders at all.
  await createElement(page, 'event', { name: 'The Sundering', start_date: -20 });
  // A plain (story) narrative with no date IS chronological backlog → appears.
  await createElement(page, 'narrative', { name: 'Chapter One' });
  // A share page and a knowledge entry are Narratives by type (so they pass the
  // dateable gate) but are non-chronological atlas constructs → never backlog.
  await createElement(page, 'narrative', { name: 'My Shared Page', subtype: 'page' });
  await createElement(page, 'narrative', { name: 'A Lore Entry', subtype: 'knowledge' });
  await openCharts(page);

  // Exactly one undated backlog item: the story narrative.
  const head = page.locator('.atlas-timeline-rail-undated-head');
  await expect(head).toBeVisible();
  await expect(head.locator('.atlas-timeline-rail-undated-count')).toHaveText('1');
  const items = page.locator('.atlas-timeline-rail-undated-item');
  await expect(items).toHaveCount(1);
  await expect(items.filter({ hasText: 'Chapter One' })).toHaveCount(1);
  await expect(page.locator('.atlas-timeline-rail-undated', { hasText: 'My Shared Page' })).toHaveCount(0);
  await expect(page.locator('.atlas-timeline-rail-undated', { hasText: 'A Lore Entry' })).toHaveCount(0);
});
