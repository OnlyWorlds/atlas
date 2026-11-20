/**
 * What a person reads when keel takes a seat's edit as a proposal
 * (conv. 163). World and element names are world data: these lines go out as
 * text (toasts and titles set text, never HTML).
 */
import type { Conflict } from '../core/types';
import { nameOrUnnamed, type Nameable } from '../core/type-words';

/** P4: a round's edits went to the keeper. */
export function proposalSentLine(worldName: string, n: number): string {
  return n === 1
    ? `Sent for review: ${worldName}'s keeper decides on changes from this seat. Your edit stays here until then.`
    : `${n} edits sent for review: ${worldName}'s keeper decides on changes from this seat. Your edits stay here until then.`;
}

/** P5: the keeper took them. */
export function proposalAcceptedLine(worldName: string, n: number): string {
  return n === 1
    ? `${worldName}'s keeper accepted your change.`
    : `${worldName}'s keeper accepted ${n} of your changes.`;
}

/** P6: a delete keel keeps for the keeper; the element is back, said by its name or its unnamed form, mid-line. */
export function deleteRefusedLine(refused: Nameable[]): string {
  if (refused.length === 1) return `Only this world's keeper can delete ${nameOrUnnamed(refused[0])}, so it is back.`;
  return `Only this world's keeper can delete these ${refused.length} elements, so they are back.`;
}

/** The element page's sync mark while a proposal waits. */
export const PROPOSAL_PENDING_TITLE = "Sent for review: this world's keeper decides. Your edit stays here until then";

/**
 * The review's line for a proposal keel did not take (P5); the buttons are the review's own. `choices`
 * false (a view-only world, whose row offers only Keep the OnlyWorlds copy) leaves out the sentence on the two.
 */
export function proposalReviewLine(p: NonNullable<Conflict['proposal']>, opts: { choices?: boolean } = {}): string {
  const said = (line: string): string => (opts.choices === false ? line
    : `${line} Keep this copy sends it for review again; Keep the OnlyWorlds copy drops it.`);
  if (p.outcome === 'declined') {
    // A reason that ends its own sentence takes no second stop after the quote.
    return said(p.reason
      ? `The keeper declined your change: "${p.reason}"${/[.!?]$/.test(p.reason) ? '' : '.'}`
      : 'The keeper declined your change.');
  }
  if (p.outcome === 'lapsed') return said('Your change waited too long for review and lapsed.');
  return said('Your change is no longer waiting for review.');
}
