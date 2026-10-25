/**
 * Is the active world view-only? (`api.read_only`: opened with a read key, a
 * player's link included; or a view-only copy, `copy_of`, conv. 177.) The
 * store refuses every UI write there (`folder-store-fs.ts`), so a surface
 * that would start one asks this first and offers nothing it would refuse
 * (conv. 149). Automatic writes (a mount's self-heal, a reconcile) skip
 * quietly on the same answer.
 *
 * Reads URL-independent state: the active world's registry entry, which the
 * element page's render gate and every room already watch.
 */
import { getState } from './state';
import type { WorldRegistryEntry } from './types';

/** A registry entry that is view-only here: a read key's world, or a copy. */
export function entryIsViewOnly(entry: WorldRegistryEntry | null | undefined): boolean {
  return !!entry && (!!entry.api?.read_only || !!entry.copy_of);
}

export function worldIsViewOnly(worldId: string | null | undefined = getState().active?.worldId): boolean {
  if (!worldId) return false;
  return entryIsViewOnly(getState().registry.worlds.find(w => w.id === worldId));
}
