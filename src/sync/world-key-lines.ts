/**
 * What Atlas says when keel refuses a linked world's key (#198): the cause
 * keel named, then the fix, which is never Unlink: a new key goes in place in
 * Settings, This world (`src/sync/world-key.ts`), and signed in Atlas makes
 * one itself. Pure, so the engine's pill and the UI's toasts share it.
 */

import type { KeyRefusal } from '../core/types';

/** Read a keel error as a key refusal, or null when it is not one of the four. */
export function keyRefusalOf(err: unknown): KeyRefusal | null {
  if (!(err instanceof Error)) return null;
  const e = err as Error & { status?: unknown; code?: unknown; param?: unknown };
  if (typeof e.status !== 'number' || typeof e.code !== 'string') return null;
  if (e.code === 'key_revoked') return 'key_revoked';
  if (e.code === 'permission_error') return 'read_only_key';
  if (e.code === 'invalid_credentials') return e.param === 'API-Pin' ? 'pin' : 'key_unknown';
  return null;
}

/** The sync pill's title: the cause and the fix, short. */
export function keyRefusalPill(reason: KeyRefusal | null | undefined): string {
  switch (reason) {
    case 'key_revoked': return 'This world\'s key was revoked. Put in a new key in Settings, This world';
    case 'key_unknown': return 'OnlyWorlds no longer knows this world\'s key: the world was deleted there, or you were removed from it';
    case 'read_only_key': return 'This is a read key, so edits can\'t sync. Put in a write key in Settings, This world';
    case 'pin': return 'OnlyWorlds did not accept your PIN. Check it in Settings, OnlyWorlds';
    default: return 'OnlyWorlds did not accept this world\'s key or your PIN. Check your PIN in Settings, or put in a new key in Settings, This world';
  }
}

/** The toast when sync stops on a refused key and Atlas cannot make a new one itself. */
export function keyRefusalLine(reason: KeyRefusal | null | undefined): string {
  switch (reason) {
    case 'key_revoked': return 'Sync paused: this world\'s key was revoked on onlyworlds.com. Put in a new key in Settings, This world. Everything here stays as it is.';
    case 'key_unknown': return 'Sync paused: OnlyWorlds no longer knows this world\'s key. The world was deleted there, or you were removed from it. If you can still open it on onlyworlds.com, put in a new key in Settings, This world.';
    case 'read_only_key': return 'Sync paused: this world\'s key can only read, so your edits can\'t sync. Put in a write key in Settings, This world.';
    case 'pin': return 'Sync paused: OnlyWorlds did not accept your PIN. Check it in Settings, OnlyWorlds.';
    default: return 'Sync paused: OnlyWorlds did not accept this world\'s key or your PIN. Check your PIN in Settings, OnlyWorlds, or put in a new key in Settings, This world.';
  }
}

/**
 * A seat world's refusal (conv. 132): its key comes back only to the sponsor
 * who renews it (SeatCreated, no join link; Skeld,
 * 2026-10-16), so no line offers a paste. A renewal reads as `key_revoked`.
 */
export function seatRefusalLine(reason: KeyRefusal | null | undefined, opts: { paused?: boolean } = { paused: true }): string {
  const lead = opts.paused ? 'Sync paused: ' : '';
  if (reason === 'key_revoked') return `${lead}${opts.paused ? 'this' : 'This'} seat's key was renewed or revoked on onlyworlds.com.`;
  if (reason === 'pin') return `${lead}OnlyWorlds did not accept this seat's secret.`;
  return `${lead}OnlyWorlds no longer accepts this world's seat. The owner may have removed it.`;
}

/** Test connection's answer, said in Settings, This world, where the key goes in. */
export function keyRefusalHere(reason: KeyRefusal | null | undefined): string {
  switch (reason) {
    case 'key_revoked': return 'This world\'s key was revoked. Put in a new key below.';
    case 'key_unknown': return 'OnlyWorlds no longer knows this world\'s key. The world was deleted there, or you were removed from it. If you can still open it on onlyworlds.com, put in a new key below.';
    case 'read_only_key': return 'This is a read key, so edits can\'t sync. Put in a write key below.';
    case 'pin': return 'OnlyWorlds did not accept your PIN. Check it on the OnlyWorlds tab.';
    default: return 'OnlyWorlds did not accept this world\'s key or your PIN. Check your PIN on the OnlyWorlds tab, or put in a new key below.';
  }
}
