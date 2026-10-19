/**
 * Is the active world view-only? (`api.read_only`: opened with a read key, a
 * player's link included.) The store refuses every UI write there
 * (`folder-store-fs.ts`), so a surface that would start one asks this first
 * and offers nothing it would refuse (conv. 149). Automatic writes (a mount's
 * self-heal, a reconcile) skip quietly on the same answer.
 *
 * Reads URL-independent state: the active world's registry entry, which the
 * element page's render gate and every room already watch.
 */
import { getState } from './state';

export function worldIsViewOnly(worldId: string | null | undefined = getState().active?.worldId): boolean {
  if (!worldId) return false;
  return !!getState().registry.worlds.find(w => w.id === worldId)?.api?.read_only;
}
