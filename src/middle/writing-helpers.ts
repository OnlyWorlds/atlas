/**
 * Shared helpers for the writing system.
 *
 * The model:
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
import { isStoryNarrative } from '../core/narrative-kind';
import { playNarrativeIds } from '../core/records';
import type { Element, WorldRegistryEntry } from '../core/types';
import { entryIsViewOnly } from '../core/view-only';

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

/** A label's plural, as the writing room says it ("chapters", "stories"). */
export function pluralize(word: string): string {
  if (word.endsWith('s')) return word;
  if (word.endsWith('y')) return word.slice(0, -1) + 'ies';
  return word + 's';
}

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
 * shortening, this is a trivial wrapper around `writingHash`
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

/**
 * The empty Book's line (1.121.0; its words 1.122.0), derived, no stored flag: while an opened Narrative at tier l1 has no child
 * at tier l2 (a Draft does not count), in a world that is not view-only, the workspace body's top says how
 * narratives nest and that the tiers can be renamed, in the world's own labels. Null for a Chapter, a Scene, a Draft, a Book with a part, or a
 * view-only world.
 */
export function emptyBookLine(el: Element, elements: readonly Element[], worldId: string, viewOnly: boolean): string | null {
  if (viewOnly || el.type !== 'narrative' || getTierForNarrative(el, worldId) !== 'l1') return null;
  const hasPart = elements.some(e => e.type === 'narrative'
    && (e as Element & { parent_narrative?: string }).parent_narrative === el.id
    && getTierForNarrative(e, worldId) === 'l2');
  if (hasPart) return null;
  // 1.122.0 (W8): the three tiers in the world's own names, plural and lower case, a blank one its default.
  const l = getWritingLabels(worldId);
  const tier = (label: string | undefined, fallback: string): string => pluralize((label ?? '').trim().toLowerCase() || fallback);
  return `Narratives nest as ${tier(l.l1, 'book')}, ${tier(l.l2, 'chapter')} and ${tier(l.l3, 'scene')}, and you can rename these tiers in Settings. Press + to add the first.`;
}

/** Walk up `parent_narrative` from `id`, returning ancestor ids closest-first. */
export function ancestorIds(idx: NarrativeIndex, id: string): string[] {
  const out: string[] = [];
  // A parent cycle in world data would loop (and grow `out`) forever; stop at
  // the first repeat.
  const seen = new Set<string>([id]);
  const cur = idx.byId.get(id);
  let parentId = cur ? (cur.el as Element & { parent_narrative?: string }).parent_narrative : undefined;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
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
  const seen = new Set<string>([id]); // cycle guard
  let parentId = (node.el as Element & { parent_narrative?: string }).parent_narrative;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
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
  // setup screen should run. Only STORY narratives count — knowledge entries
  // and sharing pages have their own rooms and must not trip the writing
  // setup heuristics (their subtypes never match writing labels, which would
  // otherwise make `allInTree` false forever).
  // A game's runs (a record's chronicle and its stories, core/records.ts:
  // a Narrative listing a record Event, or under one that does) are recorded
  // ARTIFACTS, not writing structure: they arrive as parent_narrative chains
  // whose supertype can never match a writing label, so without this carve
  // one recorded battle flipped the whole writing room to the setup screen
  // (an old hijack class through a new door; caught 2026-07-19 checking the
  // tangle seam). Read by belonging, never by a word; proposed runs too.
  const fromPlay = playNarrativeIds(elements);
  const narratives = elements.filter(e => isStoryNarrative(e) && !fromPlay.has(e.id));
  if (narratives.length === 0) return true; // nothing to decide
  // Only CHAIN MEMBERS (a narrative with a parent, or one that IS a parent)
  // warrant a setup decision. A loose supertype-less narrative — e.g. the
  // home tour's create card, or any plain element-create — is not structure,
  // and judging it here hijacked the whole writing room with the setup
  // screen the moment a book+chapter chain existed beside it (Titus's
  // repro). Setup still fires for genuinely foreign chained structures
  // (imported worlds whose tiers use other labels).
  const parentIds = new Set(
    narratives
      .map(n => (n as Element & { parent_narrative?: string }).parent_narrative)
      .filter((v): v is string => Boolean(v)),
  );
  const chainMembers = narratives.filter(n =>
    Boolean((n as Element & { parent_narrative?: string }).parent_narrative) || parentIds.has(n.id));
  if (chainMembers.length === 0) return true; // narratives exist but no hierarchy
  // A view-only world cannot run the setup's writes: when the default labels
  // read its tree, the room reads with them and nothing is written (1.123).
  if (entryIsViewOnly(entry) && defaultsReadTree(narratives, chainMembers, entry?.writing_labels)) return true;
  const labels = mergeLabels(entry?.writing_labels);
  const writingValues = new Set([labels.l1, labels.l2, labels.l3, labels.l4]);
  return chainMembers.every(n => {
    const supertype = (n as Element & { supertype?: string | null }).supertype;
    return supertype != null && writingValues.has(supertype);
  });
}

const parentOf = (n: Element): string | null => (n as Element & { parent_narrative?: string | null }).parent_narrative || null;
const supertypeOf = (n: Element): string | null => (n as Element & { supertype?: string | null }).supertype ?? null;

/**
 * Do the default labels read this tree (1.123, a view-only world)? Only
 * with the labels as the defaults (none of the world's own), and when:
 *   - every chain's root carries the default first label (Book), matched exactly;
 *   - every chain member carries a default label or sits under an ancestor that does;
 *   - no member carrying a default label sits under one that carries none.
 * The third keeps a middle tier in other words ("Book › Part › Scene") from
 * cutting the tree, which would draw its Scenes as stray roots; the second
 * alone holds for every member of a chain rooted in a Book. A member with no
 * label under the tree (a Telling under a Scene) stays out of the tree, as on
 * a writer's world before a setup.
 */
export function defaultsReadTree(
  narratives: readonly Element[],
  chainMembers: readonly Element[],
  worldLabels: Partial<WritingLabels> | undefined,
): boolean {
  const labels = mergeLabels(worldLabels);
  const d = DEFAULT_WRITING_LABELS;
  if (labels.l1 !== d.l1 || labels.l2 !== d.l2 || labels.l3 !== d.l3 || labels.l4 !== d.l4) return false;
  const known = new Set([d.l1, d.l2, d.l3, d.l4]);
  const byId = new Map(narratives.map(n => [n.id, n]));
  const labelled = (n: Element) => { const s = supertypeOf(n); return s !== null && known.has(s); };
  for (const n of chainMembers) {
    const parent = parentOf(n);
    const isRoot = !parent || !byId.has(parent);
    if (isRoot) {
      if (supertypeOf(n) !== d.l1) return false;
      continue;
    }
    if (labelled(n)) {
      // Its parent must be in the tree too, or the tree is cut here.
      if (!labelled(byId.get(parent)!)) return false;
      continue;
    }
    // An ancestor that carries a default label (a cycle is no ancestor).
    let found = false;
    const seen = new Set<string>([n.id]);
    let at = byId.get(parent);
    while (at && !seen.has(at.id)) {
      if (labelled(at)) { found = true; break; }
      seen.add(at.id);
      const up = parentOf(at);
      at = up ? byId.get(up) : undefined;
    }
    if (!found) return false;
  }
  return true;
}

/** Where a writing link lands in the room, and what is said: pure over the world's elements. */
export type WritingLandingPlace =
  | { narrativeId: string | null; line: null }
  /** In the world, not in the tree: on its nearest ancestor in the tree, or at the room's start. */
  | { narrativeId: string | null; line: 'outside'; name: string; under: string | null }
  /** Not in this world, or not in this reader's view of it. */
  | { narrativeId: null; line: 'missing' };

export function writingLandingFor(elements: readonly Element[], narrativeId: string | null, worldId: string): WritingLandingPlace {
  if (narrativeId === null) return { narrativeId: null, line: null };
  const idx = buildNarrativeIndex(elements as Element[], worldId);
  if (idx.byId.has(narrativeId)) return { narrativeId, line: null };
  const el = elements.find(e => e.id === narrativeId);
  if (!el) return { narrativeId: null, line: 'missing' };
  const name = (typeof el.name === 'string' && el.name.trim()) ? el.name.trim() : '';
  if (el.type === 'narrative') {
    const byId = new Map(elements.filter(e => e.type === 'narrative').map(e => [e.id, e]));
    const seen = new Set<string>([el.id]);
    let up = parentOf(el);
    while (up && !seen.has(up)) {
      const node = idx.byId.get(up);
      if (node) return { narrativeId: node.el.id, line: 'outside', name, under: (typeof node.el.name === 'string' && node.el.name.trim()) || '' };
      seen.add(up);
      const at = byId.get(up);
      up = at ? parentOf(at) : null;
    }
  }
  return { narrativeId: null, line: 'outside', name, under: null };
}

/** The line for a writing link's narrative that is not in the tree (`writingLandingFor`'s `outside`). */
export function writingOutsideLine(name: string, under: string | null): string {
  const what = name ? `"${name}"` : 'The story this link names';
  return under !== null
    ? `${what} is not in the book's tree, so the writing room opens on ${under ? `"${under}", ` : ''}the part it sits under.`
    : `${what} is not in the book's tree, so the writing room opens at its start.`;
}
