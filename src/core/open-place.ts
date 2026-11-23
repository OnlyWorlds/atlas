/**
 * Where a world's open draws when it finishes (1.125.8, conv. 195).
 *
 * An open takes time (a folder's permission, the store's claim, the element
 * walk, a download), and the person goes on meanwhile: Settings from the
 * sidebar gear, another room, Back. An open that finishes draws into the
 * place the person is at that moment, never back to the place it started
 * from (Settings pressed in the first moments after a reload used to give
 * way to the world's Home once the world in the address had opened).
 *
 * A place that already names the opened world is drawn as it is. Any other
 * place (a world-less one, such as `#/settings`, or one that names another
 * world, since the gear and a room's links read the world still open) is
 * read onto the opened world by the room-stable rule (conv. 37): the room
 * kind at its landing level, Settings with its tab, an element or a map
 * place falling to home. A world the person picks meanwhile is the activation
 * chain's (`newerOpenOfAnotherWorld`): the earlier open commits as it always
 * did and skips only its landing, and the later pick opens from there.
 *
 * A flow that opens a world as one task (a download, a make, a restore)
 * reads `openStart` before it and ends with `endOpen`.
 *
 * Pure but for `window.location` and one read of the open world; it imports
 * only the router, the chain and the state.
 */
import {
  importHash, knowledgeHash, navigate, parseHash, settingsHash, shareHash,
  timelineHash, worldHash, writingHash, type Route,
} from './router';
import { currentActivationGen } from './activation-chain';
import { getState } from './state';

/**
 * The room-stable reading of a route on `worldId` (conv. 37): writing,
 * knowledge, charts, pages and data at their landing level, Settings with its
 * tab; element, map, home and anything world-bound fall to home.
 */
export function roomStableHash(route: Route, worldId: string): string {
  switch (route.mode) {
    case 'settings': return settingsHash(worldId, route.settingsTab);
    case 'writing': return writingHash(worldId);
    case 'knowledge': return knowledgeHash(worldId);
    case 'timeline': return timelineHash(worldId);
    case 'share': return shareHash(worldId);
    case 'import': return importHash(worldId);
    default: return worldHash(worldId);
  }
}

/**
 * The person's place `hash` read onto `worldId`: the hash itself when it
 * names that world, the room-stable reading of any other place, or null for
 * a world-less place the shell already draws over whatever world is open
 * (the Data room with no world, which `app.ts` hands to the open world as a
 * bring-in, and the example page's overlay).
 */
export function placeOnWorld(hash: string, worldId: string): string | null {
  const route = parseHash(hash);
  if (route.worldId === worldId) return hash;
  if (route.worldId === null && (route.mode === 'import' || route.mode === 'demo')) return null;
  return roomStableHash(route, worldId);
}

/**
 * Ends an open of `worldId`. `moved` says whether the address changed since
 * the open left the person where it put them (its start, or its own first
 * navigation). Not moved: the open's own `landing` (null: the address stays).
 * Moved: the person's place stands, read onto the opened world, and it
 * replaces the entry they are on, so Back never leads to a place that named
 * the wrong world.
 */
export function landOpen(worldId: string, moved: boolean, landing: string | null): void {
  if (!moved) {
    if (landing !== null) navigate(landing);
    return;
  }
  const now = window.location.hash;
  const place = placeOnWorld(now, worldId);
  if (place !== null && place !== now) window.location.replace(place);
}

/** Where an open that runs as one task (a download, a make, a restore) began: the address and the activation count. */
export interface OpenStart { hash: string; gen: number }

export function openStart(): OpenStart {
  return { hash: window.location.hash, gen: currentActivationGen() };
}

/**
 * What the person did since `start`: `picked` (a world was asked for since:
 * it opens next and wins), `moved` (the address changed) or null (nothing).
 * Read it as soon as the task is done, before the flow opens anything itself.
 */
export function sinceOpenStart(start: OpenStart): 'picked' | 'moved' | null {
  if (currentActivationGen() !== start.gen) return 'picked';
  return window.location.hash !== start.hash ? 'moved' : null;
}

/**
 * Ends a task's open of `worldId` by what `sinceOpenStart` read. A world
 * picked meanwhile that has taken the screen (the task's world is no longer
 * the open one) draws its own place, so the task draws nothing. Otherwise the
 * task's world is on screen: with a pick still queued behind the task, the
 * person's place is read onto that world (a replace), so the pick starts from
 * an address naming the world on screen and a pick that fails comes back to
 * it; moved, the same; nothing pressed, its own `landing`.
 */
export function endOpen(worldId: string, since: 'picked' | 'moved' | null, landing: string): void {
  if (since === 'picked' && getState().active?.worldId !== worldId) return;
  landOpen(worldId, since !== null, landing);
}

/**
 * The open's hold, DEV only (the e2e and the unit tests): a page that sets
 * `window.__atlasOpenHold` to a promise has every world's open wait on it
 * just before it commits, so a test can press something while an open is
 * under way, as a person does. `window.__atlasOpenHeld` counts the opens
 * that reached it. Call it only under `import.meta.env.DEV`.
 */
export function openHoldSet(): boolean {
  return (window as unknown as { __atlasOpenHold?: unknown }).__atlasOpenHold instanceof Promise;
}

export async function waitOpenHold(): Promise<void> {
  const w = window as unknown as { __atlasOpenHold?: Promise<unknown>; __atlasOpenHeld?: number };
  w.__atlasOpenHeld = (w.__atlasOpenHeld ?? 0) + 1;
  await w.__atlasOpenHold;
}
