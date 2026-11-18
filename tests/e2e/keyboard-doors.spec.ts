/**
 * Doors a mouse alone could open, reached by the keyboard (the mouse-only
 * census, rows 5 to 10): Home's world name and description, the pane
 * dividers, a share page block's editor, and a suggestion row's actions.
 * Each is a control a keyboard reaches, its press is Enter or Space (or the
 * arrows for a divider), and focus comes back where the person was.
 */
import { test, expect, Page } from '@playwright/test';

async function freshWorld(page: Page, dir: string): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
  await page.evaluate(async (name) => {
    const root = await navigator.storage.getDirectory();
    (window as any).__atlasTestApi.setNextDirectory(await root.getDirectoryHandle(name, { create: true }));
  }, dir);
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Keyed World');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
}

for (const tag of ['', ' @firefox']) {
  test(`Home's world name and description open their editor from the keyboard, and focus comes back${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-home');
    const name = page.locator('[data-edit="name"] [role="button"]');
    await expect(name).toBeVisible();
    // The heading keeps its role; the name inside it is the button.
    await expect(page.locator('h1[data-edit="name"]')).toHaveCount(1);
    // The heading reads the name alone; where the rename applies is its description.
    await expect(name).toHaveAccessibleName('Keyed World');
    await expect(page.locator('h1[data-edit="name"]')).toHaveAccessibleName('Keyed World');
    await expect(name).toHaveAccessibleDescription('Press to rename it here only; the online name is in Settings.');
    await name.focus();
    await page.keyboard.press('Enter');
    const input = page.locator('.atlas-edit-popover input, .atlas-edit-popover textarea').first();
    await expect(input).toBeFocused();
    // The opening Enter saved nothing: the value is the old one, still open.
    await expect(input).toHaveValue('Keyed World');
    await input.fill('Rekeyed World');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-edit="name"]')).toContainText('Rekeyed World');
    await expect(page.locator('[data-edit="name"] [role="button"]')).toBeFocused();

    // The description's prompt: a button, Space opens it, Escape gives focus back.
    const desc = page.locator('[data-edit="description"]').first();
    await expect(desc).toHaveAttribute('role', 'button');
    await desc.focus();
    await page.keyboard.press(' ');
    await expect(page.locator('.atlas-edit-popover textarea, .atlas-edit-popover input').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.locator('.atlas-edit-popover')).toHaveCount(0);
    await expect(desc).toBeFocused();
  });

  test(`the pane dividers move with the arrow keys and say where they stand${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-dividers');
    const divider = page.locator('.atlas-divider').first();
    await expect(divider).toHaveAttribute('role', 'separator');
    await expect(divider).toHaveAccessibleName('Resize the sidebar');
    const before = Number(await divider.getAttribute('aria-valuenow'));
    const widthBefore = await page.locator('.atlas-sidebar').evaluate(n => n.getBoundingClientRect().width);
    await divider.focus();
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => page.locator('.atlas-sidebar').evaluate(n => n.getBoundingClientRect().width)).toBeGreaterThan(widthBefore + 40);
    expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(before);
    await expect(divider).toBeFocused();
    await page.keyboard.press('Shift+ArrowLeft');
    await expect.poll(() => page.locator('.atlas-sidebar').evaluate(n => n.getBoundingClientRect().width)).toBeLessThan(widthBefore + 40);
  });

  test(`a share block's editor opens from its Edit button${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-share');
    await page.click('.atlas-room-nav-btn[data-room="share"]');
    await page.click('button.atlas-share-new');
    await page.click('.atlas-share-block-add-btn:has-text("heading")');
    await page.fill('input.atlas-share-heading-input', 'The Domain');
    await page.keyboard.press('Enter');
    await expect(page.locator('h2.atlas-share-block-heading')).toHaveText('The Domain');
    const edit = page.locator('.atlas-share-block[data-block-kind="heading"] .atlas-share-block-ctrl[title="Edit block"]');
    await expect(edit).toHaveAccessibleName('Edit block');
    await edit.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('input.atlas-share-heading-input')).toBeFocused();
  });

  test(`a collection block's Edit lands on Done, never on a member's remove${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-collection');
    await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElement('character', { name: 'Ireena' });
      api.patchData(await store.listElements());
    });
    await page.click('.atlas-room-nav-btn[data-room="share"]');
    await page.click('button.atlas-share-new');
    await page.click('.atlas-share-block-add-btn:has-text("collection")');
    await page.locator('.atlas-picker-row', { hasText: 'Ireena' }).click();
    const block = page.locator('.atlas-share-block[data-block-kind="collection"]');
    await block.locator('.atlas-share-block-done').click();
    await block.locator('.atlas-share-block-ctrl[title="Edit block"]').focus();
    await page.keyboard.press('Enter');
    await expect(block.locator('.atlas-share-block-done')).toBeFocused();
    await expect(block).toContainText('Ireena');
  });

  test(`a suggestion's Link is a button a keyboard reaches, and focus stays in the list after it${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-link');
    const scene = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElement('character', { name: 'Ireena' });
      await store.createElement('location', { name: 'Barovia' });
      const s = await store.createElement('narrative', { name: 'Arrival', supertype: 'Book', story: 'Ireena left Barovia at dawn.' });
      api.patchData(await store.listElements());
      return s.id;
    });
    await page.evaluate((id) => {
      const worldId = (window as any).__atlasTestApi.getState().active.worldId;
      window.location.hash = `#/w/${worldId}/writing/${id}`;
    }, scene);
    await page.waitForSelector('.atlas-writing-workspace');
    await page.click('.atlas-tab[data-tab-kind="context"]');
    const named = page.locator('.atlas-context-pane-list-suggested [data-named]');
    await expect(named).toHaveCount(2);
    const link = named.first().locator('[data-action="link-named"]');
    await expect(link).toHaveJSProperty('tagName', 'BUTTON');
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(named).toHaveCount(1);
    await expect(named.first().locator('.atlas-context-pane-row')).toBeFocused();
  });
}
