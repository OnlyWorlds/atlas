/**
 * Whether the OnlyWorlds mark (the SDK's Waymark) shows beside a name, and
 * what it is given. Pure: the facts it cannot read itself (a kept element,
 * the public page's switch) are handed in.
 *
 * The rule: the mark shows only where the site has a page for this reader.
 * A world on OnlyWorlds as itself (not a local or browser world, not a
 * view-only copy). Read with a read key or a player's link, only when the
 * world's public page is on (`public_read` and `public_page.on` on GET
 * /world), as the public face. An element only once it has reached keel and
 * while the key still shows it (not kept here outside the view).
 */

import type { Element, WorldRegistryEntry } from './types';

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
  /** For a read key's world: the public page is on. Null or absent: not known yet, so no mark. */
  publicPageOn?: boolean | null;
}

/** A read key's world or a player's link: view-only on OnlyWorlds with no seat. */
export function isPublicReader(entry: WorldRegistryEntry): boolean {
  return !!entry.api?.read_only && !entry.api.seat;
}

export function waymarkFor(entry: WorldRegistryEntry | null | undefined, el: Element | null, facts: WaymarkFacts): WaymarkPlan | null {
  if (!entry || entry.state !== 'api-linked' || !entry.api?.world_id) return null;
  if (entry.copy_of) return null;
  const reader: WaymarkReader = isPublicReader(entry) ? 'public' : 'member';
  if (reader === 'public' && facts.publicPageOn !== true) return null;
  const world = { id: entry.api.world_id, name: facts.meta.name, ...(facts.meta.x_names !== undefined ? { x_names: facts.meta.x_names } : {}) };
  if (!el) return { world, element: null, reader };
  const rec = el as unknown as Record<string, unknown>;
  if (typeof rec.server_updated_at !== 'string' || !rec.server_updated_at) return null;
  if (facts.kept) return null;
  const name = typeof el.name === 'string' && el.name ? el.name : '(unnamed)';
  const element = facts.stub || reader === 'public'
    ? { id: el.id, type: el.type, name }
    : { ...rec, id: el.id, type: el.type, name, updated_at: rec.server_updated_at };
  return { world, element, reader };
}
