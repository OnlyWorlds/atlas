/**
 * keel's "known of" stub on the element page (conv. 155, I6): the name, the
 * picture and the description, with one line saying it is known of; no field
 * rows (its other fields are unknown, not empty), no rename, no create. A
 * whole Character beside it is the control.
 */
import { test, expect, type Page } from '@playwright/test';

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
    api.setNextDirectory(await root.getDirectoryHandle('known-of-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'kworld');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

const ANA = '00000000-0000-4000-8000-0000000000b2';
const KID = '00000000-0000-4000-8000-0000000000b1';

test('a stub reads as known of: name, picture, description and what keel shares, read only, no rename; a whole Character keeps its page', async ({ page }) => {
  await setupWorld(page);
  const worldId = await page.evaluate(async ({ ANA, KID }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const at = '2026-10-20T11:54:07.533243+00:00';
    // As keel serves it live since PR 117 (S444 probe-stub.log): the public fields kept, every other field unset.
    await store.applyServerRecord('character', {
      id: ANA, type: 'character', name: 'Ana', description: 'Sells mules.', supertype: '', subtype: '', image_url: '',
      reputation: 'Honest', physicality: 'Tall', mentality: '', height: null, friends: [], location: null, created_at: at, updated_at: at, known_of: true,
    }, at);
    await store.applyServerRecord('character', { id: KID, type: 'character', name: 'The Kid', description: 'Rides west.', friends: [ANA], updated_at: at }, at);
    api.patchData(await store.listElements());
    return api.getState().active.worldId as string;
  }, { ANA, KID });

  await page.evaluate(([w, id]) => { location.hash = `#/w/${w}/element/${id}`; }, [worldId, ANA]);
  const body = page.locator(`.atlas-middle-body[data-element-id="${ANA}"]`);
  await expect(body).toBeVisible();
  await expect(body.locator('[data-role="known-of"]')).toHaveText('Known of: you know only what anyone could see of Ana.');
  await expect(body.locator('.atlas-known-of-description')).toHaveText('Sells mules.');
  // Only what keel shares, as rows nothing changes (conv. 155, I5, I6).
  expect(await body.locator('[data-field]').evaluateAll(rs => rs.map(r => r.getAttribute('data-field')).sort())).toEqual(['physicality', 'reputation']);
  await expect(body.locator('[data-field].atlas-field-readonly')).toHaveCount(2);
  await expect(body.locator('[data-field="mentality"]')).toHaveCount(0);
  await expect(body.locator('.atlas-empty-fields-toggle')).toHaveCount(0);
  await page.locator('[data-role="element-name"]').click();
  await expect(page.locator('[data-role="element-name"] input, .atlas-element-name-input')).toHaveCount(0);

  // The control: a whole Character has its rows.
  await page.evaluate(([w, id]) => { location.hash = `#/w/${w}/element/${id}`; }, [worldId, KID]);
  const whole = page.locator(`.atlas-middle-body[data-element-id="${KID}"]`);
  await expect(whole).toBeVisible();
  await expect(whole.locator('[data-role="known-of"]')).toHaveCount(0);
  await expect(whole.locator('[data-field="description"]')).toBeVisible();
});

test('a stub with nothing shared shows no rows at all (never a first section of empty ones)', async ({ page }) => {
  await setupWorld(page);
  const worldId = await page.evaluate(async ({ ANA }) => {
    const api = (window as any).__atlasTestApi;
    const store = api.getActiveStore();
    const at = '2026-10-20T11:54:07.533243+00:00';
    // keel before PR 117, or a type with no public fields: every field but the kept keys unset.
    await store.applyServerRecord('character', { id: ANA, type: 'character', name: 'Ana', description: 'Sells mules.', reputation: '', height: null, created_at: at, updated_at: at, known_of: true }, at);
    api.patchData(await store.listElements());
    return api.getState().active.worldId as string;
  }, { ANA });
  await page.evaluate(([w, id]) => { location.hash = `#/w/${w}/element/${id}`; }, [worldId, ANA]);
  const body = page.locator(`.atlas-middle-body[data-element-id="${ANA}"]`);
  await expect(body.locator('[data-role="known-of"]')).toBeVisible();
  await expect(body.locator('[data-field]')).toHaveCount(0);
});
