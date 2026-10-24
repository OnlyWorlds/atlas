/**
 * The hidden mark (folder spec §4.8, RULED 2026-10-23; keel #537, PR 160 on the
 * server). An element file's `hidden` means hidden from whoever the world is
 * handed to, never from the person holding the folder: Atlas is a viewer, so it
 * shows the element with the word on it, and leaves it out of what it hands on
 * (a published page). keel serves `hidden: true` only to those who can still
 * see a hidden element (the owner, a co-builder and its maker), and takes the
 * mark on a create only (keel #587).
 */
import { escapeAttr } from './dom-utils';

/** A linked element keel has: who on OnlyWorlds can see it. */
export const HIDDEN_MARK_LINE = 'Hidden on OnlyWorlds: only the owner, co-builders and whoever made it can see it.';
/** Any other: a folder world, an unlinked one, or a linked element not yet sent. */
export const HIDDEN_FOLDER_LINE = 'Hidden: shown to you here, and left out of a published page.';
/** A linked element keel showed in its last answer, though the file holds the mark (the S461 gate's F3). */
export const HIDDEN_HERE_ONLY_LINE = 'Hidden here only: OnlyWorlds still shows it, since it was marked hidden after it went online. A published page leaves it out.';

/** keel's word on the mark, recorded with a push's stamp (`stampedBody`; ATLAS_FIELDS.md). */
export const HIDDEN_SHOWN_ONLINE = 'atlas_hidden_shown_online';

/**
 * What keel's answer to a write (a POST or PATCH body, a read-back, an adopted
 * copy) says about the mark, for the stamp's `kept`: keel answers `hidden: true`
 * exactly when it hides the element (S461 probe-48, 8a and 8b). `stampedBody`
 * keeps the key only when the file holds the mark; no answer body, no word.
 */
export function hiddenWordOf(answer: unknown): Record<string, unknown> | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  return { [HIDDEN_SHOWN_ONLINE]: !isHiddenMark(answer) };
}

/**
 * The one reading (§4.8, as SDK 4.70.0's `writeWorldFile` and Python's
 * `is_hidden`): `hidden` present and not `null` or `false`, so `"true"` and `1`
 * count. Every site reads this, never `=== true` alone.
 */
export function isHiddenMark(el: unknown): boolean {
  if (!el || typeof el !== 'object') return false;
  const v = (el as Record<string, unknown>).hidden;
  return v !== undefined && v !== null && v !== false;
}

export function hiddenMarkLine(el: unknown, worldState: string | undefined): string | null {
  if (!isHiddenMark(el)) return null;
  const rec = el as Record<string, unknown>;
  const onServer = typeof rec.server_updated_at === 'string';
  if (worldState !== 'api-linked' || !onServer) return HIDDEN_FOLDER_LINE;
  return rec[HIDDEN_SHOWN_ONLINE] === true ? HIDDEN_HERE_ONLY_LINE : HIDDEN_MARK_LINE;
}

/**
 * Said once when a push holds hidden elements back (conv. 170): keel takes the
 * mark on a create from the owner or a co-builder only, so for anyone else they
 * stay in the folder, with anything placed on them.
 */
export function hiddenHeldLine(worldName: string, n: number): string {
  return n === 1
    ? `A hidden element stays here, with anything placed on it: only the owner and co-builders of ${worldName} can put a hidden element on OnlyWorlds.`
    : `${n} hidden elements stay here, with anything placed on them: only the owner and co-builders of ${worldName} can put a hidden element on OnlyWorlds.`;
}

/** Said once when a hidden element here has an id OnlyWorlds shows (conv. 170): nothing is sent for it. */
export function hiddenShownLine(n: number): string {
  return n === 1
    ? 'A hidden element here is shown on OnlyWorlds under the same id, so Atlas sends nothing for it until it is hidden there.'
    : `${n} hidden elements here are shown on OnlyWorlds under the same ids, so Atlas sends nothing for them until they are hidden there.`;
}

/** The word in a list row (the element list, Home's Recent), beside "Proposed"; empty when not hidden. */
export function hiddenRowWord(el: unknown, worldState: string | undefined): string {
  const line = hiddenMarkLine(el, worldState);
  if (!line) return '';
  return `<span class="atlas-row-proposed atlas-row-hidden" data-role="hidden-word" title="${escapeAttr(line)}">Hidden</span>`;
}
