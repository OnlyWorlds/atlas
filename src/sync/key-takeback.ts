/**
 * Taking back the world keys Atlas minted (#814). Since 1.96.0 every key Atlas
 * mints carries `keep: true`, so keel's sweep of a revoked sign-in token (Keel
 * #779) leaves it live; nothing else would ever take it back, and a world Atlas
 * forgets would leave a live write key on the account's keys page for good.
 *
 * SCOPE: browser worlds only. A folder world's key lives in its `world.json`,
 * and any Atlas that opens a copy of the folder (another browser, a git clone,
 * Dropbox) syncs on that same key with no record of its own; revoking it would
 * stop a live copy elsewhere (the S492 contract gate, G1). A browser world's
 * files are in OPFS and never copied, so its key is this browser's alone.
 *
 * The record (`api.key_mint = { id, tail }`) is written at every mint, in the
 * registry only. `mintedKeyId` honours it only while `api_key` still ends with
 * `tail` and `id` is a UUID: a pasted key, a seat's key or a relinked world
 * reads as not Atlas's, and nothing is revoked.
 */

import { isTokenId } from '../registry/registry';
import { isBrowserWorld } from '../core/browser-worlds';
import { AccountClient } from './account-client';
import { getState } from '../core/state';
import type { WorldRegistryEntry } from '../core/types';

/** The record written at a mint: the key's id, and the last 8 chars of the key. */
export interface KeyMint {
  id: string;
  tail: string;
}

/** The record for a freshly minted key, or undefined when the id is no UUID. */
export function mintRecordOf(key: string, id: string | undefined): KeyMint | undefined {
  if (!isTokenId(id) || typeof key !== 'string' || key.length < 8) return undefined;
  return { id, tail: key.slice(-8) };
}

/**
 * The id of the key Atlas minted for this world, only when Atlas minted the key
 * the world holds now: a UUID recorded beside a key whose tail still matches.
 * Anything else (a pasted key, a key swapped by a path that did not record it,
 * a relinked world) reads as not Atlas's, and is never revoked.
 */
export function mintedKeyId(entry: Pick<WorldRegistryEntry, 'api'> | null | undefined): string | null {
  const api = entry?.api;
  const mint = api?.key_mint;
  if (!api || !mint || !isTokenId(mint.id) || typeof mint.tail !== 'string' || mint.tail.length !== 8) return null;
  return typeof api.api_key === 'string' && api.api_key.endsWith(mint.tail) ? mint.id : null;
}

const TAKE_BACK_LIMIT_MS = 8000;

/**
 * Take back the key Atlas minted for a world that is leaving this browser, by
 * the id kept at its mint and only while it is still that key (`mintedKeyId`).
 * Browser worlds only. Quiet and bounded: no account token, not a browser
 * world, or no honoured record → nothing is sent; offline or refused → the key
 * stays listed on the account's keys page, where it can be removed. The caller
 * runs this only after the local removal has committed (the contract's T3), so
 * the answer never changes anything here.
 *
 * `read` lets a test see the DELETE without the network; default is the real
 * AccountClient.
 */
export async function takeBackMintedKey(
  entry: Pick<WorldRegistryEntry, 'api' | 'where'> | null | undefined,
  read: (token: string, worldId: string, keyId: string) => Promise<void> = realRevoke,
): Promise<boolean> {
  if (!isBrowserWorld(entry)) return false;
  const id = mintedKeyId(entry);
  const worldId = entry?.api?.world_id;
  const token = getState().registry.account_token;
  if (!id || !worldId || !token) return false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      read(token, worldId, id),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), TAKE_BACK_LIMIT_MS); }), // raw-error-ok: never shown
    ]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function realRevoke(token: string, worldId: string, keyId: string): Promise<void> {
  return new AccountClient(token).revokeWorldKey(worldId, keyId);
}
