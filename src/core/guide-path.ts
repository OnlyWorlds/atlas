/**
 * The guide's path in a world (#964): which door is open, whether the path
 * shows, and the pointer's two writes (start, Next) and the rooms' visits.
 *
 *   The doors are memory, per page session: a reload shows the two doors.
 *   The pointer (`guide_step`) and the visits (`guide_visited`) live on the
 *   world's registry entry, written only from a press or a room's mount,
 *   never from a render, and the pointer only forward.
 *
 * Contract: a design note of 2026-10-29 (a new world's first screen, draft 2).
 */

import { getState, patchSlice } from './state';
import { saveRegistry, storedWorldEntry, updateWorldEntry } from '../registry/registry';
import { worldIsViewOnly } from './view-only';
import { isMoppetopiaOpen } from './moppetopia';
import { isTourFlagActive } from '../tour/tour-flag';
import { currentLore, loreWithAids } from './parlor-room';
import { settledOf } from './review-mark';
import { keepSafeCard } from '../middle/home-keepsafe';
import {
  DOTS, guideDots, laterStep, worldIsEmptyForGuide, type DotId, type Dots, type StepId,
} from './guide';

export type Door = 'nothing' | 'bring';

const openDoors = new Map<string, Door>();
const listeners = new Set<() => void>();

/** The door open in a world's empty home, if any (memory only). */
export function doorOf(worldId: string): Door | undefined {
  return openDoors.get(worldId);
}

/** Open a door, or close it (Back): the home redraws, unless `quiet` (a press that is leaving the home). */
export function setDoor(worldId: string, door: Door | null, opts: { quiet?: boolean } = {}): void {
  if (door) openDoors.set(worldId, door); else openDoors.delete(worldId);
  if (!opts.quiet) for (const fn of listeners) fn();
}

export function onDoorChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const entryOf = (worldId: string) => getState().registry.worlds.find(w => w.id === worldId);

/** Whether the keep-safe card would ask in this world, by the home's own inputs. */
export function keepSafeWouldShow(worldId: string): boolean {
  const s = getState();
  return !!keepSafeCard({ entry: entryOf(worldId), elements: settledOf(loreWithAids()), loading: !!s.data.loading, now: Date.now() });
}

/**
 * The dots the path reads: the home's lore, the copy lit by any copy outside this browser.
 * The keep-safe card's ask for a fresher copy is its own voice, drawn below the block
 * (the code gate's C7: a world online or exported is not "kept only in this browser").
 */
export function pathDots(worldId: string): Dots {
  return guideDots(currentLore(), entryOf(worldId));
}

/** Empty for the guide: the world's own elements, its reading aids counted whatever the switch (the gate's C1, §1). */
export function worldEmptyForPath(): boolean {
  return worldIsEmptyForGuide(getState().data.elements);
}

/** Where a world's block can speak at all: its own, open, editable, settled, the tour off, not hidden. */
function blockCanShow(worldId: string): boolean {
  const s = getState();
  const entry = entryOf(worldId);
  if (!entry || entry.demo === true || isMoppetopiaOpen(worldId) || worldIsViewOnly(worldId) || isTourFlagActive()) return false;
  if (s.active?.worldId !== worldId || s.data.loading) return false;
  return !entry.tour_dismissed?.includes('home-cards');
}

/**
 * Whether the path shows in this world: the one predicate the home's block
 * and the notes' silence read. An empty world shows it unless it was closed.
 * A world with a pointer shows it until `done`; one without (imported,
 * older) shows it while some dot is unlit, the copy left to the keep-safe card
 * while that card asks.
 */
export function pathShowing(worldId: string): boolean {
  if (!blockCanShow(worldId)) return false;
  const pointer = entryOf(worldId)?.guide_step;
  // An empty world opens on the path (the home that grows: no doors), unless its path was closed.
  if (worldEmptyForPath()) return pointer !== 'done';
  if (pointer) return pointer !== 'done';
  const keep = keepSafeWouldShow(worldId);
  const dots = pathDots(worldId);
  return DOTS.some(d => !dots[d.id] && !(d.id === 'copy' && keep));
}

function writeEntry(worldId: string, patch: { guide_step?: StepId; guide_visited?: string[] }): void {
  const reg = getState().registry;
  if (!reg.worlds.some(w => w.id === worldId)) return;
  const next = updateWorldEntry(reg, worldId, patch);
  saveRegistry(next);
  patchSlice('registry', next);
}

/**
 * The path starts at `someone`: Start from nothing, an empty return from the Data room, a
 * Start-page world. A pointer already set (here or by another tab) stays; `restart`, Start from
 * nothing pressed in an empty world, begins again a path that was done (the gate's C5).
 */
export function startPath(worldId: string, opts: { restart?: boolean } = {}): void {
  const mine = entryOf(worldId)?.guide_step;
  const stored = storedWorldEntry(worldId)?.guide_step;
  const held = mine ? laterStep(stored, mine) : stored;
  if (held === 'done' && opts.restart) { writeEntry(worldId, { guide_step: 'someone', guide_visited: [] }); return; }
  if (!held) { writeEntry(worldId, { guide_step: 'someone' }); return; }
  if (held !== mine) writeEntry(worldId, { guide_step: held });
}

/**
 * Next: the later of the pointer stored, this tab's, and the one computed, so a stale tab cannot
 * move it back (the registry's two-tab merge keeps a tab's own change of a field over another's).
 */
export function advancePath(worldId: string, to: StepId): StepId {
  const next = laterStep(storedWorldEntry(worldId)?.guide_step, laterStep(entryOf(worldId)?.guide_step, to));
  if (next !== entryOf(worldId)?.guide_step) writeEntry(worldId, { guide_step: next });
  return next;
}

const VISIT_ROOMS: Record<string, DotId> = { timeline: 'happened', writing: 'story' };

/**
 * A room's mount (the shell's), for the world its route names: the chart or the writing room seen once its
 * step is lit, in the active world, the tour off, while the path shows. An
 * early look at the empty chart is not the step. Written once, in a microtask.
 */
export function noteRoomVisit(mode: string, worldId: string | null): void {
  const step = VISIT_ROOMS[mode];
  if (!step || !worldId) return;
  queueMicrotask(() => {
    if (getState().active?.worldId !== worldId || !pathShowing(worldId)) return;
    if (!pathDots(worldId)[step]) return;
    // With what another tab may have seen: the merge keeps this tab's list whole over theirs.
    const visited = [...new Set([...(storedWorldEntry(worldId)?.guide_visited ?? []), ...(entryOf(worldId)?.guide_visited ?? [])])];
    if (visited.includes(step) && (entryOf(worldId)?.guide_visited ?? []).includes(step)) return;
    writeEntry(worldId, { guide_visited: visited.includes(step) ? visited : [...visited, step] });
  });
}

/** Test seam: forget the open doors. */
export function resetGuidePathForTests(): void {
  openDoors.clear();
}
