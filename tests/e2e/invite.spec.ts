/**
 * Invite someone made in Atlas (#341): signed in, Settings, This world makes
 * a person's invite link through keel's link route (SDK createWorldLink), as
 * Lantern does; signed out, the line keeps the website's Access pane.
 *
 * keel is routed: `POST /account/worlds/{id}/links` makes a link for the
 * owner only (keel C1: a member or a stranger gets 404 not_found), with the
 * account token as Bearer; everything else answers empty.
 */

import { test, expect, Page, type Route } from '@playwright/test';

const V2 = 'https://www.onlyworlds.com/api/v2';
const TOKEN = 'ow_a_e2e0invite0token00000000000000000000000';
const WORLD_ID = '44444444-5555-4666-8777-888888888888';
/** The one Character the routed keel holds in this world. */
const HELD_CHARACTER = 'c1111111-0000-4000-8000-000000000001';

interface Keel { links: Array<{ body: Record<string, unknown>; auth: string | null }> }

async function routeKeel(page: Page, opts: { owner: boolean; offline?: boolean }): Promise<Keel> {
  const keel: Keel = { links: [] };
  const now = '2026-10-16T00:00:00.000Z';
  await page.route(`${V2}/**`, async (route: Route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace('/api/v2', '');
    if (path === `/account/worlds/${WORLD_ID}/links` && req.method() === 'POST') {
      if (opts.offline) return route.abort('internetdisconnected');
      const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
      keel.links.push({ body, auth: req.headers()['authorization'] ?? null });
      if (!opts.owner) {
        return route.fulfill({ status: 404, json: { error: { type: 'invalid_request', code: 'not_found', message: 'Not found.', param: null } } });
      }
      const code = 'ow_j_' + 'C'.repeat(40);
      const link = `https://www.onlyworlds.com/join#${code}`;
      const who = typeof body.inviter_name === 'string' && body.inviter_name ? body.inviter_name : 'Someone';
      // keel refuses a player link's Character it does not hold (agents.py `_clean_link_character`).
      if (body.reader === 'player' && body.character !== 'new' && body.character !== HELD_CHARACTER) {
        return route.fulfill({ status: 422, json: { error: { type: 'invalid_request', code: 'invalid', message: 'character must be new or the id of a Character in this world.', param: 'character' } } });
      }
      return route.fulfill({ status: 201, json: {
        id: 'l-1', reader: body.reader, role: body.reader === 'player' ? 'guest' : body.role, label: '', inviter_name: body.inviter_name ?? '',
        with_character: false, last4: code.slice(-4), code, link,
        line: `${who} invites you to Invite Realm on OnlyWorlds: ${link}`,
      } });
    }
    if (path === '/account/worlds') {
      return route.fulfill({ json: { data: [
        { id: WORLD_ID, name: 'Invite Realm', role: opts.owner ? 'owner' : 'collaborator', member_role: opts.owner ? undefined : 'co_builder', public_read: false, keys: [] },
      ] } });
    }
    if (path === '/world' || path === '/world/') return route.fulfill({ json: { id: WORLD_ID, name: 'Invite Realm', updated_at: now } });
    return route.fulfill({ json: { data: [], has_more: false, next_cursor: null } });
  });
  return keel;
}

async function linkedWorldInSettings(page: Page, signedIn: boolean) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => { await (window as any).__atlasTestApi.resetAll(); });
  await page.goto('/');
  await page.waitForFunction(() => Boolean((window as any).__atlasTestApi));
  await page.evaluate(async () => {
    const api = (window as any).__atlasTestApi;
    const root = await navigator.storage.getDirectory();
    api.setNextDirectory(await root.getDirectoryHandle('invite-root', { create: true }));
  });
  await page.evaluate(() => (window as any).__atlasTestApi.setupHomeFolder());
  await page.waitForSelector('[data-action="create-local"]');
  await page.click('[data-action="create-local"]');
  await page.fill('input[name="world-name"]', 'Invite Realm');
  await page.click('[data-modal="create-world"] [data-action="pick"]');
  await expect(page.locator('[data-role="elements-search"]')).toBeVisible();
  await page.evaluate(({ id, token, signedIn }) => {
    const reg = JSON.parse(localStorage.getItem('atlas_worlds_registry')!);
    reg.worlds[0].state = 'api-linked';
    reg.worlds[0].api = { world_id: id, api_key: 'ow_w_' + 'K'.repeat(32) };
    reg.pin = '4242';
    if (signedIn) { reg.account_token = token; reg.account_username = 'e2e-owner'; }
    localStorage.setItem('atlas_worlds_registry', JSON.stringify(reg));
  }, { id: WORLD_ID, token: TOKEN, signedIn });
  await page.reload();
  await page.waitForSelector('.atlas-shell');
  await page.click('.atlas-mode-btn[data-action="mode-worlds"]');
  await page.click('.atlas-row[data-world-id]:has-text("Invite Realm")');
  await page.click('[data-action="open-settings"]');
  await page.click('[data-settings-tab="world"]');
}

/** The open world's elements as the dialog reads them: a synced Character, one made here and not yet up, a place. */
async function castInState(page: Page) {
  await page.evaluate((held) => {
    const api = (window as any).__atlasTestApi;
    const els = api.getState().data.elements;
    api.patchData([...els,
      { id: held, type: 'character', name: 'Judge Holden', server_updated_at: '2026-10-19T00:00:00.000Z' },
      { id: 'c2222222-0000-4000-8000-000000000002', type: 'character', name: 'Not Yet Up' },
      { id: 'l3333333-0000-4000-8000-000000000003', type: 'location', name: 'Glanton Camp', server_updated_at: '2026-10-19T00:00:00.000Z' },
    ]);
  }, HELD_CHARACTER);
}

test('"A player" makes keel\'s no-account player link, as a new Character or one the world holds (#416)', async ({ page }) => {
  const keel = await routeKeel(page, { owner: true });
  await linkedWorldInSettings(page, true);
  await castInState(page);
  await page.locator('[data-role="invite-line"] [data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  // The Character choice shows only for a player; the line under the choices says who needs an account.
  await expect(modal.locator('[data-role="plays-as"]')).toBeHidden();
  await expect(modal.locator('[data-role="invite-needs"]')).toHaveText('It works once, for 7 days. They need a free account.');
  await modal.locator('[data-role="player"]').click();
  await expect(modal.locator('[data-role="plays-as"]')).toBeVisible();
  await expect(modal.locator('[data-role="invite-needs"]')).toHaveText('It works once, for 7 days. No account needed: they open it in Lantern.');
  // Only Characters keel holds are offered: not a place, not one made here and not yet synced.
  await expect(modal.locator('select[name="plays-as"] option')).toHaveText(['A new Character for them', 'Judge Holden']);
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="invite-lead"]')).toHaveText('Your invite to Invite Realm, as a player:');
  expect(keel.links[0].body).toEqual({ reader: 'player', character: 'new', days: 7 });

  await modal.locator('[data-action="done"]').click();
  await page.locator('[data-action="invite-someone"]').click();
  await modal.locator('[data-role="player"]').click();
  await modal.locator('select[name="plays-as"]').selectOption(HELD_CHARACTER);
  await modal.locator('input[name="inviter-name"]').fill('Titus');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="invite-lead"]')).toHaveText('Your invite to Invite Realm, as a player reading as Judge Holden:');
  expect(keel.links[1].body).toEqual({ reader: 'player', character: HELD_CHARACTER, days: 7, inviter_name: 'Titus' });
});

test('a Character keel no longer holds is said, not retried (#416)', async ({ page }) => {
  await routeKeel(page, { owner: true });
  await linkedWorldInSettings(page, true);
  await page.evaluate(() => {
    const api = (window as any).__atlasTestApi;
    api.patchData([...api.getState().data.elements,
      { id: 'c9999999-0000-4000-8000-000000000009', type: 'character', name: 'Deleted Online', server_updated_at: '2026-10-19T00:00:00.000Z' }]);
  });
  await page.locator('[data-role="invite-line"] [data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await modal.locator('[data-role="player"]').click();
  await modal.locator('select[name="plays-as"]').selectOption('c9999999-0000-4000-8000-000000000009');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="error"]')).toHaveText(/That Character is not on OnlyWorlds yet, or no longer/);
  await expect(modal.locator('[data-role="invite-link"]')).toHaveCount(0);
});

test('signed in, the owner makes a player\'s link in Atlas: shown once, Copy and a QR code (#341)', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const keel = await routeKeel(page, { owner: true });
  await linkedWorldInSettings(page, true);
  await page.locator('[data-role="invite-line"] [data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('[data-role="contributor"]')).toHaveAttribute('aria-pressed', 'true');
  await modal.locator('[data-role="guest"]').click();
  await expect(modal.locator('[data-role="guest"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(modal.locator('[data-role="contributor"]')).toHaveAttribute('aria-pressed', 'false');
  await modal.locator('input[name="inviter-name"]').fill('  Titus  ');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="invite-link"]')).toHaveText(/^https:\/\/www\.onlyworlds\.com\/join#ow_j_/);
  await expect(modal.locator('[data-role="invite-lead"]')).toHaveText('Your invite to Invite Realm, as a player with an account:');
  await expect(modal.locator('svg.atlas-invite-qr-code')).toBeVisible();
  await expect(modal.locator('a[data-link="invite-access"]')).toHaveAttribute('href', `https://www.onlyworlds.com/account/worlds/${WORLD_ID}#access`);
  // keel was asked for a person's link, as the chosen role, signed with the trimmed name, on the account token.
  expect(keel.links).toHaveLength(1);
  expect(keel.links[0].body).toMatchObject({ reader: 'person', role: 'guest', days: 7, inviter_name: 'Titus' });
  expect(keel.links[0].auth).toBe(`Bearer ${TOKEN}`);
  await modal.locator('[data-action="copy-invite"]').click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`Titus invites you to Invite Realm on OnlyWorlds: https://www.onlyworlds.com/join#ow_j_${'C'.repeat(40)}`);
  // Nothing about the link is kept: not in the registry, not in prefs; the name is.
  const kept = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(kept).not.toContain('ow_j_');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('atlas_ui_prefs') ?? '{}').inviterName)).toBe('Titus');
  await modal.locator('[data-action="done"]').click();
  await expect(modal).toHaveCount(0);
  // The name comes back next time.
  await page.locator('[data-action="invite-someone"]').click();
  await expect(page.locator('[data-modal="invite"] input[name="inviter-name"]')).toHaveValue('Titus');
});

test('a world only shared with the account offers no Invite someone (#341)', async ({ page }) => {
  await routeKeel(page, { owner: false });
  await linkedWorldInSettings(page, true);
  // The tab is up and the account list has come before the absence is counted (gate M3).
  await expect(page.locator('[data-action="refresh-from-api"]')).toBeVisible();
  await page.waitForFunction(() => (window as any).__atlasTestApi.getState().accountWorlds.status === 'ready');
  // A world only shared with the account offers no Invite someone at all (canOfferInvite).
  await expect(page.locator('[data-role="invite-line"]')).toHaveCount(0);
});

test('with the account list loaded, a world missing from it offers no Invite someone (#341, gate M2)', async ({ page }) => {
  await routeKeel(page, { owner: true });
  await page.route(`${V2}/account/worlds`, route => route.fulfill({ json: { data: [] } }));
  await linkedWorldInSettings(page, true);
  await expect(page.locator('[data-action="refresh-from-api"]')).toBeVisible();
  await page.waitForFunction(() => (window as any).__atlasTestApi.getState().accountWorlds.status === 'ready');
  // Settings re-renders on the list's arrival; count after a tick.
  await page.waitForTimeout(200);
  await expect(page.locator('[data-role="invite-line"]')).toHaveCount(0);
});

test('while keel makes the link nothing closes the dialog or changes what is asked, and one link is made (#341, gate H1, M3)', async ({ page }) => {
  const keel = await routeKeel(page, { owner: true });
  let release!: () => void;
  const held = new Promise<void>(r => { release = r; });
  await page.route(`${V2}/account/worlds/${WORLD_ID}/links`, async (route) => {
    await held;
    await route.fallback();
  });
  await linkedWorldInSettings(page, true);
  await page.locator('[data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-action="make-invite"]')).toHaveText('Making…');
  // The choices and the name are locked: the role sent is the role said.
  await expect(modal.locator('[data-role="guest"]')).toBeDisabled();
  await expect(modal.locator('input[name="inviter-name"]')).toBeDisabled();
  await page.keyboard.press('Escape');
  await page.mouse.click(5, 5);
  await modal.locator('form').evaluate((f: HTMLFormElement) => { f.requestSubmit(); });
  await expect(modal).toBeVisible();
  release();
  await expect(modal.locator('[data-role="invite-lead"]')).toHaveText('Your invite to Invite Realm, as a contributor:');
  expect(keel.links).toHaveLength(1);
  expect(keel.links[0].body.role).toBe('contributor');
  // Made, it closes again.
  await page.keyboard.press('Escape');
  await expect(modal).toHaveCount(0);
});

test('a world at keel\'s cap of open invites is told to take some back, not to try again (#341, gate M1)', async ({ page }) => {
  await routeKeel(page, { owner: true });
  await page.route(`${V2}/account/worlds/${WORLD_ID}/links`, route => route.fulfill({ status: 422, json: { error: { type: 'invalid_request', code: 'invalid_request', message: 'A world can have at most 50 pending invites.', param: null } } }));
  await linkedWorldInSettings(page, true);
  await page.locator('[data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="error"]')).toContainText('as many open invites as it can hold');
  await expect(modal.locator('[data-role="error"]')).toHaveAttribute('role', 'alert');
  await expect(modal.locator('[data-action="make-invite"]')).toBeFocused();
});

test('a refused account token is said in the dialog, with where to sign in again (#341, gate M3)', async ({ page }) => {
  await routeKeel(page, { owner: true });
  await page.route(`${V2}/account/worlds/${WORLD_ID}/links`, route => route.fulfill({ status: 401, json: { error: { type: 'authentication_error', code: 'invalid_credentials', message: 'Invalid.', param: null } } }));
  await linkedWorldInSettings(page, true);
  await page.locator('[data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="error"]')).toContainText('Sign in again in Settings, OnlyWorlds');
});

test('keel refusing the link (not the owner) is said in the dialog; no link shown (#341)', async ({ page }) => {
  // The account list says owner (the line shows), keel refuses anyway: a key linked from another account.
  await routeKeel(page, { owner: true });
  // Registered after the fake keel: Playwright asks the newest route first.
  await page.route(`${V2}/account/worlds/${WORLD_ID}/links`, route => route.fulfill({ status: 404, json: { error: { type: 'invalid_request', code: 'not_found', message: 'Not found.', param: null } } }));
  await linkedWorldInSettings(page, true);
  await page.locator('[data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="error"]')).toContainText('Only the world\'s owner can make an invite link');
  await expect(modal.locator('[data-role="invite-link"]')).toHaveCount(0);
  await expect(modal.locator('[data-action="make-invite"]')).toBeEnabled();
});

test('no connection: the dialog says so and the button comes back (#341)', async ({ page }) => {
  await routeKeel(page, { owner: true, offline: true });
  await linkedWorldInSettings(page, true);
  await page.locator('[data-action="invite-someone"]').click();
  const modal = page.locator('[data-modal="invite"]');
  await modal.locator('[data-action="make-invite"]').click();
  await expect(modal.locator('[data-role="error"]')).toContainText('could not reach OnlyWorlds');
  await expect(modal.locator('[data-action="make-invite"]')).toHaveText('Make the link');
});

test('signed out, Invite someone still opens the website\'s Access pane, and says signing in brings it here (#341)', async ({ page }) => {
  await routeKeel(page, { owner: true });
  await linkedWorldInSettings(page, false);
  const invite = page.locator('[data-role="invite-line"] a[data-link="invite"]');
  await expect(invite).toHaveAttribute('href', `https://www.onlyworlds.com/account/worlds/${WORLD_ID}#access`);
  await expect(page.locator('[data-role="invite-line"]')).toContainText('Atlas makes the link here');
  await expect(page.locator('[data-action="invite-someone"]')).toHaveCount(0);
});
