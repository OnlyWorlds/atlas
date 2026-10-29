/**
 * The Web through a lens (#841, onboarding 3; schema-dist profiles/lens.md).
 *
 *   The choice: a world's lenses (`isLens`, a proposed one left out) and the
 *   one the Web reads through, kept on this computer as the registry entry's
 *   `context_lens`. A chosen id that is gone, no lens, or proposed reads as none.
 *
 *   The reading: `resolveLens` gives the kept ids in the profile's order, the
 *   cut by reason and whether the lens can be read; `worldGraph` with the lens
 *   gives the links between them. Both read every element Atlas holds as the
 *   owner (Atlas holds the bodies it was served, so the owner rung over them
 *   counts only what this copy holds). Nothing is written.
 *
 *   Keep a lens on <name>: one Construct, supertype Lens, the subject in its
 *   type's anchor field and nothing else (no `x_lens`: depth 1 over the
 *   anchor). Never twice for one press, a double press or a second tab.
 */

import {
  handsOnAsProposed, isLens, isTemplate, resolveLens, worldGraph,
  type OwLensCutReason, type OwLensWorld,
} from '@onlyworlds/sdk';
import type { Element, ElementType } from './types';
import { getState, patchSlice } from './state';
import { saveRegistry } from '../registry/registry';
import { isRoomElement } from './parlor-room';
import { isHiddenMark } from './hidden-mark';
import { worldIsViewOnly } from './view-only';
import { isMoppetopiaOpen } from './moppetopia';
import { isTourFlagActive } from '../tour/tour-flag';

/** The Web draws at most this many of a lens's kept elements, the first in the reading's order. */
export const LENS_DRAW_MAX = 60;

/** Each type's anchor field on a lens: the Construct's Involves links less `titles` (the profile). */
export const LENS_ANCHOR_FIELD: Readonly<Partial<Record<ElementType, string>>> = {
  character: 'characters', object: 'objects', location: 'locations', species: 'species',
  creature: 'creatures', institution: 'institutions', trait: 'traits', collective: 'collectives',
  zone: 'zones', ability: 'abilities', phenomenon: 'phenomena', language: 'languages',
  family: 'families', relation: 'relations', construct: 'constructs', event: 'events',
  narrative: 'narratives',
};
const ANCHOR_FIELDS = Object.values(LENS_ANCHOR_FIELD) as string[];

export interface LensChoice {
  id: string;
  name: string;
  template: boolean;
}

function nameOf(el: Element): string {
  return (typeof el.name === 'string' && el.name.trim()) || 'Unnamed lens';
}

/** A lens the Web may read through: a lens, and not proposed (a doubt mark included). */
export function choosable(el: Element | undefined): el is Element {
  return !!el && isLens(el) && !handsOnAsProposed(el);
}

/** The world's lenses for the chip's list, by name. */
export function lensChoices(elements: readonly Element[]): LensChoice[] {
  return elements
    .filter(choosable)
    .map(el => ({ id: el.id, name: nameOf(el), template: isTemplate(el) }))
    .sort((a, b) => a.name.localeCompare(b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** The chosen lens, checked before any reading: gone, no lens, or proposed reads as none. */
export function chosenLens(elements: readonly Element[], id: string | null | undefined): Element | null {
  if (!id) return null;
  const el = elements.find(e => e.id === id);
  return choosable(el) ? el : null;
}

/** The world as the lens reader takes it: every element Atlas holds, and the world's own now. */
export function lensWorld(elements: readonly Element[] = getState().data.elements): OwLensWorld {
  const now = getState().active?.meta?.time_current;
  return { elements, now: typeof now === 'number' ? now : null };
}

export interface LensPicture {
  lensId: string;
  name: string;
  kind: 'ok' | 'template' | 'unreadable' | 'empty';
  /** The `x_lens` key the reader could not read (for a title only). */
  unreadableKey: string | null;
  /** How many the lens keeps. */
  kept: number;
  /** Every kept id, in the reading's order (the drawn are its first LENS_DRAW_MAX). */
  keptIds: string[];
  /** What the Web draws: the first LENS_DRAW_MAX kept, in the reading's order. */
  drawn: string[];
  /** The links between drawn elements (`from` holds the link), one per pair and direction. */
  edges: Array<{ from: string; to: string }>;
  /** The lens's own anchors among the drawn, in the lens's link order. */
  anchors: string[];
  cut: Partial<Record<OwLensCutReason, number>>;
}

/** The lens's anchor ids in its own link order (the schema's field order, then each list's). */
function anchorIdsOf(lens: Element): string[] {
  const rec = lens as Record<string, unknown>;
  const out: string[] = [];
  for (const f of ANCHOR_FIELDS) {
    const v = rec[f];
    if (Array.isArray(v)) for (const id of v) if (typeof id === 'string' && !out.includes(id)) out.push(id);
  }
  return out;
}

/** Read a lens for the Web. Pure: nothing is written. */
export function readLensPicture(lens: Element, elements: readonly Element[] = getState().data.elements): LensPicture {
  const base = { lensId: lens.id, name: nameOf(lens), unreadableKey: null, kept: 0, keptIds: [], drawn: [], edges: [], anchors: [], cut: {} };
  if (isTemplate(lens)) return { ...base, kind: 'template' };
  const world = lensWorld(elements);
  let reading;
  try {
    reading = resolveLens(world, lens.id, { rung: 'owner' });
  } catch {
    return { ...base, kind: 'unreadable' };
  }
  if (reading.unreadable) return { ...base, kind: 'unreadable', unreadableKey: reading.unreadable };
  if (reading.kept.length === 0) return { ...base, kind: 'empty', cut: reading.cut };
  const drawn = reading.kept.slice(0, LENS_DRAW_MAX);
  const drawnSet = new Set(drawn);
  const edges: Array<{ from: string; to: string }> = [];
  const seen = new Set<string>();
  try {
    for (const e of worldGraph(world, { rung: 'owner' }, { lens: lens.id }).edges) {
      if (e.source === e.target || !drawnSet.has(e.source) || !drawnSet.has(e.target)) continue;
      const key = `${e.source}>${e.target}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: e.source, to: e.target });
    }
  } catch {
    // The nodes still draw; only their lines are lost.
  }
  const anchors = anchorIdsOf(lens).filter(id => drawnSet.has(id));
  return { ...base, kind: 'ok', kept: reading.kept.length, keptIds: reading.kept, drawn, edges, anchors, cut: reading.cut };
}

/** Choose the Web's lens for a world (null: none). On this computer only: the registry entry, never the world. */
export function setWebLens(worldId: string, lensId: string | null): void {
  const reg = getState().registry;
  const idx = reg.worlds.findIndex(w => w.id === worldId);
  if (idx < 0 || (reg.worlds[idx].context_lens ?? null) === lensId) return;
  const updated = { ...reg.worlds[idx] };
  if (lensId) updated.context_lens = lensId;
  else delete updated.context_lens;
  const next = { ...reg, worlds: reg.worlds.map((w, i) => (i === idx ? updated : w)) };
  saveRegistry(next);
  patchSlice('registry', next);
}

/** Each cut reason in the line's words, in the profile's order. */
const CUT_WORDS: ReadonlyArray<[OwLensCutReason, string]> = [
  ['types', 'by type'],
  ['budget', 'past its limit'],
  ['window', 'outside its time'],
  ['stale', 'not changed lately'],
  ['undated', 'with no date'],
  ['after_as_of', "after the world's now"],
  ['anchor_not_visible', 'proposed, not yet accepted'],
  ['not_visible', 'proposed, not yet accepted'],
  ['hops_not_served', 'more than one step away'],
];

/** The line under the Web: what the lens keeps, what it left out and why. */
export function lensLine(p: LensPicture, subject?: { name: string; kept: boolean } | null): string {
  if (p.kind === 'template') return 'A template reads nothing until it points at something.';
  if (p.kind === 'unreadable') return "This lens can't be read: one of its settings is not one Atlas knows.";
  if (p.kind === 'empty') return `${p.name} keeps nothing in this world yet.`;
  const parts: string[] = [];
  const keeps = p.kept > p.drawn.length
    ? `${p.name} keeps ${p.kept}, and the Web draws the first ${p.drawn.length}.`
    : `${p.name} keeps ${p.kept}.`;
  parts.push(keeps);
  const byWord = new Map<string, number>();
  let total = 0;
  for (const [reason, word] of CUT_WORDS) {
    const n = p.cut[reason] ?? 0;
    if (n <= 0) continue;
    byWord.set(word, (byWord.get(word) ?? 0) + n);
    total += n;
  }
  if (total > 0) {
    parts.push(`${total} left out: ${[...byWord].map(([w, n]) => `${n} ${w}`).join(', ')}.`);
  }
  if (subject && !subject.kept) parts.push(`${subject.name || 'This element'} is not in this lens.`);
  return parts.join(' ');
}

// ---- Keep a lens on <name> -------------------------------------------------

/** The states where nothing is written for the person: a demo, Moppetopia, a view-only world, the tour. */
function worldTakesALens(worldId: string): boolean {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  if (!entry || entry.demo === true) return false;
  return !isMoppetopiaOpen(worldId) && !worldIsViewOnly(worldId) && !isTourFlagActive();
}

/**
 * Whether Keep a lens on <subject> is offered, and in which field the subject
 * goes. `focused`: the person opened this element, the pane did not pick it.
 * A hidden subject is never offered: a lens would carry its name into a
 * visible Construct (the profile's leak law).
 */
export function keepLensField(worldId: string | null | undefined, subject: Element | null, focused: boolean): string | null {
  if (!worldId || !subject || !focused) return null;
  const field = LENS_ANCHOR_FIELD[subject.type as ElementType];
  if (!field) return null;
  if (isLens(subject) || isRoomElement(subject) || handsOnAsProposed(subject) || isHiddenMark(subject)) return null;
  return worldTakesALens(worldId) ? field : null;
}

/** An `x_lens` that is no recipe: absent, null or an empty object. */
function noRecipe(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);
}

/** A lens that already is exactly "<name>'s world": this one anchor, nothing else, no recipe. */
export function lensOnAlone(elements: readonly Element[], anchorId: string, field: string): Element | null {
  for (const el of elements) {
    if (!choosable(el) || isTemplate(el)) continue;
    const rec = el as Record<string, unknown>;
    if (rec.x_served_trimmed !== undefined && rec.x_served_trimmed !== null) continue;
    if (!noRecipe(rec.x_lens)) continue;
    const exact = ANCHOR_FIELDS.every(f => {
      const v = rec[f];
      const list = Array.isArray(v) ? v : [];
      return f === field ? list.length === 1 && list[0] === anchorId : list.length === 0;
    });
    if (exact) return el;
  }
  return null;
}

/** Keep-a-lens writes in flight, by world and anchor: module state, so a toolbar remounted mid-write still waits. */
const keeping = new Set<string>();

export function keepingLens(worldId: string, anchorId: string): boolean {
  return keeping.has(`${worldId}|${anchorId}`);
}

export interface LensStore {
  listElements(): Promise<Element[]>;
  createElement(type: ElementType, data: Partial<Element>): Promise<Element>;
}

/**
 * Keep a lens on the subject: the id of the lens that now reads it, made or
 * found. Null when a write for this anchor is already running. The store is
 * read again first, so a lens a second tab made is chosen, not made twice.
 * `refresh` runs after a write (the cache and the push).
 */
export async function keepLensOn(
  worldId: string, subject: Element, field: string, store: LensStore,
  refresh: () => Promise<unknown>,
): Promise<string | null> {
  const key = `${worldId}|${subject.id}`;
  if (keeping.has(key)) return null;
  keeping.add(key);
  try {
    const found = lensOnAlone(await store.listElements(), subject.id, field);
    if (found) return found.id;
    const name = (typeof subject.name === 'string' && subject.name.trim()) || 'Unnamed';
    const created = await store.createElement('construct', {
      name: `${name}'s world`, supertype: 'Lens', [field]: [subject.id],
    } as Partial<Element>);
    await refresh();
    return created.id;
  } finally {
    keeping.delete(key);
  }
}
