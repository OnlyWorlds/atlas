/**
 * What a person reads when keel takes a seat's edit as a proposal (keel #519,
 * conv. 163). World and element names are world data: these lines go out as
 * text (toasts and titles set text, never HTML).
 */
import type { Conflict } from '../core/types';

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

/** P6: a delete keel keeps for the keeper; the element is back. */
export function deleteRefusedLine(names: string[]): string {
  if (names.length === 1) return `Only this world's keeper can delete ${names[0]}, so it is back.`;
  return `Only this world's keeper can delete these ${names.length} elements, so they are back.`;
}

/** The element page's sync mark while a proposal waits. */
export const PROPOSAL_PENDING_TITLE = "Sent for review: this world's keeper decides. Your edit stays here until then";

/** The review's line for a proposal keel did not take (P5); the buttons are the review's own. */
export function proposalReviewLine(p: NonNullable<Conflict['proposal']>): string {
  const choice = 'Overwrite sends it for review again; Pull drops it.';
  if (p.outcome === 'declined') {
    return p.reason
      ? `The keeper declined your change: "${p.reason}". ${choice}`
      : `The keeper declined your change. ${choice}`;
  }
  if (p.outcome === 'lapsed') return `Your change waited too long for review and lapsed. ${choice}`;
  return `Your change is no longer waiting for review. ${choice}`;
}
