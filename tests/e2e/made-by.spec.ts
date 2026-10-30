/**
 * #350: in a synced world whose roster holds an agent seat, the element list offers "Made by"
 * People or Agents, read from keel's created_by with the roster's kind; and any world holding
 * the parlor's room (a Narrative with supertype Message, and the rest: core/parlor-room.ts)
 * offers "Hide the room". A world on disk only offers no made-by. Keel is routed: the roster
 * answers with an agent seat, every other read is empty, every write refused.
 */
import { test, expect, type Page } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const SERVER_WORLD = '44444444-5555-4666-8777-888888888350';
const AT = '2026-10-22T00:00:00.000Z';
const AGENT = 'b1c2d3e4-0000-4000-8000-000000000350';
const PERSON = 'b1c2d3e4-0000-4000-8000-000000000351';

async function setupWorld(page: Page) {
  await page.route(`${V2}/**`, async (route) => {
    const req = route.request();
    const p = new URL(req.url()).pathname.replace('/api/v2', '');
    if (req.method() !== 'GET') return route.fulfill({ status: 503, json: { error: { code: 'unavailable', message: 'routed', type: 'api_error' } } });
    if (p === '/world' || p === '/world/') return route.fulfill({ json: { id: SERVER_WORLD, name: 'made', updated_at: AT } });
    if (p === '/members' || p === '/members/') return route.fulfill({ json: { data: [
      { id: null, kind: 'owner', role: 'owner', character: null, status: 'active' },
      { id: AGENT, kind: 'agent', role: 'contributor', character: null, status: 'active', name: 'Codex' },
      { id: PERSON, kind: 'person', role: 'co_builder', character: null, status: 'active' },
    ] } });
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('made-by-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'made');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  // Past its first steps (as Done writes): while the path is open the cover holds back its cast
  // doors and count line, so nothing above the grid moves with an act.
  await page.evaluate(async () => {
    const { getState, patchSlice } = await import('/src/core/state.ts');
    const reg = await import('/src/registry/registry.ts');
    const s = getState();
    const next = (reg as any).updateWorldEntry(s.registry, s.active!.worldId, { guide_step: 'done' });
    (reg as any).saveRegistry(next);
    patchSlice('registry', next);
  });
}

/** As a pull leaves it: synced, keel's created_by on it. */
async function pulled(page: Page, type: string, id: string, name: string, extra: Record<string, unknown>) {
  await page.evaluate(async ({ type, id, name, extra, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim(type, { id, type, name, local_updated_at: at, server_updated_at: at, ...extra });
    api.patchData(await store.listElements());
  }, { type, id, name, extra, at: AT });
}

async function linkWorld(page: Page) {
  await page.evaluate((sid) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: sid, api_key: 'ow_w_' + 'M'.repeat(32) };
    reg.pin = '4242';
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, SERVER_WORLD);
  await page.reload();
  await page.waitForSelector('.atlas-shell');
}

const rowNames = (page: Page) => page.locator('.atlas-list .atlas-row .atlas-row-main');

test.describe('made by, and the room', () => {
  test('a synced world with an agent seat filters by who made it; the room hides; a world on disk offers no made-by', async ({ page }) => {
    await setupWorld(page);
    await pulled(page, 'character', '0192a000-0000-7000-8000-000000035001', 'Glanton', { created_by: AGENT });
    await pulled(page, 'character', '0192a000-0000-7000-8000-000000035002', 'Holden', { created_by: PERSON });
    // The owner's own, through MCP: the seat decides, so a person's.
    await pulled(page, 'location', '0192a000-0000-7000-8000-000000035003', 'Fort Griffin', { created_by: null, changed_via: 'mcp' });
    await pulled(page, 'narrative', '0192a000-0000-7000-8000-000000035004', 'A line in the room', { created_by: AGENT, supertype: 'Message', x_room_of: SERVER_WORLD });

    const row = page.locator('[data-role="origin-filters"]');
    const summary = page.locator('[data-role="filter-summary"]');
    // On disk only: the room's chip, no made-by.
    await expect(row.locator('[data-action="hide-room"]')).toBeVisible();
    await expect(row.locator('[data-action="made-by-agents"]')).toHaveCount(0);

    await linkWorld(page);
    const agents = row.locator('[data-action="made-by-agents"]');
    await expect(agents).toHaveText('Agents 2');
    await expect(row.locator('[data-action="made-by-people"]')).toHaveText('People 2');
    // The room is hidden as the world opens (1.76).
    await expect(row.locator('[data-action="hide-room"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(rowNames(page)).toHaveCount(3);

    await agents.click();
    await expect(agents).toHaveAttribute('aria-pressed', 'true');
    await expect(summary).toHaveText('All types · made by agents · the room hidden');
    await expect(rowNames(page)).toHaveText(['Glanton']);

    // The room shown: the agent's line joins the agent's character.
    await row.locator('[data-action="hide-room"]').click();
    await expect(summary).toHaveText('All types · made by agents');
    await expect(rowNames(page)).toHaveText(['A line in the room', 'Glanton']);

    // People: the person's and the owner's (through MCP), never the agent's.
    await row.locator('[data-action="made-by-people"]').click();
    await expect(rowNames(page)).toHaveText(['Fort Griffin', 'Holden']);

    // Off again: everyone, the room hidden again.
    await row.locator('[data-action="made-by-people"]').click();
    await row.locator('[data-action="hide-room"]').click();
    await expect(summary).toHaveText('All types · the room hidden');
    await expect(rowNames(page)).toHaveText(['Fort Griffin', 'Glanton', 'Holden']);
  });

  test('an agent seat that made nothing offers no Made by, until an agent\'s element arrives', async ({ page }) => {
    // W11's shape: agent seats on the roster, none of the world's elements theirs.
    await setupWorld(page);
    await pulled(page, 'character', '0192a000-0000-7000-8000-000000035011', 'Holden', { created_by: PERSON });
    await pulled(page, 'location', '0192a000-0000-7000-8000-000000035012', 'Fort Griffin', { created_by: null });
    await linkWorld(page);
    await expect(rowNames(page)).toHaveCount(2);
    const row = page.locator('[data-role="origin-filters"]');
    // Long enough for the routed roster to answer: the second half proves it did.
    await page.waitForTimeout(1500);
    await expect(row).toBeHidden();
    await expect(row.locator('[data-action="made-by-agents"]')).toHaveCount(0);

    // The control moves: a pull brings an agent's element, and the row offers it.
    await pulled(page, 'character', '0192a000-0000-7000-8000-000000035013', 'Glanton', { created_by: AGENT });
    await expect(row.locator('[data-action="made-by-agents"]')).toHaveText('Agents 1');
    await expect(row.locator('[data-action="made-by-people"]')).toHaveText('People 2');
  });

  // 1.76: a lore
  // world holding a parlor's room reads as lore in every whole view, and one switch shows the room.
  test("the parlor's room is hidden from Home, a lore page, Charts and Search until shown", async ({ page }) => {
    await setupWorld(page);
    const HOLDEN = '0192a000-0000-7000-8000-000000035021';
    await pulled(page, 'character', HOLDEN, 'Holden', {});
    await pulled(page, 'event', '0192a000-0000-7000-8000-000000035022', 'The scalp war', { start_date: 3 });
    await pulled(page, 'relation', '0192a000-0000-7000-8000-000000035023', 'Fix the age of Holden', { supertype: 'Work item', characters: [HOLDEN], x_room_of: SERVER_WORLD });
    await pulled(page, 'event', '0192a000-0000-7000-8000-000000035024', 'Sitting one', { supertype: 'Sitting', start_date: 5, x_room_of: SERVER_WORLD });
    await pulled(page, 'narrative', '0192a000-0000-7000-8000-000000035025', 'Shall we rename him', { supertype: 'Message', x_room_of: SERVER_WORLD });
    // A lore letter: a Message with no parlor's mark is the world's own and stays in view (dist.45).
    await pulled(page, 'narrative', '0192a000-0000-7000-8000-000000035026', 'A letter from the judge', { supertype: 'Message' });
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
    const go = (hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);
    const middle = page.locator('.atlas-middle-content');
    const roomLine = page.locator('[data-action="home-room"]');
    const cmdkInput = page.locator('.atlas-cmdk-input');

    // Home: the counts leave the room out, and one line says it is hidden.
    await go(`#/w/${wid}`);
    await expect(roomLine).toHaveText("The parlor's room, 3, is hidden · Show it");
    await expect(page.locator('.atlas-home-statline')).not.toContainText('relation');
    // A lore page: the work item about Holden is not among his references.
    await go(`#/w/${wid}/element/${HOLDEN}`);
    await expect(middle).toContainText('Holden');
    await expect(middle).not.toContainText('Fix the age of Holden');
    await go(`#/w/${wid}/timeline`);
    // Charts: the undated tray holds Holden, never the message (the axis is drawn, not text).
    await expect(middle).toContainText('See your world arranged in time.');
    await expect(middle).toContainText('Holden');
    await expect(middle).not.toContainText('Shall we rename him');
    await expect(middle).toContainText('A letter from the judge');
    // Search.
    // The palette opens before a key is typed, holds the query, and closes again (a check
    // against a palette that never opened passes for anything).
    await page.keyboard.press('Control+k');
    await expect(cmdkInput).toBeFocused();
    await page.keyboard.type('Sitting');
    await expect(cmdkInput).toHaveValue('Sitting');
    await expect(page.locator('.atlas-cmdk-list')).toBeVisible();
    await expect(page.locator('.atlas-cmdk-list')).not.toContainText('Sitting one');
    await page.keyboard.press('Escape');
    await expect(cmdkInput).toHaveCount(0);

    // Shown, by Home's line: every view reads the room again.
    await go(`#/w/${wid}`);
    await roomLine.click();
    await expect(roomLine).toHaveText("The parlor's room, 3, is shown · Hide it");
    await expect(page.locator('[data-action="hide-room"]')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('.atlas-home-statline')).toContainText('relation');
    await go(`#/w/${wid}/timeline`);
    await expect(middle).toContainText('Shall we rename him');
    await page.keyboard.press('Control+k');
    await expect(cmdkInput).toBeFocused();
    await page.keyboard.type('Sitting');
    await expect(page.locator('.atlas-cmdk-list')).toContainText('Sitting one');
    await page.keyboard.press('Escape');
    await expect(cmdkInput).toHaveCount(0);
    await go(`#/w/${wid}/element/${HOLDEN}`);
    await expect(middle).toContainText('Fix the age of Holden');
  });
});
