/**
 * The reading aids (1.101, the charter profile): Home shows the marked Charter,
 * Guide and Domains first, in that order; the element list leaves them out
 * until the person shows them (Home's line and the list's chip are one switch,
 * per world); a Guide's page picks a Domain the list hides; an unmarked Domain
 * Construct is offered its mark; a second marked Charter is retired from Home
 * by taking its mark off, and stays in the world as lore.
 */
import { test, expect, type Page } from '@playwright/test';

const AT = '2026-10-22T00:00:00.000Z';
const CHARTER = '0192a000-0000-7000-8000-000000200101';
const OLD = '0192a000-0000-7000-8000-000000200102';
const GUIDE = '0192a000-0000-7000-8000-000000200103';
const DOCKS = '0192a000-0000-7000-8000-000000200104';
const MARKET = '0192a000-0000-7000-8000-000000200105';
const PIER = '0192a000-0000-7000-8000-000000200106';
const MARA = '0192a000-0000-7000-8000-000000200107';
const HARBOUR = '0192a000-0000-7000-8000-000000200108';
const BELL = '0192a000-0000-7000-8000-000000200109';

async function setupWorld(page: Page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('reading-aids-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'harbour');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

async function put(page: Page, type: string, id: string, name: string, extra: Record<string, unknown> = {}) {
  await page.evaluate(async ({ type, id, name, extra, at }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    await store.createElementVerbatim(type, { id, type, name, local_updated_at: at, ...extra });
    api.patchData(await store.listElements());
  }, { type, id, name, extra, at: AT });
}

const go = (page: Page, hash: string) => page.evaluate((h) => { window.location.hash = h; }, hash);
const row = (page: Page, id: string) => page.locator(`.atlas-row[data-element-id="${id}"]`);

test.describe('the reading aids at the door and out of the lore', () => {
  test('Home shows them first, the list leaves them out until shown, a Guide picks a Domain', async ({ page }) => {
    await setupWorld(page);
    const own = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.meta.id as string);
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await put(page, 'location', PIER, 'The Pier');
    await put(page, 'character', MARA, 'Mara Vell');
    await put(page, 'law', CHARTER, 'House Rules', { supertype: 'Charter', x_charter_of: own, description: 'Be kind to the harbour cats.', created_at: '2026-10-01T00:00:00Z' });
    await put(page, 'construct', GUIDE, 'Start Here', { supertype: 'Guide', x_charter_of: own, description: 'Read the docks first.', constructs: [DOCKS] });
    await put(page, 'construct', DOCKS, 'The Docks', { supertype: 'Domain', x_charter_of: own, description: 'Where the boats come in.\nMore here.', locations: [PIER] });
    await put(page, 'construct', HARBOUR, 'The Harbour', { supertype: 'Domain', x_charter_of: own, description: 'The water itself.' });
    await put(page, 'construct', MARKET, 'The Market', { supertype: 'Domain', description: 'Where the fish go.' });
    await put(page, 'construct', BELL, 'The Bell');

    await go(page, `#/w/${wid}`);
    const door = page.locator('[data-role="reading-aids"]');
    await expect(door.locator('[data-role="charter"]')).toContainText('House Rules');
    await expect(door.locator('[data-role="guide"]')).toContainText('Start Here');
    await expect(door.locator('[data-role="domains"]')).toContainText('The Docks · Where the boats come in.');
    await expect(door.locator('[data-role="domains"]')).not.toContainText('More here.');
    await expect(door.locator('[data-role="domains"]')).not.toContainText('The Market');
    const order = await door.locator('[data-role]').evaluateAll(els => els.map(e => e.getAttribute('data-role')));
    expect(order.slice(0, 3)).toEqual(['charter', 'guide', 'domains']);
    const line = page.locator('[data-action="home-aids"]');
    await expect(line).toContainText('This world\'s reading aids, 4, are not counted or listed');
    await page.screenshot({ path: test.info().outputPath('reading-aids-home.png') });

    // The list: lore in, aids out; the unmarked Domain is lore.
    await expect(row(page, PIER)).toBeVisible();
    await expect(row(page, MARKET)).toBeVisible();
    for (const id of [CHARTER, GUIDE, DOCKS, HARBOUR]) await expect(row(page, id)).toHaveCount(0);
    await expect(page.locator('[data-action="hide-aids"]')).toHaveAttribute('aria-pressed', 'true');

    // One switch: Home's line shows them in the list too, and the chip says so.
    await line.click();
    await expect(line).toContainText('are counted and listed');
    for (const id of [CHARTER, GUIDE, DOCKS]) await expect(row(page, id)).toBeVisible();
    await expect(page.locator('[data-action="hide-aids"]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-action="hide-aids"]').click();
    for (const id of [CHARTER, GUIDE, DOCKS]) await expect(row(page, id)).toHaveCount(0);
    await expect(page.locator('[data-action="home-aids"]')).toContainText('are not counted or listed');

    // The Guide's page picks a marked Domain the lists hide; a lore page's picker does not offer it.
    await go(page, `#/w/${wid}/element/${GUIDE}`);
    await page.locator('[data-field="constructs"] .atlas-link-pick').click();
    await expect(page.locator(`.atlas-picker-row[data-element-id="${HARBOUR}"]`)).toBeVisible();
    await page.keyboard.press('Escape');
    await go(page, `#/w/${wid}/element/${BELL}`);
    await page.locator('[data-field="constructs"] .atlas-link-pick').click();
    await expect(page.locator(`.atlas-picker-row[data-element-id="${GUIDE}"]`)).toHaveCount(0);
    await expect(page.locator(`.atlas-picker-row[data-element-id="${HARBOUR}"]`)).toHaveCount(0);
    await page.keyboard.press('Escape');

    // An unmarked Domain Construct is offered its mark; the press marks it and Home lists it.
    await go(page, `#/w/${wid}/element/${MARKET}`);
    const offer = page.locator('[data-role="charter-mark"]');
    await expect(offer.locator('[data-role="charter-mark-btn"]')).toHaveText("Mark as one of this world's domains");
    await offer.locator('[data-role="charter-mark-btn"]').click();
    await expect(offer).toHaveCount(0);
    await go(page, `#/w/${wid}`);
    await expect(page.locator('[data-role="domains"]')).toContainText('The Market');
  });

  test('a keeper changes which Charter leads: an older one is not offered a mark that cannot lead; the leader retires from its page; then the older one is marked and leads', async ({ page }) => {
    await setupWorld(page);
    const own = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.meta.id as string);
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await put(page, 'law', CHARTER, 'House Rules', { supertype: 'Charter', x_charter_of: own, created_at: '2026-10-01T00:00:00Z' });
    await put(page, 'law', OLD, 'Old Rules', { supertype: 'Charter', created_at: '2026-01-01T00:00:00Z' });
    await go(page, `#/w/${wid}/element/${OLD}`);
    const blocked = page.locator('[data-role="charter-mark-blocked"]');
    await expect(blocked).toContainText('retire House Rules on its page first');
    await expect(page.locator('[data-role="charter-mark-btn"]')).toHaveCount(0);
    await go(page, `#/w/${wid}/element/${CHARTER}`);
    const retire = page.locator('[data-role="aid-retire-offer"]');
    await expect(retire).toContainText("This is this world's charter.");
    await retire.locator('[data-action="aid-retire"]').click();
    await go(page, `#/w/${wid}/element/${OLD}`);
    await expect(page.locator('[data-role="charter-mark-btn"]')).toHaveText("Mark as this world's charter");
    await page.locator('[data-role="charter-mark-btn"]').click();
    await expect(page.locator('[data-role="charter-mark-btn"]')).toHaveCount(0);
    await go(page, `#/w/${wid}`);
    await expect(page.locator('[data-role="charter"]')).toContainText('Old Rules');
    await expect(page.locator('[data-role="aid-other"]')).toHaveCount(0);
  });

  test('a second marked Charter is retired from Home, and stays as lore', async ({ page }) => {
    await setupWorld(page);
    const own = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.meta.id as string);
    const wid = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId as string);
    await put(page, 'law', OLD, 'Old Rules', { supertype: 'Charter', x_charter_of: own, created_at: '2026-01-01T00:00:00Z' });
    await put(page, 'law', CHARTER, 'House Rules', { supertype: 'Charter', x_charter_of: own, created_at: '2026-10-01T00:00:00Z' });
    await go(page, `#/w/${wid}`);
    await expect(page.locator('[data-role="charter"]')).toContainText('House Rules');
    const other = page.locator('[data-role="aid-other"]');
    await expect(other).toContainText('Another charter is also marked: Old Rules');
    await other.locator('[data-action="aid-retire"]').click();
    await expect(other).toHaveCount(0);
    const mark = await page.evaluate(async (id) => {
      const store = (window as any).__atlasTestApi.getActiveStore();
      const els = await store.listElements();
      const el = els.find((e: { id: string }) => e.id === id);
      return el ? (el.x_charter_of ?? null) : 'gone';
    }, OLD);
    expect(mark).toBeNull();
    await expect(page.locator('[data-role="charter"]')).toContainText('House Rules');
    await expect(row(page, OLD)).toBeVisible();
    await expect(row(page, CHARTER)).toHaveCount(0);
  });
});
