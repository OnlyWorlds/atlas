/**
 * The one question about the account PIN (moved out of Settings' Account tab
 * in 1.125.0, so the World PIN dialog in a world, Settings' field and the
 * watch in `sync-attach.ts` all ask the same way): one `GET /me` beside the
 * open world's key that writes, its time limit, keel's 429 kept as the key's
 * wait, and one question per PIN at a time, so a wrong PIN reaches keel's PIN
 * wall once (law 193).
 */

import { getState } from '../core/state';
import { isSeatWorld } from '../core/seat';
import { isPinRefusal, recordPinState, type PinState } from '../registry/pin-proof';
import { buildV2Adapter } from './make-online';
import { isPinParam } from './sync-engine';
import { rateWaitOf, setRateWait } from './rate-wait';

/**
 * What a question about the PIN got: OnlyWorlds' word; null for no answer (offline, busy); 'unasked' when
 * there was nothing to ask with; 'waiting' inside a 429's wait on the world's key (`rate-wait.ts`), met by
 * this question or by an earlier send: the PIN is kept, not checked, never refused, and the question is not
 * spent.
 */
export type PinAnswer = PinState | null | 'unasked' | 'waiting';

/** The questions still out, by PIN: a second ask of the same PIN waits on this one's answer. */
const inFlight = new Map<string, Promise<PinAnswer>>();

/** How long a question waits for `/me`: past it, no answer came (not checked yet, never refused), and it is not spent. */
let pinAskTimeoutMs = 15_000;
/** Tests: a shorter wait for a question that hangs. */
export function __setPinAskTimeoutForTests(ms: number): void {
  pinAskTimeoutMs = ms;
}

/** Tests: nothing out. */
export function __resetPinAskInFlightForTests(): void {
  inFlight.clear();
}

/** The question about `pin` still out, if one is: a caller that must not run ahead of it waits on this. */
export function pinQuestionOut(pin: string | undefined): Promise<PinAnswer> | null {
  return pin ? inFlight.get(pin) ?? null : null;
}

/**
 * Ask OnlyWorlds about `pin` once, beside the open world's key that writes: one `GET /me` through
 * `keyScope` (a key of no known shape asks `/me` bare first, then once with the PIN), no retry. Never beside
 * a read key or for a seat's world. Returns what OnlyWorlds said; null when it asked and no answer came
 * (offline, busy), so the PIN stays not checked, never refused; 'unasked' when there was nothing to ask
 * with (no world open, a read key, a seat), so no question was spent. A question about the same PIN
 * still out is not sent again: this ask waits on its answer, so a wrong PIN reaches OnlyWorlds once.
 *
 * It records what keel said only of the PIN kept as the account's (`recordPinState`): a caller asking about
 * a PIN not kept yet keeps it itself once proved.
 */
export function askAboutPin(pin: string | undefined): Promise<PinAnswer> {
  const out = pin ? inFlight.get(pin) : undefined;
  if (out) return out;
  const asking = askOnce(pin);
  if (pin) {
    inFlight.set(pin, asking);
    const done = (): void => { if (inFlight.get(pin) === asking) inFlight.delete(pin); };
    asking.then(done, done);
  }
  return asking;
}

async function askOnce(pin: string | undefined): Promise<PinAnswer> {
  const reg = getState().registry;
  const active = getState().active;
  const entry = active ? reg.worlds.find((w) => w.id === active.worldId) : undefined;
  // A key that reads by its shape is asked nothing with a PIN: `keyScope` answers it read with no call.
  if (!pin || !entry?.api || entry.state !== 'api-linked' || entry.api.read_only || isSeatWorld(entry)) return 'unasked';
  // Inside a 429's wait on this key nothing is asked: the answer would be the wait again.
  if (rateWaitOf(entry.api.api_key)) return 'waiting';
  try {
    const { scope, pinProved } = await buildV2Adapter(entry.api.api_key, pin, undefined, { readTimeoutMs: pinAskTimeoutMs }).keyScope();
    // A key that turned out to read: no PIN went beside it, so nothing was asked.
    if (scope === 'read') return 'unasked';
    if (!pinProved) return null;
    recordPinState(pin, 'proved');
    return 'proved';
  } catch (err) {
    // keel's 429 (its PIN wall refuses even the right PIN): the wait is kept on the key, and the sync
    // waits it out too. The PIN is never recorded refused by it.
    const e = err as { status?: unknown; retryAfterMs?: unknown; param?: unknown } | null;
    if (e?.status === 429) {
      setRateWait(entry.api.api_key, typeof e.retryAfterMs === 'number' ? e.retryAfterMs : 30_000, isPinParam(e.param));
      return 'waiting';
    }
    if (!isPinRefusal(err)) return null;
    recordPinState(pin, 'refused');
    return 'refused';
  }
}
