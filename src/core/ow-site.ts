/**
 * The onlyworlds.com pages Atlas sends people to (the journey floor
 * 2026-10-14): making an account, setting its PIN, and a world's Access pane,
 * where only the website can make an invite link today (keel
 * `portal/urls.py`: invites are portal views, the v2 API has no route).
 */

import type { WorldRegistryEntry, AccountWorldRow } from './types';

export const OW_SIGNUP_URL = 'https://www.onlyworlds.com/accounts/signup/';
export const OW_PIN_URL = 'https://www.onlyworlds.com/account/settings/pin';
/** The website's Account settings page: World PIN and Account tokens live there (keel portal/urls.py). */
export const OW_SETTINGS_URL = 'https://www.onlyworlds.com/account/settings';
/** The OnlyWorlds app made for a phone (#279): a phone visitor hears of it from the first screen and help. */
export const LANTERN_URL = 'https://lantern.onlyworlds.com';

/** The line that points a phone visitor at Lantern. */
export function lanternLineHtml(): string {
  return `On a phone, <a class="atlas-settings-link atlas-link-inline" data-link="lantern" href="${LANTERN_URL}" target="_blank" rel="noopener">Lantern</a> is the OnlyWorlds app made for one: it catches notes at the table and keeps your world offline.`;
}

/** A world's page on onlyworlds.com, opened at Access: its own path, kept through the site's sign-in (Skeld 2026-10-19). */
export function owAccessUrl(apiWorldId: string): string {
  return `https://www.onlyworlds.com/account/worlds/${encodeURIComponent(apiWorldId)}/access`;
}

/**
 * Whether to offer "Invite someone" for this world: linked, not a seat, not
 * view-only, and not a world the signed-in account only collaborates on (its
 * Access pane is the owner's). Without the account list, the owner is the
 * likely case, and the website says so plainly if not. With the list loaded
 * (`listLoaded`), a world missing from it is someone else's: keel makes links
 * for the owner only, so it is not offered (#341).
 */
export function canOfferInvite(world: WorldRegistryEntry, accountRows: readonly AccountWorldRow[], listLoaded = false): boolean {
  const api = world.api;
  if (world.state !== 'api-linked' || !api?.world_id) return false;
  if (api.seat || api.read_only) return false;
  const row = accountRows.find(r => r.id === api.world_id);
  if (listLoaded) return row?.role === 'owner';
  return !row || row.role === 'owner';
}

/** The "no account yet" line under a sign-in or PIN form. */
export function noAccountYetHtml(): string {
  return `No account yet? <a class="atlas-settings-link atlas-link-inline" data-link="signup" href="${OW_SIGNUP_URL}" target="_blank" rel="noopener">Make a free one on onlyworlds.com</a>, then <a class="atlas-settings-link atlas-link-inline" data-link="set-pin" href="${OW_PIN_URL}" target="_blank" rel="noopener">set its PIN</a>.`;
}
