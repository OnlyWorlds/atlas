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
    case 'read_only_key': return 'This key can only read, so edits can\'t sync. Put in a write key in Settings, This world';
    case 'pin': return 'OnlyWorlds did not accept this World PIN. Check it in Settings, OnlyWorlds';
    default: return 'OnlyWorlds did not accept this world\'s key or the World PIN. Check the World PIN in Settings, or put in a new key in Settings, This world';
  }
}

/** The toast when sync stops on a refused key and Atlas cannot make a new one itself. */
export function keyRefusalLine(reason: KeyRefusal | null | undefined): string {
  switch (reason) {
    case 'key_revoked': return 'Sync paused: this world\'s key was revoked on onlyworlds.com. Put in a new key in Settings, This world. Everything here stays as it is.';
    case 'key_unknown': return 'Sync paused: OnlyWorlds no longer knows this world\'s key. The world was deleted there, or you were removed from it. If you can still open it on onlyworlds.com, put in a new key in Settings, This world.';
    case 'read_only_key': return 'Sync paused: this world\'s key can only read, so your edits can\'t sync. Put in a write key in Settings, This world.';
    case 'pin': return 'Sync paused: OnlyWorlds did not accept this World PIN. Check it in Settings, OnlyWorlds.';
    default: return 'Sync paused: OnlyWorlds did not accept this world\'s key or the World PIN. Check the World PIN in Settings, OnlyWorlds, or put in a new key in Settings, This world.';
  }
}

/**
 * A seat world's refusal (conv. 132): its key comes back only to the sponsor
 * who renews it (SeatCreated, no join link,
 * 2026-10-16), so no line offers a paste. A renewal reads as `key_revoked`.
 */
export function seatRefusalLine(reason: KeyRefusal | null | undefined, opts: { paused?: boolean } = { paused: true }): string {
  const lead = opts.paused ? 'Sync paused: ' : '';
  if (reason === 'key_revoked') return `${lead}${opts.paused ? 'this' : 'This'} seat's key was renewed or revoked on onlyworlds.com.`;
  if (reason === 'pin') return `${lead}OnlyWorlds did not accept this seat secret.`;
  return `${lead}OnlyWorlds no longer accepts this world's seat. The owner may have removed it.`;
}

/** A seat world's pill title: its refusal, short, as `keyRefusalPill` is (no closing stop). */
export function seatRefusalPill(reason: KeyRefusal | null | undefined): string {
  return seatRefusalLine(reason, { paused: false }).replace(/\.$/, '');
}

/** Whose key a world holds, for a line that says what to do when it is refused. */
export type HeldKeyKind = 'account' | 'read' | 'seat';

/**
 * A cleared world's Download it again, refused for its key: what happened, then the ways back its row
 * offers (Remove from the list, then a new way in; Open a world file). Never Retry: the same key is
 * refused again. Null when the refusal is not about the key, for the caller's general line. The step
 * reads only, so a PIN refusal cannot reach here but for a legacy key, which the general line words.
 *
 * A key keel no longer knows means the world was deleted or the person removed (keel's `live_prefixed_key`),
 * so a new way in is offered only as "if". A world file restores into the row on its refused key: an
 * account world takes a new key in Settings, This world; a read or seat world cannot, and a new link then
 * meets it as already here, so its file is named as a copy that no longer syncs.
 */
export function clearedKeyRefusalLine(err: unknown, kind: HeldKeyKind): string | null {
  const reason = keyRefusalOf(err);
  if (reason !== 'key_revoked' && reason !== 'key_unknown') return null;
  const revoked = reason === 'key_revoked';
  const what = kind === 'seat'
    ? (revoked ? 'This seat\'s key was renewed or revoked on onlyworlds.com' : 'OnlyWorlds no longer accepts this world\'s seat')
    : (revoked ? 'This world\'s key was revoked on onlyworlds.com' : 'OnlyWorlds no longer knows this world\'s key');
  const why = revoked ? '' : kind === 'seat' ? ' The owner may have removed it.' : ' The world was deleted there, or you were removed from it.';
  const way = kind === 'account'
    ? (revoked ? 'To bring it back, remove it from your list and open it again from onlyworlds.com.'
      : 'If you can still open it on onlyworlds.com, remove it from your list and open it again from there.')
    : kind === 'read'
      ? `${revoked ? 'To bring it back, remove' : 'If it is still shared with you, remove'} it from your list and open it again by a new link or key from whoever shared it.`
      : 'To bring it back, remove it from your list and open it again by a new link from whoever made the seat.';
  const file = kind === 'account' ? ' A world file of it brings it back too.'
    : ' Or open a world file of it instead: that brings it back as a copy that no longer syncs.';
  return `${what}, so Atlas could not download it again. Nothing changed.${why} ${way}${file}`;
}

/** Test connection's answer, said in Settings, This world, where the key goes in. */
export function keyRefusalHere(reason: KeyRefusal | null | undefined): string {
  switch (reason) {
    case 'key_revoked': return 'This world\'s key was revoked. Put in a new key below.';
    case 'key_unknown': return 'OnlyWorlds no longer knows this world\'s key. The world was deleted there, or you were removed from it. If you can still open it on onlyworlds.com, put in a new key below.';
    case 'read_only_key': return 'This key can only read, so edits can\'t sync. Put in a write key below.';
    case 'pin': return 'OnlyWorlds did not accept this World PIN. Check it on the OnlyWorlds tab.';
    default: return 'OnlyWorlds did not accept this world\'s key or the World PIN. Check the World PIN on the OnlyWorlds tab, or put in a new key below.';
  }
}
