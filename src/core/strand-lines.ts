/**
 * The strand's lines (Atlas 1.122.0): one italic line above each filled box that asks for a fact or
 * points at a room, and the record of which lines are done with in this browser.
 *
 *   `strandLine` is the whole rule, pure: given what the box knows (its slot, the reader, the facts read
 *   from the world on this draw) and the record, either no line or its pieces. A line that asks for a
 *   fact goes once the fact holds (the event dated as the timeline reads it, the location placed by a
 *   settled pin on a map in view); the story's goes once the writing room was opened on it, the main
 *   character's once their page was opened; any line goes on its ×; where they are now goes on its ×
 *   only. A reader who may not change the element sees no line.
 *
 *   The record (`strand_lines` on this browser's registry entry for the world) holds keys
 *   `<slot>:<element id>`: `hidden` (the ×) and `opened` (the room or the page). It never enters
 *   `WORLD_PREF_KEYS`, so it never reaches the world folder, keel or an export. Each write reads the
 *   entry as stored now and unions it with this tab's, so two tabs never undo each other (conv. 115's
 *   later-save-wins is per field). Forget world drops it with the entry; a re-key moves its ids.
 */

import type { WorldRegistryEntry } from './types';
import type { StrandSlot } from './strand';
import { memberIds, storedMark } from './strand';
import { getState, patchSlice } from './state';
import { saveRegistry, storedWorldEntry, updateWorldEntry } from '../registry/registry';
import { pluralize, type WritingLabels, type WritingTier } from '../middle/writing-helpers';

export interface StrandLines {
  hidden: string[];
  opened: string[];
}

export const NO_LINES: StrandLines = { hidden: [], opened: [] };

/** A line's key in the record: per slot and element, so another element in the slot has its own line. */
export const lineKey = (slot: StrandSlot, id: string): string => `${slot}:${id}`;

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []);

/** The record as an entry holds it; anything else reads as nothing done. */
export function linesOf(entry: Pick<WorldRegistryEntry, 'strand_lines'> | undefined): StrandLines {
  const r = entry?.strand_lines as unknown;
  if (!r || typeof r !== 'object' || Array.isArray(r)) return NO_LINES;
  const o = r as Record<string, unknown>;
  return { hidden: strings(o.hidden), opened: strings(o.opened) };
}

// ---- The rule ----

/** What a box knows for its line, read from the world on this draw. */
export interface LineFacts {
  slot: StrandSlot;
  id: string;
  /** This reader may change the element (the box's Edit here). */
  writer: boolean;
  /** Story: the world's writing tier and labels when the story is in the writing room and writing is set up; else null. */
  writing?: { tier: WritingTier; labels: WritingLabels } | null;
  /** Event: the timeline places it (its own parse of `start_date`). */
  dated?: boolean;
  /** Location: the grid acts in this world (`gridActsIn`: never the demo, Moppetopia or a view-only world). */
  acts?: boolean;
  /** Location: some map is in this reader's view. */
  hasMap?: boolean;
  /** Location: a settled pin places it on a map in this reader's view. */
  placed?: boolean;
}

/** A run of words, or a link the box draws as a button that only navigates or opens a dialog. */
export type LinePiece = { text: string } | { link: 'charts' | 'create-map' | 'pin-map'; text: string };

const lower = (label: string | undefined, fallback: string): string => pluralize((label ?? '').trim().toLowerCase() || fallback);

/**
 * The line above a filled box, or null for none. Every way a line goes keeps the box's buttons, which
 * carry the same doors (the contract's Promise 4).
 */
export function strandLine(f: LineFacts, rec: StrandLines): LinePiece[] | null {
  if (!f.writer) return null;
  const key = lineKey(f.slot, f.id);
  if (rec.hidden.includes(key)) return null;
  switch (f.slot) {
    case 'narrative': {
      if (!f.writing || rec.opened.includes(key)) return null;
      const l = f.writing.labels;
      if (f.writing.tier === 'l1') return [{ text: `In the writing room you can shape it into ${lower(l.l2, 'chapter')} and ${lower(l.l3, 'scene')}.` }];
      if (f.writing.tier === 'l2') return [{ text: `In the writing room you can shape it into ${lower(l.l3, 'scene')}.` }];
      return null;
    }
    case 'character':
      return rec.opened.includes(key) ? null : [{ text: 'Open their page to see and edit them in full.' }];
    case 'event':
      return f.dated ? null : [{ text: 'Give it a date to place it in a timeline in ' }, { link: 'charts', text: 'Charts' }, { text: '.' }];
    case 'location':
      if (!f.acts || f.placed) return null;
      return f.hasMap
        ? [{ link: 'pin-map', text: 'Pin it on a map' }, { text: '.' }]
        : [{ link: 'create-map', text: 'Create a map' }, { text: ' to pin it in place.' }];
    case 'now':
      return [{ text: 'Their location is where they are now.' }];
  }
}

/** A line's words as read aloud or tested. */
export const lineWords = (pieces: readonly LinePiece[]): string => pieces.map(p => p.text).join('');

// ---- The record's writers ----

const entryOf = (worldId: string): WorldRegistryEntry | undefined => getState().registry.worlds.find(w => w.id === worldId);

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])];

/**
 * Add `key` to the record's `list` for this world: the entry as stored now unioned with this tab's, so
 * another tab's hides and visits are kept. Nothing when this tab and the store both hold it already.
 */
export function noteStrandLine(worldId: string, list: keyof StrandLines, key: string): void {
  const reg = getState().registry;
  if (!reg.worlds.some(w => w.id === worldId)) return;
  const mine = linesOf(entryOf(worldId));
  const stored = linesOf(storedWorldEntry(worldId));
  if (mine[list].includes(key) && stored[list].includes(key)) return;
  const next: StrandLines = { hidden: union(stored.hidden, mine.hidden), opened: union(stored.opened, mine.opened) };
  if (!next[list].includes(key)) next[list] = [...next[list], key];
  const nextReg = updateWorldEntry(reg, worldId, { strand_lines: next });
  saveRegistry(nextReg);
  patchSlice('registry', nextReg);
}

/** What was last noted as opened, per world: a room's every redraw asks once. */
const lastOpened = new Map<string, string>();

/**
 * A room opened on an element (the writing room on a story, the element page on a character): noted
 * when it is the strand's story or its main character at that moment, so the record stays small.
 * Called from a render: the write waits for a microtask, never inside the state tick that drew it.
 */
export function noteStrandOpened(worldId: string, slot: 'narrative' | 'character', id: string | null | undefined): void {
  if (!id) return;
  const seen = `${slot}:${id}`;
  if (lastOpened.get(worldId) === seen) return;
  lastOpened.set(worldId, seen);
  queueMicrotask(() => {
    const s = getState();
    // Not yet readable (another world, still loading): asked again on the next draw.
    if (s.active?.worldId !== worldId || s.data.loading) { lastOpened.delete(worldId); return; }
    const story = memberIds(storedMark(s.active.meta)).narrative;
    if (!story) return;
    if (slot === 'narrative' && id !== story) return;
    if (slot === 'character') {
      const el = s.data.elements.find(e => e.id === story) as unknown as Record<string, unknown> | undefined;
      const hero = el?.protagonist;
      const heroId = typeof hero === 'string' ? hero : hero && typeof hero === 'object' ? (hero as { id?: unknown }).id : null;
      if (heroId !== id) return;
    }
    noteStrandLine(worldId, 'opened', lineKey(slot, id));
  });
}

/** Test seam. */
export function resetStrandLinesForTests(): void {
  lastOpened.clear();
}
