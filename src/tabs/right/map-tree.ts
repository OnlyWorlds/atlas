/**
 * buildMapTree — pure function turning (maps, locations) into a sorted tree.
 *
 * Algorithm (DESIGN_MAPS.md §2):
 *   Phase 1 — explicit parent_map edges. Dangling parent_map → root + broken.
 *             Cycle defense: cycles fall back to root + broken.
 *   Phase 2 — location-inferred placement. For each root with a `location` and
 *             no parent_map, walk the location's parent chain; the first
 *             ancestor location that owns a map becomes the inferred parent.
 *             Maps that find no ancestor stay at root with a chip.
 *   Phase 3 — sort siblings by hierarchy ascending (default 0), alpha-tied.
 *
 * The output is pure and deterministic — same inputs, same tree.
 *
 * Each node is annotated:
 *   - `brokenParent`: this map's parent_map points to a missing map id OR
 *     creates a cycle. Surfaces a warning chip in the UI.
 *   - `inferred`: this map was placed via location-chain inference (Phase 2),
 *     not by an explicit parent_map link.
 */

import type { WorldMap } from '../../core/types';

/** Minimal shape we need from Location elements — just id + parent_location. */
export interface LocationLike {
  id: string;
  parent_location?: string;
}

export interface MapTreeNode {
  map: WorldMap;
  children: MapTreeNode[];
  /** True iff parent_map points to a missing map OR creates a cycle. */
  brokenParent?: boolean;
  /** True iff this node was placed via location-chain inference. */
  inferred?: boolean;
}

export function buildMapTree(maps: readonly WorldMap[], locations: readonly LocationLike[]): MapTreeNode[] {
  const nodeById = new Map<string, MapTreeNode>();
  for (const m of maps) nodeById.set(m.id, { map: m, children: [] });

  const mapById = new Map<string, WorldMap>();
  for (const m of maps) mapById.set(m.id, m);

  const locById = new Map<string, LocationLike>();
  for (const l of locations) locById.set(l.id, l);

  // Group maps by their location field — needed for ancestor-map lookup.
  const mapsByLocation = new Map<string, WorldMap[]>();
  for (const m of maps) {
    if (typeof m.location === 'string' && m.location) {
      const arr = mapsByLocation.get(m.location) ?? [];
      arr.push(m);
      mapsByLocation.set(m.location, arr);
    }
  }

  // -- Phase 1: explicit parent_map edges --
  const roots: MapTreeNode[] = [];
  for (const m of maps) {
    const node = nodeById.get(m.id)!;
    const parentId = typeof m.parent_map === 'string' ? m.parent_map : undefined;
    if (!parentId) {
      roots.push(node);
      continue;
    }
    const parentNode = nodeById.get(parentId);
    if (!parentNode) {
      node.brokenParent = true;
      roots.push(node);
      continue;
    }
    if (wouldCreateCycle(m.id, parentId, mapById)) {
      node.brokenParent = true;
      roots.push(node);
      continue;
    }
    parentNode.children.push(node);
  }

  // -- Phase 2: location-inferred placement for orphan loc-bound roots --
  // Snapshot before mutating — we may remove entries from roots.
  const rootSnapshot = [...roots];
  for (const node of rootSnapshot) {
    const m = node.map;
    if (node.brokenParent) continue;             // leave broken at root
    if (typeof m.parent_map === 'string' && m.parent_map) continue; // explicit already placed
    if (typeof m.location !== 'string' || !m.location) continue;    // no location anchor

    const ancestorMapId = findInferredParent(m, locById, mapsByLocation);
    if (!ancestorMapId || ancestorMapId === m.id) continue;
    const ancestorNode = nodeById.get(ancestorMapId);
    if (!ancestorNode) continue;
    // Don't slot a node under itself transitively. (Defensive.)
    if (isDescendantOf(ancestorNode, node)) continue;

    ancestorNode.children.push(node);
    node.inferred = true;
    const idx = roots.indexOf(node);
    if (idx >= 0) roots.splice(idx, 1);
  }

  // -- Phase 3: sort recursively --
  sortRecursively(roots);
  for (const n of nodeById.values()) sortRecursively(n.children);

  return roots;
}

function findInferredParent(
  m: WorldMap,
  locById: Map<string, LocationLike>,
  mapsByLocation: Map<string, WorldMap[]>,
): string | null {
  const start = typeof m.location === 'string' ? m.location : undefined;
  if (!start) return null;
  // Walk up the location parent chain starting from m.location's PARENT.
  // A map at location X is not its own parent — we want the first ancestor
  // location that has a map, not X itself.
  let locId: string | undefined = locById.get(start)?.parent_location;
  let depth = 0;
  while (locId && depth < 100) {
    depth++;
    const candidates = mapsByLocation.get(locId);
    if (candidates && candidates.length > 0) {
      // When multiple maps anchor to the same location, prefer one without
      // its own parent_map (it'll be a more direct ancestor in the tree).
      // Ties broken by alpha for determinism.
      const sorted = [...candidates].sort((a, b) => {
        const aHasParent = !!(typeof a.parent_map === 'string' && a.parent_map);
        const bHasParent = !!(typeof b.parent_map === 'string' && b.parent_map);
        if (aHasParent !== bHasParent) return aHasParent ? 1 : -1;
        return (a.name ?? '').localeCompare(b.name ?? '');
      });
      return sorted[0].id;
    }
    const loc = locById.get(locId);
    locId = loc?.parent_location;
  }
  return null;
}

function wouldCreateCycle(
  childId: string,
  proposedParentId: string,
  mapById: Map<string, WorldMap>,
): boolean {
  let cur: string | undefined = proposedParentId;
  let depth = 0;
  while (cur && depth < 1000) {
    if (cur === childId) return true;
    const parent = mapById.get(cur);
    cur = typeof parent?.parent_map === 'string' ? parent.parent_map : undefined;
    depth++;
  }
  return false;
}

function isDescendantOf(maybeAncestor: MapTreeNode, candidate: MapTreeNode): boolean {
  if (maybeAncestor === candidate) return true;
  for (const c of maybeAncestor.children) {
    if (isDescendantOf(c, candidate)) return true;
  }
  return false;
}

function sortRecursively(nodes: MapTreeNode[]): void {
  nodes.sort((a, b) => {
    const aH = typeof a.map.hierarchy === 'number' ? a.map.hierarchy : 0;
    const bH = typeof b.map.hierarchy === 'number' ? b.map.hierarchy : 0;
    if (aH !== bH) return aH - bH;
    return (a.map.name ?? '').localeCompare(b.map.name ?? '');
  });
  // Children of each node are sorted in the caller's outer loop too, but
  // sorting in-place here ensures recursion if a node's children weren't
  // visited externally.
  for (const n of nodes) sortRecursively(n.children);
}
