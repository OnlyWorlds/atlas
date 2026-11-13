/**
 * Records: a game's runs kept in the world (the record profile, schema-dist
 * `profiles/record.md`). A record is read only from its mark (`x_record` on an
 * Event, `recordMarkOf`); a label, a subtype or a game's own tally never makes
 * one (reader rule 1). The one exception Atlas keeps is Tactical Tangle's
 * battles from before the mark: an Event whose own tally (`x_tangle_battle`)
 * Atlas's Tangle card can read and that carries no mark is shown as what it is,
 * a battle from Tactical Tangle, never as a record. Those are permanent: Tangle
 * wrote to worlds it has no list of.
 *
 * Every "is this from play?" question in Atlas is asked here, so the rule lives
 * once (no reader keys on a word: `Chronicle`, `Battle`, `Record`).
 *
 * Link shapes are the SDK's exactly (an array of id strings, a single id by
 * `===`), so belonging here and `recordsOf` agree on every element.
 */

import { compareInstants, instantOf, proposedMarkOf, recordMarkOf, recordsOf, TOOLS, type OwRecord } from '@onlyworlds/sdk';
import type { Element } from './types';
import { battleOutcomeLine } from '../middle/tangle-cards';

/**
 * Whether a record reader holds an element back as proposed: exactly when
 * `proposedMarkOf` reads a mark, as `recordsOf` does since serial 103 (SDK
 * 4.127.0): an empty mark, or one that is no object, is settled. One rule, the
 * SDK's, so the legacy battles and the records agree.
 */
export function isProposedForRecords(el: unknown): boolean {
  return proposedMarkOf(el) !== null;
}

/** A Tactical Tangle battle from before the mark: its tally reads, and it has no valid mark. */
export function isLegacyBattle(el: Element): boolean {
  if (el.type !== 'event') return false;
  if (recordMarkOf(el) !== null) return false;
  return battleOutcomeLine((el as Record<string, unknown>).x_tangle_battle) !== null;
}

/** A record's Event or a legacy battle: the elements Atlas marks as recorded from play. */
export type PlayKind = { kind: 'record'; tool: string } | { kind: 'legacy' };

export function playKindOf(el: Element): PlayKind | null {
  if (el.type !== 'event') return null;
  const mark = recordMarkOf(el);
  if (mark) return { kind: 'record', tool: mark.tool };
  return isLegacyBattle(el) ? { kind: 'legacy' } : null;
}

/** The ids of every record Event and legacy battle, proposed included (belonging, not showing). */
export function playEventIds(elements: readonly Element[]): Set<string> {
  const out = new Set<string>();
  for (const el of elements) if (playKindOf(el)) out.add(el.id);
  return out;
}

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * The Narratives that belong to a run: their `events` lists a record Event or a
 * legacy battle, or their `parent_narrative` is such a Narrative (Tangle's
 * stories under its chronicle). Proposed rows belong too: this is about what a
 * Narrative is, never whether it is shown. Used by the writing room's setup and
 * Home's recap, which read recorded chains as artifacts, not writing.
 */
export function playNarrativeIds(elements: readonly Element[]): Set<string> {
  const events = playEventIds(elements);
  const direct = new Set<string>();
  const narratives: Element[] = [];
  for (const el of elements) {
    if (el.type !== 'narrative') continue;
    narratives.push(el);
    if (ids((el as Record<string, unknown>).events).some(id => events.has(id))) direct.add(el.id);
  }
  const out = new Set(direct);
  for (const n of narratives) {
    const parent = (n as Record<string, unknown>).parent_narrative;
    if (typeof parent === 'string' && direct.has(parent)) out.add(n.id);
  }
  return out;
}

/** The game's name for a tool id: the tools list's row (Tactical Tangle's since SDK 4.127.0), else the id. */
export function toolName(tool: string): string {
  return TOOLS.find(t => t.id === tool)?.name ?? tool;
}
export const LEGACY_TOOL_NAME = toolName('tangle');

/** The glyph a record Event wears in a list or on the timeline. */
export function playGlyph(kind: PlayKind): string {
  return kind.kind === 'legacy' || kind.tool === 'tangle' ? 'swords' : 'sports_esports';
}

/** One row of a Character's Records: a marked run (`record`) or a legacy battle (`legacy`). */
export interface LegacyRow {
  event: Element;
  outcome: string | null;
  stories: OwRecord['stories'];
}

/**
 * A Character's records, as the SDK reads them (`recordsOf` on the elements as
 * this page reads them, one pass since SDK 4.124.1), and their legacy battles.
 * Legacy stories come from `recordsOf` too, on a copy
 * of each legacy battle with a placeholder mark, so one reader decides which
 * stories are theirs, what proposed means and their order; that copy is never
 * shown as a record.
 */
export function characterRecords(characterId: string, elements: readonly Element[]): { records: OwRecord[]; legacy: LegacyRow[] } {
  const events = playEventIds(elements);
  const records = recordsOf(characterId, elements);

  // Legacy battles naming this Character, and for each the stories naming them that list it (only a story naming
  // them can be theirs, the profile's rule), handed to the reader one battle at a time.
  const named: Element[] = [];
  const storiesOf = new Map<string, Element[]>();
  for (const el of elements) {
    const r = el as Record<string, unknown>;
    if (el.type === 'event' && events.has(el.id) && ids(r.characters).includes(characterId)) named.push(el);
    else if (el.type === 'narrative' && (r.protagonist === characterId || r.narrator === characterId)) {
      for (const id of new Set(ids(r.events))) if (events.has(id)) storiesOf.set(id, [...(storiesOf.get(id) ?? []), el]);
    }
  }

  const legacy: LegacyRow[] = [];
  for (const ev of named) {
    if (!isLegacyBattle(ev) || isProposedForRecords(ev)) continue;
    const stand = { ...ev, x_record: { tool: 'tangle', played_at: '1970-01-01T00:00:00Z' } };
    const read = recordsOf(characterId, [stand, ...(storiesOf.get(ev.id) ?? [])]);
    legacy.push({
      event: ev,
      outcome: battleOutcomeLine((ev as Record<string, unknown>).x_tangle_battle),
      stories: read[0]?.stories ?? [],
    });
  }
  // Newest first by the server's stamp when the world has one, read as an instant (one that cannot be read
  // last), then by name (an Atlas display order, never a reading).
  const made = (e: Element) => instantOf((e as Record<string, unknown>).created_at);
  legacy.sort((a, b) => {
    const ca = made(a.event), cb = made(b.event);
    const byTime = ca === null || cb === null ? (ca === cb ? 0 : ca === null ? 1 : -1) : compareInstants(cb, ca);
    if (byTime !== 0) return byTime;
    return (typeof a.event.name === 'string' ? a.event.name : '').localeCompare(typeof b.event.name === 'string' ? b.event.name : '');
  });
  return { records, legacy };
}
