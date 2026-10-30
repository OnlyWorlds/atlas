/**
 * Is a world's public page on? keel's whole switch is `public_read` and
 * `public_page.on` on GET /world (any key). Asked only for a reader who
 * reaches the site through the public page (a read key, a player's link, an
 * agent seat); kept in memory, fresh for five minutes, so a page switched off
 * loses its marks at the next mount after that. Until an answer, and after a
 * failed read, the answer is "not known" and no mark shows (the Waymark
 * contract's R1).
 */

import { getState } from '../core/state';
import { worldPin } from '../core/seat';
import type { WorldRegistryEntry } from '../core/types';
import { readsByPublicPage } from '../core/waymark-for';
import { buildV2Adapter } from './make-online';

const FRESH_MS = 5 * 60 * 1000;
const READ_TIMEOUT_MS = 10_000;

const FAILED_WAIT_MS = 60_000;

const known = new Map<string, { on: boolean; at: number }>();
const asking = new Map<string, Promise<boolean | null>>();
/** When a read last failed, per world: a redraw within the minute does not ask again. */
const failedAt = new Map<string, number>();

/** The switch as last read (true or false), or null: never read, or every read failed. */
export function publicPageOnNow(entry: WorldRegistryEntry): boolean | null {
  const id = entry.api?.world_id;
  return id ? known.get(id)?.on ?? null : null;
}

/** Whether the last answer is older than five minutes (or there is none). */
export function publicPageStale(entry: WorldRegistryEntry, now = Date.now()): boolean {
  const id = entry.api?.world_id;
  const k = id ? known.get(id) : undefined;
  return !k || now - k.at > FRESH_MS;
}

/**
 * Read the switch for a public-page reader's world, at most one read in flight
 * per world; a fresh answer is reused. Answers the switch, or null when the
 * read failed (nothing is kept, so a later mount may ask again).
 */
export function readPublicPageOn(entry: WorldRegistryEntry): Promise<boolean | null> {
  const id = entry.api?.world_id;
  const key = entry.api?.api_key;
  if (!id || !key || !readsByPublicPage(entry)) return Promise.resolve(null);
  if (!publicPageStale(entry)) return Promise.resolve(known.get(id)!.on);
  const inFlight = asking.get(id);
  if (inFlight) return inFlight;
  const failed = failedAt.get(id);
  if (failed !== undefined && Date.now() - failed < FAILED_WAIT_MS) return Promise.resolve(null);
  // A seat's key carries its own secret as the PIN; a read key goes bare.
  const pin = entry.api?.seat ? worldPin(entry, getState().registry) ?? '' : entry.api?.read_only ? '' : worldPin(entry, getState().registry) ?? '';
  const ask = buildV2Adapter(key, pin, undefined, { readTimeoutMs: READ_TIMEOUT_MS }).getWorldMeta().then(
    meta => {
      failedAt.delete(id);
      known.set(id, { on: meta.public_page_on === true, at: Date.now() });
      return meta.public_page_on === true;
    },
    err => {
      // A stale answer is not kept past a failed refresh (a key withdrawn answers 401): not known, no mark.
      failedAt.set(id, Date.now());
      known.delete(id);
      console.warn('[atlas:waymark] the public page switch was not read; no mark until it is', err);
      return null;
    },
  ).finally(() => { asking.delete(id); });
  asking.set(id, ask);
  return ask;
}

/** Tests only: forget what was read. */
export function resetPublicPageForTests(): void {
  known.clear();
  asking.clear();
  failedAt.clear();
}
