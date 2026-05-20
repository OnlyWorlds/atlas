/**
 * Shared helpers for the writing system.
 *
 * The model (locked session 224):
 *   - Narratives are in the writing tree iff their `supertype` matches one of
 *     the four configured labels for the world (`writing_labels.l1`–`l4`).
 *   - Tier is determined directly by supertype value (no canonical/display
 *     split — what you see is what's stored).
 *   - Subtype is FREE for the user (vision, flashback, research-note, etc.) —
 *     atlas never sets it during writing-create.
 *   - Position is via `parent_narrative` + `order`.
 *
 * Defaults: Book / Chapter / Scene / Draft.
 *
 * See DESIGN_WRITING.md for the full spec.
 */

import { getState } from '../core/state';
import type { Element, WorldRegistryEntry } from '../core/types';

export type WritingTier = 'l1' | 'l2' | 'l3' | 'l4' | null;

export interface WritingLabels {
  l1: string;
  l2: string;
  l3: string;
  l4: string;
}

export const DEFAULT_WRITING_LABELS: WritingLabels = {
  l1: 'Book',
  l2: 'Chapter',
  l3: 'Scene',
  l4: 'Draft',
};

/**
 * Resolve writing labels for a world. Always returns a complete set —
 * missing fields fall back to defaults, so callers can rely on l1-l4 being
 * present strings.
 */
export function getWritingLabels(worldId: string): WritingLabels {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  return mergeLabels(entry?.writing_labels);
}

export function mergeLabels(partial: Partial<WritingLabels> | undefined): WritingLabels {
  return {
    l1: partial?.l1 ?? DEFAULT_WRITING_LABELS.l1,
    l2: partial?.l2 ?? DEFAULT_WRITING_LABELS.l2,
    l3: partial?.l3 ?? DEFAULT_WRITING_LABELS.l3,
    l4: partial?.l4 ?? DEFAULT_WRITING_LABELS.l4,
  };
}

/**
 * Returns the tier of a Narrative based on its supertype, or null if it's not
 * in the writing tree for this world. Tier is the registry key (`l1`/`l2`/…)
 * not the display label, so callers can compare tiers stably even when the
 * user renames labels.
 */
export function getTierForNarrative(el: Element, worldId: string): WritingTier {
  if (el.type !== 'narrative') return null;
  const supertype = (el as Element & { supertype?: string | null }).supertype;
  if (!supertype) return null;
  const labels = getWritingLabels(worldId);
  if (supertype === labels.l1) return 'l1';
  if (supertype === labels.l2) return 'l2';
  if (supertype === labels.l3) return 'l3';
  if (supertype === labels.l4) return 'l4';
  return null;
}

/** True iff this narrative is part of the writing tree for the given world. */
export function isWritingNarrative(el: Element, worldId: string): boolean {
  return getTierForNarrative(el, worldId) !== null;
}

/**
 * Resolve the supertype value to write when creating a narrative at the given
 * tier. Always returns the current label for that tier — storage matches
 * display by design.
 */
export function supertypeForTier(tier: 'l1' | 'l2' | 'l3' | 'l4', worldId: string): string {
  const labels = getWritingLabels(worldId);
  return labels[tier];
}

/**
 * Build the writing-room URL hash for a given narrative by walking its
 * parent_narrative chain to recover the (bookId, chapterId, sceneId) trio.
 * Use when navigating within writing mode after creating/selecting a
 * narrative — keeps the user in the writing room.
 */
/**
 * Emit the writing-room URL for a specific narrative. After the URL scheme
 * shortening (session 227), this is a trivial wrapper around `writingHash`
 * — ancestry is no longer encoded in the URL. The `elements` arg is kept on
 * the signature for caller back-compat but is unused.
 */
export function writingHashForNarrative(
  worldId: string,
  narrativeId: string,
  _elements?: Element[],
): string {
  return `#/w/${worldId}/writing/${narrativeId}`;
}

/**
 * Icon to render for a tier. Drafts (l4) get a distinct icon to signal their
 * flexible nature.
 */
export function iconForTier(tier: WritingTier): string {
  switch (tier) {
    case 'l1': return 'menu_book';
    case 'l2': return 'article';
    case 'l3': return 'short_text';
    case 'l4': return 'edit_note';
    default: return 'description';
  }
}

/**
 * Tier index 0-3 for sorting / depth comparison. Drafts are treated as a
 * separate tier with no canonical depth — `tierIndex('l4')` returns 3 but
 * the writing tree doesn't enforce depth-3 placement for drafts.
 */
export function tierIndex(tier: WritingTier): number {
  switch (tier) {
    case 'l1': return 0;
    case 'l2': return 1;
    case 'l3': return 2;
    case 'l4': return 3;
    default: return -1;
  }
}

/**
 * Whether a tier has structural constraints atlas enforces at create time.
 *   l1 (Book): no parent required
 *   l2 (Chapter): requires parent_narrative
 *   l3 (Scene): requires parent_narrative
 *   l4 (Draft): no constraints — flexible parent
 */
export function tierConstraints(tier: 'l1' | 'l2' | 'l3' | 'l4'): {
  requiresParent: boolean;
  allowsChildren: boolean;
} {
  switch (tier) {
    case 'l1': return { requiresParent: false, allowsChildren: true };
    case 'l2': return { requiresParent: true, allowsChildren: true };
    case 'l3': return { requiresParent: true, allowsChildren: false };
    case 'l4': return { requiresParent: false, allowsChildren: true };
  }
}

// ====== Tree building (consolidated from writing-sidebar / writing) ======

export interface NarrativeNode {
  el: Element;
  tier: WritingTier;
  children: NarrativeNode[];
  depth: number;
}

export interface NarrativeIndex {
  roots: NarrativeNode[];
  byId: Map<string, NarrativeNode>;
}

/**
 * Build the writing tree from a flat list of elements. Filters to narratives
 * whose supertype matches one of the writing labels (`isWritingNarrative`),
 * links them by `parent_narrative`, assigns depth via BFS, and sorts every
 * sibling group by `order` then name.
 *
 * Used by both the sidebar tree and the writing-room dispatcher.
 */
export function buildNarrativeIndex(elements: Element[], worldId: string): NarrativeIndex {
  const writingNarratives = elements.filter(e => isWritingNarrative(e, worldId));
  const byId = new Map<string, NarrativeNode>();
  for (const el of writingNarratives) {
    byId.set(el.id, { el, tier: getTierForNarrative(el, worldId), children: [], depth: 0 });
  }
  const roots: NarrativeNode[] = [];
  for (const node of byId.values()) {
    const parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const queue: NarrativeNode[] = roots.map(r => { r.depth = 0; return r; });
  while (queue.length > 0) {
    const n = queue.shift()!;
    for (const child of n.children) {
      child.depth = n.depth + 1;
      queue.push(child);
    }
  }
  const orderFn = (a: NarrativeNode, b: NarrativeNode) => {
    const ao = (a.el as Element & { order?: number }).order ?? 0;
    const bo = (b.el as Element & { order?: number }).order ?? 0;
    if (ao !== bo) return ao - bo;
    return (a.el.name ?? '').localeCompare(b.el.name ?? '');
  };
  const sortTree = (nodes: NarrativeNode[]): void => {
    nodes.sort(orderFn);
    for (const n of nodes) sortTree(n.children);
  };
  sortTree(roots);
  return { roots, byId };
}

/** Walk up `parent_narrative` from `id`, returning ancestor ids closest-first. */
export function ancestorIds(idx: NarrativeIndex, id: string): string[] {
  const out: string[] = [];
  const cur = idx.byId.get(id);
  let parentId = cur ? (cur.el as Element & { parent_narrative?: string }).parent_narrative : undefined;
  while (parentId) {
    out.push(parentId);
    const parent = idx.byId.get(parentId);
    if (!parent) break;
    parentId = (parent.el as Element & { parent_narrative?: string }).parent_narrative;
  }
  return out;
}

/**
 * Resolve the ancestry of a narrative as a {bookId, chapterId, sceneId} trio.
 * Walks `parent_narrative` to the root and assigns slots by depth. Returns an
 * empty object if the narrative isn't in the index.
 */
export function findAncestry(idx: NarrativeIndex, id: string): { bookId?: string; chapterId?: string; sceneId?: string } {
  const node = idx.byId.get(id);
  if (!node) return {};
  const chain: NarrativeNode[] = [node];
  let parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
  while (parentId) {
    const parent = idx.byId.get(parentId);
    if (!parent) break;
    chain.unshift(parent);
    parentId = (parent.el as Element & { parent_narrative?: string }).parent_narrative;
  }
  return {
    bookId: chain[0]?.el.id,
    chapterId: chain[1]?.el.id,
    sceneId: chain[2]?.el.id,
  };
}

/** Next `order` value for a new sibling under `parentId` (null = root). */
export function nextOrder(idx: NarrativeIndex, parentId: string | null): number {
  const siblings = parentId
    ? (idx.byId.get(parentId)?.children ?? [])
    : idx.roots;
  let max = -1;
  for (const s of siblings) {
    const o = (s.el as Element & { order?: number }).order ?? 0;
    if (o > max) max = o;
  }
  return max + 1;
}

/**
 * Resolve `writing_initialized` with smart-default semantics. A world is
 * effectively initialized when either:
 *   - The user has explicitly completed setup (`writing_initialized === true`)
 *   - There is no narrative structure that warrants a setup decision
 *
 * Worlds with structured narratives (parent chains) but no `writing_initialized`
 * flag → setup screen should appear (returns false here).
 *
 * Fresh worlds with no narratives → return true (no decision to make; user
 * can use writing room with defaults; settings cog re-opens setup later).
 */
export function isWritingInitialized(
  entry: WorldRegistryEntry | undefined,
  elements: Element[],
): boolean {
  if (entry?.writing_initialized) return true;
  // Detect "writing-shaped" candidates: narratives in a parent_narrative
  // chain. If any exist without supertype matching a writing label, the
  // setup screen should run.
  const narratives = elements.filter(e => e.type === 'narrative');
  if (narratives.length === 0) return true; // nothing to decide
  // If every narrative already has a writing-tree supertype, treat as inited.
  // (Could be a world filled by another tool that happens to use Book/Chapter/Scene.)
  const labels = mergeLabels(entry?.writing_labels);
  const writingValues = new Set([labels.l1, labels.l2, labels.l3, labels.l4]);
  const anyStructured = narratives.some(n => {
    const parent = (n as Element & { parent_narrative?: string }).parent_narrative;
    return Boolean(parent);
  });
  if (!anyStructured) return true; // narratives exist but no hierarchy
  const allInTree = narratives.every(n => {
    const supertype = (n as Element & { supertype?: string | null }).supertype;
    return supertype != null && writingValues.has(supertype);
  });
  return allInTree;
}
