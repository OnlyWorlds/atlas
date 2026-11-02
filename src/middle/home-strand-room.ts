/**
 * Each strand box opens its room (1.121.0): one line under a filled box's text saying what its type is for,
 * and one act that only navigates (never a write, never placement armed). The words are a table of facts
 * (`roomLine`, pure); the box reads the facts from the world (`roomFacts`) and draws the line
 * (`buildRoomLine`).
 *
 *   Story: the writing room when the story is in the writing tree and the world's writing is set up (its
 *   children named by the world's own labels), else the room `roomOf` names, else its page.
 *   Event: the timeline in Charts when it has a year; without one, a line and no act (Edit is beside it
 *   for a reader who may change it).
 *   Location (either box): with a map in a world where the grid acts and a reader who may change it, the
 *   map that holds a pin of it (else the world's first map by name), opened with the location's page,
 *   whose header offers +pin; else its page. On a narrow window the map is the right drawer: it opens
 *   once the page has settled, since every change of address closes the drawers first (`openWebOn`'s way).
 *   Character: their page.
 *
 *   A press keeps the focus key `<slot>:room`, so Back puts the focus (and the scroll) on the act.
 */

import { dateOf } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { elementHash, mapHash, navigate, timelineHash, writingHash } from '../core/router';
import { roomOf } from '../core/element-room';
import { mayChange } from '../core/may-change';
import { isKnownOf } from '../sync/known-of';
import { spatialMapOf, spatialOtherOf } from '../core/world-links';
import type { StrandSlot } from '../core/strand';
import { getState } from '../core/state';
import { getTierForNarrative, getWritingLabels, isWritingInitialized, pluralize, type WritingLabels, type WritingTier } from './writing-helpers';
import { gridActsIn } from './home-grow';
import { isNarrow, openDrawer } from '../layout/narrow-layout';
import { memory, type StrandContext } from './home-strand-model';
import { act } from './home-strand-acts';

export interface RoomFacts {
  slot: StrandSlot;
  worldId: string;
  id: string;
  /** This reader may change the element (the box shows Edit). */
  writer: boolean;
  /** Story: the room `roomOf` names ('' the element page), whether the world's writing is set up, its labels and tier. */
  room?: { hash: string; label: string };
  writingReady?: boolean;
  labels?: WritingLabels;
  tier?: WritingTier;
  /** Event: it has a year. */
  dated?: boolean;
  /** Location: the grid acts in this world (`gridActsIn`), and the map to open it with. */
  acts?: boolean;
  map?: { id: string; name: string; pinned: boolean } | null;
}

export interface RoomLine {
  text: string;
  act: { label: string; hash: string } | null;
}

const PAGE_LINE = 'Its page holds everything about it.';
const PLACE_LINE = 'Its page shows everything that is in or at it.';

/** The line and act for a filled box: the contract's table, reader who may change it and reader who may not. */
export function roomLine(f: RoomFacts): RoomLine {
  const page = (label = 'Open its page') => ({ label, hash: elementHash(f.worldId, f.id) });
  switch (f.slot) {
    case 'narrative': {
      if (f.room?.label === 'writing' && f.writingReady) {
        const l = f.labels!;
        const text = f.tier === 'l1' ? `Its ${pluralize(l.l2.toLowerCase())} and ${pluralize(l.l3.toLowerCase())} are written in the writing room.`
          : f.tier === 'l2' ? `Its ${pluralize(l.l3.toLowerCase())} are written in the writing room.`
            : 'It is written in the writing room.';
        return { text, act: { label: 'Open in the writing room', hash: writingHash(f.worldId, f.id) } };
      }
      if (f.room?.label === 'knowledge') return { text: PAGE_LINE, act: { label: 'Open in Knowledge', hash: f.room.hash } };
      if (f.room?.label === 'share') return { text: PAGE_LINE, act: { label: 'Open in Pages', hash: f.room.hash } };
      return { text: PAGE_LINE, act: page() };
    }
    case 'event':
      if (f.dated) return { text: 'Its year puts it on the timeline in Charts.', act: { label: 'See it on the timeline', hash: timelineHash(f.worldId, f.id) } };
      return f.writer
        ? { text: 'Give it a year and it goes on the timeline in Charts.', act: null }
        : { text: 'It has no year yet, so it is not on the timeline.', act: null };
    case 'location':
    case 'now':
      if (f.map && f.acts && f.writer) {
        const hash = mapHash(f.worldId, f.map.id, f.id);
        return f.map.pinned
          ? { text: `It is on ${f.map.name}.`, act: { label: 'See it on the map', hash } }
          : { text: 'A location can be pinned on a map.', act: { label: 'Open it with the map', hash } };
      }
      return { text: PLACE_LINE, act: page() };
    case 'character':
      return { text: 'Their page holds everything about them.', act: page('Open their page') };
  }
}

const byName = (a: Element, b: Element): number =>
  (a.name ?? '').localeCompare(b.name ?? '', 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** The map to open a location with: the one holding a pin of it (the first by name), else the world's first map by name. */
export function mapFor(locationId: string, elements: Iterable<Element>): { id: string; name: string; pinned: boolean } | null {
  const maps: Element[] = [];
  const pinnedOn = new Set<string>();
  for (const e of elements) {
    if (e.type === 'map') maps.push(e);
    else if (e.type === 'pin' && spatialOtherOf(e) === locationId) {
      const m = spatialMapOf(e);
      if (m) pinnedOn.add(m);
    }
  }
  if (maps.length === 0) return null;
  maps.sort(byName);
  const held = maps.find(m => pinnedOn.has(m.id));
  const m = held ?? maps[0];
  return { id: m.id, name: m.name?.trim() || 'a map', pinned: !!held };
}

/** The facts for a filled box, read from this draw's strand and the world. */
export function roomFacts(slot: StrandSlot, el: Element, c: StrandContext): RoomFacts {
  const f: RoomFacts = { slot, worldId: c.worldId, id: el.id, writer: !isKnownOf(el) && mayChange(c.entry, el) };
  if (slot === 'narrative') {
    f.room = roomOf(el, c.worldId);
    f.writingReady = isWritingInitialized(c.entry, getState().data.elements);
    f.labels = getWritingLabels(c.worldId);
    f.tier = getTierForNarrative(el, c.worldId);
  } else if (slot === 'event') {
    f.dated = dateOf(el as never) !== null;
  } else if (slot === 'location' || slot === 'now') {
    f.acts = gridActsIn(c.worldId);
    f.map = mapFor(el.id, c.byId.values());
  }
  return f;
}

/**
 * Go to a map act's address; on a narrow window, open the right drawer (the map) once that page has
 * settled. The listener is added before the navigation: `navigate` always fires a hashchange, a
 * synthetic one when the address is already the act's.
 */
function navigateWithMap(to: string): void {
  if (isNarrow()) {
    const once = (e: HashChangeEvent): void => {
      window.removeEventListener('hashchange', once);
      // A synthetic event (the address did not change) carries no newURL.
      if ((e.newURL || window.location.href).endsWith(to) && isNarrow()) openDrawer('right');
    };
    window.addEventListener('hashchange', once);
  }
  navigate(to);
}

/** The box's line: its words, and its act (a link-styled button; a write in flight holds it as every act). */
export function buildRoomLine(slot: StrandSlot, el: Element, c: StrandContext): HTMLElement {
  const facts = roomFacts(slot, el, c);
  const line = roomLine(facts);
  const p = document.createElement('p');
  p.className = 'atlas-home-strand-room';
  p.setAttribute('data-role', 'strand-room');
  const text = document.createElement('span');
  text.className = 'atlas-home-strand-room-text';
  text.textContent = line.text;
  p.appendChild(text);
  if (line.act) {
    const to = line.act.hash;
    const withMap = !!facts.map && to === mapHash(facts.worldId, facts.map.id, facts.id);
    p.append(' ', act(line.act.label, `${slot}:room`, () => {
      memory.askFocus = { worldId: c.worldId, key: `${slot}:room` };
      if (withMap) navigateWithMap(to);
      else navigate(to);
    }, 'atlas-btn-link'));
  }
  return p;
}
