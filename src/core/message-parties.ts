/**
 * Who a message is from and to (#526). The crew's convention, used on the
 * Manifest's Wire and in BrainBoost: a message is a Narrative with supertype
 * Message, its sender the Narrator, its recipients the Characters. Atlas
 * draws that as one line above the text, so a message reads as a message and
 * not as a story with a narrator.
 *
 * Pure: the element and the world's elements come in. An id the world does
 * not hold is left out (a stub names it, a deleted one does not); a message
 * with neither a sender nor a recipient in the world gets no line.
 */
import type { Element } from './types';

export interface MessageParty {
  id: string;
  name: string;
}

export interface MessageParties {
  from: MessageParty | null;
  to: MessageParty[];
}

export function isMessage(el: Element): boolean {
  if (el.type !== 'narrative') return false;
  const sup = (el as Record<string, unknown>).supertype;
  return typeof sup === 'string' && sup.trim().toLowerCase() === 'message';
}

export function messageParties(el: Element, elements: readonly Element[]): MessageParties | null {
  if (!isMessage(el)) return null;
  const rec = el as Record<string, unknown>;
  const party = (id: unknown): MessageParty | null => {
    if (typeof id !== 'string' || !id) return null;
    const hit = elements.find(e => e.id === id && e.type === 'character');
    if (!hit) return null;
    const name = typeof hit.name === 'string' && hit.name.trim() ? hit.name.trim() : '(unnamed)';
    return { id, name };
  };
  const from = party(rec.narrator);
  const ids = Array.isArray(rec.characters) ? rec.characters : [];
  const to: MessageParty[] = [];
  for (const id of ids) {
    // The sender listed among the recipients too (a note to self, or a convention slip) is said once.
    if (from && id === from.id) continue;
    const p = party(id);
    if (p && !to.some(t => t.id === p.id)) to.push(p);
  }
  if (!from && to.length === 0) return null;
  return { from, to };
}
