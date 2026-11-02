/**
 * Home's Strand tab, its reading and its memory (this tab's, never stored): the one reading of the
 * strand a draw hands to every part, and what the panel keeps between draws. Kept in one module so the
 * head, the cards and the boxes (`home-strand.ts`, `home-strand-card.ts`, `home-strand-box.ts`) read
 * and clear the same memory.
 *
 *   - The cards' fields (R3): what was typed in each card, per world and slot (an Edit card's apart),
 *     restored by every draw; cleared by a Make or Save that wrote, by Escape, or a world switch.
 *   - The skips (R2): the slots "Skip for now" set aside, per world, until Add or a world switch.
 *   - The slot asked for out of order (the frame's Pick on Home, an Add press) and the box being edited.
 *   - The tab chosen per world, the focus asked for after the next draw, the change opened on a box, the
 *     panel's own line, and the writes in flight.
 */

import type { Element, WorldMeta, WorldRegistryEntry } from '../core/types';
import { getState, subscribe } from '../core/state';
import { elementIndex, strandView, type OwStrand, type StrandSlot } from '../core/strand';
import { isKeptHere, keptSetOf } from '../sync/sync-attach';
import { EMPTY_VALUES, type CardValues } from '../core/strand-journey';
import type { StrandDrawn } from '../ui/strand-write';

export type HomeTab = 'picture' | 'strand';

// ---- The reading ----

export interface StrandContext {
  worldId: string;
  entry: WorldRegistryEntry | undefined;
  meta: WorldMeta;
  /** The store's array, the kept-here copies included: read through `kept` (Pick filters it only when opened). */
  all: readonly Element[];
  /** Whether an element is a kept-here copy outside the key's view (conv. 151). */
  kept: (id: string) => boolean;
  /** This copy's elements by id, less the kept-here copies; the array's own index when none is kept (C7). */
  byId: ReadonlyMap<string, Element>;
  strand: OwStrand;
}

/** The kept-filtered index, once per elements array and kept set (rare: a member's kept copies). */
const filtered = new WeakMap<readonly Element[], { set: ReadonlySet<string>; byId: Map<string, Element> }>();

function byIdLessKept(all: readonly Element[], keptSet: ReadonlySet<string> | undefined): ReadonlyMap<string, Element> {
  if (!keptSet || keptSet.size === 0) return elementIndex(all);
  const hit = filtered.get(all);
  if (hit && hit.set === keptSet) return hit.byId;
  const byId = new Map<string, Element>();
  for (const el of all) if (!keptSet.has(el.id)) byId.set(el.id, el);
  filtered.set(all, { set: keptSet, byId });
  return byId;
}

/** The strand as this copy reads it, for one draw: Home computes it once and hands it to each part (C7). */
export function strandContext(worldId: string): StrandContext | null {
  const s = getState();
  if (!s.active || s.active.worldId !== worldId) return null;
  noteWorld(worldId);
  const kept = (id: string) => isKeptHere(worldId, id);
  return {
    worldId,
    entry: s.registry.worlds.find(w => w.id === worldId),
    meta: s.active.meta,
    all: s.data.elements,
    kept,
    byId: byIdLessKept(s.data.elements, keptSetOf(worldId)),
    strand: strandView(s.active.meta, s.data.elements, kept),
  };
}

// ---- The memory ----

/** A box opened for a change, or a change said and waiting for its second press. */
export interface Opened {
  worldId: string;
  slot: StrandSlot;
  /** 'acts': Use another pressed, the box offers its ways; 'promise': a pick or a name said, the second press writes. */
  mode: 'acts' | 'promise';
  pick?: string;
  name?: string;
  /** The promise was said on the slot's card (a held Character or Now field): its Make carries the card's fields. */
  card?: boolean;
  /** What the promise named: the second press writes against this, never against a newer draw. */
  drawn?: StrandDrawn;
  /** The box's state when it opened, to let go of it once the world moved. */
  stamp: string;
}

/** The box drawn as its Edit card: the values it opened with, shown and compared at Save. */
export interface Editing {
  worldId: string;
  slot: StrandSlot;
  id: string;
  opened: CardValues;
  raw: Record<string, unknown>;
}

export const memory = {
  tabs: new Map<string, HomeTab>(),
  /** A control to focus after the next draw (a tab press, a write). */
  askFocus: null as { worldId: string; key: string } | null,
  opened: null as Opened | null,
  /** The panel's own line (a refusal, an element made and kept), for this world, until the next act. */
  said: null as { worldId: string; text: string } | null,
  drafts: new Map<string, CardValues>(),
  skips: new Map<string, Set<StrandSlot>>(),
  forced: null as { worldId: string; slot: StrandSlot } | null,
  editing: null as Editing | null,
  /** The slots with a write under way (C1): set before the write's first await, cleared after its redraw. */
  inFlight: new Set<string>(),
  /** The open name boxes, pick lists, menus and held cards, each with its quiet close. */
  openClosers: new Set<() => void>(),
};

export const draftKey = (worldId: string, slot: StrandSlot, edit: boolean): string => `${worldId}\u0000${slot}${edit ? '\u0000edit' : ''}`;

/** A card's fields as last typed (empty when none). */
export function draftOf(worldId: string, slot: StrandSlot, edit = false): CardValues {
  return memory.drafts.get(draftKey(worldId, slot, edit)) ?? EMPTY_VALUES;
}

export function keepDraft(worldId: string, slot: StrandSlot, edit: boolean, v: CardValues): void {
  memory.drafts.set(draftKey(worldId, slot, edit), { ...v });
}

export function clearDraft(worldId: string, slot: StrandSlot, edit = false): void {
  memory.drafts.delete(draftKey(worldId, slot, edit));
}

export function isSkipped(worldId: string, slot: StrandSlot): boolean {
  return memory.skips.get(worldId)?.has(slot) ?? false;
}

export function skip(worldId: string, slot: StrandSlot): void {
  let set = memory.skips.get(worldId);
  if (!set) { set = new Set(); memory.skips.set(worldId, set); }
  set.add(slot);
  if (memory.forced?.worldId === worldId && memory.forced.slot === slot) memory.forced = null;
}

/** Ask a slot now, out of order if need be: it is un-skipped and drawn as its card. */
export function askSlot(worldId: string, slot: StrandSlot): void {
  memory.skips.get(worldId)?.delete(slot);
  memory.forced = { worldId, slot };
}

export function forcedSlot(worldId: string): StrandSlot | null {
  return memory.forced?.worldId === worldId ? memory.forced.slot : null;
}

export const flightKey = (worldId: string, slot: StrandSlot): string => `${worldId}\u0000${slot}`;

export function flying(worldId: string): boolean {
  for (const k of memory.inFlight) if (k.startsWith(`${worldId}\u0000`)) return true;
  return false;
}

/** The world the memory was last kept for: a switch to another clears the cards, the skips and the asks. */
let lastWorld: string | null = null;

function noteWorld(worldId: string | null): void {
  if (worldId === lastWorld) return;
  if (lastWorld !== null && worldId !== null) clearJourney();
  if (worldId !== null) lastWorld = worldId;
}

/** Every card's fields, the skips, the ask and the edit (a world switch, a reload). */
export function clearJourney(): void {
  memory.drafts.clear();
  memory.skips.clear();
  memory.forced = null;
  memory.editing = null;
  memory.opened = null;
  memory.said = null;
}

// A world switch anywhere in the app (the sidebar, a room's link) clears the journey's memory, not only
// a switch while Home draws.
subscribe(() => noteWorld(getState().active?.worldId ?? null));

/** Test seam. */
export function resetStrandMemoryForTests(): void {
  memory.tabs.clear();
  memory.askFocus = null;
  memory.inFlight.clear();
  memory.openClosers.clear();
  clearJourney();
  lastWorld = null;
}
