/**
 * Doors a mouse alone could open, reached by the keyboard (the mouse-only
 * census, rows 5 to 18): Home's world name and description, the pane
 * dividers, a share page block's editor, a suggestion row's actions; the link
 * chips, a zone and its kind in the map's zone panel, a card of the scroll
 * view, the picture beside an element's name, a field section's fold and the
 * Maps tree's fold. Each is a control a keyboard reaches, its press is Enter
 * or Space (or the arrows for a divider), and focus comes back where the
 * person was, or lands on the page the press opened.
 */
import { test, expect, Page } from '@playwright/test';

// A 1x1 PNG, for a picture the page can draw without a network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

async function openElement(page: Page, id: string): Promise<void> {
  await page.evaluate((elementId) => {
    const worldId = (window as any).__atlasTestApi.getState().active.worldId;
    window.location.hash = `#/w/${worldId}/element/${elementId}`;
  }, id);
  await expect(page.locator(`.atlas-middle-body[data-element-id="${id}"]`)).toBeVisible();
}

/** A map made through its dialog, open in its tab; its id. */
async function newMap(page: Page, name: string): Promise<string> {
  await page.click('[data-action="new-map"]');
  await page.fill('input[name="map-name"]', name);
  await page.click('[data-modal="create-map"] [data-action="submit"]');
  await expect(page.locator('.atlas-tab.active', { hasText: name })).toBeVisible();
  return page.evaluate((n) => (window as any).__atlasTestApi.getState().data.elements.find((e: any) => e.type === 'map' && e.name === n).id, name);
}

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
    await expect(name).toHaveAccessibleDescription('Rename it here only; the online name is in Settings.');
    // One sentence for both: the mouse's tooltip says what the keyboard's description says.
    await expect(page.locator('h1[data-edit="name"]')).toHaveAttribute('title', 'Rename it here only; the online name is in Settings.');
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

  test(`an element's fields keep the keyboard's place: inline saves and Escape, link removes, a key past a selection${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-fields');
    const annId = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const a = await store.createElement('character', { name: 'Bram' });
      const b = await store.createElement('character', { name: 'Cora' });
      const ann = await store.createElement('character', { name: 'Ann', description: 'Salt', friends: [a.id, b.id] });
      api.patchData(await store.listElements());
      return ann.id;
    });
    await page.evaluate((id) => {
      const worldId = (window as any).__atlasTestApi.getState().active.worldId;
      window.location.hash = `#/w/${worldId}/element/${id}`;
    }, annId);
    const desc = page.locator('[data-field="description"] .atlas-field-value[role="button"]');
    await expect(desc).toHaveText('Salt');

    // A selection inside the value, then Enter: the editor opens (the popover, the default mode).
    await desc.focus();
    await desc.evaluate((v) => { const r = document.createRange(); r.selectNodeContents(v); const s = getSelection()!; s.removeAllRanges(); s.addRange(r); });
    await page.keyboard.press('Enter');
    await expect(page.locator('.atlas-edit-popover')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(desc).toBeFocused();

    // Two link removes in a row from the keyboard: focus stays in the field.
    const removes = page.locator('[data-field="friends"] .atlas-link-chip-remove');
    await expect(removes).toHaveCount(2);
    await removes.first().focus();
    await page.keyboard.press('Enter');
    await expect(removes).toHaveCount(1);
    await expect(removes.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(removes).toHaveCount(0);
    await expect(page.locator('[data-field="friends"] .atlas-link-pick')).toBeFocused();

    // The inline mode: a save and an Escape both give focus back to the value.
    await page.evaluate(() => {
      const api = (window as any).__atlasTestApi;
      const reg = api.getState().registry;
      api.patchSlice('registry', { ...reg, editor_settings: { ...(reg.editor_settings ?? {}), field_edit_mode: 'inline-single' } });
    });
    await desc.focus();
    await page.keyboard.press('Enter');
    const input = page.locator('[data-field="description"] .atlas-field-inline-input');
    await expect(input).toBeFocused();
    await input.fill('Salt and pepper');
    await page.keyboard.press('Enter');
    await expect(desc).toHaveText('Salt and pepper');
    await expect(desc).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(input).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(input).toHaveCount(0);
    await expect(desc).toBeFocused();
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

  // Census row 11.
  test(`a link chip's name opens the element it names, from a link field and from Referenced by, and focus lands on that page's name${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-chips');
    const ids = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const bram = await store.createElement('character', { name: 'Bram' });
      const ann = await store.createElement('character', { name: 'Ann', friends: [bram.id] });
      api.patchData(await store.listElements());
      return { bram: bram.id as string, ann: ann.id as string };
    });
    await openElement(page, ids.ann);
    const heading = page.locator('.atlas-middle [data-role="element-name"]');
    const link = page.locator('[data-field="friends"] .atlas-link-chip [role="link"]');
    await expect(link).toHaveAccessibleName('Bram');
    // The chip's remove is its own stop, after the name.
    await link.focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('[data-field="friends"] .atlas-link-chip-remove')).toBeFocused();
    // Enter, held: the first keydown opens Bram's page, focus lands on his name,
    // and the key's repeats there rename nothing.
    await link.focus();
    await page.keyboard.down('Enter');
    await expect(page.locator(`.atlas-middle-body[data-element-id="${ids.bram}"]`)).toBeVisible();
    await expect(heading).toHaveText('Bram');
    await expect(heading).toBeFocused();
    await page.keyboard.down('Enter');
    await page.keyboard.down('Enter');
    await page.keyboard.up('Enter');
    await expect(heading.locator('input')).toHaveCount(0);
    await expect(heading).toBeFocused();

    // Bram's page: Ann refers to him; Space on her chip opens her page.
    const ref = page.locator('.atlas-detail-refs .atlas-link-chip [role="link"]', { hasText: 'Ann' });
    await expect(ref).toHaveAccessibleName('Ann');
    await ref.focus();
    await page.keyboard.press(' ');
    await expect(page.locator(`.atlas-middle-body[data-element-id="${ids.ann}"]`)).toBeVisible();
    await expect(heading).toHaveText('Ann');
    await expect(heading).toBeFocused();
  });

  // Census rows 12 and 13.
  test(`the zone panel's kinds fold and its zones open from the keyboard, and focus stays on what was pressed${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-zones');
    const mapId = await newMap(page, 'Keyed Canvas');
    const zoneId = await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const ids: string[] = [];
      for (const [name, supertype, x] of [['the north march', 'Border', 100], ['the deep', 'Sea', 900]] as const) {
        const zone = await store.createZone({ name, supertype });
        let order = 1;
        for (const [px, py] of [[x, 100], [x + 300, 100], [x + 300, 400], [x, 400]]) await store.createMarker({ map_id: map, zone_id: zone.id, x: px, y: py, order: order++ });
        ids.push(zone.id);
      }
      api.patchData(await store.listElements());
      return ids[0];
    }, mapId);
    await page.click('[data-action="zones-dropdown"]');
    const panel = page.locator('[data-role="zones-dropdown-panel"]');
    const kind = panel.locator('.atlas-zone-kind', { hasText: 'Border' });
    const fold = kind.locator('button.atlas-zone-kind-caret');
    // Two kinds start closed; the fold names its list, aria-expanded its state, the tooltip what a press does.
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toHaveAccessibleName('The list of one Border zone');
    await expect(fold).toHaveAttribute('title', 'Show the list of one Border zone');
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(fold).toHaveAccessibleName('The list of one Border zone');
    await expect(fold).toHaveAttribute('title', 'Hide the list of one Border zone');
    await expect(fold).toBeFocused();

    // The zone's name: Enter selects it and opens its page; focus stays on it.
    const zone = kind.locator('.atlas-zone-chip-name');
    await expect(zone).toHaveAccessibleName('the north march');
    await zone.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`.atlas-middle-body[data-element-id="${zoneId}"]`)).toBeVisible();
    await expect(kind.locator('.atlas-zone-chip')).toHaveClass(/is-selected/);
    await expect(zone).toHaveAttribute('aria-current', 'true');
    await expect(zone).toBeFocused();

    // Space folds the kind again.
    await fold.focus();
    await page.keyboard.press(' ');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toBeFocused();
  });

  // Census row 15: the on-map badge needs no stop of its own (see the build report).
  test(`an element on the open map is located from the keyboard: its row opens its page, whose pin button opens the map at it${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-locate');
    const mapId = await newMap(page, 'Keyed Canvas');
    const ireena = await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const c = await store.createElement('character', { name: 'Ireena' });
      await store.createElement('pin', { name: 'Ireena', map_id: map, element_id: c.id, element_type: 'character', x: 200, y: 200 });
      api.patchData(await store.listElements());
      return c.id as string;
    }, mapId);
    const row = page.locator(`.atlas-list [data-element-id="${ireena}"]`);
    await expect(row.locator('.atlas-elements-row-onmap-badge')).toHaveCount(1);
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`.atlas-middle-body[data-element-id="${ireena}"]`)).toBeVisible();
    const pinBtn = page.locator('.atlas-middle-header [data-action="goto-pin"]');
    await expect(pinBtn).toHaveJSProperty('tagName', 'BUTTON');
    await pinBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.atlas-tab.active', { hasText: 'Keyed Canvas' })).toBeVisible();
  });

  // Census row 16.
  test(`the picture beside an element's name shows the images again from the keyboard, and the hide button sends focus back to it${tag}`, async ({ page }) => {
    await page.route('https://media.onlyworlds.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await freshWorld(page, 'keys-picture');
    const id = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const c = await store.createElement('character', { name: 'Ireena', image_url: 'https://media.onlyworlds.com/u/keys/ireena.png' });
      api.patchData(await store.listElements());
      const reg = api.getState().registry;
      api.patchSlice('registry', { ...reg, editor_settings: { ...(reg.editor_settings ?? {}), show_element_images: false } });
      return c.id as string;
    });
    await openElement(page, id);
    const show = page.locator('.atlas-middle-header button.atlas-header-icon-thumb-btn');
    await expect(show).toHaveAccessibleName('Show element images');
    await expect(show.locator('img')).toBeVisible();
    await show.focus();
    await page.keyboard.press('Enter');
    const hide = page.locator('.atlas-element-image-hide');
    await expect(hide).toBeFocused();
    await expect(show).toHaveCount(0);
    await page.keyboard.press(' ');
    await expect(hide).toHaveCount(0);
    await expect(show).toBeFocused();
    // The note after hiding names the way back in the button's own words.
    await expect(page.locator('.ow-toast', { hasText: 'Element images hidden' })).toContainText('press Show element images beside the name');
    await expect(page.locator('.ow-toast', { hasText: 'Element images hidden' })).toContainText('or tick it in Settings → Elements');
    // The setting it points to is there by those words, said plainly, and now off.
    await page.evaluate(() => {
      const api = (window as any).__atlasTestApi;
      window.location.hash = `#/w/${api.getState().active.worldId}/settings/elements`;
    });
    const setting = page.getByRole('checkbox', { name: 'Show element images, on an element\'s page and in the web pane', exact: true });
    await expect(setting).toBeVisible();
    await expect(setting).not.toBeChecked();
  });

  // Census row 17.
  test(`a field section folds from the keyboard and keeps focus through the redraw${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-sections');
    const id = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const c = await api.getActiveStore().createElement('character', { name: 'Ireena', description: 'Salt' });
      api.patchData(await api.getActiveStore().listElements());
      return c.id as string;
    });
    await openElement(page, id);
    const section = page.locator('.atlas-detail-section', { has: page.locator('[data-field="description"]') });
    const name = await section.getAttribute('data-section');
    const fold = page.locator(`.atlas-detail-section[data-section="${name}"] > .atlas-detail-section-header`);
    await expect(fold).toHaveAttribute('role', 'button');
    await expect(fold).toHaveAccessibleName(name!);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('[data-field="description"]')).toHaveCount(0);
    await expect(fold).toBeFocused();
    // Space presses on its release: the page holds its redraw until then, and focus still comes back.
    await page.keyboard.press(' ');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('[data-field="description"]')).toHaveCount(1);
    await expect(fold).toBeFocused();
  });

  // Census row 18.
  test(`the Maps tree's fold is a stop of its own, named for the maps it holds, and keeps focus through the redraw${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-maptree');
    const { parent, child } = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const p = await store.createElement('map', { name: 'Realm' });
      const c = await store.createElement('map', { name: 'Province', parent_map: p.id });
      api.patchData(await store.listElements());
      const ui = api.getState().ui;
      api.patchSlice('ui', { ...ui, rightActiveIndex: ui.rightTabs.findIndex((t: any) => t.kind === 'map-index') });
      return { parent: p.id as string, child: c.id as string };
    });
    const childRow = page.locator(`.atlas-map-tree-row[data-map-id="${child}"]`);
    await expect(childRow).toBeVisible();
    const fold = page.locator(`.atlas-map-tree-row[data-map-id="${parent}"] .atlas-map-tree-chevron`);
    const name = page.locator(`.atlas-map-tree-row[data-map-id="${parent}"] .atlas-map-tree-name`);
    await expect(fold).toHaveAccessibleName('The map under Realm');
    await expect(fold).toHaveAttribute('title', 'Hide the map under Realm');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    // The fold and the name are stops side by side: Tab from the fold reaches the name, Shift+Tab goes back.
    await fold.focus();
    await page.keyboard.press('Tab');
    await expect(name).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(fold).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(childRow).toHaveCount(0);
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toHaveAccessibleName('The map under Realm');
    await expect(fold).toHaveAttribute('title', 'Show the map under Realm');
    await expect(fold).toBeFocused();
    await page.keyboard.press(' ');
    await expect(childRow).toBeVisible();
    await expect(fold).toBeFocused();
    // Enter on the name opens the map, as a click on the row does.
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.atlas-tab.active', { hasText: 'Realm' })).toBeVisible();
  });

  // The 1.124.24 gate: a held key presses once, a mouse click moves no focus, a
  // person's own click is never undone, a reselected zone shows, Escape keeps the keyboard's place.
  test(`a held Enter presses the picture and the zone fold once, not once per repeat${tag}`, async ({ page }) => {
    await page.route('https://media.onlyworlds.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await freshWorld(page, 'keys-held');
    const id = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const c = await store.createElement('character', { name: 'Ireena', image_url: 'https://media.onlyworlds.com/u/keys/ireena.png' });
      api.patchData(await store.listElements());
      const reg = api.getState().registry;
      api.patchSlice('registry', { ...reg, editor_settings: { ...(reg.editor_settings ?? {}), show_element_images: false } });
      return c.id as string;
    });
    await openElement(page, id);
    const imagesOn = () => page.evaluate(() => (window as any).__atlasTestApi.getState().registry.editor_settings?.show_element_images);
    const show = page.locator('.atlas-middle-header button.atlas-header-icon-thumb-btn');
    await expect(show.locator('img')).toBeVisible();
    await show.focus();
    await page.keyboard.down('Enter');
    await expect(page.locator('.atlas-element-image-hide')).toBeFocused();
    // Three repeats: an odd count, so a toggle that flips per repeat ends the other way.
    for (let i = 0; i < 3; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(150); }
    await page.keyboard.up('Enter');
    expect(await imagesOn()).toBe(true);
    await expect(page.locator('.atlas-element-image-hide')).toBeFocused();

    // The zone kind's fold, held.
    const mapId = await newMap(page, 'Held Canvas');
    await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      for (const [name, supertype, x] of [['the north march', 'Border', 100], ['the deep', 'Sea', 900]] as const) {
        const zone = await store.createZone({ name, supertype });
        let order = 1;
        for (const [px, py] of [[x, 100], [x + 300, 100], [x + 300, 400], [x, 400]]) await store.createMarker({ map_id: map, zone_id: zone.id, x: px, y: py, order: order++ });
      }
      api.patchData(await store.listElements());
    }, mapId);
    await page.click('[data-action="zones-dropdown"]');
    const fold = page.locator('[data-role="zones-dropdown-panel"] .atlas-zone-kind', { hasText: 'Border' }).locator('button.atlas-zone-kind-caret');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await fold.focus();
    await page.keyboard.down('Enter');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    // Three repeats: an odd count, so a toggle that flips per repeat ends the other way.
    for (let i = 0; i < 3; i++) { await page.keyboard.down('Enter'); await page.waitForTimeout(150); }
    await page.keyboard.up('Enter');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
  });

  test(`a mouse click on the picture, a zone's name or the Maps fold leaves no focus behind, so their hover-only controls stay hidden${tag}`, async ({ page }) => {
    await page.route('https://media.onlyworlds.com/**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
    await freshWorld(page, 'keys-mouse');
    const opacity = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).opacity);
    const id = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const c = await store.createElement('character', { name: 'Ireena', image_url: 'https://media.onlyworlds.com/u/keys/ireena.png' });
      api.patchData(await store.listElements());
      const reg = api.getState().registry;
      api.patchSlice('registry', { ...reg, editor_settings: { ...(reg.editor_settings ?? {}), show_element_images: false } });
      return c.id as string;
    });
    await openElement(page, id);
    await page.locator('.atlas-middle-header button.atlas-header-icon-thumb-btn').click();
    const hide = page.locator('.atlas-element-image-hide');
    await expect(hide).toHaveCount(1);
    await page.mouse.move(2, 2);
    await expect(hide).not.toBeFocused();
    await expect.poll(() => opacity('.atlas-element-image-hide')).toBe('0');

    // A zone's name, by mouse: selected, its trash hidden once the mouse leaves.
    const mapId = await newMap(page, 'Mouse Canvas');
    await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const zone = await store.createZone({ name: 'the north march', supertype: 'Border' });
      let order = 1;
      for (const [px, py] of [[100, 100], [400, 100], [400, 400], [100, 400]]) await store.createMarker({ map_id: map, zone_id: zone.id, x: px, y: py, order: order++ });
      const child = await store.createElement('map', { name: 'Province', parent_map: map });
      void child;
      api.patchData(await store.listElements());
    }, mapId);
    await page.click('[data-action="zones-dropdown"]');
    const panel = page.locator('[data-role="zones-dropdown-panel"]');
    await panel.locator('.atlas-zone-chip-name').click();
    await expect(panel.locator('.atlas-zone-chip')).toHaveClass(/is-selected/);
    await page.mouse.move(2, 2);
    await expect(panel.locator('.atlas-zone-chip-name')).not.toBeFocused();
    await expect.poll(() => opacity('[data-role="zones-dropdown-panel"] .atlas-zone-chip-x')).toBe('0');
    await page.keyboard.press('Escape');

    // The Maps fold, by mouse: the map's delete is not left showing.
    await page.evaluate(() => {
      const api = (window as any).__atlasTestApi;
      const ui = api.getState().ui;
      api.patchSlice('ui', { ...ui, rightActiveIndex: ui.rightTabs.findIndex((t: any) => t.kind === 'map-index') });
    });
    const row = page.locator(`.atlas-map-tree-row[data-map-id="${mapId}"]`);
    await row.locator('.atlas-map-tree-chevron').click();
    await expect(row.locator('.atlas-map-tree-chevron')).toHaveAttribute('aria-expanded', 'false');
    await page.mouse.move(2, 2);
    await expect(row.locator('.atlas-map-tree-chevron')).not.toBeFocused();
    await expect.poll(() => opacity(`.atlas-map-tree-row[data-map-id="${mapId}"] .atlas-inline-actions`)).toBe('0');
  });

  test(`a click on plain text just after a chip opened a page keeps focus where the click left it${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-arrival-click');
    const ids = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const bram = await store.createElement('character', { name: 'Bram' });
      const ann = await store.createElement('character', { name: 'Ann', friends: [bram.id] });
      api.patchData(await store.listElements());
      return { bram: bram.id as string, ann: ann.id as string };
    });
    await openElement(page, ids.ann);
    await page.locator('[data-field="friends"] .atlas-link-chip [role="link"]').focus();
    await page.keyboard.press('Enter');
    const heading = page.locator('.atlas-middle [data-role="element-name"]');
    await expect(heading).toHaveText('Bram');
    await expect(heading).toBeFocused();
    // Within the watch's time: a click on a label (no control) drops focus to the page, and it stays there.
    await page.locator('.atlas-middle .atlas-detail-refs .atlas-field-label').first().click();
    await page.waitForTimeout(400);
    expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true);
  });

  test(`a selected zone's kind opens again on a new selection, and Escape in the zones list goes back to its button${tag}`, async ({ page }) => {
    await freshWorld(page, 'keys-reselect');
    const mapId = await newMap(page, 'Reselect Canvas');
    const { zoneId, charId } = await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const ids: string[] = [];
      for (const [name, supertype, x] of [['the north march', 'Border', 100], ['the deep', 'Sea', 900]] as const) {
        const zone = await store.createZone({ name, supertype });
        let order = 1;
        for (const [px, py] of [[x, 100], [x + 300, 100], [x + 300, 400], [x, 400]]) await store.createMarker({ map_id: map, zone_id: zone.id, x: px, y: py, order: order++ });
        ids.push(zone.id);
      }
      const c = await store.createElement('character', { name: 'Bram' });
      api.patchData(await store.listElements());
      return { zoneId: ids[0], charId: c.id as string };
    }, mapId);
    await page.click('[data-action="zones-dropdown"]');
    const panel = page.locator('[data-role="zones-dropdown-panel"]');
    const fold = panel.locator('.atlas-zone-kind', { hasText: 'Border' }).locator('button.atlas-zone-kind-caret');
    const select = (sel: string | null) => page.evaluate((zid) => {
      const api = (window as any).__atlasTestApi;
      api.patchSlice('ui', { ...api.getState().ui, selectedElementId: zid });
    }, sel);
    await select(zoneId);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    // Folded around the selected zone, it stays folded while the zone stays selected.
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    // Deselect, select the same zone again: its kind opens.
    await select(null);
    await select(zoneId);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    // Fold, another element between, the zone again: opens again.
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await select(charId);
    await select(zoneId);
    await expect(fold).toHaveAttribute('aria-expanded', 'true');

    // Escape on a focused zone name: the list closes, focus is on the Zones button, the page stays.
    const zname = panel.locator('.atlas-zone-chip-name', { hasText: 'the north march' });
    await zname.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`.atlas-middle-body[data-element-id="${zoneId}"]`)).toBeVisible();
    await expect(zname).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).not.toHaveClass(/is-open/);
    await expect(page.locator('[data-action="zones-dropdown"]')).toBeFocused();
    await expect(page.locator(`.atlas-middle-body[data-element-id="${zoneId}"]`)).toBeVisible();
  });

  // The last press's kind (src/ui/input-kind.ts): a click with no pointer behind it keeps focus as a key does, and a
  // held key's repeat landing inside a mouse click does not make the click read as a key.
  test(`a press with no pointer keeps focus, a held key's repeat does not turn a click into a key${tag}`, async ({ page }) => {
    await freshWorld(page, 'kd-input-kind');
    const mapId = await newMap(page, 'Tree Canvas');
    await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      await store.createElement('map', { name: 'Province', parent_map: map });
      api.patchData(await store.listElements());
      const ui = api.getState().ui;
      api.patchSlice('ui', { ...ui, rightActiveIndex: ui.rightTabs.findIndex((t: any) => t.kind === 'map-index') });
    }, mapId);
    const chev = page.locator(`.atlas-map-tree-row[data-map-id="${mapId}"] .atlas-map-tree-chevron`);
    // A screen reader's press after a mouse press: detail 0, no pointerdown, no keydown.
    await page.evaluate(() => document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    await chev.focus();
    await chev.evaluate((el) => (el as HTMLElement).click());
    await page.waitForTimeout(250);
    expect(await chev.evaluate((el) => document.activeElement === el)).toBe(true);
    // A key held across a mouse click: the repeat lands between the press and the release.
    await page.locator('[data-role="elements-search"]').focus();
    const box = (await chev.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down('x');
    await page.mouse.down();
    await page.keyboard.down('x');
    await page.mouse.up();
    await page.keyboard.up('x');
    await page.mouse.move(2, 2);
    await page.waitForTimeout(250);
    expect(await chev.evaluate((el) => document.activeElement === el)).toBe(false);
    expect(await page.locator(`.atlas-map-tree-row[data-map-id="${mapId}"] .atlas-inline-actions`).first().evaluate((el) => getComputedStyle(el).opacity)).toBe('0');
  });

  // The 1.124.25 names: a row holding controls is no control itself, a fold names what it folds (its state
  // aria-expanded's, the verb its tooltip's, 1.124.26), and a button met in a run of its twins says what it acts on.
  test(`the Maps tree names each map once, its name and its fold are side by side, and each delete names its map${tag}`, async ({ page }) => {
    await freshWorld(page, 'kd-names-maps');
    const parent = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const p = await store.createElement('map', { name: 'Sikelia' });
      for (const name of ['Akragas', 'Gela', 'Selinous']) await store.createElement('map', { name, parent_map: p.id });
      api.patchData(await store.listElements());
      const ui = api.getState().ui;
      api.patchSlice('ui', { ...ui, rightActiveIndex: ui.rightTabs.findIndex((t: any) => t.kind === 'map-index') });
      return p.id as string;
    });
    const row = page.locator(`.atlas-map-tree-row[data-map-id="${parent}"]`);
    await expect(row).toBeVisible();
    // The row is a wrapper: no role, no tab stop, no button inside a button.
    expect(await row.getAttribute('role')).toBeNull();
    expect(await row.getAttribute('tabindex')).toBeNull();
    await expect(row.locator(':is(button, [role="button"]) :is(button, [role="button"])')).toHaveCount(0);
    await expect(row.locator('.atlas-map-tree-name')).toHaveRole('button');
    await expect(row.locator('.atlas-map-tree-name')).toHaveAccessibleName('Sikelia');
    const fold = row.locator('.atlas-map-tree-chevron');
    await expect(fold).toHaveRole('button');
    // The fold's name says which maps, aria-expanded their state; only its tooltip says what a press does.
    await expect(fold).toHaveAccessibleName('The 3 maps under Sikelia');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(fold).toHaveAttribute('title', 'Hide the 3 maps under Sikelia');
    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toHaveAccessibleName('The 3 maps under Sikelia');
    await expect(fold).toHaveAttribute('title', 'Show the 3 maps under Sikelia');
    const del = row.locator('[data-action="delete-map"]');
    await expect(del).toHaveAccessibleName('Delete the map Sikelia');
    await expect(del).toHaveAttribute('title', 'Delete the map Sikelia');

    // A map whose name is only spaces (a foreign file) takes the unnamed form on its fold and its delete.
    const blank = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const p = await store.createElement('map', { name: '   ' });
      await store.createElement('map', { name: 'Hollow', parent_map: p.id });
      api.patchData(await store.listElements());
      return p.id as string;
    });
    const blankRow = page.locator(`.atlas-map-tree-row[data-map-id="${blank}"]`);
    await expect(blankRow.locator('.atlas-map-tree-chevron')).toHaveAccessibleName('The map under the unnamed map');
    await expect(blankRow.locator('.atlas-map-tree-chevron')).toHaveAttribute('title', 'Hide the map under the unnamed map');
    await expect(blankRow.locator('[data-action="delete-map"]')).toHaveAccessibleName('Delete the unnamed map');
    await expect(blankRow.locator('[data-action="delete-map"]')).toHaveAttribute('title', 'Delete the unnamed map');

    // A search holds the tree open: the fold says so, is disabled, and a press neither folds nor writes the stored fold.
    const stored = () => page.evaluate(() => localStorage.getItem('atlas_map_tree_collapsed_v1'));
    const before = await stored();
    await page.locator('input[data-role="map-search"]').fill('a');
    // The name stays the plain list; why a press does nothing is the tooltip's.
    await expect(fold).toHaveAccessibleName('The 2 maps under Sikelia');
    await expect(fold).toHaveAttribute('title', 'The search shows the 2 maps under Sikelia');
    await expect(fold).toHaveAttribute('aria-disabled', 'true');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    // One press at a time (two would flip a stored fold and back): a key, then a mouse press.
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('.atlas-map-tree-row', { hasText: 'Akragas' })).toBeVisible();
    await page.waitForTimeout(200);
    expect(await stored()).toBe(before);
    await fold.click({ force: true }); // aria-disabled stops Playwright's plain click, never a person's
    await page.waitForTimeout(200);
    expect(await stored()).toBe(before);
    await page.locator('input[data-role="map-search"]').fill('');
    // Out of the search, the fold is as it was left: closed.
    await expect(fold).toHaveAccessibleName('The 3 maps under Sikelia');
    await expect(fold).toHaveAttribute('title', 'Show the 3 maps under Sikelia');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(await fold.getAttribute('aria-disabled')).toBeNull();

    // A mouse click on the name opens the map, as a click on the row always did.
    await row.locator('.atlas-map-tree-name').click();
    await expect(page.locator('.atlas-tab.active', { hasText: 'Sikelia' })).toBeVisible();
  });

  test(`a map's location chip is named by what it opens, its glyph hidden${tag}`, async ({ page }) => {
    await freshWorld(page, 'kd-names-loc');
    const ids = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      const loc = await store.createElement('location', { name: 'Syracuse' });
      const blank = await store.createElement('location', { name: '' });
      const harbour = await store.createElement('map', { name: 'Harbour', location: loc.id });
      const quay = await store.createElement('map', { name: 'Quay', location: blank.id });
      api.patchData(await store.listElements());
      const ui = api.getState().ui;
      api.patchSlice('ui', { ...ui, rightActiveIndex: ui.rightTabs.findIndex((t: any) => t.kind === 'map-index') });
      return { loc: loc.id as string, harbour: harbour.id as string, quay: quay.id as string };
    });
    const chip = page.locator(`.atlas-map-tree-row[data-map-id="${ids.harbour}"] .atlas-row-chip-location`);
    await expect(chip).toHaveRole('button');
    await expect(chip).toHaveAccessibleName('Open Syracuse');
    await expect(chip).toHaveAttribute('title', 'Open Syracuse');
    await expect(chip.locator('.material-symbols-outlined')).toHaveAttribute('aria-hidden', 'true');
    // A place with no name, in the one form every control says it.
    const blankChip = page.locator(`.atlas-map-tree-row[data-map-id="${ids.quay}"] .atlas-row-chip-location`);
    await expect(blankChip).toHaveAccessibleName('Open the unnamed location');
    await expect(blankChip).toHaveAttribute('title', 'Open the unnamed location');
    // What the name says is what a press does: Enter opens the place's page.
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator(`.atlas-middle-body[data-element-id="${ids.loc}"]`)).toBeVisible();
  });

  test(`a zone kind's fold says what it shows or hides, and each zone's delete names its zone${tag}`, async ({ page }) => {
    await freshWorld(page, 'kd-names-zones');
    const mapId = await newMap(page, 'Named Canvas');
    await page.evaluate(async (map) => {
      const api = (window as any).__atlasTestApi;
      const store = api.getActiveStore();
      for (const [name, supertype, x] of [['the north march', 'Border', 100], ['the south march', 'Border', 500], ['', 'Sea', 900], ['the open ground', '', 1300]] as const) {
        const zone = await store.createZone({ name, supertype });
        let order = 1;
        for (const [px, py] of [[x, 100], [x + 300, 100], [x + 300, 400], [x, 400]]) await store.createMarker({ map_id: map, zone_id: zone.id, x: px, y: py, order: order++ });
      }
      api.patchData(await store.listElements());
    }, mapId);
    await page.click('[data-action="zones-dropdown"]');
    const panel = page.locator('[data-role="zones-dropdown-panel"]');
    const border = panel.locator('.atlas-zone-kind', { hasText: 'Border' });
    const fold = border.locator('button.atlas-zone-kind-caret');
    // The fold names the list; the eye beside it is the one that hides zones on the map.
    // Its name says which list, aria-expanded its state; only its tooltip says what a press does.
    await expect(fold).toHaveAccessibleName('The list of the 2 Border zones');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toHaveAttribute('title', 'Show the list of the 2 Border zones');
    // A kind-less zone's fold, in the app's own word.
    const kindless = panel.locator('.atlas-zone-kind', { hasText: '(no kind)' }).locator('button.atlas-zone-kind-caret');
    await expect(kindless).toHaveAccessibleName('The list of one zone with no kind');
    await expect(kindless).toHaveAttribute('title', 'Show the list of one zone with no kind');

    // A search holds the kind open: the fold says so, is disabled, and a press does not change what clearing brings back.
    const search = panel.locator('input[data-role="zone-search"]');
    await search.fill('march');
    // The name stays the plain list; why a press does nothing is the tooltip's.
    await expect(fold).toHaveAccessibleName('The list of the 2 Border zones');
    await expect(fold).toHaveAttribute('title', 'The search shows the list of the 2 Border zones');
    await expect(fold).toHaveAttribute('aria-disabled', 'true');
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    // One press at a time (two would flip the kind and back), each checked by clearing the search.
    await fold.focus();
    await page.keyboard.press('Enter');
    await expect(border.locator('.atlas-zone-chip', { hasText: 'the north march' })).toBeVisible();
    await search.fill('');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');
    await expect(fold).toHaveAccessibleName('The list of the 2 Border zones');
    await expect(fold).toHaveAttribute('title', 'Show the list of the 2 Border zones');
    expect(await fold.getAttribute('aria-disabled')).toBeNull();
    await search.fill('march');
    await expect(fold).toHaveAttribute('aria-disabled', 'true');
    await fold.click({ force: true }); // aria-disabled stops Playwright's plain click, never a person's
    await search.fill('');
    await expect(fold).toHaveAttribute('aria-expanded', 'false');

    await fold.click();
    await expect(fold).toHaveAttribute('aria-expanded', 'true');
    await expect(fold).toHaveAccessibleName('The list of the 2 Border zones');
    await expect(fold).toHaveAttribute('title', 'Hide the list of the 2 Border zones');
    const north = border.locator('.atlas-zone-chip', { hasText: 'the north march' });
    await expect(north.locator('[data-action="delete"]')).toHaveAccessibleName('Delete the zone the north march');
    await expect(north.locator('[data-action="delete"]')).toHaveAttribute('title', 'Delete the zone the north march');
    // A zone with no name: its delete says so, never a bare "Delete".
    const sea = panel.locator('.atlas-zone-kind', { hasText: 'Sea' });
    await sea.locator('button.atlas-zone-kind-caret').click();
    await expect(sea.locator('[data-action="delete"]')).toHaveAccessibleName('Delete the unnamed zone');
    await expect(sea.locator('[data-action="delete"]')).toHaveAttribute('title', 'Delete the unnamed zone');
  });

  test(`a field's remove names the field it removes${tag}`, async ({ page }) => {
    await freshWorld(page, 'kd-names-fields');
    const id = await page.evaluate(async () => {
      const api = (window as any).__atlasTestApi;
      const c = await api.getActiveStore().createElement('character', { name: 'Ireena', x_mood: 'calm' });
      api.patchData(await api.getActiveStore().listElements());
      return c.id as string;
    });
    await openElement(page, id);
    const rm = page.locator('[data-field="x_mood"] .atlas-field-remove');
    await expect(rm).toHaveAccessibleName('Remove the field Mood');
    await expect(rm).toHaveAttribute('title', 'Remove the field Mood');
  });
}
