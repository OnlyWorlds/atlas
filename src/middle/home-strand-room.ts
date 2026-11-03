/**
 * The strand's lines and doors (1.122.0; each box opened its room since 1.121.0).
 *
 *   The line: one italic line ABOVE each filled box, a sibling of `[data-box]` in its cell, never inside
 *   it, ending with an × ("Hide this line"). Its rule is `strandLine` (`core/strand-lines.ts`), pure; this
 *   reads the facts from the world on every draw (`lineFacts`) and draws it (`buildStrandLine`). A
 *   reader who may not change the element gets no line, and the location's only where the grid acts
 *   (never the demo, Moppetopia or a view-only world, so no map dialog there: conv. 149).
 *
 *     Story: "In the writing room you can shape it into <l2s> and <l3s>." (the world's tiers), while the
 *       story is in the writing room and writing is set up.
 *     Event: "Give it a date to place it in a timeline in Charts.", Charts a link to the timeline;
 *       gone once the timeline itself places it (its own parse of `start_date`).
 *     Location: no map in view, "Create a map to pin it in place." (Create a map opens the Maps panel's
 *       own New map dialog, nothing filled in); a map, "Pin it on a map." (the map `mapFor` names,
 *       opened with the location's page, whose header offers +pin; on a narrow window the right drawer);
 *       gone once a settled pin places it on a map in view.
 *     Character: "Open their page to see and edit them in full."; gone once that page was opened.
 *     Now: "Their location is where they are now."; gone on its × only.
 *
 *   A line that goes during a visit (×, a date saved, a pin placed, a room opened in another tab) keeps
 *   its height as an empty `aria-hidden` strut until Home's next opening, and a line whose words change
 *   keeps its tallest height: the words and the × go at once, the space stays, so no box below moves
 *   (`lineHold`, read after each draw by `holdStrandLines`, let go where the rows' hold is).
 *
 *   The doors: each filled box offers Edit here (a reader who may change it), Open its page (the
 *   element's page, `elementHash`), and a third only where a room edits it: Edit in the writing room
 *   (a writing story), Edit in Charts (the event), Open in Knowledge or Open in Pages (a story that
 *   lives there), and for the location, where its line could be, Pin it on a map (a map in view) or
 *   Create a map (none), the line's own acts, so its way to a map stays once the line has gone. A reader who may not change it gets the reading words: Open in the writing room, See
 *   it in Charts (a dated event). Every door only navigates; a press keeps its focus key, so Back puts
 *   the focus (and the scroll) on it.
 */

import type { Element } from '../core/types';
import { elementHash, mapHash, navigate, timelineHash, writingHash } from '../core/router';
import { roomOf } from '../core/element-room';
import { mayChange } from '../core/may-change';
import { isProposed } from '../core/review-mark';
import { isKnownOf } from '../sync/known-of';
import { spatialMapOf, spatialOtherOf } from '../core/world-links';
import type { StrandSlot } from '../core/strand';
import { getState } from '../core/state';
import { lineKey, linesOf, noteStrandLine, strandLine, type LineFacts } from '../core/strand-lines';
import { parseTemporalValue } from '../visualization/timeline/temporal-fields';
import { getTierForNarrative, getWritingLabels, isWritingInitialized } from './writing-helpers';
import { gridActsIn } from './home-grow';
import { isNarrow, openDrawer } from '../layout/narrow-layout';
import { createMapDialog } from '../ui/map-create-modal';
import { toastManager } from '../ui/toast-manager';
import { memory, type StrandContext } from './home-strand-model';
import { act } from './home-strand-acts';

const byName = (a: Element, b: Element): number =>
  (a.name ?? '').localeCompare(b.name ?? '', 'en') || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The map to open a location with: the one holding a pin of it (the first by name), else the world's
 * first map by name. Settled maps only (1.122.0's code gate, C6): a proposed map is neither counted
 * (`hasMapIn`) nor opened.
 */
export function mapFor(locationId: string, elements: Iterable<Element>): { id: string; name: string; pinned: boolean } | null {
  const maps: Element[] = [];
  const pinnedOn = new Set<string>();
  for (const e of elements) {
    if (e.type === 'map') { if (!isProposed(e)) maps.push(e); }
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

/**
 * Is the location placed (G7)? A settled pin of it (not proposed), with a point (`x`, `y` numbers), on a
 * map in this reader's view. Zones, markers and a map's own `location` do not count.
 */
export function placedOn(locationId: string, byId: ReadonlyMap<string, Element>): boolean {
  for (const e of byId.values()) {
    if (e.type !== 'pin' || isProposed(e) || spatialOtherOf(e) !== locationId) continue;
    const mapId = spatialMapOf(e);
    const map = mapId ? byId.get(mapId) : undefined;
    if (!map || map.type !== 'map' || isProposed(map)) continue;
    const r = e as unknown as Record<string, unknown>;
    if (typeof r.x === 'number' && Number.isFinite(r.x) && typeof r.y === 'number' && Number.isFinite(r.y)) return true;
  }
  return false;
}

/** Some settled map is in this reader's view. */
function hasMapIn(byId: ReadonlyMap<string, Element>): boolean {
  for (const e of byId.values()) if (e.type === 'map' && !isProposed(e)) return true;
  return false;
}

/** The event is on the timeline: the timeline's own parse of its start (G7: never a date asked that it shows). */
export function datedOnTimeline(el: Element): boolean {
  return parseTemporalValue((el as unknown as Record<string, unknown>).start_date) !== null;
}

/** This reader may change the element: the box's Edit here, and its line. */
export const writerOf = (el: Element, c: StrandContext): boolean => !isKnownOf(el) && mayChange(c.entry, el);

/** The story's room, when it is the writing room and the world's writing is set up (G6). */
function writingRoomOf(el: Element, c: StrandContext): boolean {
  return roomOf(el, c.worldId).label === 'writing' && isWritingInitialized(c.entry, getState().data.elements);
}

/** What a filled box knows for its line, read from this draw's world. */
export function lineFacts(slot: StrandSlot, el: Element, c: StrandContext): LineFacts {
  const f: LineFacts = { slot, id: el.id, writer: writerOf(el, c) };
  if (slot === 'narrative') {
    const tier = getTierForNarrative(el, c.worldId);
    f.writing = writingRoomOf(el, c) && tier ? { tier, labels: getWritingLabels(c.worldId) } : null;
  } else if (slot === 'event') {
    f.dated = datedOnTimeline(el);
  } else if (slot === 'location') {
    f.acts = gridActsIn(c.worldId);
    f.hasMap = hasMapIn(c.byId);
    f.placed = placedOn(el.id, c.byId);
  }
  return f;
}

/**
 * Go to a map's address; on a narrow window, open the right drawer (the map) once that page has
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

// ---- The line's hold (G2) ----

/**
 * Each line's tallest height this visit to Home, per key, at the grid's width: a line that goes leaves
 * a strut this tall, and a line whose words change never gets shorter. Let go at Home's next opening
 * (`openHeadLatch`), another world or another width; never stored.
 */
let lineHold: { worldId: string; width: number; heights: Map<string, number> } | null = null;

export function resetLineHold(): void {
  lineHold = null;
}

const heldFor = (worldId: string, key: string): number | undefined =>
  (lineHold && lineHold.worldId === worldId ? lineHold.heights.get(key) : undefined);

/** After Home's draw: each line's height read and kept where it is the tallest yet (`grid` drawn at `width`). */
export function holdStrandLines(grid: HTMLElement, worldId: string, width: number): void {
  if (!lineHold || lineHold.worldId !== worldId || Math.abs(width - lineHold.width) > 0.5) lineHold = { worldId, width, heights: new Map() };
  for (const slotEl of grid.querySelectorAll<HTMLElement>('[data-line-key]')) {
    if (!slotEl.querySelector('[data-role="strand-line"]')) continue;
    const key = slotEl.getAttribute('data-line-key')!;
    const h = slotEl.getBoundingClientRect().height;
    if (h > (lineHold.heights.get(key) ?? 0)) lineHold.heights.set(key, h);
  }
}

// ---- The line ----

/**
 * The line above a filled box (or its strut, once it went during this visit), or null when there is
 * neither. Its links are acts (held while a write is in flight); the × writes only this browser's
 * record, so it is never held.
 */
export function buildStrandLine(slot: StrandSlot, el: Element, c: StrandContext, redraw: () => void): HTMLElement | null {
  const key = lineKey(slot, el.id);
  const pieces = strandLine(lineFacts(slot, el, c), linesOf(c.entry));
  const held = heldFor(c.worldId, key);
  if (!pieces && held === undefined) return null;
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-line-slot';
  wrap.setAttribute('data-line-key', key);
  wrap.setAttribute('data-line-slot', slot);
  if (held !== undefined) wrap.style.minHeight = `${held}px`;
  if (!pieces) {
    // Gone during this visit: the space stays, empty, until Home is next opened.
    wrap.classList.add('is-strut');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.setAttribute('data-role', 'strand-line-strut');
    return wrap;
  }
  const p = document.createElement('p');
  p.className = 'atlas-home-strand-line';
  p.setAttribute('data-role', 'strand-line');
  const text = document.createElement('span');
  text.className = 'atlas-home-strand-line-text';
  for (const piece of pieces) {
    if ('link' in piece) text.appendChild(lineLink(piece.link, piece.text, slot, el, c, redraw));
    else text.appendChild(document.createTextNode(piece.text));
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'atlas-home-strand-line-x';
  x.setAttribute('aria-label', 'Hide this line');
  x.setAttribute('data-strand-key', `line:${slot}:hide`);
  x.innerHTML = '<span aria-hidden="true">×</span>';
  x.addEventListener('click', () => {
    // G8: the focus goes to the box's first control once the line is gone.
    memory.askFocus = { worldId: c.worldId, key: `box:${slot}` };
    noteStrandLine(c.worldId, 'hidden', key);
    redraw();
  });
  p.append(text, x);
  wrap.appendChild(p);
  return wrap;
}

/**
 * The map acts a location's line and its box share. Create a map: the Maps panel's own New map dialog,
 * nothing filled in; once it made a map, the focus goes to `then` (the control that now pins it: the
 * code gate's C2), else the dialog puts it back itself. Pin it on a map: `mapFor`'s map with the
 * location's page (the drawer on a narrow window). Neither writes anything of its own.
 */
function mapAct(kind: 'create-map' | 'pin-map', el: Element, c: StrandContext, then: string, redraw: () => void): void {
  if (kind === 'create-map') {
    void createMapDialog(toastManager, {}).then(made => {
      if (!made || getState().active?.worldId !== c.worldId) return;
      memory.askFocus = { worldId: c.worldId, key: then };
      redraw();
    });
    return;
  }
  const map = mapFor(el.id, c.byId.values());
  if (map) navigateWithMap(mapHash(c.worldId, map.id, el.id));
}

/** A link inside a line: navigation, or the Maps panel's own New map dialog; never a write of its own. */
function lineLink(kind: 'charts' | 'create-map' | 'pin-map', label: string, slot: StrandSlot, el: Element, c: StrandContext, redraw: () => void): HTMLElement {
  const focusKey = `line:${slot}:${kind}`;
  const b = act(label, focusKey, () => {
    memory.askFocus = { worldId: c.worldId, key: focusKey };
    if (kind === 'charts') navigate(timelineHash(c.worldId));
    else mapAct(kind, el, c, `line:${slot}:pin-map`, redraw);
  }, 'atlas-btn-link atlas-home-strand-line-link');
  b.setAttribute('data-line-link', kind);
  return b;
}

// ---- The doors ----

export interface BoxDoor {
  label: string;
  key: string;
  /** Where it navigates; a map act instead for the location's third door. */
  hash?: string;
  map?: 'create-map' | 'pin-map';
}

/**
 * A filled box's ways out beside Edit here (W6, G3, G6): Open its page in every box, and a third only
 * where a room edits it, in reading words for a reader who may not change it.
 */
export function boxDoors(slot: StrandSlot, el: Element, c: StrandContext): BoxDoor[] {
  const writer = writerOf(el, c);
  const doors: BoxDoor[] = [{ label: 'Open its page', key: `${slot}:page`, hash: elementHash(c.worldId, el.id) }];
  if (slot === 'narrative') {
    const room = roomOf(el, c.worldId);
    if (room.label === 'writing' && writingRoomOf(el, c)) {
      doors.push({ label: writer ? 'Edit in the writing room' : 'Open in the writing room', key: `${slot}:room`, hash: writingHash(c.worldId, el.id) });
    } else if (room.label === 'knowledge') doors.push({ label: 'Open in Knowledge', key: `${slot}:room`, hash: room.hash });
    else if (room.label === 'share') doors.push({ label: 'Open in Pages', key: `${slot}:room`, hash: room.hash });
  } else if (slot === 'event') {
    const dated = datedOnTimeline(el);
    // Its place on the timeline; undated, the timeline's own rail, where a date is given.
    if (writer) doors.push({ label: 'Edit in Charts', key: `${slot}:room`, hash: dated ? timelineHash(c.worldId, el.id) : timelineHash(c.worldId) });
    else if (dated) doors.push({ label: 'See it in Charts', key: `${slot}:room`, hash: timelineHash(c.worldId, el.id) });
  } else if (slot === 'location' && writer && gridActsIn(c.worldId)) {
    // The code gate's C3 (the lead's ruling): the location's way to a map stays on its box once its line
    // has gone (Promise 4), for a reader who may act on it, as the line's (G3); others get nothing new.
    doors.push(hasMapIn(c.byId)
      ? { label: 'Pin it on a map', key: `${slot}:room`, map: 'pin-map' }
      : { label: 'Create a map', key: `${slot}:room`, map: 'create-map' });
  }
  return doors;
}

/** The doors as buttons (link-styled; held as every act while a write is in flight). */
export function buildBoxDoors(slot: StrandSlot, el: Element, c: StrandContext, redraw: () => void): HTMLElement[] {
  return boxDoors(slot, el, c).map(d => act(d.label, d.key, () => {
    memory.askFocus = { worldId: c.worldId, key: d.key };
    if (d.map) mapAct(d.map, el, c, d.key, redraw);
    else if (d.hash) navigate(d.hash);
  }, 'atlas-btn-link'));
}
