/**
 * The From and To line on a message (#526; the rule is `src/core/message-parties.ts`,
 * by the message profile). Each name links to its Character; the line is a
 * reading aid, never an editor, so it is the same in a view-only world.
 *
 * The sender reads plainly only when the world's roster proves it; until then
 * (a folder, an export, a roster not read yet) the line says "Claims to be
 * from". In a synced world the roster is asked once, and the line is said
 * again in place when it arrives.
 */
import { getState } from '../core/state';
import { elementHash } from '../core/router';
import { authorAsServed, messageParties, type MessageParties, type MessageParty } from '../core/message-parties';
import { sliceOf } from '../core/provenance';
import type { Element, WorldRegistryEntry } from '../core/types';
import { rosterFor, rosterNow } from '../sync/world-roster';

export function buildMessageParties(el: Element): HTMLElement | null {
  const state = getState();
  const worldId = state.active?.worldId;
  if (!worldId) return null;
  const entry = state.registry.worlds.find(w => w.id === worldId);
  const linked = entry?.state === 'api-linked';
  const roster = linked && entry ? rosterNow(entry) : null;
  const wholeWorld = readsWholeWorld(entry, state.active?.meta);
  const parties = messageParties(el, state.data.elements, { members: roster, wholeWorld });
  if (!parties) return null;

  const line = document.createElement('p');
  line.className = 'atlas-message-parties';
  line.dataset.role = 'message-parties';
  fillMessageParties(line, parties, worldId);
  if (linked && entry && !roster && parties.from && 'created_by' in el && authorAsServed(el)) {
    void rosterFor(entry).then(rows => {
      if (!rows || !line.isConnected) return;
      const now = messageParties(el, getState().data.elements, { members: rows, wholeWorld });
      if (now) fillMessageParties(line, now, worldId);
    });
  }
  return line;
}

/**
 * Whether the reader holds the whole world, so an empty list hides no one:
 * in a synced world, a key keel answers as the owner or a co-builder (an
 * unknown role is not assumed); on disk, any world but a copy exported as a
 * member's, a Character's or the public view.
 */
export function readsWholeWorld(entry: WorldRegistryEntry | undefined, meta: unknown): boolean {
  if (entry?.state === 'api-linked') {
    const role = entry.api?.member_role;
    return role === 'owner' || role === 'co_builder';
  }
  const slice = sliceOf(meta);
  return !slice || slice.kind === 'owner' || (slice.kind === 'member' && slice.role === 'co_builder');
}

/** Says the line into `line` (exported for its unit test). */
export function fillMessageParties(line: HTMLElement, parties: MessageParties, worldId: string): void {
  line.replaceChildren();
  line.dataset.sender = parties.sender;
  const link = (p: MessageParty): HTMLAnchorElement => {
    const a = document.createElement('a');
    a.href = elementHash(worldId, p.id);
    a.textContent = p.name;
    return a;
  };
  const label = (text: string): HTMLElement => {
    const s = document.createElement('span');
    s.className = 'atlas-message-parties-label';
    s.textContent = text;
    return s;
  };
  // An id Atlas has no Character for (hidden from this key, another type, gone) is counted, never named.
  const notShown = 'someone not shown here';

  // keel's trimmed mark (#888, the message profile's "a list trimmed for the reader"): someone
  // this key may not see, never who and never how many.
  const unseen = 'someone you cannot see';

  if (parties.sender === 'unseen') {
    line.append(label('From'), ' ', unseen);
  } else if (!parties.from && !parties.fromOutside) {
    line.append(label('From'), parties.wholeWorld ? ' nobody' : ' nobody, or someone hidden from you');
  } else {
    const who = parties.from ? link(parties.from) : notShown;
    if (parties.sender === 'verified') {
      line.append(label('From'), ' ', who);
    } else {
      line.append(label('Claims to be from'), ' ', who);
      if (parties.sender === 'mismatch') {
        if (parties.writtenBy) line.append(', written by ', link(parties.writtenBy), "'s key");
        else line.append(", written by another member's key");
      }
    }
  }

  line.append(' · ', label('To'), ' ');
  if (parties.toEveryone) {
    line.append(parties.wholeWorld ? 'everyone' : 'everyone, or someone hidden from you');
  } else {
    // Names joined by commas, as before #888; " and " only before the last of the
    // tail (the ones not shown, the ones unseen), so "BB, Kael" reads as it did.
    const names: Array<HTMLElement | string> = parties.to.map(link);
    const tail: string[] = [];
    const n = parties.toOutside;
    if (n > 0) tail.push(n === 1 ? notShown : names.length > 0 ? `${n} others not shown here` : `${n} not shown here`);
    if (parties.toUnseen) tail.push(unseen);
    const parts = [...names, ...tail];
    if (parts.length === 0) line.append('nobody');
    parts.forEach((part, i) => {
      if (i > 0) line.append(tail.length > 0 && i === parts.length - 1 ? ' and ' : ', ');
      line.append(part);
    });
  }
}
