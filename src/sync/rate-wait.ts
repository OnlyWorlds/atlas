/**
 * keel's 429 waits, by world key: while one runs, Atlas sends nothing more on that key by itself.
 *
 * A 429 carries a `Retry-After`. keel's PIN wall (ten different wrong PINs on one key within 15 minutes)
 * answers every request that carries a PIN with that 429 until it lifts, the right PIN included; its
 * general throttles answer the same status without `param` `API-Pin`. Either way a request sent inside
 * the wait is answered with the wait again, so the wait is kept here, outside any one engine: a world
 * switched away and back, a PIN saved in Settings (a new engine on the same key) and an engine stopped and
 * started again all find it. In memory only: a page load forgets it, and keel's own `Retry-After` answers
 * the first request after the load.
 */

export interface RateWait {
  /** When the wait ends (`Date.now()` clock). */
  until: number;
  /** keel named the PIN (`param` `API-Pin`): its PIN wall, not a general throttle. */
  pin: boolean;
}

/** Each key's wait: its end, and the end of the PIN wall's share of it (0 when keel never named the PIN). */
const waits = new Map<string, { until: number; pinUntil: number }>();

/** The longest wait Atlas keeps, whatever `Retry-After` says (the engine's retry clamp). */
export const RATE_WAIT_MAX_MS = 15 * 60_000;
/** The shortest: a `Retry-After` under a second is read as one. */
export const RATE_WAIT_MIN_MS = 1000;

/** A wait's length as Atlas keeps it: `Retry-After` clamped to 1 s .. 15 min. */
export function clampWaitMs(ms: number): number {
  return Math.min(Math.max(ms, RATE_WAIT_MIN_MS), RATE_WAIT_MAX_MS);
}

/**
 * Start (or move) the wait on `key`: `ms` from now. A later end never shortens to an earlier one, and the
 * PIN wall, once met, stays named until its own wait ends, whatever 429 came after it.
 */
export function setRateWait(key: string, ms: number, pin: boolean, now = Date.now()): RateWait {
  const until = now + clampWaitMs(ms);
  const had = rateWaitOf(key, now) ? waits.get(key) : undefined;
  const next = {
    until: Math.max(had?.until ?? 0, until),
    pinUntil: Math.max(had && had.pinUntil > now ? had.pinUntil : 0, pin ? until : 0),
  };
  waits.set(key, next);
  return { until: next.until, pin: next.pinUntil > now };
}

/** The wait running on `key`, or null when none runs (an ended one is forgotten). */
export function rateWaitOf(key: string | null | undefined, now = Date.now()): RateWait | null {
  if (!key) return null;
  const w = waits.get(key);
  if (!w) return null;
  if (w.until <= now) {
    waits.delete(key);
    return null;
  }
  return { until: w.until, pin: w.pinUntil > now };
}

/** End the wait on `key` (its retry is going out). */
export function clearRateWait(key: string): void {
  waits.delete(key);
}

/** A wait in words: seconds under 90, else minutes. */
export function waitWords(ms: number): string {
  const secs = Math.max(1, Math.round(clampWaitMs(ms) / 1000));
  if (secs >= 90) return `${Math.round(secs / 60)} minutes`;
  return `${secs} second${secs === 1 ? '' : 's'}`;
}

/**
 * The sync's words for a 429's wait, by keel's `param`: its PIN wall, or any other throttle. `place` is
 * where the world keeps its changes ("in this browser", "in the folder"). The toast at the 429 and a
 * press made inside the wait say the same sentence.
 */
export function rateWaitLine(pin: boolean, ms: number, place: string): string {
  const when = waitWords(ms);
  return pin
    ? `OnlyWorlds refused too many different PINs for this world's key, so it takes none for a while. Check your PIN in Settings; Atlas tries again in ${when}.`
    : `OnlyWorlds asked Atlas to wait. Your changes are saved ${place}, and Atlas tries again in ${when}.`;
}

/**
 * Settings' PIN check inside a 429's wait (asked and answered with the wait, or held back by it): the PIN
 * is kept, never called refused (under the PIN wall even the right PIN gets the 429), and the split is the
 * sync's.
 */
export function pinCheckWaitLine(pin: boolean, ms: number): string {
  const when = waitWords(ms);
  return pin
    ? `OnlyWorlds refused too many different PINs for this world's key, so it takes none for a while. This PIN is kept here, not checked by OnlyWorlds yet; OnlyWorlds takes PINs again in ${when}.`
    : `OnlyWorlds asked Atlas to wait. This PIN is kept here, not checked by OnlyWorlds yet; Atlas can ask about it again in ${when}.`;
}

/** Tests: no wait anywhere. */
export function __resetRateWaitsForTests(): void {
  waits.clear();
}
