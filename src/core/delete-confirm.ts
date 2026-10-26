/**
 * The one decision site for "does this delete need a confirmation, and what
 * does it say".
 *
 * DELIBERATELY STORE-FREE AND DOM-FREE — callers do the I/O (fetch dependents,
 * call window.confirm) and hand the facts in. That keeps the RULE testable
 * without a store, and keeps every delete surface on the same rule.
 *
 * THE RULE
 * ---------------
 * A delete gets a confirmation when EITHER
 *   (a) the user's `confirm_before_delete` preference is on, OR
 *   (b) the delete CASCADES — it destroys elements beyond the one clicked.
 *
 * (b) is a floor the preference cannot lower. That is not an override of the
 * user's choice, it is the choice's literal scope: the setting reads
 * "Ask for confirmation before deleting an element" (settings-elements.ts) —
 * SINGULAR. Someone who turns it off has opted out of confirming the deletion
 * of one element. Deleting a Book that takes 7 chapters and scenes with it was
 * never inside that opt-out, and atlas has NO UNDO ANYWHERE.
 *
 * This floor is also what the rest of the app already does, and this module
 * exists because ONE surface had drifted off it:
 *   - `map-index-tab.ts:555`  confirms unconditionally, names the pin cascade
 *   - `share-room.ts:166-180` confirms unconditionally for a published page
 *   - `writing-sidebar.ts:603` confirms unconditionally for bulk unlink
 *     ("disk unlinks in closed narratives have no Ctrl+Z")
 *   - `element-detail-header.ts` gated its CASCADING delete on the preference
 * The last one is the outlier, and it is the one wired to the writing room,
 * where the cascade is an entire manuscript. Verified live: one click,
 * zero confirms, 8 of 9 elements destroyed.
 */

import type { Element } from './types';
import type { WritingLabels } from '../middle/writing-helpers';
import { summarizeNarrativeDeletion } from './narrative-delete';

export interface DeleteConfirmDecision {
  /** Whether the caller must ask before deleting. */
  needed: boolean;
  /** The message to show. Empty when `needed` is false. */
  message: string;
  /** True when the delete destroys more than the clicked element. */
  cascades: boolean;
}

export interface DeleteConfirmInput {
  /** The element the user clicked delete on. */
  el: Element;
  /** What the store says will ALSO be deleted (`folder.findDependents(el.id)`). */
  dependents: Element[];
  /** The world's full element list — only read for narrative tier counting. */
  allElements: Element[];
  /** The world's writing tier labels. */
  labels: WritingLabels;
  /** The user's `confirm_before_delete` setting. */
  confirmPref: boolean;
  /**
   * True when the dependents probe THREW, so `dependents` is empty because we
   * could not look, not because nothing depends on this element.
   *
   * The two cases are opposite in consequence and were indistinguishable: an
   * empty list means `cascades` is false, which switches off the confirm
   * floor, so with `confirm_before_delete` turned off a failed probe deleted
   * a whole subtree with no prompt at all. Unknown is not the same
   * as none.
   */
  dependentsUnknown?: boolean;
}

/**
 * Decide whether to confirm, and compose the message.
 *
 * Narratives get a tier-aware sentence in the user's own vocabulary ("2
 * chapters and 4 scenes"); everything else keeps the generic dependent count,
 * which is honest for pins and markers where there is no richer vocabulary to
 * speak.
 */
export function decideDeleteConfirm(input: DeleteConfirmInput): DeleteConfirmDecision {
  const { el, dependents, allElements, labels, confirmPref, dependentsUnknown } = input;
  const cascades = dependents.length > 0;

  // Could not determine the blast radius: always ask, and say so plainly.
  // The store still cascades by default, so proceeding silently here would be
  // the confirm floor failing in exactly the case it exists for.
  if (dependentsUnknown) {
    return {
      needed: true,
      message: `Delete ${subjectOf(el)}? Atlas could not check what else this would delete, so anything filed under it may go too. This cannot be undone.`,
      cascades: true,
    };
  }

  const needed = confirmPref || cascades;
  if (!needed) return { needed: false, message: '', cascades };

  const subject = subjectOf(el);

  if (el.type === 'narrative') {
    const summary = summarizeNarrativeDeletion(allElements, el.id, labels);
    // The summary walks the same parent chain the store cascades over, so its
    // counts describe THIS delete. If it somehow disagrees with the store's
    // dependent list, prefer the store: it is the one doing the deleting.
    if (summary.total > 0) {
      return {
        needed: true,
        message: `Delete ${subject}? ${summary.sentence} This cannot be undone.`,
        cascades,
      };
    }
    if (!cascades) return { needed: true, message: `Delete ${subject}? This cannot be undone.`, cascades };
  }

  const n = dependents.length;
  const extra = n > 0
    ? ` This also deletes ${n} element${n === 1 ? '' : 's'} filed under it.`
    : '';
  return { needed: true, message: `Delete ${subject}?${extra} This cannot be undone.`, cascades };
}

/** The confirm's subject: the name in quotes, or "this element" (never an id). */
function subjectOf(el: { name?: string | null }): string {
  const name = (el.name ?? '').trim();
  return name ? `"${name}"` : 'this element';
}
