/**
 * A linked world takes a new key in place (#198, Titus's go,
 * 2026-10-16). Before, a revoked, unknown or read key meant Unlink, then Make
 * online, and Unlink drops the deletes not yet sent (conv. 24). Now the key is
 * swapped under the same world: same folder, same baselines, same pending
 * edits and tombstones, a fresh engine on the new key.
 *
 * Two ways a key arrives:
 * - pasted in Settings, This world (`checkNewKey`, then `putKeyInPlace`): the
 *   key is read once against keel and must name THIS world;
 * - made by Atlas from the account token (`makeNewWorldKey`): signed in, for
 *   a world on the account's list. Sync calls it once per world and session
 *   when keel refuses the key (`recoverRefusedKey`: a member removed and
 *   invited back, the owner rotating keys, Skeld 2026-10-16); the button in
 *   Settings calls it too.
 *
 * A seat world never takes either: its key and secret come back only through
 * its join link (conv. 132).
 */

import { getState, patchSlice } from '../core/state';
import { diskApiBlock, isSeatWorld, worldPin } from '../core/seat';
import { getActiveStore } from '../core/active-store';
import { PlainError } from '../core/plain-error';
import { saveRegistry, setPin, updateWorldEntry } from '../registry/registry';
import type { AccountWorldRow, KeyRefusal, WorldRegistryEntry } from '../core/types';
import { attachSyncEngine, detachSyncEngine } from './sync-attach';
import { buildV2Adapter } from './make-online';
import { AccountClient } from './account-client';
import { accountWorldsWhenFetched, mintOwnKey, sharedOpenLine, type ReadOnlyWhy } from './account-worlds';
import { keyRefusalOf } from './world-key-lines';
import { PinPromptModal } from '../ui/pin-prompt-modal';

/** A read key, by keel's prefix; a write key or a legacy ten-digit one otherwise. */
export function isReadKey(key: string): boolean {
  return key.startsWith('ow_r_');
}

/** True when the world can take a new key at all: linked, and not a seat. */
export function canTakeNewKey(entry: WorldRegistryEntry | undefined): entry is WorldRegistryEntry & { api: NonNullable<WorldRegistryEntry['api']> } {
  return !!entry && entry.state === 'api-linked' && !!entry.api && !isSeatWorld(entry);
}

/** True when Atlas can make the key itself: signed in, and a world that can take one. */
export function canMakeWorldKey(entry: WorldRegistryEntry | undefined): boolean {
  return canTakeNewKey(entry) && !!getState().registry.account_token;
}

/**
 * True when Settings offers Make a new key: signed in, and the world on the
 * account's list as loaded, never a guest's (a guest's key only reads; the
 * #198 gate's G3, G7). Sync's own recovery asks `canMakeWorldKey` and fetches
 * the list fresh.
 */
export function offersMakeKey(entry: WorldRegistryEntry | undefined): boolean {
  if (!canMakeWorldKey(entry) || !entry?.api) return false;
  const row = getState().accountWorlds.rows.find(r => r.id === entry.api!.world_id);
  return !!row && row.member_role !== 'guest';
}

/**
 * Read a pasted key once against keel. Resolves to whether it reads only;
 * refuses (a `PlainError` worded for the person) a key for another world, the
 * key the world has now, and a key keel refuses.
 */
export async function checkNewKey(entry: WorldRegistryEntry, raw: string): Promise<{ readOnly: boolean }> {
  if (!canTakeNewKey(entry)) throw new PlainError('This world cannot take a new key here.');
  const key = raw.trim();
  if (!key) throw new PlainError('Paste the key first.');
  if (key === entry.api.api_key) throw new PlainError('That is the key this world has now.');
  const readOnly = isReadKey(key);
  // A read goes bare and `/me` checks the PIN; a legacy key sends it on every route.
  const pin = readOnly ? '' : (worldPin(entry, getState().registry) ?? '');
  const refused = (err: unknown): unknown => {
    const why = keyRefusalOf(err);
    if (why === 'key_revoked') return new PlainError('That key was revoked too. Make a new one on the world\'s page on onlyworlds.com.');
    if (why === 'key_unknown') return new PlainError('OnlyWorlds does not know that key. Copy it again from the world\'s page on onlyworlds.com.');
    if (why === 'pin') return new PlainError('OnlyWorlds did not accept your PIN with that key. Check it on the OnlyWorlds tab.');
    return err;
  };
  const client = buildV2Adapter(key, pin);
  let fetched: { id: string; name: string };
  try {
    fetched = await client.getWorld();
  } catch (err) {
    throw refused(err);
  }
  // Which world first: this world's PIN against another world's key is that
  // world's question, and the answer here is the key, not the PIN.
  if (fetched.id !== entry.api.world_id) {
    throw new PlainError(`That key is for another world, "${fetched.name}". Copy the key from this world's page on onlyworlds.com.`);
  }
  try {
    await client.checkPin();
  } catch (err) {
    throw refused(err);
  }
  return { readOnly };
}

/**
 * Put a checked key in place: the registry (the save must land, or nothing
 * moves), world.json's mirror, the store's view-only flag, and a fresh engine
 * when the world is open. Nothing about the world's own state is touched.
 */
export async function putKeyInPlace(entry: WorldRegistryEntry, key: string, readOnly: boolean): Promise<WorldRegistryEntry> {
  if (!canTakeNewKey(entry)) throw new PlainError('This world cannot take a new key here.');
  // The role belongs to the key: a new one (perhaps another account's) is read afresh (conv. 151).
  const { read_only: _was, member_role: _role, ...rest } = entry.api;
  const api = { ...rest, api_key: key, ...(readOnly ? { read_only: true } : {}) };
  const next = updateWorldEntry(getState().registry, entry.id, { api });
  if (!saveRegistry(next)) {
    throw new PlainError('Atlas could not save the new key in this browser, so the old one stays. Free some storage, then try again.');
  }
  lastRefusal.delete(entry.id);
  patchSlice('registry', next);
  const updated = next.worlds.find(w => w.id === entry.id) ?? { ...entry, api };
  const store = getState().active?.worldId === entry.id ? getActiveStore() : null;
  if (store) {
    try {
      // The api block is sync's, not the person's edit: a view-only world
      // (a read key going to a write key) still takes it.
      await store.writeWorldMeta({ api: diskApiBlock(api) }, { fromSync: true });
    } catch (err) {
      console.warn('[world-key] world.json api mirror not written:', err); // raw-error-ok: a log
    }
    store.setViewOnly(readOnly);
    // What the old key kept, or saw leave its view, is the old key's view:
    // the new key walks from 0, so what it sees syncs again and the rest stays
    // kept or left (conv. 151; `left_view`).
    // The old engine stops first, so no round of its writes the old cursor
    // back after the reset.
    try {
      const st = await store.readSyncState();
      if ((st.kept_outside_view?.length ?? 0) > 0 || (st.left_view?.length ?? 0) > 0) {
        if (getState().active?.worldId === entry.id) detachSyncEngine();
        await store.updateSyncState(() => ({ changes_cursor: null, changes_last_seq: null, walked_as_role: undefined }));
      }
    } catch (err) {
      console.warn('[world-key] the kept set\'s walk was not reset:', err); // raw-error-ok: a log
    }
    // Still this world's store, and still the open world, after the write
    // (the #198 gate's G2: a switch mid-write attached A's engine over B).
    if (getState().active?.worldId === entry.id && getActiveStore() === store) {
      attachSyncEngine(updated, store);
    }
  }
  return updated;
}

export type MakeKeyOutcome =
  | { kind: 'swapped'; readOnly: boolean; why?: ReadOnlyWhy; line: string }
  | { kind: 'gone'; line: string }
  | { kind: 'not-on-account'; line: string }
  | { kind: 'kept'; line: string }
  | { kind: 'cancelled' }
  | { kind: 'failed'; error?: unknown };

/**
 * Make a new key from the account token and put it in place. `keyDead`: the
 * key the world has now was refused, so a read key is still better than it;
 * otherwise (the button, the old key working) a read key that would not
 * change what the world can do is taken back and the reason said.
 */
export async function makeNewWorldKey(entry: WorldRegistryEntry, opts: { keyDead: boolean; cause?: KeyRefusal }): Promise<MakeKeyOutcome> {
  const token = getState().registry.account_token;
  if (!token || !canTakeNewKey(entry)) return { kind: 'failed' };
  const worldId = entry.api.world_id;
  const fetched = await accountWorldsWhenFetched(token, 15_000, { fresh: true });
  if (fetched === null) return { kind: 'failed' };
  const row: AccountWorldRow | undefined = getState().accountWorlds.rows.find(r => r.id === worldId);
  if (!row) {
    // Deleted or removed only when keel said it no longer knows the key; a
    // world linked with another account's key is simply not this one's (the
    // #198 gate's G3).
    return opts.cause === 'key_unknown'
      ? { kind: 'gone', line: `${entry.name} is no longer on your OnlyWorlds account: it was deleted there, or you were removed from it. Everything here stays as it is.` }
      : { kind: 'not-on-account', line: `${entry.name} is not on the OnlyWorlds account you are signed in with, so Atlas cannot make its key. Put in a key from the world's page on onlyworlds.com.` };
  }
  const client = new AccountClient(token);
  let minted: Awaited<ReturnType<typeof mintOwnKey>>;
  try {
    minted = await mintOwnKey(client, row);
  } catch (err) {
    return { kind: 'failed', error: err };
  }
  const takeBack = (): Promise<void> => client.revokeWorldKey(worldId, minted.minted.id).catch(() => {});
  if (minted.readOnly && !opts.keyDead && (entry.api.read_only || minted.why === 'no-pin')) {
    // Nothing gained: a read key for a world that reads, or one that would
    // take a working write key's place.
    await takeBack();
    return {
      kind: 'kept',
      line: minted.why === 'guest'
        ? `You are a guest in ${entry.name}, so its key can only read.`
        : `Editing ${entry.name} needs a PIN on your account, set on onlyworlds.com in Account settings under World PIN. Then make a new key here again.`,
    };
  }
  if (!minted.readOnly && !worldPin(entry, getState().registry)) {
    const pin = await new PinPromptModal().prompt(
      `${entry.name} has a new key: Atlas needs your OnlyWorlds PIN to save your edits. It is the one PIN of your account, set on onlyworlds.com in Account settings under World PIN.`
    );
    if (!pin) { await takeBack(); return { kind: 'cancelled' }; }
    const withPin = setPin(getState().registry, pin);
    saveRegistry(withPin);
    patchSlice('registry', withPin);
  }
  const current = getState().registry.worlds.find(w => w.id === entry.id);
  if (!canTakeNewKey(current) || current.api.world_id !== worldId) {
    // Unlinked or relinked while the key was made: it is not wanted.
    await takeBack();
    return { kind: 'failed' };
  }
  try {
    await putKeyInPlace(current, minted.minted.key, minted.readOnly);
  } catch (err) {
    // Taken back only if it never landed: a step after the registry save
    // must not leave the world on a revoked key (the #198 gate's G6).
    const landed = getState().registry.worlds.find(w => w.id === entry.id)?.api?.api_key === minted.minted.key;
    if (!landed) await takeBack();
    return { kind: 'failed', error: err };
  }
  const readLine = minted.readOnly ? sharedOpenLine(row, minted.why) : null;
  return {
    kind: 'swapped',
    readOnly: minted.readOnly,
    why: minted.why,
    line: readLine ?? `${entry.name} has a new key from your account. Sync is on again.`,
  };
}

/** Worlds whose refused key Atlas tried to replace this session: once each. */
const triedThisSession = new Set<string>();

/** The last refusal sync met per world, until a new key goes in (Settings reads it). */
const lastRefusal = new Map<string, KeyRefusal | undefined>();

/** Why sync last stopped on this world's key this session, or undefined. */
export function keyRefusalFor(worldId: string): KeyRefusal | undefined {
  return lastRefusal.get(worldId);
}

/** The reasons a new key can cure; a refused PIN is not the key's. */
export function newKeyCures(reason: KeyRefusal | undefined): boolean {
  return reason === 'key_revoked' || reason === 'key_unknown' || reason === 'read_only_key';
}

/**
 * Sync's answer to a refused key: signed in, make a new one, once per world
 * and session (a second refusal is a cause a key does not cure). Resolves to
 * the line to say, or null when the caller should say its own.
 */
export async function recoverRefusedKey(entry: WorldRegistryEntry, reason: KeyRefusal | undefined): Promise<{ ok: boolean; line: string } | null> {
  lastRefusal.set(entry.id, reason);
  if (!newKeyCures(reason) || !canMakeWorldKey(entry) || triedThisSession.has(entry.id)) return null;
  triedThisSession.add(entry.id);
  const outcome = await makeNewWorldKey(entry, { keyDead: true, cause: reason });
  if (outcome.kind === 'swapped') {
    return {
      ok: true,
      line: outcome.readOnly && outcome.line
        ? `OnlyWorlds no longer took ${entry.name}'s key, so Atlas made a new one from your account. ${outcome.line}`
        : `OnlyWorlds no longer took ${entry.name}'s key, so Atlas made a new one from your account. Sync is on again.`,
    };
  }
  if (outcome.kind === 'gone') return { ok: false, line: `Sync paused: ${outcome.line}` };
  return null;
}

/** Test seam: forget which worlds were tried. */
export function resetKeyRecoveryForTests(): void {
  triedThisSession.clear();
  lastRefusal.clear();
}
