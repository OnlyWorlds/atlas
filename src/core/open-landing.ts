/**
 * Where an open link lands: `#/open/<world id>/element/<id>`
 * opens the world by the `#/open` door, then the element; `/elements/<ids>`
 * opens a work packet, the elements in the link's order, stepped through with
 * the packet bar (`ui/open-packet-bar.ts`).
 *
 * The door's paths all end at the world's Home (a copy already here, the
 * account's row after the Open click, the sign-in first), so the landing does
 * not ride them: it waits here, in memory like the captured id, until the
 * world the link names is the active one and has loaded, then moves there
 * once. A landing for another world is dropped the moment a different world's
 * link is captured. Nothing here opens a world or writes anything.
 */
import type { Element, WorldRegistryEntry } from './types';

export interface OpenLanding {
  /** keel's world id, as the link names it. */
  serverWorldId: string;
  /** The element ids, in the link's order (one for an element link). */
  elementIds: string[];
  /** When the link was captured (ms): a landing never fires long after, unasked. */
  at: number;
}

/** Long enough for a sign-in and a download; short enough that a later open of the same world is never moved by an old link. */
export const OPEN_LANDING_TTL_MS = 15 * 60_000;

let landing: OpenLanding | null = null;

export function setOpenLanding(serverWorldId: string, elementIds: readonly string[], now = Date.now()): void {
  landing = elementIds.length > 0 ? { serverWorldId, elementIds: [...elementIds], at: now } : null;
}

export function clearOpenLanding(): void {
  landing = null;
}

export function peekOpenLanding(): OpenLanding | null {
  return landing;
}

/** What to do now, for the active world; pure over its inputs. */
export type LandingStep =
  | { kind: 'wait' }
  | { kind: 'expired' }
  | { kind: 'land'; localWorldId: string; found: string[]; missing: number };

export function landingStep(
  l: OpenLanding | null,
  active: { worldId: string } | null,
  entry: Pick<WorldRegistryEntry, 'id' | 'api' | 'former_api_world_id'> | undefined,
  loading: boolean,
  elements: readonly Pick<Element, 'id'>[],
  now = Date.now(),
): LandingStep {
  if (l && now - l.at > OPEN_LANDING_TTL_MS) return { kind: 'expired' };
  // An empty element list is a world still arriving as often as an empty world: wait.
  if (!l || !active || !entry || loading || elements.length === 0) return { kind: 'wait' };
  const server = entry.api?.world_id ?? entry.former_api_world_id ?? null;
  if (server !== l.serverWorldId) return { kind: 'wait' };
  const have = new Set(elements.map(e => e.id));
  const found = l.elementIds.filter(id => have.has(id));
  return { kind: 'land', localWorldId: active.worldId, found, missing: l.elementIds.length - found.length };
}
