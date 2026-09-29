/**
 * The URL after ids change (S363, re-key gate lens 3 F6). Pure.
 *
 * One rewriter for every route that carries an element id, used by the
 * re-key's live pass, by recovery (the tour's saved return hash) and by
 * Route 2's id swap. It replaced four hand-written branches in `handleIdSwap`
 * that sent `/timeline/<id>` to the element room, left `/writing/<id>` on the
 * old id, and kept a map route's old map id.
 *
 * Callers apply the result with `location.replace`, never `navigate`: Back
 * must not lead to an id that no longer exists.
 */
import {
  parseHash, elementHash, timelineHash, mapHash, writingHash,
  knowledgeHash, knowledgeKnowerHash, shareHash,
} from '../core/router';

/** The hash with every re-keyed id replaced, or null when nothing in it changes (or it is another world's). */
export function rekeyRouteHash(hash: string, worldId: string, map: ReadonlyMap<string, string>): string | null {
  const r = parseHash(hash);
  if (r.worldId !== worldId) return null;
  const moved = (id: string | undefined): boolean => !!id && map.has(id);
  const sw = (id: string | undefined): string | undefined => (id && map.get(id)) || id;
  switch (r.mode) {
    case 'element':
      return moved(r.elementId) ? elementHash(worldId, sw(r.elementId)!) : null;
    case 'timeline':
      return moved(r.elementId) ? timelineHash(worldId, sw(r.elementId)) : null;
    case 'map':
      if (!r.mapId || (!moved(r.mapId) && !moved(r.elementId))) return null;
      return mapHash(worldId, sw(r.mapId)!, sw(r.elementId));
    case 'writing':
      return moved(r.narrativeId) ? writingHash(worldId, sw(r.narrativeId)) : null;
    case 'knowledge':
      if (moved(r.knowerId)) return knowledgeKnowerHash(worldId, sw(r.knowerId)!);
      return moved(r.knowledgeId) ? knowledgeHash(worldId, sw(r.knowledgeId)) : null;
    case 'share':
      return moved(r.pageId) ? shareHash(worldId, sw(r.pageId)) : null;
    default:
      return null;
  }
}
