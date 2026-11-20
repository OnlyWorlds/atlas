/**
 * What Atlas knows of the account PIN it keeps (`registry.pin`): proved, refused, or not checked yet
 * (`registry.pin_state`, absent). The PIN is the account's, one for every world (keel), so its state sits
 * beside it on the registry, never on a world's entry.
 *
 * What proves it: keel answered `GET /me` with write scope with this PIN beside a key that writes
 * (`keyScope().pinProved`), or keel accepted a write sent with it (a world's create, or a write the sync
 * engine landed). Never beside a read key, never a seat's secret (a seat's PIN is its world's alone). What
 * refuses it: keel's 401 naming `API-Pin` for this PIN. A failed read (offline, busy) says nothing.
 *
 * Limits, named: keel compares nothing where a world holds no PIN hash, so a `/me` or a write there is
 * counted as proof though nothing was checked. And the PIN is one account's: an owner key is checked
 * against its world's owner's PIN, a member key against the member's own, so a key from another
 * account's world (a shared owner key, a world linked under another sign-in) answers about a PIN that is
 * not this one, and its answer is recorded against the one PIN kept here.
 */
import { getState, patchSlice } from '../core/state';
import type { WorldsRegistry } from '../core/types';
import { saveRegistry } from './registry';
import { keyCheckError, PinRefusedError } from '../setup/key-check-errors';

export type PinState = 'proved' | 'refused';

/** The registry with `state` for `pin`, when `pin` is the PIN it keeps; otherwise unchanged (a proof of another PIN says nothing of this one). */
export function notePinState(reg: WorldsRegistry, pin: string | undefined, state: PinState): WorldsRegistry {
  const own = pin?.trim();
  if (!own || reg.pin !== own || reg.pin_state === state) return reg;
  return { ...reg, pin_state: state };
}

/** Record a proof or a refusal of `pin` in the registry, saved and in state. */
export function recordPinState(pin: string | undefined, state: PinState): void {
  const reg = getState().registry;
  const next = notePinState(reg, pin, state);
  if (next === reg) return;
  saveRegistry(next);
  patchSlice('registry', next);
}

/** A key check's error that is keel refusing the PIN itself (401, param `API-Pin`), raw or already worded. */
export function isPinRefusal(err: unknown): boolean {
  return err instanceof PinRefusedError || keyCheckError(err) instanceof PinRefusedError;
}
