/**
 * A world's charter (#526): the Law with supertype Charter, by the crew's
 * convention (Skeld, h5 #9462: what this world is for, who is in it, its house
 * rules). Home shows it first, so a person meets the rules an agent is told to
 * read before anything else.
 *
 * Pure. More than one charter is a world's own business: the one changed last
 * leads, since it is the one someone is keeping; a tie goes by name.
 */
import type { Element } from './types';

export function isCharter(el: Element): boolean {
  if (el.type !== 'law') return false;
  const sup = (el as Record<string, unknown>).supertype;
  return typeof sup === 'string' && sup.trim().toLowerCase() === 'charter';
}

export function findCharter(elements: readonly Element[]): Element | null {
  let best: Element | null = null;
  for (const el of elements) {
    if (!isCharter(el)) continue;
    if (!best) { best = el; continue; }
    const a = stamp(el);
    const b = stamp(best);
    if (a > b || (a === b && nameOf(el).localeCompare(nameOf(best)) < 0)) best = el;
  }
  return best;
}

/** The charter's opening, for Home: its first paragraph, cut at a word near `max` characters. */
export function charterLead(el: Element, max = 280): string {
  const text = typeof el.description === 'string' ? el.description.trim() : '';
  if (!text) return '';
  const first = text.split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim();
  if (first.length <= max) return first;
  const cut = first.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function stamp(el: Element): string {
  const rec = el as Record<string, unknown>;
  const v = rec.local_updated_at ?? rec.updated_at ?? rec.server_updated_at;
  return typeof v === 'string' ? v : '';
}

function nameOf(el: Element): string {
  return typeof el.name === 'string' ? el.name : '';
}
