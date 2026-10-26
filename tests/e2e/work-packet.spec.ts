/**
 * Work packet e2e: a Work item's packet (x_packet_elements, dist.36) shows on
 * its page in the producer's order with each reason, and Step through opens the
 * packet bar on the first element with its reason, Next moving to the second.
 * A Relation without the profile shows no packet. The rule: tests/unit/work-packet.test.ts.
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
    const sub = await root.getDirectoryHandle('work-packet-root', { create: true });
    api.setNextDirectory(sub);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'packetworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function createElement(page: Page, type: string, data: Record<string, unknown>): Promise<string> {
  return await page.evaluate(async ({ type, data }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    if (!store) throw new Error('no active store');
    const created = await store.createElement(type, data);
    api.patchData(await store.listElements());
    return created.id;
  }, { type, data });
}

async function worldId(page: Page): Promise<string> {
  return await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
}

test.describe('a work packet', () => {
  test("a Work item's packet lists its elements with reasons and steps through them", async ({ page }) => {
    await setupWorld(page);
    const coast = await createElement(page, 'location', { name: 'The Salt Coast' });
    const ana = await createElement(page, 'character', { name: 'Ana' });
    const item = await createElement(page, 'relation', {
      name: 'Check the coast', supertype: 'Work item', locations: [coast], characters: [ana],
      x_packet_elements: [
        { type: 'location', id: coast, reason: 'Its river ends inland' },
        { type: 'character', id: '00000000-0000-7000-8000-000000000000', reason: 'Named in a story, not here' },
        { type: 'character', id: ana, reason: 'Lives on the coast but has no location' },
      ],
      x_packet_producer: { tool: 'onlyworlds doctor', version: '0.12.0' },
    });
    const plain = await createElement(page, 'relation', { name: 'Allies', locations: [coast] });
    const w = await worldId(page);

    await page.evaluate(([w, id]) => { window.location.hash = `#/w/${w}/element/${id}`; }, [w, item]);
    const box = page.locator('[data-role="work-packet"]');
    await expect(box.locator('h3')).toHaveText('Work packet · 3 elements');
    await expect(box).toContainText('Made by onlyworlds doctor 0.12.0');
    await expect(box.locator('li')).toHaveText([
      'The Salt Coast · Its river ends inland',
      'Not in this world (Character) · Named in a story, not here',
      'Ana · Lives on the coast but has no location',
    ]);

    await box.locator('[data-role="work-packet-step"]').click();
    const bar = page.locator('[data-role="packet-bar"]');
    await expect(bar.locator('.atlas-packet-bar-count')).toHaveText('1 of 2');
    await expect(bar).toContainText('1 not in this world');
    await expect(bar.locator('[data-role="packet-reason"]')).toHaveText('Its river ends inland');
    await expect(page.locator('[data-role="element-name"]')).toHaveText('The Salt Coast');
    await bar.locator('[data-role="packet-next"]').click();
    await expect(bar.locator('[data-role="packet-reason"]')).toHaveText('Lives on the coast but has no location');
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Ana');
    await bar.locator('[data-role="packet-close"]').click();

    await page.evaluate(([w, id]) => { window.location.hash = `#/w/${w}/element/${id}`; }, [w, plain]);
    await expect(page.locator('[data-role="element-name"]')).toHaveText('Allies');
    await expect(page.locator('[data-role="work-packet"]')).toHaveCount(0);
  });
});
