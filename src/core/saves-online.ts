/**
 * Whether a linked world saves to OnlyWorlds yet (1.125.0). An owner's world
 * opened from onlyworlds.com comes down with no PIN kept and no engine: it is
 * linked, and nothing made here has reached the site. One predicate, the test
 * `diagnoseSyncUnavailable` makes (linked, not read-only, no PIN kept), read
 * wherever a person is told their world is held by OnlyWorlds: Home's
 * keep-safe card, the guide's copy dot, the sidebar's chip and cloud.
 *
 * Never the sync controls or a Make online offer: those stay on the linked
 * state, since a linked world is never offered Make online. Named gap: a world
 * whose PIN keel refused keeps its PIN, so it still reads as saving here while
 * its pill says the refusal.
 */
import type { WorldRegistryEntry, WorldsRegistry } from './types';
import { isSeatWorld, SEAT_SECRET_MISSING_LINE, worldPin } from './seat';

/** Linked to OnlyWorlds, writes, and no PIN kept: its changes stay here until the World PIN is given. */
export function waitsOnPin(entry: WorldRegistryEntry | null | undefined, reg: WorldsRegistry): boolean {
  return !!entry && entry.state === 'api-linked' && !!entry.api && !entry.api.read_only && !worldPin(entry, reg);
}

/**
 * Waits on the account's World PIN: `waitsOnPin`, never a seat. A seat that lost its secret waits on that
 * secret, which no World PIN gives, so a line that names the World PIN reads this; a seat keeps its own words.
 */
export function waitsOnWorldPin(entry: WorldRegistryEntry | null | undefined, reg: WorldsRegistry): boolean {
  return waitsOnPin(entry, reg) && !isSeatWorld(entry);
}

/** What a resumed sync says of a world waiting on the World PIN: nothing runs until the PIN is given. */
export const PIN_WAITS_RESUME_LINE = 'Sync is no longer paused. This world saves to OnlyWorlds once you add your World PIN.';

/**
 * What a resumed sync says of a world that still cannot sync: waiting on the World PIN, or a seat that lost its
 * secret (its own words). Null when the world syncs once resumed, so the caller says "Sync resumed".
 */
export function resumeWaitLine(entry: WorldRegistryEntry | null | undefined, reg: WorldsRegistry): string | null {
  if (waitsOnWorldPin(entry, reg)) return PIN_WAITS_RESUME_LINE;
  if (waitsOnPin(entry, reg)) return `Sync is no longer paused. ${SEAT_SECRET_MISSING_LINE}`;
  return null;
}

/** Linked and saving to OnlyWorlds (or reading from it, a view-only link): what "online" means to a person. */
export function savesOnline(entry: WorldRegistryEntry | null | undefined, reg: WorldsRegistry): boolean {
  return !!entry && entry.state === 'api-linked' && !!entry.api && !waitsOnPin(entry, reg);
}
