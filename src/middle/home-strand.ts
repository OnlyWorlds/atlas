/**
 * Home's Strand tab (the strand profile; Atlas's contract S3, S5, S6): the world's strand as five
 * boxes beside Home's picture, in the story's order: Story, Happening, Where it happened, Hero, Where
 * the hero is now. A filled box names its element (a press opens it) with Change; an empty one offers
 * Make one and Pick from the world (and Same place, for where the hero is now, once where it happened
 * is filled); a box whose parent is empty says what it waits for.
 *
 *   The tab head ("Picture" / "Strand") is built by Home's render above whichever picture draws, never
 *   inside it; the panel not chosen is not built. The default is Strand when the story box is filled,
 *   else Picture, and a world's first draw in a session records its tab as if pressed, so a later pull
 *   never switches it under the person. Kept per world in this module, never stored.
 *
 *   Who writes which box is the core's `maySetSlot`; with an empty strand and no box writable there is
 *   no tab at all (`strandTabShows`). Every write is `ui/strand-write.ts`. A change (Change on a filled
 *   box, or a Hero or Now whose field already holds something the strand does not read) first says
 *   what it would do, and only a second press writes.
 *
 *   The name box and the pick list hold Home's redraws while open (`GRID_OPEN_ATTR`, `GRID_CLOSED`), as
 *   the grid's do; after a write the focus goes to the box it wrote (`data-slot`), never to the page.
 */

import type { Element, WorldMeta, WorldRegistryEntry } from '../core/types';
import { getState } from '../core/state';
import { navigate, worldHash } from '../core/router';
import { ELEMENT_ICONS, ELEMENT_TYPE_COLORS } from '../core/constants';
import { escapeText } from '../core/dom-utils';
import { openElementTarget } from '../core/element-room';
import { hiddenRowWord, isHiddenMark } from '../core/hidden-mark';
import { handsOnAsProposed } from '../core/review-mark';
import { markEscapeOwned } from '../core/escape-mark';
import {
  anySlotWritable, elementIndex, maySetSlot, memberIds, offerable, rawSingle, storedMark, strandView, SLOT_TYPE,
  STRAND_SLOTS, type OwStrand, type StrandSlot,
} from '../core/strand';
import { canonicalExtValue } from '../sync/world-meta-sync';
import { isKeptHere, keptSetOf } from '../sync/sync-attach';
import { typeName } from '../core/type-words';
import { GRID_OPEN_ATTR, afterPress, gridClosed, watchLeave } from './home-grid-kinds';
import { makeStrandSlot, writeStrandSlot, STRAND_MOVED, type StrandDrawn, type StrandWriteResult } from '../ui/strand-write';

export type HomeTab = 'picture' | 'strand';

/** Each box's word. */
export const SLOT_WORD: Record<StrandSlot, string> = {
  narrative: 'Story',
  event: 'Happening',
  location: 'Where it happened',
  character: 'Hero',
  now: 'Where the hero is now',
};

/** The slot as a promise names it ("Mira will be the hero in place of Ana"). */
const SLOT_PHRASE: Record<StrandSlot, string> = {
  narrative: 'the story',
  event: 'the happening',
  location: 'where it happened',
  character: 'the hero',
  now: 'where the hero is now',
};

/** What an empty box waits for, when its parent is empty. */
const WAITS_FOR: Partial<Record<StrandSlot, string>> = {
  event: 'After the story',
  location: 'After the happening',
  character: 'After the story',
  now: 'After the hero',
};

export const READ_ONLY_LINE = 'The owner or a co-builder chooses the strand.';

// ---- Module memory (this tab's, never stored) ----

const tabs = new Map<string, HomeTab>();
/** A control to focus after the next draw (a tab press, a write). */
let askFocus: { worldId: string; key: string } | null = null;
/** A box opened for a change, or a change said and waiting for its second press. */
interface Opened {
  worldId: string;
  slot: StrandSlot;
  /** 'acts': Change pressed, the box offers its ways; 'promise': a pick or a name said, the second press writes. */
  mode: 'acts' | 'promise';
  pick?: string;
  name?: string;
  /** What the promise named: the second press writes against this, never against a newer draw. */
  drawn?: StrandDrawn;
  /** The box's state when it opened, to let go of it once the world moved. */
  stamp: string;
}
let opened: Opened | null = null;
/** The panel's own line (a refusal, an element made and kept), for this world, until the next act. */
let said: { worldId: string; text: string } | null = null;

// ---- Reading ----

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

/** S3, G16: a tab when the strand has a story, or when some box is writable here. */
export function strandTabShows(worldId: string, c: StrandContext | null = strandContext(worldId)): boolean {
  if (!c) return false;
  return !!c.strand.narrative || anySlotWritable(c.entry, c.meta, c.strand, c.byId);
}

/** The tab chosen for this world: the first draw in a session is recorded as if pressed (G13). */
export function chosenTab(worldId: string, c: StrandContext | null = strandContext(worldId)): HomeTab {
  let t = tabs.get(worldId);
  if (!t) {
    t = c?.strand.narrative ? 'strand' : 'picture';
    tabs.set(worldId, t);
  }
  return t;
}

/**
 * Home drew its picture with no tab head (no strand and nothing writable here, G16): recorded as the
 * Picture tab if nothing is yet, so a strand pulled later never takes the picture from under the
 * person (C4).
 */
export function notePictureShown(worldId: string): void {
  if (!tabs.has(worldId)) tabs.set(worldId, 'picture');
}

/** Home on the Strand tab (S7's Open it, S8's Pick on Home). */
export function openStrandTab(worldId: string): void {
  tabs.set(worldId, 'strand');
  askFocus = { worldId, key: 'tab-strand' };
  navigate(worldHash(worldId));
}

// ---- Focus across Home's redraws ----

/** The strand control holding the focus in `root`, by its key, before a redraw takes it. */
export function strandFocusKey(root: HTMLElement): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !root.contains(a)) return null;
  return a.closest<HTMLElement>('[data-strand-key]')?.getAttribute('data-strand-key') ?? null;
}

/** After a draw: the control a press asked for, else the one that held the focus before it. */
export function settleStrandFocus(root: HTMLElement, kept: string | null): void {
  const worldId = getState().active?.worldId;
  const ask = askFocus && askFocus.worldId === worldId ? askFocus.key : null;
  askFocus = null;
  const key = ask ?? kept;
  if (!key) return;
  const box = key.startsWith('box:') ? root.querySelector<HTMLElement>(`[data-slot="${CSS.escape(key.slice(4))}"]`) : null;
  const target = box
    ? box.querySelector<HTMLElement>('[data-strand-key]') ?? box
    : root.querySelector<HTMLElement>(`[data-strand-key="${CSS.escape(key)}"]`);
  target?.focus({ preventScroll: true });
}

// ---- The head ----

/**
 * The two tabs, one Tab stop, arrows between (automatic activation). A press records the tab and
 * asks Home to redraw (`choose`), the focus kept on the tab.
 */
export function buildStrandHead(worldId: string, chosen: HomeTab, choose: () => void): HTMLElement {
  const head = document.createElement('div');
  head.className = 'atlas-home-tabs';
  head.setAttribute('role', 'tablist');
  head.setAttribute('aria-label', 'What Home shows');
  head.setAttribute('data-role', 'home-tabs');
  const pick = (t: HomeTab): void => {
    askFocus = { worldId, key: `tab-${t}` };
    if (tabs.get(worldId) === t) { settleStrandFocus(head, null); return; }
    tabs.set(worldId, t);
    choose();
  };
  const order: HomeTab[] = ['picture', 'strand'];
  for (const t of order) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-home-tab';
    b.id = `atlas-home-tab-${t}`;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(t === chosen));
    b.setAttribute('aria-controls', 'atlas-home-tabpanel');
    b.setAttribute('data-strand-key', `tab-${t}`);
    b.setAttribute('data-tab', t);
    b.tabIndex = t === chosen ? 0 : -1;
    b.textContent = t === 'picture' ? 'Picture' : 'Strand';
    b.addEventListener('click', () => pick(t));
    b.addEventListener('keydown', e => {
      const at = order.indexOf(t);
      let next: HomeTab | null = null;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = order[(at + 1) % order.length];
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = order[(at + order.length - 1) % order.length];
      else if (e.key === 'Home') next = order[0];
      else if (e.key === 'End') next = order[order.length - 1];
      if (!next) return;
      e.preventDefault();
      pick(next);
    });
    head.appendChild(b);
  }
  return head;
}

/** The panel's wrapper, labelled by the chosen tab. */
export function tabPanel(chosen: HomeTab): HTMLElement {
  const panel = document.createElement('div');
  panel.className = 'atlas-home-tabpanel';
  panel.id = 'atlas-home-tabpanel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `atlas-home-tab-${chosen}`);
  panel.setAttribute('data-tabpanel', chosen);
  return panel;
}

// ---- The boxes ----

const nameOf = (el: { name?: unknown } | undefined | null, fallback = 'Unnamed'): string =>
  (el && typeof el.name === 'string' && el.name.trim() ? el.name.trim() : fallback);

/** What a box was drawn with: the mark's ids as stored, and for Hero and Now the raw field. */
export function drawnFor(slot: StrandSlot, c: StrandContext): StrandDrawn {
  const ids = memberIds(storedMark(c.meta));
  const base: StrandDrawn = { worldId: c.worldId, narrative: ids.narrative ?? null, event: ids.event ?? null, location: ids.location ?? null };
  if (slot === 'character') {
    const on = c.strand.narrative?.id ?? null;
    return { ...base, on, raw: rawSingle(on ? c.byId.get(on) : undefined, 'protagonist') };
  }
  if (slot === 'now') {
    const on = c.strand.character?.id ?? null;
    return { ...base, on, raw: rawSingle(on ? c.byId.get(on) : undefined, 'location') };
  }
  return base;
}

/** The box's state as a string: an open change lets go once it moves. */
function stampOf(slot: StrandSlot, c: StrandContext): string {
  const d = drawnFor(slot, c);
  return `${canonicalExtValue(storedMark(c.meta)) ?? ''}|${canonicalExtValue(d.raw ?? null) ?? ''}|${c.strand[slot]?.id ?? ''}`;
}

/** A kind word with its article: "a location", "an event". */
const aKind = (type: string): string => {
  const w = typeName(type);
  return `${/^[aeiou]/i.test(w) ? 'an' : 'a'} ${w}`;
};

/**
 * What a Hero or Now field holds that the strand does not read (G8), in words where it can: a proposed
 * or hidden element, one of another kind (C5), or an id that names nothing here; `label` for the box,
 * `phrase` for the middle of a promise. Null when it holds nothing.
 */
export function rawHeld(slot: StrandSlot, c: StrandContext): { label: string; phrase: string } | null {
  if (slot !== 'character' && slot !== 'now') return null;
  if (c.strand[slot]) return null;
  const raw = drawnFor(slot, c).raw;
  if (raw === null || raw === undefined) return null;
  const el = typeof raw === 'string' ? c.byId.get(raw) : undefined;
  if (!el) return { label: 'An id that names nothing here', phrase: 'an id that names nothing here' };
  const name = nameOf(el);
  if (el.type !== SLOT_TYPE[slot]) {
    const kind = aKind(el.type);
    return { label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)}: ${name}`, phrase: `${kind}, ${name}` };
  }
  if (handsOnAsProposed(el)) return { label: `Proposed: ${name}`, phrase: `the proposed ${name}` };
  // Unreached at the owner rung (a hidden element is in view, so the slot fills); kept for a lower reading.
  if (isHiddenMark(el)) return { label: `Hidden: ${name}`, phrase: `the hidden ${name}` };
  return { label: name, phrase: name };
}

/** The box's words for what its field holds (`rawHeld`'s label). */
export function rawWords(slot: StrandSlot, c: StrandContext): string | null {
  return rawHeld(slot, c)?.label ?? null;
}

/** The parent a box waits for is empty. */
function waits(slot: StrandSlot, s: OwStrand): boolean {
  if (slot === 'event' || slot === 'character') return !s.narrative;
  if (slot === 'location') return !s.event;
  if (slot === 'now') return !s.character;
  return false;
}

/** The pick list's elements: that kind's, the parent's own first (G12: `offerable`). */
export function pickRows(slot: StrandSlot, c: StrandContext): { own: Element[]; rest: Element[]; ownWord: string | null } {
  const type = SLOT_TYPE[slot];
  // What the box holds now is no pick for its Change (C14).
  const holds = c.strand[slot]?.id;
  const all = c.all.filter(e => offerable(e, type) && e.id !== holds && !c.kept(e.id))
    .sort((a, b) => nameOf(a, '').localeCompare(nameOf(b, ''), undefined, { sensitivity: 'base' }));
  const parent = slot === 'event' ? c.strand.narrative?.id : slot === 'location' ? c.strand.event?.id : slot === 'character' ? c.strand.narrative?.id : undefined;
  const field = slot === 'event' ? 'events' : slot === 'location' ? 'locations' : slot === 'character' ? 'characters' : null;
  const list = parent && field ? (c.byId.get(parent) as Record<string, unknown> | undefined)?.[field] : undefined;
  const ids = new Set(Array.isArray(list) ? list.filter((v): v is string => typeof v === 'string') : []);
  const ownWord = slot === 'location' ? 'In this happening' : slot === 'event' || slot === 'character' ? 'In this story' : null;
  return { own: all.filter(e => ids.has(e.id)), rest: all.filter(e => !ids.has(e.id)), ownWord };
}

export interface StrandPanelOptions {
  /** No picture beside it: the strand draws alone, under its own heading. */
  alone: boolean;
  /** Redraw Home now (its inputs may not have moved: a refusal writes nothing). */
  redraw: () => void;
  /** The draw's one reading (C7); read afresh when not given. */
  context?: StrandContext | null;
}

/** The Strand panel: the five boxes. */
export function buildStrandPanel(worldId: string, opts: StrandPanelOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'atlas-home-strand';
  section.setAttribute('data-role', 'home-strand');
  const c = opts.context !== undefined ? opts.context : strandContext(worldId);
  if (!c) return section;
  if (opts.alone) {
    const h = document.createElement('h2');
    h.className = 'atlas-home-section-title';
    h.textContent = 'Strand';
    section.appendChild(h);
  } else section.setAttribute('aria-label', 'Strand');
  const writable = STRAND_SLOTS.filter(s => maySetSlot(s, c.entry, c.meta, c.strand, c.byId));
  if (writable.length === 0) {
    const p = document.createElement('p');
    p.className = 'atlas-home-strand-note';
    p.setAttribute('data-role', 'strand-read-only');
    p.textContent = READ_ONLY_LINE;
    section.appendChild(p);
  }
  // An open change lets go once its box moved (a pull, another tab, a write elsewhere).
  if (opened && (opened.worldId !== worldId || opened.stamp !== stampOf(opened.slot, c) || !writable.includes(opened.slot))) opened = null;
  const sayLine = document.createElement('p');
  sayLine.className = 'atlas-home-strand-say';
  sayLine.setAttribute('data-role', 'strand-say');
  sayLine.setAttribute('role', 'status');
  sayLine.textContent = said && said.worldId === worldId ? said.text : '';
  const list = document.createElement('ol');
  list.className = 'atlas-home-strand-boxes';
  for (const slot of STRAND_SLOTS) {
    const box = buildBox(slot, c, writable.includes(slot), opts);
    if (inFlight.has(flightKey(worldId, slot))) box.setAttribute('aria-busy', 'true');
    list.appendChild(box);
  }
  section.append(list, sayLine);
  // A write in flight anywhere in the panel: every act waits (C1, D1), so no other press races it.
  if ([...inFlight].some(k => k.startsWith(`${worldId}\u0000`))) holdActs(section);
  return section;
}

/** The boxes with a write under way (C1): set before the write's first await, cleared after its redraw. */
const inFlight = new Set<string>();
const flightKey = (worldId: string, slot: StrandSlot): string => `${worldId}\u0000${slot}`;

/** The open name boxes and pick lists, each with its quiet close (no focus move, no redraw asked). */
const openClosers = new Set<() => void>();

/** Every act in `panel` disabled. */
function holdActs(panel: ParentNode): void {
  for (const b of panel.querySelectorAll<HTMLButtonElement>('[data-act]')) b.disabled = true;
}

/**
 * A write starts (D1): every act in the panel as drawn now is disabled, and any open name box or pick
 * list closes, before the write's first await, so no press races it and nothing typed meanwhile is
 * dropped unsaid or answered with "changed meanwhile" about the person's own press.
 */
function quietPanel(): void {
  for (const close of [...openClosers]) close();
  for (const panel of document.querySelectorAll('[data-role="home-strand"]')) holdActs(panel);
}

function act(label: string, key: string, run: () => void, cls = 'atlas-btn-ghost'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `${cls} atlas-home-strand-act`;
  b.setAttribute('data-strand-key', key);
  b.setAttribute('data-act', key.split(':').pop()!);
  b.textContent = label;
  b.addEventListener('click', run);
  return b;
}

function buildBox(slot: StrandSlot, c: StrandContext, writable: boolean, opts: StrandPanelOptions): HTMLElement {
  const type = SLOT_TYPE[slot];
  const box = document.createElement('li');
  box.className = 'atlas-home-strand-box';
  box.setAttribute('data-slot', slot);
  box.style.setProperty('--type-color', ELEMENT_TYPE_COLORS[type]);
  const head = document.createElement('div');
  head.className = 'atlas-home-strand-box-head';
  head.innerHTML = `<span class="material-symbols-outlined" aria-hidden="true">${escapeText(ELEMENT_ICONS[type] ?? 'category')}</span><span class="atlas-home-strand-word">${escapeText(SLOT_WORD[slot])}</span>`;
  box.appendChild(head);
  const body = document.createElement('div');
  body.className = 'atlas-home-strand-box-body';
  box.appendChild(body);

  const filled = c.strand[slot];
  const isOpen = opened && opened.worldId === c.worldId && opened.slot === slot ? opened : null;
  if (filled) {
    box.classList.add('is-filled');
    const el = c.byId.get(filled.id);
    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'atlas-btn-link atlas-home-strand-name';
    name.setAttribute('data-strand-key', `${slot}:open`);
    name.textContent = filled.name.trim() || 'Unnamed';
    name.title = `Open ${name.textContent}`;
    name.addEventListener('click', () => { if (el) openElementTarget(el, c.worldId); });
    body.appendChild(name);
    // Hidden here: the keeper knows others read this slot empty (G23).
    const hidden = el ? hiddenRowWord(el, c.entry?.state) : '';
    if (hidden) body.insertAdjacentHTML('beforeend', hidden);
    if (slot === 'now' && c.strand.same === true) {
      const same = document.createElement('span');
      same.className = 'atlas-home-strand-same';
      same.setAttribute('data-role', 'strand-same');
      same.textContent = 'The same place';
      body.appendChild(same);
    }
    if (writable && !isOpen) {
      body.appendChild(act('Change', `${slot}:change`, () => {
        said = null;
        opened = { worldId: c.worldId, slot, mode: 'acts', stamp: stampOf(slot, c) };
        askFocus = { worldId: c.worldId, key: `${slot}:make` };
        opts.redraw();
      }));
    }
  } else if (waits(slot, c.strand)) {
    box.classList.add('is-waiting');
    const p = document.createElement('span');
    p.className = 'atlas-home-strand-wait';
    p.textContent = WAITS_FOR[slot] ?? 'Empty';
    body.appendChild(p);
    return box;
  } else {
    const held = rawHeld(slot, c)?.label ?? null;
    const p = document.createElement('span');
    p.className = 'atlas-home-strand-empty';
    p.setAttribute('data-role', held ? 'strand-held' : 'strand-empty');
    p.textContent = held ?? 'Empty';
    body.appendChild(p);
  }
  if (!writable) return box;
  if (isOpen?.mode === 'promise') {
    body.appendChild(promiseRow(slot, c, isOpen, opts));
    return box;
  }
  if (!filled || isOpen) body.appendChild(actsRow(slot, c, !!isOpen, opts));
  return box;
}

/** A pick or a name needs its promise first: a filled box (Change), or a Hero or Now field already holding something (G8). */
function needsPromise(slot: StrandSlot, c: StrandContext): boolean {
  return !!c.strand[slot] || rawHeld(slot, c) !== null;
}

/** What the box holds now, as the middle of a promise names it (C5: lower case there). */
function holdsWords(slot: StrandSlot, c: StrandContext): string {
  const f = c.strand[slot];
  return f ? (f.name.trim() || 'Unnamed') : rawHeld(slot, c)?.phrase ?? 'nothing';
}

function actsRow(slot: StrandSlot, c: StrandContext, changing: boolean, opts: StrandPanelOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-home-strand-acts';
  const chosen = (how: { pick?: string; name?: string }): void => {
    said = null;
    if (needsPromise(slot, c)) {
      opened = { worldId: c.worldId, slot, mode: 'promise', ...how, drawn: drawnFor(slot, c), stamp: stampOf(slot, c) };
      askFocus = { worldId: c.worldId, key: `${slot}:confirm` };
      opts.redraw();
      return;
    }
    void run(slot, c, drawnFor(slot, c), how, opts);
  };
  const make = act('Make one', `${slot}:make`, () => openNameBox(row, slot, make, name => chosen({ name })));
  const pick = act('Pick from the world', `${slot}:pick`, () => openPickList(row, slot, c, pick, id => chosen({ pick: id })));
  row.append(make, pick);
  // Where the hero is now: the place it happened, offered once that box is filled.
  if (slot === 'now' && c.strand.location && c.strand.location.id !== c.strand.now?.id) {
    const where = c.strand.location.id;
    row.appendChild(act('Same place', `${slot}:same`, () => chosen({ pick: where })));
  }
  if (changing) {
    row.appendChild(act('Cancel', `${slot}:cancel`, () => {
      opened = null;
      askFocus = { worldId: c.worldId, key: `box:${slot}` };
      opts.redraw();
    }));
  }
  return row;
}

function promiseRow(slot: StrandSlot, c: StrandContext, o: Opened, opts: StrandPanelOptions): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-home-strand-promise';
  const line = document.createElement('p');
  line.className = 'atlas-home-strand-promise-line';
  line.setAttribute('data-role', 'strand-promise');
  const next = o.name ?? nameOf(o.pick ? c.byId.get(o.pick) : undefined);
  line.textContent = `${next} will be ${SLOT_PHRASE[slot]} in place of ${holdsWords(slot, c)}.`;
  row.appendChild(line);
  const confirm = act('Change', `${slot}:confirm`, () => {
    if (confirm.disabled) return;
    confirm.disabled = true;
    const drawn = o.drawn ?? drawnFor(slot, c);
    opened = null;
    void run(slot, c, drawn, { pick: o.pick, name: o.name }, opts);
  }, 'atlas-btn-primary');
  row.appendChild(confirm);
  row.appendChild(act('Cancel', `${slot}:cancel`, () => {
    opened = null;
    askFocus = { worldId: c.worldId, key: `box:${slot}` };
    opts.redraw();
  }));
  row.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    markEscapeOwned(e);
    opened = null;
    askFocus = { worldId: c.worldId, key: `box:${slot}` };
    opts.redraw();
  });
  return row;
}

/** Run the box's write and say what came of it; the focus goes back to the box it wrote. */
async function run(slot: StrandSlot, c: StrandContext, drawn: StrandDrawn, how: { pick?: string; name?: string }, opts: StrandPanelOptions): Promise<void> {
  // One write per box at a time (C1): a second Enter or press while this one runs is dropped, never a
  // second write and never "changed meanwhile" about the person's own first press.
  const key = flightKey(c.worldId, slot);
  if (inFlight.has(key)) return;
  inFlight.add(key);
  quietPanel();
  askFocus = { worldId: c.worldId, key: `box:${slot}` };
  let result: StrandWriteResult = 'nothing';
  let made: Element | undefined;
  try {
    if (how.name !== undefined) {
      const out = await makeStrandSlot(slot, drawn, how.name);
      result = out.result;
      made = out.made;
    } else if (how.pick) result = await writeStrandSlot(slot, drawn, how.pick);
  } finally {
    inFlight.delete(key);
  }
  const kept = made && result !== 'wrote' ? ` ${nameOf(made)} was made and stays in the world.` : '';
  if (result === 'refused') said = { worldId: c.worldId, text: `${STRAND_MOVED}${kept}` };
  else if (kept) said = { worldId: c.worldId, text: kept.trim() };
  askFocus = { worldId: c.worldId, key: `box:${slot}` };
  opts.redraw();
}

// ---- The name box and the pick list (each holds Home's redraws while open) ----

/** The name box in the slot: Enter makes it, Escape leaves (the focus back on Make one). */
function openNameBox(row: HTMLElement, slot: StrandSlot, back: HTMLElement, done: (name: string) => void): void {
  if (row.querySelector('form')) return;
  const form = document.createElement('form');
  form.className = 'atlas-home-strand-make';
  form.setAttribute(GRID_OPEN_ATTR, '');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-input';
  input.placeholder = 'Name';
  input.setAttribute('aria-label', `Name of the new ${SLOT_WORD[slot].toLowerCase()}`);
  input.setAttribute('data-role', 'strand-name');
  const note = document.createElement('span');
  note.className = 'atlas-home-strand-note';
  note.setAttribute('role', 'status');
  form.append(input, note);
  let closed = false;
  // Closed by a write starting elsewhere in the panel (D1): no focus moved, the write's redraw follows.
  const quiet = (): void => {
    if (closed) return;
    closed = true;
    openClosers.delete(quiet);
    unwatch();
    form.remove();
    row.classList.remove('is-open');
  };
  openClosers.add(quiet);
  const close = (how: 'escape' | 'press' | 'blur'): void => {
    if (closed) return;
    closed = true;
    openClosers.delete(quiet);
    unwatch();
    form.remove();
    row.classList.remove('is-open');
    if (how === 'escape') { back.focus(); gridClosed(row); }
    else if (how === 'press') afterPress(() => gridClosed(document.querySelector('.atlas-world-home') ?? document.body));
    else setTimeout(() => gridClosed(document.querySelector('.atlas-world-home') ?? document.body), 0);
  };
  const unwatch = watchLeave(form, t => form.contains(t), how => close(how));
  form.addEventListener('submit', e => {
    e.preventDefault();
    // A second Enter while the first one's make runs (C1): nothing, the box already gave its name.
    if (closed) return;
    const n = input.value.trim();
    if (!n) { note.textContent = 'Type a name first'; input.focus(); return; }
    closed = true;
    openClosers.delete(quiet);
    unwatch();
    input.disabled = true;
    form.removeAttribute(GRID_OPEN_ATTR);
    done(n);
    gridClosed(row);
  });
  form.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); markEscapeOwned(e); close('escape'); }
  });
  row.classList.add('is-open');
  row.appendChild(form);
  input.focus();
}

let listSeq = 0;

/** That kind's elements by name, filterable, the parent's own first; Enter or a press picks. */
function openPickList(row: HTMLElement, slot: StrandSlot, c: StrandContext, back: HTMLElement, done: (id: string) => void): void {
  if (row.querySelector('.atlas-home-strand-pick')) return;
  const { own, rest, ownWord } = pickRows(slot, c);
  const wrap = document.createElement('div');
  wrap.className = 'atlas-home-strand-pick';
  wrap.setAttribute(GRID_OPEN_ATTR, '');
  const id = `atlas-strand-pick-${++listSeq}`;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'atlas-input';
  input.placeholder = 'Filter by name';
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-expanded', 'true');
  input.setAttribute('aria-controls', id);
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-label', `Pick ${SLOT_PHRASE[slot]}`);
  input.setAttribute('data-role', 'strand-filter');
  const list = document.createElement('ul');
  list.className = 'atlas-home-strand-options';
  list.id = id;
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', SLOT_WORD[slot]);
  wrap.append(input, list);

  let options: HTMLElement[] = [];
  let active = -1;
  const setActive = (i: number): void => {
    active = options.length === 0 ? -1 : (i + options.length) % options.length;
    options.forEach((o, j) => o.setAttribute('aria-selected', String(j === active)));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const draw = (): void => {
    const q = input.value.trim().toLowerCase();
    const match = (e: Element) => !q || nameOf(e, '').toLowerCase().includes(q);
    list.innerHTML = '';
    options = [];
    const group = (word: string | null, els: Element[]): void => {
      const shown = els.filter(match);
      if (shown.length === 0) return;
      if (word) {
        const h = document.createElement('li');
        h.className = 'atlas-home-strand-group';
        h.setAttribute('role', 'presentation');
        h.textContent = word;
        list.appendChild(h);
      }
      for (const e of shown) {
        const o = document.createElement('li');
        o.className = 'atlas-home-strand-option';
        o.id = `${id}-${options.length}`;
        o.setAttribute('role', 'option');
        o.setAttribute('data-id', e.id);
        o.textContent = nameOf(e);
        o.addEventListener('pointerdown', ev => ev.preventDefault());
        o.addEventListener('click', () => pickIt(e.id));
        list.appendChild(o);
        options.push(o);
      }
    };
    group(own.length && ownWord ? ownWord : null, own);
    group(own.length && ownWord ? 'In the world' : null, rest);
    if (options.length === 0) {
      const none = document.createElement('li');
      none.className = 'atlas-home-strand-none';
      none.setAttribute('role', 'presentation');
      none.textContent = own.length + rest.length === 0 ? 'Nothing of this kind yet' : 'No name matches';
      list.appendChild(none);
    }
    setActive(0);
  };
  let closed = false;
  // Closed by a write starting elsewhere in the panel (D1).
  const quiet = (): void => {
    if (closed) return;
    closed = true;
    openClosers.delete(quiet);
    unwatch();
    wrap.remove();
    row.classList.remove('is-open');
  };
  openClosers.add(quiet);
  const close = (how: 'escape' | 'press' | 'blur' | 'picked'): void => {
    if (closed) return;
    closed = true;
    openClosers.delete(quiet);
    unwatch();
    wrap.remove();
    row.classList.remove('is-open');
    const home = document.querySelector<HTMLElement>('.atlas-world-home') ?? document.body;
    if (how === 'escape') { back.focus(); gridClosed(row); }
    else if (how === 'press') afterPress(() => gridClosed(home));
    else if (how === 'blur') setTimeout(() => gridClosed(home), 0);
  };
  const pickIt = (eid: string): void => {
    // A second press or Enter on a list already picked from (C1): nothing.
    if (closed) return;
    close('picked');
    done(eid);
    gridClosed(row.isConnected ? row : document.querySelector<HTMLElement>('.atlas-world-home') ?? document.body);
  };
  const unwatch = watchLeave(wrap, t => wrap.contains(t), how => close(how));
  input.addEventListener('input', draw);
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(active + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active - 1); }
    else if (e.key === 'Home' && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === 'End' && e.ctrlKey) { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = options[active];
      if (o) pickIt(o.getAttribute('data-id')!);
    } else if (e.key === 'Escape') { e.preventDefault(); markEscapeOwned(e); close('escape'); }
  });
  row.classList.add('is-open');
  row.appendChild(wrap);
  draw();
  input.focus();
}

/** Test seam. */
export function resetStrandTabForTests(): void {
  tabs.clear();
  askFocus = null;
  opened = null;
  said = null;
  inFlight.clear();
  openClosers.clear();
}
