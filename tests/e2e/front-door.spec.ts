/**
 * THE FRONT DOOR (S365): a world folder opens on the very first visit.
 *
 * The OnlyWorlds toolkit tells people "open Atlas and pick the world folder
 * your AI made". Before S365 a first-visit pick of a world folder answered
 * with a hint naming a sidebar button that was not on screen yet. Now a world
 * folder opens in place from the landing, with no home folder; the home
 * folder is asked for when the user first makes a NEW world.
 */

import { test, expect, type Page } from '@playwright/test';

const WORLD_ID = '00000000-0000-4000-8000-00000000f00d';

async function freshBoot(page: Page): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.waitForSelector('.atlas-shell');
}

/** A world folder as another tool writes it (world.json + one element), handed to the next picker. */
async function seedWorldFolderForPicker(page: Page, dirName: string): Promise<void> {
  await page.evaluate(async ({ dirName, worldId }) => {
    const api = (window as any).__atlasTestApi;
    const opfs = await navigator.storage.getDirectory();
    try { await opfs.removeEntry(dirName, { recursive: true }); } catch { /* fresh */ }
    const dir = await opfs.getDirectoryHandle(dirName, { create: true });
    const put = async (d: FileSystemDirectoryHandle, name: string, body: unknown) => {
      const w = await (await d.getFileHandle(name, { create: true })).createWritable();
      await w.write(JSON.stringify(body, null, 2) + '\n');
      await w.close();
    };
    await put(dir, 'world.json', { id: worldId, name: 'Agent World' });
    const chars = await (await dir.getDirectoryHandle('elements', { create: true }))
      .getDirectoryHandle('character', { create: true });
    await put(chars, 'gil.json', { id: '00000000-0000-4000-8000-0000000000a1', name: 'Gil the Agent' });
    api.setNextDirectory(dir);
  }, { dirName, worldId: WORLD_ID });
}

test('first visit: "open a world folder" opens the world in place, no home folder asked', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world');
  await page.click('[data-action="open-world-folder"]');

  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await expect(page.getByText('Gil the Agent').first()).toBeVisible();
  const root = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot);
  expect(root).toBeNull();
});

test('first visit: two doors, start a world and Moppetopia, then the tour, a world folder and other ways in', async ({ page }) => {
  // 1.17 (contract §8, lens C R2-c): "set up a folder" became "start a world",
  // whose dialog asks where; "other ways in" is the chooser.
  await freshBoot(page);
  const doors = page.locator('.atlas-landing-actions .atlas-landing-btn');
  // #127 (the Captain's Q4): two doors; the rest is one quiet line of links,
  // the tour one click from the first screen (his Q5).
  await expect(doors).toHaveText(['start a world', 'explore Moppetopia']);
  await expect(page.locator('.atlas-landing-more-link')).toHaveText(['take the tour', 'open a world folder', 'other ways in']);
  await expect(page.locator('.atlas-landing-note')).toBeHidden();

  await page.click('[data-action="other-ways-in"]');
  const chooser = page.locator('[data-modal="add-world"]');
  await expect(chooser.locator('[data-choice]')).toHaveCount(7);
  await expect(chooser.locator('[data-choice="open-file"]')).toBeVisible();
  await expect(chooser.locator('[data-choice="try-demo"] strong')).toHaveText('Explore Moppetopia');
});

test('first visit, browser storage refused on Chromium: no tour, and the doors left say only what works (S374 gate F6)', async ({ page }) => {
  await page.addInitScript(() => {
    const storage = navigator.storage as any;
    storage.getDirectory = async () => { throw Object.assign(new Error('refused'), { name: 'SecurityError' }); };
  });
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.atlas-landing-note')).toContainText('does not allow browser storage');
  await expect(page.locator('[data-action="start-tour"]')).toHaveCount(0);
  const notes = page.locator('.atlas-landing-choice-note');
  await expect(notes).toHaveText(['your first world, in a folder on your drive']);
  // The link line keeps the folder doors, without a dangling separator.
  await expect(page.locator('.atlas-landing-more-link')).toHaveText(['open a world folder', 'other ways in']);
  await expect(page.locator('.atlas-landing-more-sep')).toHaveCount(1);
  await expect(page.locator('[data-action="other-ways-in"]')).toHaveAttribute('title', 'download one from OnlyWorlds, or view a shared world');
});

test('first visit: start a world asks where, folder first, and the browser row lands a world in this browser', async ({ page }) => {
  await freshBoot(page);
  await page.click('[data-action="start-world"]');
  const dialog = page.locator('[data-modal="create-world"]');
  await expect(dialog.locator('input[name="where"]')).toHaveCount(2);
  await expect(dialog.locator('input[name="where"]').first()).toHaveAttribute('value', 'folder');
  await dialog.locator('input[name="where"][value="browser"]').check();
  await dialog.locator('input[name="world-name"]').fill('Landing World');
  await dialog.locator('[data-action="pick"]').click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    const w = s.registry.worlds.find((x: any) => x.name === 'Landing World');
    return { root: s.atlasRoot, where: w?.where ?? null };
  });
  expect(after).toEqual({ root: null, where: 'browser' });
  // Set up now: the landing is gone for good after a reload.
  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('[data-action="start-world"]')).toHaveCount(0);
  await expect(page.locator('.atlas-sidebar').getByText('Landing World').first()).toBeVisible();
});

test('first visit: start a world in a folder, pointed at a world folder for its home, opens that world instead', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-2');
  await page.click('[data-action="start-world"]');
  const dialog = page.locator('[data-modal="create-world"]');
  await dialog.locator('input[name="where"][value="folder"]').check();
  await dialog.locator('input[name="world-name"]').fill('Never Made');
  await dialog.locator('[data-action="pick"]').click();
  await page.locator('[data-modal="home-folder"] [data-action="choose"]').click();

  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await expect(page.getByText('Gil the Agent').first()).toBeVisible();
  // It opened the WORLD; it did not make a home folder inside someone's
  // world, and it made no new one.
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { root: s.atlasRoot, made: s.registry.worlds.some((w: any) => w.name === 'Never Made') };
  });
  expect(after).toEqual({ root: null, made: false });
});

test('a world opened without a home folder: a reload shows the world list, not the landing', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-3');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();

  await page.goto('/');
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('[data-action="open-world-folder"]')).toHaveCount(0);
  await expect(page.locator('.atlas-sidebar').getByText('Agent World').first()).toBeVisible();
});

test('the first NEW world asks where worlds live, then creates it there', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-4');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();

  await page.goto('/#/');
  await page.waitForSelector('.atlas-shell');
  // 1.17: the create dialog asks where first; the folder row asks for a home
  // folder inside the Create click, then makes the world there.
  await page.locator('[data-action="create-local"]').click();
  const dialog = page.locator('[data-modal="create-world"]');
  await dialog.locator('input[name="where"][value="folder"]').check();
  await dialog.locator('input[name="world-name"]').fill('Folder World');
  await dialog.locator('[data-action="pick"]').click();
  const ask = page.locator('[data-modal="home-folder"]');
  await expect(ask).toBeVisible();

  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const home = await opfs.getDirectoryHandle('front-door-home', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(home);
  });
  await ask.locator('[data-action="choose"]').click();
  await expect(dialog).toHaveCount(0);
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    const w = s.registry.worlds.find((x: any) => x.name === 'Folder World');
    return { root: s.atlasRoot, where: w ? (w.where ?? 'folder') : null };
  });
  expect(after.root).not.toBeNull();
  expect(after.where).toBe('folder');
});

test('cancelling the home-folder question creates nothing', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-5');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.goto('/#/');
  await page.waitForSelector('.atlas-shell');
  await page.locator('[data-action="create-local"]').click();
  const dialog = page.locator('[data-modal="create-world"]');
  await dialog.locator('input[name="where"][value="folder"]').check();
  await dialog.locator('[data-action="pick"]').click();
  await page.locator('[data-modal="home-folder"] [data-action="cancel"]').click();
  await expect(page.locator('[data-modal="home-folder"]')).toHaveCount(0);
  // The create dialog stays, so the user can choose again (1.17); nothing is made.
  await expect(dialog).toBeVisible();
  const after = await page.evaluate(() => {
    const s = (window as any).__atlasTestApi.getState();
    return { root: s.atlasRoot, worlds: s.registry.worlds.length };
  });
  expect(after.root).toBeNull();
  expect(after.worlds).toBe(1); // only the world opened in place above
});

// S421: the sidebar rebuilt its add-a-world buttons on every state change and
// hashchange, so a press on the old button and a release on its twin sent the
// click to their common ancestor, and the click was lost. A route to `#/` sets
// off a burst of those rebuilds: the race `cancelling the home-folder
// question` lost 5 of 20 runs to (S419). Here the rebuild lands between the
// press and the release on purpose.
test('a click on Start a world survives a sidebar re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-8');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.goto('/#/');
  const button = page.locator('[data-action="create-local"]');
  await expect(button).toBeVisible();
  await page.waitForTimeout(500); // the route's own re-renders settle; only ours lands inside the click
  const box = (await button.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await page.mouse.up();
  await expect(page.locator('[data-modal="create-world"]')).toBeVisible();
});

// The family of the test above: the worlds list was rebuilt the same way.
test('a click on a world row survives a sidebar re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-9');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.goto('/#/');
  const row = page.locator('[data-world-id]').first();
  await expect(row).toBeVisible();
  await page.waitForTimeout(500);
  const box = (await row.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => window.dispatchEvent(new HashChangeEvent('hashchange')));
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe('#/');
});

/**
 * Press on `selector`, re-render everything that listens to the hash or the
 * store (a sync publish patches the `sync` slice on every engine step), release.
 */
async function clickAcrossRerender(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await expect(target).toBeVisible();
  // The target sits still first: the strip's opening settle rebuilds it, takes
  // its labels off and slides every room left (by design, 420 ms, later under
  // load), and a press across it is released over another spot.
  await expect.poll(async () => {
    const a = JSON.stringify(await target.boundingBox());
    await page.waitForTimeout(250);
    return a !== 'null' && a === JSON.stringify(await target.boundingBox());
  }).toBe(true);
  await target.scrollIntoViewIfNeeded(); // a raw mouse press lands only on what is in the viewport
  await page.waitForTimeout(500); // the route's own re-renders settle; only ours lands inside the click
  const box = (await target.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.evaluate(() => {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    const api = (window as any).__atlasTestApi;
    api.patchSlice('sync', { ...api.getState().sync });
  });
  await page.mouse.up();
}

// The census's first two rows (Forge/Notes/2026-10-17-s421-rerender-census.md):
// the room strip and the sidebar's mode toggle, both always on screen.
test('a click on a room in the strip survives a re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-10');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await clickAcrossRerender(page, '.atlas-room-nav-btn[data-room="knowledge"]');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('knowledge');
});

test('a click on the sidebar mode toggle survives a re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-11');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  const before = await page.evaluate(() => (window as any).__atlasTestApi.getState().ui.sidebarMode);
  const other = before === 'worlds' ? 'mode-elements' : 'mode-worlds';
  await clickAcrossRerender(page, `[data-action="${other}"]`);
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().ui.sidebarMode)).not.toBe(before);
});

// Row 3: the element page, where most of a world's editing happens.
test('a click on the element page survives a re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-12');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.evaluate(() => { window.location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/element/00000000-0000-4000-8000-0000000000a1`; });
  const toggle = page.locator('.atlas-empty-fields-toggle button');
  const before = await toggle.getAttribute('data-action');
  await clickAcrossRerender(page, '.atlas-empty-fields-toggle button');
  await expect(toggle).not.toHaveAttribute('data-action', before!);
});

// Row 4: the settings room's tabs. From General: the OnlyWorlds tab's waypoint
// count moves on its own when a waypoint lands, a real change, not the class.
test('a click on a settings tab survives a re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-13');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.evaluate(() => { window.location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/settings/general`; });
  await clickAcrossRerender(page, '.atlas-settings-tab[data-settings-tab="storage"]');
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('storage');
});

// Waypoints live outside the store, so Settings redraws on their own event:
// with redraws keyed (1.51.5), nothing else would show a new count.
test('the OnlyWorlds tab\'s waypoint count moves when a waypoint lands', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-16');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await page.evaluate(() => { window.location.hash = `#/w/${(window as any).__atlasTestApi.getState().active.worldId}/settings/onlyworlds`; });
  const count = page.locator('.atlas-ow-waypoints-count');
  await expect(count).toBeVisible();
  await page.waitForTimeout(500);
  const total = Number((await count.textContent())!.split(' of ')[1]);
  await page.evaluate(() => {
    const raw = localStorage.getItem('atlas_waypoints_v1');
    const s = raw ? JSON.parse(raw) : { completed: {} };
    s.completed = s.completed ?? {};
    document.querySelectorAll('[data-waypoint]').forEach((el) => { s.completed[(el as HTMLElement).dataset.waypoint!] = new Date().toISOString(); });
    localStorage.setItem('atlas_waypoints_v1', JSON.stringify(s));
    document.dispatchEvent(new CustomEvent('atlas:waypoints-changed'));
  });
  await expect(count).toHaveText(`${total} of ${total}`);
});

// Row 5: the right pane's tab bar, and the badges on the sync pill, where a
// click across a redraw fell to the pill and refreshed instead.
test('a click on a right pane tab survives a re-render between press and release', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-14');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  const before = await page.evaluate(() => (window as any).__atlasTestApi.getState().ui.rightActiveIndex);
  const other = await page.evaluate((b) => (window as any).__atlasTestApi.getState().ui.rightTabs.findIndex((_: unknown, i: number) => i !== b), before);
  await clickAcrossRerender(page, `.atlas-tab[data-tab-index="${other}"]`);
  await expect.poll(() => page.evaluate(() => (window as any).__atlasTestApi.getState().ui.rightActiveIndex)).toBe(other);
});

test('a click on the sync pill\'s conflict badge stays on the badge across a re-render', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-15');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  // The pill's linked branch with two conflicts (no server: the UI branch only).
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    const s = api.getState();
    const worlds = s.registry.worlds.map((w: any) => w.id === s.active.worldId
      ? { ...w, state: 'api-linked', api: { world_id: 'fake-server-id', api_key: 'fake-key' } } : w);
    api.patchSlice('registry', { ...s.registry, worlds });
    api.patchSlice('sync', { ...api.getState().sync, activeConflictsCount: 2 });
    (window as any).__clickTargets = [];
    document.addEventListener('click', (e) => (window as any).__clickTargets.push((e.target as HTMLElement).dataset.role ?? null), true);
  });
  await clickAcrossRerender(page, '[data-role="review-conflicts"]');
  await expect.poll(() => page.evaluate(() => (window as any).__clickTargets)).toEqual(['review-conflicts']);
});

test('"add a world" opens the chooser; its open-a-world row opens a picked world', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-6');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();

  // A second world folder, through the chooser this time.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const dir = await opfs.getDirectoryHandle('agent-world-7', { create: true });
    const w = await (await dir.getFileHandle('world.json', { create: true })).createWritable();
    await w.write(JSON.stringify({ id: '00000000-0000-4000-8000-00000000f00e', name: 'Second World' }));
    await w.close();
    (window as any).__atlasTestApi.setNextDirectory(dir);
  });
  await page.locator('[data-action="add-world"]').click();
  const chooser = page.locator('[data-modal="add-world"]');
  // Six ways in since 1.17 (the sixth opens a world file, contract §5.2); the
  // seventh since 1.18 is the demo world (#113).
  await expect(chooser.locator('[data-choice]')).toHaveCount(7);
  await expect(chooser.locator('[data-choice="open-file"] strong')).toHaveText('Open a world file');
  await chooser.locator('[data-choice="open-folder"]').click();
  await expect(page.locator('h1', { hasText: 'Second World' })).toBeVisible();
});

test('Settings can hide the add-world icons; "add a world" stays, across a reload', async ({ page }) => {
  await freshBoot(page);
  await seedWorldFolderForPicker(page, 'agent-world-8');
  await page.click('[data-action="open-world-folder"]');
  await expect(page.locator('h1', { hasText: 'Agent World' })).toBeVisible();
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toBeVisible();

  // Through the real toggle (S365 gate lens C M8: the old test patched state).
  const worldId = await page.evaluate(() => (window as any).__atlasTestApi.getState().active.worldId);
  await page.evaluate((id) => { window.location.hash = `#/w/${id}/settings/general`; }, worldId);
  const toggle = page.locator('input[name="worlds-add-icons"]');
  await expect(toggle).toBeChecked();
  await toggle.uncheck();
  await page.evaluate((id) => { window.location.hash = `#/w/${id}`; }, worldId);
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toHaveCount(0);
  await expect(page.locator('.atlas-worlds-header [data-action="add-world"]')).toBeVisible();

  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await expect(page.locator('.atlas-worlds-header [data-action="add-world"]')).toBeVisible();
  await expect(page.locator('.atlas-worlds-header [data-action="create-local"]')).toHaveCount(0);
});

test('the open-a-world door does not switch an existing home folder', async ({ page }) => {
  await freshBoot(page);
  // A home folder first.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const home = await opfs.getDirectoryHandle('door-home-1', { create: true });
    (window as any).__atlasTestApi.setNextDirectory(home);
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForFunction(() => !!(window as any).__atlasTestApi.getState().atlasRoot);
  const before = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot.folderName);

  // Then the open-a-world door pointed at ANOTHER folder that keeps worlds.
  await page.evaluate(async () => {
    const opfs = await navigator.storage.getDirectory();
    const other = await opfs.getDirectoryHandle('door-home-2', { create: true });
    const wrap = await other.getDirectoryHandle('onlyworlds-atlas', { create: true });
    const w = await (await wrap.getFileHandle('.atlas-root', { create: true })).createWritable();
    await w.write('{"version":1}'); await w.close();
    (window as any).__atlasTestApi.setNextDirectory(other);
  });
  await page.locator('.atlas-worlds-header [data-action="open-folder"]').click();
  await expect(page.locator('.ow-toast', { hasText: 'Settings, then Storage' })).toBeVisible();
  const after = await page.evaluate(() => (window as any).__atlasTestApi.getState().atlasRoot);
  expect(after.folderName).toBe(before);
});
