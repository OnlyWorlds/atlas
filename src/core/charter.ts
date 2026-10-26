/**
 * A world's charter (#526): the Law with supertype Charter, by the crew's
 * convention (Skeld, 2026-10-21: what this world is for, who is in it, its house
 * rules). Home shows it first, so a person meets the rules an agent is told to
 * read before anything else.
 *
 * keel's one definition (D152, PR 182; Skeld 2026-10-22), which keel's
 * front door and the doctor read too: a Law counts only when the owner or a
 * co-builder made it (any member may make a Law, and a guest's or a seat's
 * own Charter must never be the one that leads), and the newest by
 * `created_at` leads, a tie to the higher id, so editing a Charter never
 * changes which one leads.
 *
 * Pure: the roster's roles come in.
 */
import type { OwMember } from '@onlyworlds/sdk';
import type { Element } from './types';

/** The roster as membership id to role; null when it has not been read. */
export type RosterRoles = ReadonlyMap<string, OwMember['role']> | null;

export function rosterRoles(roster: readonly OwMember[] | null): RosterRoles {
  if (!roster) return null;
  const roles = new Map<string, OwMember['role']>();
  for (const row of roster) if (typeof row.id === 'string') roles.set(row.id, row.role);
  return roles;
}

/**
 * Made by a keeper: `created_by` null is the owner (keel D72); absent is made
 * here and not yet read back (a world that never met keel is all its owner's);
 * a membership counts only as a co-builder the roster names. No roster, no
 * membership counts: a guest's Charter must not lead while the roster is unread.
 */
export function madeByKeeper(el: Element, roles: RosterRoles): boolean {
  const by = (el as Record<string, unknown>).created_by;
  if (by === null || by === undefined || by === '') return true;
  return typeof by === 'string' && !!roles && roles.get(by) === 'co_builder';
}

export function isCharter(el: Element): boolean {
  if (el.type !== 'law') return false;
  const sup = (el as Record<string, unknown>).supertype;
  return typeof sup === 'string' && sup.trim().toLowerCase() === 'charter';
}

/**
 * `named` is world.json's `charter` (folder spec §4.6 (a)): a folder's shortcut
 * and tie-break, preferred when it names a Law the world holds. It never rides
 * the wire, so a linked world often lacks it, and anything else in it (a
 * missing id, another type, not a string) leaves the rule by supertype.
 */
export function findCharter(elements: readonly Element[], named?: unknown, roles: RosterRoles = null): Element | null {
  if (typeof named === 'string' && named) {
    const law = elements.find(el => el.id === named && el.type === 'law');
    if (law && madeByKeeper(law, roles)) return law;
  }
  let best: Element | null = null;
  for (const el of elements) {
    if (!isCharter(el) || !madeByKeeper(el, roles)) continue;
    if (!best || newer(el, best)) best = el;
  }
  return best;
}

/** keel's order (`house_of`: -created_at, then -id). One made here and not read back has no stamp yet, and is the newest. */
function newer(a: Element, b: Element): boolean {
  const ca = createdAt(a);
  const cb = createdAt(b);
  if (ca !== cb) return ca === null ? true : cb === null ? false : ca > cb;
  return a.id > b.id;
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

function createdAt(el: Element): string | null {
  const v = (el as Record<string, unknown>).created_at;
  return typeof v === 'string' && v ? v : null;
}
