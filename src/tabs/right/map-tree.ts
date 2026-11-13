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
 *   Phase 3 — order siblings by the standard's groups (sortRecursively), then
 *             by hierarchy ascending (default 0), name, id.
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
import { compareCodePoints } from '../../core/code-point';

/** Minimal shape we need from Location elements: id, parent_location, and the name that orders one
 *  location's set of maps against another's. */
export interface LocationLike {
  id: string;
  parent_location?: string;
  name?: string;
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
    // Never slot a node under one of its own descendants: a location chain
    // that loops (X inside Y, Y inside X) would hang two maps under each
    // other and drop both from the list.
    if (isDescendantOf(node, ancestorNode)) continue;

    ancestorNode.children.push(node);
    node.inferred = true;
    const idx = roots.indexOf(node);
    if (idx >= 0) roots.splice(idx, 1);
  }

  // -- Phase 3: order every sibling list by the standard's groups --
  const locNames = new Map<string, string>();
  for (const l of locations) if (typeof l.name === 'string') locNames.set(l.id, l.name);
  sortRecursively(roots, locNames);

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
        return nameOf(a).localeCompare(nameOf(b)) || compareCodePoints(String(a.id), String(b.id));
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

/**
 * Order one sibling list by the standard's groups (Map.hierarchy, serial 124):
 * the number orders the maps with the same parent_map; without one, the maps of
 * the same location; without either, the maps of the world itself. The tree is
 * a display that also places maps by inference, so a node's children (and the
 * top list) are cut into those groups first, and the number orders inside each:
 *   under a map: the maps whose parent_map is that map, then the maps placed
 *                there by location, one set per location;
 *   at the top:  the world's own maps (neither field), then located maps that
 *                found no map up their chain, one set per location, then maps
 *                whose parent_map is missing or loops, one set per parent_map.
 * Inside a set: hierarchy ascending (absent or not a finite number reads 0),
 * then name, then id by code point.
 */
function sortRecursively(nodes: MapTreeNode[], locNames: Map<string, string>): void {
  const world: MapTreeNode[] = [];
  const explicit: MapTreeNode[] = [];
  const byLocation = new Map<string, MapTreeNode[]>();
  const byBrokenParent = new Map<string, MapTreeNode[]>();
  for (const n of nodes) {
    const group = siblingGroupOf(n);
    if (group.kind === 'broken') push(byBrokenParent, group.key, n);
    else if (group.kind === 'parent') explicit.push(n);
    else if (group.kind === 'location') push(byLocation, group.key, n);
    else world.push(n);
  }
  const sets = (groups: Map<string, MapTreeNode[]>, label: (key: string) => string): MapTreeNode[] =>
    [...groups.entries()]
      .sort(([a], [b]) => label(a).localeCompare(label(b)) || compareCodePoints(a, b))
      .flatMap(([, set]) => set.sort(bySiblingOrder));
  const ordered = [
    ...world.sort(bySiblingOrder),
    ...explicit.sort(bySiblingOrder),
    ...sets(byLocation, (id) => locNames.get(id) ?? ''),
    ...sets(byBrokenParent, () => ''),
  ];
  nodes.splice(0, nodes.length, ...ordered);
  for (const n of nodes) sortRecursively(n.children, locNames);
}

/** Which of the standard's groups a node's map stands in among its siblings: its parent_map's, its location's,
 *  the world's own, or (a parent_map missing or looping) its broken parent's. Two siblings share a group exactly
 *  when `kind` and `key` are equal; only such maps are ordered against each other by hierarchy. */
export function siblingGroupOf(n: MapTreeNode): { kind: 'parent' | 'location' | 'world' | 'broken'; key: string } {
  const parent = typeof n.map.parent_map === 'string' && n.map.parent_map ? n.map.parent_map : null;
  const loc = typeof n.map.location === 'string' && n.map.location ? n.map.location : null;
  if (n.brokenParent && parent) return { kind: 'broken', key: parent };
  if (parent) return { kind: 'parent', key: parent };
  if (loc) return { kind: 'location', key: loc };
  return { kind: 'world', key: '' };
}

function push(groups: Map<string, MapTreeNode[]>, key: string, n: MapTreeNode): void {
  const set = groups.get(key);
  if (set) set.push(n);
  else groups.set(key, [n]);
}

function bySiblingOrder(a: MapTreeNode, b: MapTreeNode): number {
  const h = hierarchyOf(a.map) - hierarchyOf(b.map);
  if (h !== 0) return h;
  return nameOf(a.map).localeCompare(nameOf(b.map)) || compareCodePoints(String(a.map.id), String(b.map.id));
}

/** A foreign file's name may be anything: only a string orders as a name, anything else as none. */
function nameOf(m: WorldMap): string {
  return typeof m.name === 'string' ? m.name : '';
}

function hierarchyOf(m: WorldMap): number {
  return typeof m.hierarchy === 'number' && Number.isFinite(m.hierarchy) ? m.hierarchy : 0;
}

/**
 * Filter a tree by a case-insensitive substring match on map name. A node
 * survives the filter if its own name matches OR any descendant survives —
 * ancestry is preserved so context for a match is always visible.
 *
 * Pure function. Doesn't mutate the input.
 */
export function filterTreeByName(nodes: MapTreeNode[], term: string): MapTreeNode[] {
  const lower = term.toLowerCase();
  const result: MapTreeNode[] = [];
  for (const node of nodes) {
    const filteredChildren = filterTreeByName(node.children, term);
    const selfMatch = nameOf(node.map).toLowerCase().includes(lower);
    if (selfMatch || filteredChildren.length > 0) {
      result.push({ ...node, children: filteredChildren });
    }
  }
  return result;
}
