/**
 * The guide's notes (onboarding step 1): one quiet line after a gesture made
 * by hand. What a gesture earns is the kernel's (`core/guide.ts`); this file
 * owns the one note on screen: where it lives, when it draws, when it leaves,
 * and its actions.
 *
 *   One node, one slot: the slot is the shell's (`.atlas-guide-slot`, a
 *   zero-height row at the foot of the middle pane, an empty live region from
 *   the start), and the note floats up from it over the page, so it never
 *   reflows the page and no room's rebuild can touch it.
 *
 *   One at a time: a note earned while another shows is dropped, never
 *   stamped, except a note earned by a note's own action, which replaces it;
 *   and `copy`, which is never queued, only re-checked when the slot empties.
 *
 *   An action writes only the field it names, only when it is empty, inside
 *   the element's lock (`updateElementWith`), on the ids captured when the
 *   note was earned.
 *
 * Contract: a design note of 2026-10-27 (the guide, step 1, draft 2).
 */

import { dateOf } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { getState, subscribe } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { elementHash, navigate, timelineHash, writingHash } from '../core/router';
import { typeName } from '../core/type-words';
import { worldIsViewOnly } from '../core/view-only';
import { isMoppetopiaOpen } from '../core/moppetopia';
import { isTourFlagActive } from '../tour/tour-flag';
import { hasFolderMode } from '../core/capabilities';
import { isPartialSlice } from '../core/provenance';
import { resolveCalendarLens } from '../core/calendar-lens';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { getTierForNarrative, getWritingLabels } from '../middle/writing-helpers';
import { keepSafeCard } from '../middle/home-keepsafe';
import { anyModalOpen } from './modal-base';
import { linkIdsOf } from '../core/link-ids';
import { toastManager } from './toast-manager';
import { showProblem } from './problem-fixes';
import { isProposed } from '../core/review-mark';
import { webRingOne } from '../tabs/right/context-pane-graph';
import { onWebDrawerReleased, openWebOn, webDrawerHolds } from './open-web';
import {
  guideDots, guideElements, isFilled, loadGuideState, markNoteSeen, newestOf, noteEarned, placeIdOf, rewardEarned,
  type EarnedNote, type Gesture, type Reward,
} from '../core/guide';

interface Showing {
  note: EarnedNote;
  worldId: string;
  /** The address it was drawn on: a later change of address is a change of room. */
  drawnHash: string;
  /** What it drew (`drawnKey`): redrawn only when that changes. */
  key?: string;
  node: HTMLElement;
  /** The reward's button on this note: the note's own rider, or Were there's, earned while it showed. */
  rider?: Reward;
  /** The button has been drawn (and `reading` stamped): later redraws keep it. */
  riderDrawn?: boolean;
}

let showing: Showing | null = null;
/** Earned while a modal was open: drawn when the last modal closes, if its world is still open. */
let pending: { note: EarnedNote; worldId: string; forced: boolean } | null = null;
/** An Event made by hand in this opening of the world: `copy` may speak when the slot is free. */
let copyEarnedIn: string | null = null;
/** A note's action is running: `copy` waits until it is done (and has moved, if it moves). */
let acting = false;
/** `copy` was due while a dialog was up: re-checked when the last one closes. */
let copyAfterDialog = false;
let wired = false;
let lastWorldId: string | null = null;
let lastElements: unknown = null;

const activeWorldId = (): string | null => getState().active?.worldId ?? null;
const entryOf = (worldId: string) => getState().registry.worlds.find(w => w.id === worldId);

/** The states in which no note speaks (a mark's own press is the person asking, and passes `forced`). */
function silent(worldId: string): boolean {
  const entry = entryOf(worldId);
  // The tour's sandbox and Moppetopia are worlds to look at: no note speaks in either (#840's gate, G2).
  if (!entry || entry.demo === true || isMoppetopiaOpen(worldId) || worldIsViewOnly(worldId) || isTourFlagActive()) return true;
  if (entry.tour_dismissed?.includes('home-cards')) return true;
  return false;
}

function speaksCalendar(): boolean {
  const s = getState();
  const id = s.active ? entryOf(s.active.worldId)?.active_calendar_id : null;
  return resolveCalendarLens(s.data.elements, id, { fallbackToOnly: true }) !== null;
}

/**
 * A gesture made by hand. Callers: the create modal (opened with no
 * contextual callback, after its callbacks settled), the editor's location
 * and start-date commits, and this file's own actions (`fromAction`).
 */
export function reportGesture(
  gesture: Gesture,
  opts: { fromAction?: boolean; pair?: { character: string; location: string }; was?: unknown } = {},
): void {
  wire();
  const worldId = activeWorldId();
  if (!worldId) return;
  const els = getState().data.elements;
  if (gesture.kind === 'created' && els.find(e => e.id === gesture.id)?.type === 'event') copyEarnedIn = worldId;
  const note = noteEarned(gesture, els, speaksCalendar());
  // The reward rides only on the commit that lit `placed` or `happened` (#840's C2); Were there earns its own.
  // A field that held something before (a move, a changed year) made no new link (the code gate's C4).
  const reward = isFilled(opts.was) ? null
    : note?.id === 'placed' ? earnReading(worldId, note.character!, note.location!)
    : note?.id === 'dated' ? earnReading(worldId, datedAnchor(note.event!, opts.pair), note.event!)
    : null;
  const how = { fromAction: opts.fromAction === true, forced: false };
  const took = note ? offer(reward ? { ...note, rider: reward } : note, worldId, how) : false;
  // Its gesture's note seen before: the reward speaks alone.
  if (reward && !took) offer({ id: 'reading', character: reward.anchor, rider: reward }, worldId, how);
  if (!showing && !pending) tryCopy();
}

/** Whose web a year made: the event note's pair if the Event links them, else the newest placed Character it links. */
function datedAnchor(eventId: string, pair: { character: string } | undefined): string | null {
  const ev = elementOf(eventId) as Record<string, unknown> | undefined;
  if (!ev) return null;
  const linked = linkIdsOf(ev.characters);
  if (pair && linked.includes(pair.character)) return pair.character;
  const placed = guideElements(getState().data.elements).filter(e =>
    e.type === 'character' && linked.includes(e.id) && !!elementOf(placeIdOf(e) ?? undefined));
  return newestOf(placed)?.id ?? null;
}

/** The anchor's ring as the Web draws it at depth 1, less what is only proposed: a doubt is not a link made. */
function readingRing(worldId: string, anchor: Element): string[] {
  const hidden = new Set<string>(entryOf(worldId)?.context_filters_off ?? []);
  return webRingOne(anchor, hidden).filter(id => !isProposed(elementOf(id)));
}

/**
 * Whether this gesture just gave the anchor its web (the kernel's `rewardEarned`), or null:
 * never once seen, with the notes off, or where no note speaks.
 */
function earnReading(worldId: string, anchorId: string | null, elementId: string): Reward | null {
  const anchor = elementOf(anchorId ?? undefined);
  // An anchor not placed has no button to draw (the code gate's C5): nothing is earned.
  if (!anchor || anchor.type !== 'character' || silent(worldId) || !riderHolds({ anchor: anchor.id, names: [], more: 0 })) return null;
  const s = loadGuideState();
  if (s.off || s.seen.reading) return null;
  const els = getState().data.elements;
  return rewardEarned(guideDots(els, entryOf(worldId)), anchor.id, readingRing(worldId, anchor), elementId, placeIdOf(anchor));
}

/** The Somewhere mark's press: the offer, whatever `seen` and the switch say, never stamped. */
export function showPlaceOffer(character: string, location: string): void {
  wire();
  const worldId = activeWorldId();
  if (!worldId) return;
  offer({ id: 'place-offer', character, location }, worldId, { fromAction: false, forced: true });
}

/** Whether the note drew, or waits for a dialog to close. */
function offer(note: EarnedNote, worldId: string, how: { fromAction: boolean; forced: boolean }): boolean {
  // A note on a page the person has left goes first, as `clear()` removes it: its
  // hashchange has not run yet (a create that navigated), and it must not block this one.
  if (showing && showing.drawnHash !== window.location.hash) { showing.node.remove(); showing = null; }
  if (!how.forced) {
    if (silent(worldId)) return false;
    const s = loadGuideState();
    if (s.off || s.seen[note.id]) return false;
    // One at a time: dropped, never stamped, so a later gesture can earn it.
    if (showing && !how.fromAction) return false;
  }
  if (anyModalOpen()) {
    pending = { note, worldId, forced: how.forced };
    return true;
  }
  draw(note, worldId, how.forced);
  return true;
}

/** The keep-safe card asks for the same copy: while it would show, `copy` stays quiet (the two never offer at once). */
function keepSafeShowing(worldId: string): boolean {
  const els = getState().data.elements;
  return !!keepSafeCard({ entry: entryOf(worldId), elements: guideElements(els), loading: !!getState().data.loading, now: Date.now() });
}

/**
 * `copy` speaks only into a free slot, never while a note's action runs (an
 * action that empties the slot and then moves would draw it, stamp it seen,
 * and take it away again unseen), and never under a dialog.
 */
function tryCopy(): void {
  // Nor under the Web's drawer, from the press that opens it until it closes (#840's C1).
  if (showing || pending || acting || webDrawerHolds()) return;
  const worldId = activeWorldId();
  if (!worldId || copyEarnedIn !== worldId || silent(worldId)) return;
  const s = loadGuideState();
  if (s.off || s.seen.copy) return;
  if (keepSafeShowing(worldId) || guideDots(getState().data.elements, entryOf(worldId)).copy) return;
  if (anyModalOpen()) { copyAfterDialog = true; return; }
  draw({ id: 'copy' }, worldId, false);
}

function slot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('.atlas-guide-slot');
}

function draw(note: EarnedNote, worldId: string, forced: boolean): void {
  const host = slot();
  if (!host) return;
  if (showing) showing.node.remove();
  const node = document.createElement('div');
  node.className = 'atlas-guide-note';
  node.setAttribute('data-role', 'guide-note');
  node.setAttribute('data-note', note.id);
  showing = { note, worldId, drawnHash: window.location.hash, node, ...(note.rider ? { rider: note.rider } : {}) };
  if (!forced) markNoteSeen(note.id);
  fill();
  host.appendChild(node);
}

/** Leave: the slot empties, then `copy` may speak. */
function leave(): void {
  if (!showing) return;
  showing.node.remove();
  showing = null;
  tryCopy();
}

/** Leave without letting `copy` take the freed slot (the world closed, the switch went off). */
function clear(): void {
  pending = null;
  if (showing) { showing.node.remove(); showing = null; }
}

const elementOf = (id: string | undefined): Element | undefined =>
  id ? getState().data.elements.find(e => e.id === id) : undefined;

/** The person's own name, as text; an empty one reads as its type ("this Character"). */
function nameOf(id: string | undefined, type: string): string {
  const el = elementOf(id);
  const name = typeof el?.name === 'string' ? el.name.trim() : '';
  return name || `this ${typeName(type)}`;
}

/** Whether what the note is about still holds; it leaves when not. */
function stillHolds(n: EarnedNote): boolean {
  const ch = elementOf(n.character);
  switch (n.id) {
    case 'someone': return !!ch;
    case 'place-offer': return !!ch && !!elementOf(n.location) && !isFilled((ch as { location?: unknown }).location);
    case 'placed': return !!ch && !!elementOf(n.location) && placeIdOf(ch) === n.location;
    case 'event': return !!elementOf(n.event);
    case 'dated': { const ev = elementOf(n.event); return !!ev && dateOf(ev) !== null; }
    case 'story':
    case 'chapter': return !!elementOf(n.narrative);
    // The reward alone (#840): its anchor still placed, and its web still two or more.
    case 'reading': return riderHolds(n.rider) && readingRing(showing?.worldId ?? '', ch!).filter(id => id !== ch!.id).length >= 2;
    case 'copy': {
      const worldId = activeWorldId();
      return !!worldId && !guideDots(getState().data.elements, entryOf(worldId)).copy && !keepSafeShowing(worldId);
    }
  }
}

/** The reward's button stands while its anchor is there and placed somewhere that is (G17a). */
function riderHolds(r: Reward | undefined): boolean {
  const ch = elementOf(r?.anchor);
  return !!ch && !!elementOf(placeIdOf(ch) ?? undefined);
}

/** An element's name as text, for a line that names elements of any type. */
function anyName(id: string): string {
  return nameOf(id, elementOf(id)?.type ?? 'element');
}

/** What a note draws from the store: its names, and the Event fields its actions read. */
function drawnKey(n: EarnedNote): string {
  const ev = elementOf(n.event) as Record<string, unknown> | undefined;
  const r = showing?.note === n ? showing.rider : n.rider;
  const anchor = elementOf(r?.anchor);
  return JSON.stringify([
    r ? [nameOf(r.anchor, 'character'), !!anchor, anchor ? placeIdOf(anchor) : null, riderHolds(r), r.names.map(anyName)] : null,
    nameOf(n.character, 'character'), nameOf(n.location, 'location'), nameOf(n.event, 'event'), nameOf(n.narrative, 'narrative'),
    n.pair ? [nameOf(n.pair.character, 'character'), nameOf(n.pair.location, 'location')] : null,
    ev ? [linkIdsOf(ev.characters), linkIdsOf(ev.locations), ev.start_date ?? null] : null,
    n.id === 'copy' ? getState().active?.meta.name ?? '' : '',
  ]);
}

/** (Re)write the note's words and actions from the store, so a rename reads at once. */
function fill(): void {
  if (!showing) return;
  const { note, node } = showing;
  showing.key = drawnKey(note);
  // A year being typed survives the redraw, and its focus with it.
  const oldYear = node.querySelector<HTMLInputElement>('.atlas-guide-note-year-input');
  const keptYear = oldYear?.value ?? '';
  const hadFocus = node.contains(document.activeElement);
  node.textContent = '';
  const line = document.createElement('span');
  line.className = 'atlas-guide-note-line';
  const actions = document.createElement('span');
  actions.className = 'atlas-guide-note-actions';
  const act = (verb: string, label: string, run: () => void | Promise<void>): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-guide-note-act';
    b.setAttribute('data-note-action', verb);
    b.textContent = label;
    b.addEventListener('click', () => { void runAction(run); });
    actions.appendChild(b);
  };
  const ch = nameOf(note.character, 'character');
  const loc = nameOf(note.location, 'location');
  const worldId = showing.worldId;

  switch (note.id) {
    case 'someone':
      line.textContent = `${ch} is someone in your world.`;
      act('add-place', 'Add a place', async () => {
        leave();
        const { ElementCreateModal } = await import('./element-create-modal');
        new ElementCreateModal(toastManager, { initialType: 'location', suppressNavigate: true }).open();
      });
      break;
    case 'place-offer':
      line.textContent = `${ch} and ${loc}: place one in the other?`;
      act('place', `Place ${ch} at ${loc}`, async () => {
        const target = note.location!;
        const wrote = await writeIfEmpty(note.character!, ex =>
          isFilled((ex as { location?: unknown }).location) ? null : { location: target } as Partial<Element>);
        if (wrote === 'wrote') reportGesture({ kind: 'location-set', character: note.character! }, { fromAction: true });
        if (showing?.note === note) leave();
      });
      break;
    case 'placed':
      line.textContent = `${ch} is at ${loc}, and ${loc} lists ${ch}.`;
      act('open-place', `Open ${loc}`, () => { leave(); navigate(elementHash(worldId, note.location!)); });
      break;
    case 'event': {
      line.textContent = 'An Event is something that happened.';
      const ev = elementOf(note.event) as Record<string, unknown> | undefined;
      const pair = note.pair;
      const names = (f: string): string[] => (Array.isArray(ev?.[f]) ? (ev![f] as unknown[]).filter((v): v is string => typeof v === 'string') : []);
      if (pair && ev && !names('characters').includes(pair.character) && !names('locations').includes(pair.location)) {
        const pc = nameOf(pair.character, 'character');
        const pl = nameOf(pair.location, 'location');
        act('were-there', `${pc} and ${pl} were there`, async () => {
          const wrote = await writeIfEmpty(note.event!, ex => {
            // Read as ids, whatever shape another tool wrote, and written back as ids.
            const r = ex as Record<string, unknown>;
            const chars = linkIdsOf(r.characters);
            const locs = linkIdsOf(r.locations);
            if (chars.includes(pair.character) && locs.includes(pair.location)) return null;
            return {
              characters: chars.includes(pair.character) ? chars : [...chars, pair.character],
              locations: locs.includes(pair.location) ? locs : [...locs, pair.location],
            } as Partial<Element>;
          });
          // Were there can be what gave the pair's Character its web (#840's C2): the button joins this note.
          if (wrote === 'wrote' && showing?.note === note) {
            const reward = earnReading(worldId, pair.character, note.event!);
            if (reward) showing.rider = reward;
          }
          // Not a leave: the note keeps its year (fill carries it), and redraws without this action.
          fill();
        });
      }
      if (note.askYear && ev && !isFilled(ev.start_date)) addYear(actions, note);
      break;
    }
    case 'dated': {
      const ev = elementOf(note.event);
      line.textContent = `${nameOf(note.event, 'event')} is on the chart at year ${ev ? dateOf(ev) : ''}.`;
      act('open-chart', 'Open the chart', () => { leave(); navigate(timelineHash(worldId, note.event)); });
      break;
    }
    case 'story': {
      const labels = getWritingLabels(worldId);
      line.textContent = 'A Narrative is a story told in your world.';
      act('write', `Write it as a ${labels.l1.toLowerCase()}`, async () => {
        const id = note.narrative!;
        const made = await writeIfEmpty(id, ex => (isFilled((ex as { supertype?: unknown }).supertype) ? null : { supertype: labels.l1 } as Partial<Element>));
        // A write that failed has said so (showProblem): no move to a room that cannot hold it.
        if (made === 'failed') { if (showing?.note === note) leave(); return; }
        const el = elementOf(id);
        navigate(writingHash(worldId, id));
        if (el && getTierForNarrative(el, worldId) === 'l1') {
          offer({ id: 'chapter', narrative: id }, worldId, { fromAction: true, forced: false });
          if (showing?.note.id === 'chapter') return;
        }
        if (showing?.note === note) leave();
      });
      break;
    }
    case 'chapter': {
      const labels = getWritingLabels(worldId);
      const chapter = labels.l2.toLowerCase();
      line.textContent = `${nameOf(note.narrative, 'narrative')} is open for writing, and a ${chapter} goes inside it.`;
      act('add-chapter', `Add a ${chapter}`, async () => {
        const el = elementOf(note.narrative);
        leave();
        if (!el) return;
        const { openWritingChildCreate } = await import('../middle/element-detail-header');
        openWritingChildCreate(el, 'l2', worldId);
      });
      break;
    }
    case 'copy': {
      const entry = entryOf(worldId);
      line.textContent = `${getState().active?.meta.name || 'This world'} is kept only in this browser.`;
      act('download', 'Download', async () => {
        leave();
        const now = entryOf(worldId);
        if (!now) return;
        const { downloadWorldFromClick } = await import('./download-world');
        void downloadWorldFromClick(now, toastManager);
      });
      if (hasFolderMode()) {
        act('move', 'Move to a folder', async () => {
          leave();
          const now = entryOf(worldId);
          if (!now) return;
          const { MoveBrowserWorldModal } = await import('./move-browser-world-modal');
          new MoveBrowserWorldModal(now, toastManager).open();
        });
      }
      if (entry && entry.state !== 'api-linked' && !entry.copy_of && !isPartialSlice(getState().active?.meta)) {
        act('online', 'Make online', async () => {
          leave();
          const { MakeOnlineModal } = await import('./make-online-modal');
          new MakeOnlineModal(toastManager).open();
        });
      }
      break;
    }
    case 'reading': {
      const r = note.rider!;
      // "Ada, Hollow Keep and The Fall are linked now.", "and N more" past two.
      const all = [ch, ...r.names.map(anyName)];
      const last = r.more > 0 ? `${r.more} more` : all.pop()!;
      line.textContent = `${all.join(', ')} and ${last} are linked now.`;
      break;
    }
  }

  // The reward (#840's C2): See <name>'s world, the note's second button, drawn only while the
  // note carries it. Its first drawing stamps `reading`; a later redraw keeps it.
  // A button that stopped holding is gone for good: a later write that puts it back is no gesture (C6).
  if (showing.rider && note.id !== 'reading' && !riderHolds(showing.rider)) showing.rider = undefined;
  const rider = showing.rider;
  if (rider && riderHolds(rider) && (note.id === 'reading' || showing.riderDrawn || !loadGuideState().seen.reading)) {
    if (!showing.riderDrawn) {
      showing.riderDrawn = true;
      markNoteSeen('reading');
    }
    act('see-world', `See ${nameOf(rider.anchor, 'character')}'s world`, () => {
      leave();
      openWebOn(worldId, rider.anchor);
    });
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'atlas-icon-btn-sm atlas-guide-note-close';
  close.setAttribute('data-note-close', '');
  close.setAttribute('aria-label', 'Close this note');
  close.title = 'Close this note';
  close.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
  close.addEventListener('click', () => leave());

  node.append(line);
  if (actions.childElementCount) node.append(actions);
  node.append(close);
  const newYear = node.querySelector<HTMLInputElement>('.atlas-guide-note-year-input');
  if (newYear) {
    newYear.value = keptYear;
    if (hadFocus) newYear.focus({ preventScroll: true });
  } else if (hadFocus) {
    close.focus({ preventScroll: true });
  }
}

/**
 * Every action runs here: `copy` waits while it runs, and speaks only once it
 * is done: into the room it moved to, or after the dialog it opened closes.
 */
async function runAction(run: () => void | Promise<void>): Promise<void> {
  acting = true;
  try {
    await run();
  } finally {
    acting = false;
  }
  tryCopy();
}

const YEAR = /^-?\d+$/;

/** Year [ ] Set year: a whole number only, written only when the Event has none. */
function addYear(actions: HTMLElement, note: EarnedNote): void {
  const wrap = document.createElement('span');
  wrap.className = 'atlas-guide-note-year';
  const label = document.createElement('label');
  label.textContent = 'Year';
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = 'numeric';
  input.className = 'atlas-input atlas-guide-note-year-input';
  input.placeholder = 'e.g. 120';
  input.setAttribute('aria-label', 'Year');
  label.appendChild(input);
  const set = document.createElement('button');
  set.type = 'button';
  set.className = 'atlas-guide-note-act';
  set.setAttribute('data-note-action', 'set-year');
  set.textContent = 'Set year';
  const err = document.createElement('span');
  err.className = 'atlas-guide-note-error';
  err.hidden = true;
  const run = async (): Promise<void> => {
    const text = input.value.trim();
    const year = YEAR.test(text) ? Number(text) : NaN;
    if (!Number.isSafeInteger(year)) {
      err.textContent = 'A year is a whole number, like 120 or -40.';
      err.hidden = false;
      return;
    }
    const wrote = await writeIfEmpty(note.event!, ex =>
      isFilled((ex as { start_date?: unknown }).start_date) ? null : { start_date: year } as Partial<Element>);
    if (wrote === 'wrote') reportGesture({ kind: 'date-set', event: note.event! }, { fromAction: true, pair: note.pair });
    if (showing?.note === note) leave();
  };
  set.addEventListener('click', () => { void runAction(run); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void runAction(run); } });
  wrap.append(label, set, err);
  actions.appendChild(wrap);
}

/**
 * The one write path for every action: the check runs on the element as it
 * is on disk, inside its lock, and returns null to write nothing. A failure
 * is said (showProblem) and answered 'failed', so no action moves on from it.
 */
async function writeIfEmpty(id: string, mutate: (existing: Element) => Partial<Element> | null): Promise<'wrote' | 'nothing' | 'failed'> {
  const worldId = showing?.worldId;
  const store = getActiveStore();
  if (!store || !worldId || activeWorldId() !== worldId) return 'nothing';
  let wrote = false;
  try {
    await store.updateElementWith(id, ex => {
      const patch = mutate(ex);
      wrote = patch !== null;
      return patch;
    });
  } catch (err) {
    showProblem(err, { doing: 'saving the change', toasts: toastManager });
    return 'failed';
  }
  if (!wrote) return 'nothing';
  await refreshElementsAfterWrite(store);
  requestPushIfLinked();
  return 'wrote';
}

/** Listeners, once: the world, the elements, the address, the modals, the switch. */
function wire(): void {
  if (wired) return;
  wired = true;
  lastWorldId = activeWorldId();
  lastElements = getState().data.elements;
  subscribe(() => {
    const worldId = activeWorldId();
    if (worldId !== lastWorldId) {
      lastWorldId = worldId;
      copyEarnedIn = null;
      clear();
      return;
    }
    if (showing && (worldIsViewOnly(worldId) || isTourFlagActive()
      || entryOf(showing.worldId)?.tour_dismissed?.includes('home-cards'))) { clear(); return; }
    const els = getState().data.elements;
    if (els !== lastElements) {
      lastElements = els;
      if (showing) {
        if (!stillHolds(showing.note)) leave();
        // The words follow a rename, and only a change of what the note draws redraws it: a sync
        // round that changed nothing never rebuilds its buttons under a press (conv. 146). A year
        // being typed and its focus survive a redraw (fill carries them).
        else if (drawnKey(showing.note) !== showing.key) fill();
      }
    }
  });
  window.addEventListener('hashchange', () => {
    if (showing && window.location.hash !== showing.drawnHash) leave();
  });
  document.addEventListener('atlas:modal-closed', () => {
    if (anyModalOpen()) return;
    const p = pending;
    pending = null;
    // A note that waited for the dialog speaks only into a free slot (a mark's own offer still replaces).
    if (p && activeWorldId() === p.worldId) offer(p.note, p.worldId, { fromAction: false, forced: p.forced });
    if (copyAfterDialog) { copyAfterDialog = false; tryCopy(); }
  });
  document.addEventListener('atlas:guide-changed', () => {
    if (loadGuideState().off && showing) clear();
  });
  // The Web's drawer closed (or never opened): `copy`, held from the press, may speak now.
  onWebDrawerReleased(() => tryCopy());
}

/** Test seam: forget everything this module holds. */
export function resetGuideNoteForTests(): void {
  clear();
  copyEarnedIn = null;
}
