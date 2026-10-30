/**
 * Whether the OnlyWorlds mark (the SDK's Waymark) shows beside a name, and
 * what it is given. Pure: the facts it cannot read itself (a kept element,
 * the public page's switch) are handed in.
 *
 * The rule: the mark shows only where the site has a page for this reader.
 * keel's `/w/<world>` sends on the owner and every live member (signed in
 * there, since 30 Oct 2026) and otherwise shows the public page when it is on; an
 * element's address sends on a signed-in member whose role reads it. So:
 * - the world's own mark: the owner or a member, or anyone while the public
 *   page is on;
 * - an element's mark: the owner or a member, once it has reached keel and
 *   while the key still shows it; a read key, a player's link or an agent
 *   seat (no account on the site) only while the public page is on, and only
 *   for an element the public page shows (not hidden, no room element, not
 *   proposed);
 * - never a local or browser world, never a view-only copy.
 */

import type { Element, WorldRegistryEntry } from './types';
import { isHiddenMark } from './hidden-mark';
import { isRoomElement } from './parlor-room';
import { handsOnAsProposed } from './review-mark';

export type WaymarkReader = 'member' | 'public';

export interface WaymarkPlan {
  world: { id: string; name: string; x_names?: unknown };
  element: { id: string; type: string; name: string; [k: string]: unknown } | null;
  reader: WaymarkReader;
}

export interface WaymarkFacts {
  /** The world's own name and words, as the page shows them. */
  meta: { name: string; x_names?: unknown };
  /** The element is kept here outside the key's view (conv. 151). */
  kept?: boolean;
  /** The element is a known-of stub (only its name and type served). */
  stub?: boolean;
  /** The world's public page is on. Null or absent: not known yet. */
  publicPageOn?: boolean | null;
}

/** A read key's world or a player's link: view-only on OnlyWorlds with no seat. */
export function isPublicReader(entry: WorldRegistryEntry): boolean {
  return !!entry.api?.read_only && !entry.api.seat;
}

/** An agent seat: its key has no account on the site behind it. */
function isSeat(entry: WorldRegistryEntry): boolean {
  return !!entry.api?.seat;
}

/** Whose site pages this reader can open only through the public page: the public face. */
export function readsByPublicPage(entry: WorldRegistryEntry): boolean {
  return isPublicReader(entry) || isSeat(entry);
}

export function waymarkFor(entry: WorldRegistryEntry | null | undefined, el: Element | null, facts: WaymarkFacts): WaymarkPlan | null {
  if (!entry || entry.state !== 'api-linked' || !entry.api?.world_id) return null;
  if (entry.copy_of) return null;
  const pageOn = facts.publicPageOn === true;
  const viaPublic = readsByPublicPage(entry);
  if (viaPublic && !pageOn) return null;
  const reader: WaymarkReader = viaPublic ? 'public' : 'member';
  const world = { id: entry.api.world_id, name: facts.meta.name, ...(facts.meta.x_names !== undefined ? { x_names: facts.meta.x_names } : {}) };
  if (!el) return { world, element: null, reader };
  const rec = el as unknown as Record<string, unknown>;
  if (typeof rec.server_updated_at !== 'string' || !rec.server_updated_at) return null;
  if (facts.kept) return null;
  // The public page shows no hidden element, no room element and nothing proposed or doubted; a Pin or a
  // Marker has no page of its own there (its address opens the world's page).
  if (reader === 'public' && (isHiddenMark(el) || isRoomElement(el) || handsOnAsProposed(el)
    || el.type === 'pin' || el.type === 'marker')) return null;
  const name = typeof el.name === 'string' && el.name ? el.name : '(unnamed)';
  const element = facts.stub || reader === 'public'
    ? { id: el.id, type: el.type, name }
    : { ...rec, id: el.id, type: el.type, name, updated_at: rec.server_updated_at };
  return { world, element, reader };
}
