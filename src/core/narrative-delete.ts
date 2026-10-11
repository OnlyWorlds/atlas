/**
 * Narrative deletion summary — the ONE rule site for "what is about to be
 * destroyed, in the user's own vocabulary".
 *
 * DELIBERATELY STORE-FREE AND DOM-FREE. Pure functions over an element list;
 * lifts verbatim into any tool that models a parent-chained document tree.
 *
 * WHY THIS EXISTS (S310)
 * ----------------------
 * Deleting a Book cascade-deletes every descendant narrative and their pins
 * (`FsFolderStore.findDependents` -> `deleteElementUnchained`, cascade defaults
 * to true). Atlas has NO UNDO ANYWHERE. Before this module the confirm read
 * "This will also remove 15 dependent elements", which is true and useless: it
 * cannot tell 15 scenes of finished prose from 15 pins, and it never speaks the
 * tier labels the user configured.
 *
 * THE TRAP THIS MODULE EXISTS TO AVOID
 * ------------------------------------
 * `buildNarrativeIndex` (the writing TREE) filters to narratives whose
 * supertype matches a tier label. `findDependents` (the CASCADE) does not — it
 * walks `parent_narrative` across ALL narratives. So a narrative the user
 * free-texted out of the tree (DESIGN_WRITING.md: "free-text override removes
 * the narrative from the writing tree (still visible elsewhere)") is INVISIBLE
 * in the tree and STILL DELETED by the cascade. A counter built from the tree
 * would under-report and destroy prose the sentence never mentioned.
 *
 * Therefore: this walker mirrors findDependents (all narratives, by
 * parent_narrative), NOT the tree, and buckets anything with no resolvable tier
 * into `offTree` so the sentence can name it honestly.
 *
 * If `findDependents` ever changes shape, THIS FILE CHANGES IN THE SAME BOUT —
 * the count is a promise about what the store does, and a promise that drifts
 * from its subject is worse than no promise at all. `narrative-delete.test.ts`
 * asserts the two walkers agree.
 */

import type { Element } from './types';
import type { WritingLabels, WritingTier } from '../middle/writing-helpers';

/** Tier buckets, plus the two honesty buckets the tree cannot see. */
export interface NarrativeDeletionSummary {
  /** Descendant narrative ids (NOT including the target itself). */
  descendantIds: string[];
  /** Per-tier descendant counts, keyed by registry tier key. */
  byTier: Record<'l1' | 'l2' | 'l3' | 'l4', number>;
  /** Descendant narratives with no resolvable tier (free-texted supertype). */
  offTree: number;
  /** Pins pointing at the target or any descendant — the store deletes these too. */
  pins: number;
  /** Everything that dies alongside the target. */
  total: number;
  /**
   * Human sentence naming the loss, or '' when nothing else dies.
   * Sentence case, no em-dashes (house voice law).
   */
  sentence: string;
}

/**
 * Resolve a narrative's tier from its supertype against a label set.
 *
 * Deliberately takes LABELS rather than a worldId: `getTierForNarrative` in
 * writing-helpers reaches into global state, which would make this module
 * untestable without a store and unliftable into another tool.
 */
export function tierFromSupertype(el: Element, labels: WritingLabels): WritingTier {
  if (el.type !== 'narrative') return null;
  const supertype = (el as Element & { supertype?: string | null }).supertype;
  if (!supertype) return null;
  if (supertype === labels.l1) return 'l1';
  if (supertype === labels.l2) return 'l2';
  if (supertype === labels.l3) return 'l3';
  if (supertype === labels.l4) return 'l4';
  return null;
}

/**
 * Pluralize a user-configured label for a count.
 *
 * The tier labels are USER TEXT and can be anything ("Part", "Episode",
 * "Beat", "Notes", "Séance"). We only ever apply English rules because the
 * surrounding copy is English; the important correctness property is that
 * count === 1 never pluralizes, which is where a naive helper produces
 * "1 chapters" and reads like a bug to the user.
 */
export function pluralizeLabel(label: string, count: number): string {
  const word = label.trim();
  if (count === 1) return word;
  if (!word) return word;
  if (/s$/i.test(word)) return word;          // already plural-ish ("Notes")
  if (/[^aeiou]y$/i.test(word)) return word.slice(0, -1) + 'ies';  // Story -> Stories
  if (/(ch|sh|x|z)$/i.test(word)) return word + 'es';              // Sketch -> Sketches
  return word + 's';
}

/** Join clause parts as "a", "a and b", "a, b and c". */
function joinClauses(parts: string[]): string {
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];
  return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
}

/**
 * Collect every narrative descendant of `targetId` by walking
 * `parent_narrative`. Mirrors `FsFolderStore.findDependents`'s narrative walk.
 *
 * CYCLE-SAFE: a malformed folder (or a hand-edited JSON) can contain a parent
 * cycle. The `seen` set is what stops this from looping forever; the store's
 * own walker is protected by the same shape. Never "simplify" this to a
 * recursive walk without a seen set.
 */
export function collectNarrativeDescendants(all: Element[], targetId: string): string[] {
  const narratives = all.filter(e => e.type === 'narrative') as Array<
    Element & { parent_narrative?: string }
  >;
  const descendantIds = new Set<string>();
  const queue: string[] = [targetId];
  const visited = new Set<string>([targetId]);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const n of narratives) {
      if (n.parent_narrative !== cur) continue;
      if (n.id === targetId) continue;          // self-parent: never delete the target twice
      if (descendantIds.has(n.id)) continue;
      descendantIds.add(n.id);
      if (!visited.has(n.id)) {
        visited.add(n.id);
        queue.push(n.id);
      }
    }
  }
  return [...descendantIds];
}

/**
 * Summarize what `deleteElement(targetId)` will destroy alongside the target.
 *
 * `all` must be the world's full element list — pins live outside the
 * narrative type and are swept by the same cascade.
 */
export function summarizeNarrativeDeletion(
  all: Element[],
  targetId: string,
  labels: WritingLabels,
): NarrativeDeletionSummary {
  const descendantIds = collectNarrativeDescendants(all, targetId);
  const byId = new Map(all.map(e => [e.id, e]));

  const byTier: Record<'l1' | 'l2' | 'l3' | 'l4', number> = { l1: 0, l2: 0, l3: 0, l4: 0 };
  let offTree = 0;
  for (const id of descendantIds) {
    const el = byId.get(id);
    if (!el) continue;
    const tier = tierFromSupertype(el, labels);
    if (tier) byTier[tier] += 1;
    else offTree += 1;
  }

  // Pins are swept for the target AND every descendant (findDependents builds
  // `targetIds = new Set([id, ...descendantIds])` and filters pins by element_id).
  const doomed = new Set<string>([targetId, ...descendantIds]);
  const pins = (all as Array<Element & { element_id?: string }>).filter(
    p => p.type === 'pin' && p.element_id != null && doomed.has(p.element_id),
  ).length;

  const total = descendantIds.length + pins;

  const parts: string[] = [];
  for (const tier of ['l1', 'l2', 'l3', 'l4'] as const) {
    const n = byTier[tier];
    if (n > 0) parts.push(`${n} ${pluralizeLabel(labels[tier], n).toLowerCase()}`);
  }
  if (offTree > 0) parts.push(`${offTree} other ${offTree === 1 ? 'narrative' : 'narratives'}`);
  if (pins > 0) parts.push(`${pins} ${pins === 1 ? 'pin' : 'pins'}`);

  const sentence = parts.length > 0 ? `This also deletes ${joinClauses(parts)}.` : '';

  return { descendantIds, byTier, offTree, pins, total, sentence };
}

/**
 * The full confirm body for deleting a narrative.
 *
 * "This cannot be undone" is literal: atlas has no undo, and a tombstone is a
 * delete record rather than a recovery path. If an undo lands, this string is
 * a caller of that feature and must change with it.
 */
export function narrativeDeleteConfirmMessage(
  name: string,
  summary: NarrativeDeletionSummary,
): string {
  const subject = name.trim() ? `"${name.trim()}"` : 'this narrative';
  if (summary.total === 0) return `Delete ${subject}? This cannot be undone.`;
  return `Delete ${subject}? ${summary.sentence} This cannot be undone.`;
}
