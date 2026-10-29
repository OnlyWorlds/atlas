/**
 * Who a message is from and to (#526), by the published message profile
 * (schema-dist `profiles/message.md`): a Narrative with supertype Message, its
 * claimed sender the Narrator, its recipients the Characters. Atlas draws that
 * as one line above the text. The rules are the SDK's (`isMessage`,
 * `recipientsOf`, `isToEveryone`, `senderStatus`); this file only names the
 * Characters they point at.
 *
 * The sender is a claim until checked: only the world's members list proves
 * it, so a folder, an export or a world whose roster is not read yet says
 * "claims to be from", never the plain sender. An empty Characters list is
 * addressed to everyone. An id the world does not hold as a Character is
 * counted, never named.
 *
 * keel's trimmed mark (`x_served_trimmed`, #888): a list or a sender served
 * with ids this key may not see left out reads "someone you cannot see"
 * (`hasUnseenRecipients`, the `unseen` sender), never everyone or nobody.
 *
 * Two readings the profile cannot make alone:
 * - keel strips links to elements a key may not see (a hidden one, outside a
 *   guest's view) from the bodies that key reads, so an empty list or a
 *   missing Narrator in a world not read whole may stand for someone hidden.
 *   `wholeWorld` false says so, never "everyone" or "nobody" alone.
 * - `created_by` proves a sender only on the body as keel served it: a copy
 *   with an unpushed edit (or a hand-edited file) is checked against nothing.
 *
 * Pure: the element, the world's elements and the reading come in.
 */
import { hasUnseenRecipients, isMessage as sdkIsMessage, isToEveryone, recipientsOf, senderStatus, type OwMessageMember, type OwSenderStatus } from '@onlyworlds/sdk';
import type { Element } from './types';

export interface MessageParty {
  id: string;
  name: string;
}

export interface MessageParties {
  /** The profile's answer: `verified` only when the members list proves it. */
  sender: OwSenderStatus;
  /** The claimed sender (the Narrator); null when there is none ("from nobody"). */
  from: MessageParty | null;
  /** The Narrator names an id this world does not hold as a Character. */
  fromOutside: boolean;
  /** On a mismatch, the Character whose key wrote it, when this world holds it. */
  writtenBy: MessageParty | null;
  /** On a mismatch, the writer's Character is not one this world holds. */
  writtenByOutside: boolean;
  toEveryone: boolean;
  /** The recipients this world holds as Characters, in order, each once. */
  to: MessageParty[];
  /** Recipient ids this world does not hold as Characters. */
  toOutside: number;
  /** keel served the list with recipients this key may not see left out (`x_served_trimmed` names `characters`). */
  toUnseen: boolean;
  /** The reader sees the whole world: an empty list or no Narrator hides no one. */
  wholeWorld: boolean;
}

export interface MessageReading {
  /** keel's members list, or null when it is not read (a folder, an export, not yet). */
  members?: readonly OwMessageMember[] | null;
  /** The reader's key reads the whole world (the owner, a co-builder, a world made here). Default true. */
  wholeWorld?: boolean;
}

/**
 * The body as keel last served it: stamped by the server and no edit since.
 * Only then does its `created_by` say who wrote it.
 */
export function authorAsServed(el: Element): boolean {
  const rec = el as Record<string, unknown>;
  const server = rec.server_updated_at;
  const local = rec.local_updated_at;
  return typeof server === 'string' && !(typeof local === 'string' && local > server);
}

export function isMessage(el: Element): boolean {
  return sdkIsMessage(el);
}

export function messageParties(
  el: Element,
  elements: readonly Element[],
  reading: MessageReading = {},
): MessageParties | null {
  if (!isMessage(el)) return null;
  const members = reading.members && authorAsServed(el) ? reading.members : null;
  const party = (id: string): MessageParty | null => {
    const hit = elements.find(e => e.id === id && e.type === 'character');
    if (!hit) return null;
    const name = typeof hit.name === 'string' && hit.name.trim() ? hit.name.trim() : '(unnamed)';
    return { id, name };
  };
  const status = senderStatus(el, members);
  const from = status.claimed ? party(status.claimed) : null;
  const writtenBy = status.writtenBy ? party(status.writtenBy) : null;
  const toEveryone = isToEveryone(el);
  const to: MessageParty[] = [];
  let toOutside = 0;
  const seen = new Set<string>();
  for (const id of recipientsOf(el)) {
    if (seen.has(id)) continue;
    seen.add(id);
    const p = party(id);
    if (p) to.push(p);
    else toOutside++;
  }
  // No sender and no recipient: a story's letter with nothing on it to read, so
  // no line rather than "from nobody, to everyone". A sender keel left out for
  // this key (`unseen`) is someone, so the line stays.
  if (!status.claimed && toEveryone && status.status !== 'unseen') return null;
  return {
    sender: status.status,
    from,
    fromOutside: status.claimed !== null && !from,
    writtenBy,
    writtenByOutside: status.writtenBy !== null && !writtenBy,
    toEveryone,
    to,
    toOutside,
    toUnseen: hasUnseenRecipients(el) === true,
    // A body keel marked was read with a key that marks: a field the mark does not
    // name lost nobody, so it is not hedged a second way (the #888 gate's G2).
    wholeWorld: Array.isArray((el as Record<string, unknown>).x_served_trimmed) ? true : reading.wholeWorld ?? true,
  };
}
