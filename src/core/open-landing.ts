/**
 * Where an open link lands: `#/open/<world id>/element/<id>`
 * opens the world by the `#/open` door, then the element; `/elements/<ids>`
 * opens a work packet, the elements in the link's order, stepped through with
 * the packet bar (`ui/open-packet-bar.ts`); `/writing[/<id>]` opens the
 * writing room, on that narrative or at its start (a landing of its own kind,
 * so a writing link with no narrative is held too).
 *
 * The door's paths all end at the world's Home (a copy already here, the
 * account's row after the Open click, the sign-in first, a public world's
 * view-only copy), so the landing does not ride them: it waits here, in
 * memory like the captured id (and in the sign-in round trip's resume beside
 * it, `sync/onlyworlds-sign-in.ts`), until the world the link names is the
 * active one and has loaded, then moves there once. The world the link names
 * is matched by its link, a former link, or the world a copy copies. A
 * landing for another world is dropped the moment a different world's link
 * is captured. Nothing here opens a world or writes anything.
 */
import type { Element, WorldRegistryEntry } from './types';

/** The writing room's landing: one narrative, or the room's start. */
export interface WritingLanding { kind: 'writing'; narrativeId: string | null }

export interface OpenLanding {
  /** keel's world id, as the link names it. */
  serverWorldId: string;
  /** The element ids, in the link's order (one for an element link); empty for a writing landing. */
  elementIds: string[];
  /** Set for a writing landing. */
  writing?: WritingLanding;
  /** When the link was captured (ms): a landing never fires long after, unasked. */
  at: number;
}

/** A link's one element (or narrative) that this world does not hold for this reader. */
export const LANDING_MISSING_ONE_LINE = 'The element this link names is not in this world, or not in your view of it.';

/** Long enough for a sign-in and a download; short enough that a later open of the same world is never moved by an old link. */
export const OPEN_LANDING_TTL_MS = 15 * 60_000;

let landing: OpenLanding | null = null;

export function setOpenLanding(serverWorldId: string, target: readonly string[] | WritingLanding, now = Date.now()): void {
  if (!Array.isArray(target)) {
    const w = target as WritingLanding;
    landing = { serverWorldId, elementIds: [], writing: { kind: 'writing', narrativeId: w.narrativeId }, at: now };
    return;
  }
  const elementIds = target as readonly string[];
  landing = elementIds.length > 0 ? { serverWorldId, elementIds: [...elementIds], at: now } : null;
}

export function clearOpenLanding(): void {
  landing = null;
}

export function peekOpenLanding(): OpenLanding | null {
  return landing;
}

/** A landing as the sign-in round trip parks it (`atlas-signin-resume`): read back by shape there. */
export type ParkedLanding =
  | { kind: 'elements'; ids: string[]; at: number }
  | { kind: 'writing'; narrativeId: string | null; at: number };

/** The landing waiting for the world this open id names, parked for the round trip; null when none waits. */
export function parkedLandingFor(serverWorldId: string): ParkedLanding | null {
  const l = landing;
  if (!l || l.serverWorldId !== serverWorldId) return null;
  if (l.writing) return { kind: 'writing', narrativeId: l.writing.narrativeId, at: l.at };
  return l.elementIds.length > 0 ? { kind: 'elements', ids: [...l.elementIds], at: l.at } : null;
}

/** Back from the round trip: the parked landing waits again, with its own capture time (the TTL holds across). */
export function restoreParkedLanding(serverWorldId: string, p: ParkedLanding): void {
  setOpenLanding(serverWorldId, p.kind === 'writing' ? { kind: 'writing', narrativeId: p.narrativeId } : p.ids, p.at);
}

/** What to do now, for the active world; pure over its inputs. */
export type LandingStep =
  | { kind: 'wait' }
  | { kind: 'expired' }
  | { kind: 'land'; localWorldId: string; found: string[]; missing: number }
  | { kind: 'writing'; localWorldId: string; narrativeId: string | null };

export function landingStep(
  l: OpenLanding | null,
  active: { worldId: string } | null,
  entry: Pick<WorldRegistryEntry, 'id' | 'api' | 'former_api_world_id' | 'copy_of'> | undefined,
  loading: boolean,
  elements: readonly Pick<Element, 'id'>[],
  now = Date.now(),
): LandingStep {
  if (l && now - l.at > OPEN_LANDING_TTL_MS) return { kind: 'expired' };
  // An empty element list is a world still arriving as often as an empty world: wait.
  if (!l || !active || !entry || loading || elements.length === 0) return { kind: 'wait' };
  // The world the link names: its link, a link it had, or the world a view-only copy copies.
  const server = entry.api?.world_id ?? entry.former_api_world_id ?? entry.copy_of?.world_id ?? null;
  if (server !== l.serverWorldId) return { kind: 'wait' };
  if (l.writing) return { kind: 'writing', localWorldId: active.worldId, narrativeId: l.writing.narrativeId };
  const have = new Set(elements.map(e => e.id));
  const found = l.elementIds.filter(id => have.has(id));
  return { kind: 'land', localWorldId: active.worldId, found, missing: l.elementIds.length - found.length };
}
