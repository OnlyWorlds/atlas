/**
 * Writing promotion + migration helpers.
 *
 * Two flows live here:
 *
 *   1. Initial promote (during setup): scan an existing world for narratives
 *      with parent_narrative chains and assign canonical writing supertypes
 *      based on depth. Also assigns `order` when missing.
 *
 *   2. Label-rename migration: when the user renames a tier label
 *      (Book → Volume etc.), find every narrative with the OLD supertype
 *      value and rewrite to the NEW one so the tree stays consistent.
 *
 * Both run via FolderStore — folder writes stamp `local_updated_at` and the
 * sync engine pushes them up when api-linked.
 */

import type { Element } from '../core/types';
import { isStoryNarrative } from '../core/narrative-kind';
import type { FsFolderStore } from '../store/folder-store-fs';
import type { WritingLabels } from './writing-helpers';
// view-only-ok: reached only from writing setup, which writes nothing on a view-only world (writing-setup.ts) (conv. 149).

interface PromoteCandidate {
  el: Element;
  depth: number;
  currentSupertype: string | null;
  proposedSupertype: string;
  needsOrder: boolean;
  proposedOrder: number;
}

/**
 * Scan the world's narratives and return promote candidates. A candidate is
 * any narrative that:
 *   - Has a parent_narrative set, OR
 *   - Is referenced as a parent by another narrative
 *
 * Loose narratives (no parent, no children referencing as parent) are NOT
 * candidates — they don't look like writing-tree material.
 */
export function buildPromoteCandidates(
  elements: Element[],
  labels: WritingLabels,
): PromoteCandidate[] {
  // Only STORY narratives are tree material — knowledge entries and sharing
  // pages are excluded explicitly (core/narrative-kind.ts). Both are flat by
  // design so today they'd be skipped as loose narratives anyway, but the
  // writing tree and the other narrative kinds should stay separate even if
  // either's shape changes.
  const narratives = elements.filter(e => isStoryNarrative(e));
  if (narratives.length === 0) return [];

  // Build parent → children map and depth via BFS from roots.
  const byId = new Map<string, Element>();
  for (const n of narratives) byId.set(n.id, n);

  const childrenOf = new Map<string, Element[]>();
  const isParent = new Set<string>();
  for (const n of narratives) {
    const parent = (n as Element & { parent_narrative?: string }).parent_narrative;
    if (parent && byId.has(parent)) {
      if (!childrenOf.has(parent)) childrenOf.set(parent, []);
      childrenOf.get(parent)!.push(n);
      isParent.add(parent);
    }
  }

  // Roots = narratives with no valid parent. Only narratives that participate
  // in a chain (have children OR have a valid parent) become candidates.
  const candidates: PromoteCandidate[] = [];
  const depthOf = new Map<string, number>();
  const roots: Element[] = [];
  for (const n of narratives) {
    const parent = (n as Element & { parent_narrative?: string }).parent_narrative;
    const hasValidParent = parent && byId.has(parent);
    if (!hasValidParent) {
      // Only include as root candidate if it has children — pure loose
      // narratives are skipped.
      if (isParent.has(n.id)) {
        roots.push(n);
        depthOf.set(n.id, 0);
      }
    }
  }

  // BFS from roots to assign depth + collect all candidates.
  const queue: Element[] = [...roots];
  while (queue.length > 0) {
    const node = queue.shift()!;
    const depth = depthOf.get(node.id)!;
    candidates.push(buildCandidate(node, depth, labels));
    const children = childrenOf.get(node.id) ?? [];
    for (const child of children) {
      depthOf.set(child.id, depth + 1);
      queue.push(child);
    }
  }

  // Sort within parent groups for stable display + sequential order fill.
  candidates.sort((a, b) => {
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (a.el.name ?? '').localeCompare(b.el.name ?? '');
  });

  // Re-compute proposedOrder per parent group (siblings sorted by current
  // order if present, else by name).
  const orderByParent = new Map<string, number>();
  const sorted = [...candidates].sort((a, b) => {
    const ao = (a.el as Element & { order?: number | null }).order ?? Number.MAX_SAFE_INTEGER;
    const bo = (b.el as Element & { order?: number | null }).order ?? Number.MAX_SAFE_INTEGER;
    if (ao !== bo) return ao - bo;
    return (a.el.name ?? '').localeCompare(b.el.name ?? '');
  });
  for (const c of sorted) {
    const parent = (c.el as Element & { parent_narrative?: string }).parent_narrative ?? '_root';
    const next = orderByParent.get(parent) ?? 0;
    c.proposedOrder = next;
    orderByParent.set(parent, next + 1);
  }

  return candidates;
}

function buildCandidate(el: Element, depth: number, labels: WritingLabels): PromoteCandidate {
  const proposedSupertype =
    depth === 0 ? labels.l1
    : depth === 1 ? labels.l2
    : depth === 2 ? labels.l3
    : labels.l4; // depth 3+ become drafts
  const currentSupertype = (el as Element & { supertype?: string | null }).supertype ?? null;
  const currentOrder = (el as Element & { order?: number | null }).order;
  const needsOrder = currentOrder == null;
  return {
    el,
    depth,
    currentSupertype,
    proposedSupertype,
    needsOrder,
    proposedOrder: 0, // filled in by caller after sorting
  };
}

/**
 * Detect existing supertype groupings by depth from the candidate set. Used
 * by the setup screen to offer "adopt detected labels" — if all depth-0
 * candidates share the same supertype, that becomes a candidate label.
 *
 * Returns null if a depth has mixed supertypes or no candidates (caller
 * falls back to defaults for that tier).
 */
export function detectExistingLabels(
  candidates: PromoteCandidate[],
): { l1: string | null; l2: string | null; l3: string | null; l4: string | null } {
  const byDepth: Record<number, Set<string>> = { 0: new Set(), 1: new Set(), 2: new Set(), 3: new Set() };
  for (const c of candidates) {
    const d = Math.min(c.depth, 3);
    if (c.currentSupertype) byDepth[d].add(c.currentSupertype);
  }
  function singleValue(d: number): string | null {
    if (byDepth[d].size === 1) return [...byDepth[d]][0];
    return null;
  }
  return {
    l1: singleValue(0),
    l2: singleValue(1),
    l3: singleValue(2),
    l4: singleValue(3),
  };
}

/**
 * Apply the promote: writes supertype + order to each candidate via the
 * FolderStore. Skips writes if the existing supertype already matches the
 * proposed value AND order is already set (idempotent).
 *
 * Returns the count of narratives actually written.
 */
export async function applyPromote(
  store: FsFolderStore,
  candidates: PromoteCandidate[],
): Promise<number> {
  let written = 0;
  for (const c of candidates) {
    const patch: Record<string, unknown> = {};
    if (c.currentSupertype !== c.proposedSupertype) {
      patch.supertype = c.proposedSupertype;
    }
    if (c.needsOrder) {
      patch.order = c.proposedOrder;
    }
    if (Object.keys(patch).length === 0) continue;
    await store.updateElement(c.el.id, patch as Partial<Element>);
    written++;
  }
  return written;
}

/**
 * Label-rename migration. When the user changes labels, every narrative whose
 * supertype matches an OLD label value gets rewritten to the NEW label value.
 *
 * Pass two snapshot label sets (before + after). Returns the count of writes.
 */
export async function applyLabelRenameMigration(
  store: FsFolderStore,
  elements: Element[],
  oldLabels: WritingLabels,
  newLabels: WritingLabels,
): Promise<number> {
  const renames: Array<[string, string]> = [];
  if (oldLabels.l1 !== newLabels.l1) renames.push([oldLabels.l1, newLabels.l1]);
  if (oldLabels.l2 !== newLabels.l2) renames.push([oldLabels.l2, newLabels.l2]);
  if (oldLabels.l3 !== newLabels.l3) renames.push([oldLabels.l3, newLabels.l3]);
  if (oldLabels.l4 !== newLabels.l4) renames.push([oldLabels.l4, newLabels.l4]);
  if (renames.length === 0) return 0;
  const renameMap = new Map(renames);
  let written = 0;
  for (const el of elements) {
    if (el.type !== 'narrative') continue;
    const supertype = (el as Element & { supertype?: string | null }).supertype;
    if (!supertype) continue;
    const newSupertype = renameMap.get(supertype);
    if (!newSupertype) continue;
    await store.updateElement(el.id, { supertype: newSupertype } as Partial<Element>);
    written++;
  }
  return written;
}

export type { PromoteCandidate };
