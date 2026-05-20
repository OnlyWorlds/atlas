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
