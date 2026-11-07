/**
 * The strand's part in the keep-safe card's ask, read one way for every caller: Home's card, the copy
 * note that stays quiet while the card asks, Settings and the path. Read only for the open world, the
 * one whose strand mark and elements the state holds.
 */

import { getState } from '../core/state';
import { strandView } from '../core/strand';
import { strandWhole } from '../core/strand-journey';
import { isKeptHere } from '../sync/sync-attach';
import type { KeepSafeStrand } from './home-keepsafe';

export function keepSafeStrand(worldId: string | null | undefined): KeepSafeStrand | null {
  const s = getState();
  if (!worldId || s.active?.worldId !== worldId) return null;
  const strand = strandView(s.active.meta, s.data.elements, id => isKeptHere(worldId, id));
  return { story: strand.narrative?.id ?? null, whole: strandWhole(strand) };
}
