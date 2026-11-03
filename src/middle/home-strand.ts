/**
 * Home's Strand tab (the strand profile; Atlas 1.114, the journey since 1.120.0): the world's strand as
 * a short journey in Seethe's grid. The story across the top; the Event and the main character on the
 * left, their places on the right, the joining words between. A filled box is always drawn; the one
 * slot asked for next is drawn as its card (a name and a text, `home-strand-card.ts`); the story's box
 * says in two lines how the parts join (`home-strand-box.ts`).
 *
 *   The tab head ("Picture" / "Strand") is decided once per Home opening (`StrandHeadLatch`): today's
 *   `strandTabShows`, and the world holds a counted element outside the strand's five bodies or the
 *   strand is whole. Nothing made during the visit adds or removes it. With no head the strand draws
 *   alone. With a head, the default is Strand when the story is filled, else Picture, and a world's
 *   first draw in a session records its tab as if pressed (kept per world in memory, never stored).
 *
 *   The reveal (R2): the asked slot is the first empty slot, in the story's order, this reader may write
 *   and has not set aside with "Skip for now" (a skipped slot's cell offers "Add <slot>"); the frame's
 *   Pick on Home asks its slot out of order. Every write is `ui/strand-write.ts`, through `run`.
 *
 *   After a write the focus goes to the next card's Name, else the box written, else the whole line,
 *   scrolled into view; never to the page.
 */

import { navigate, worldHash } from '../core/router';
import { getState } from '../core/state';
import { anySlotWritable, maySetSlot, STRAND_SLOTS, type StrandSlot } from '../core/strand';
import { askedSlot, countedOutsideStrand, strandWhole, JOIN_NOW, JOIN_PLACE, SLOT_WORD } from '../core/strand-journey';
import { worldEmptyForPath } from '../core/guide-path';
import {
  askSlot, dropEditDraftsNotOn, flightKey, flying, forcedSlot, isSkipped, memory, resetStrandMemoryForTests, strandContext,
  type HomeTab, type StrandContext,
} from './home-strand-model';
import { act, holdActs, stampOf as stampNow, type StrandPanelOptions } from './home-strand-acts';
import { buildEditCard, buildMakeCard } from './home-strand-card';
import { buildFilledBox, buildSameLine, buildWholeLine } from './home-strand-box';
import { buildStrandLine, holdStrandLines, resetLineHold } from './home-strand-room';

export { SLOT_WORD } from '../core/strand-journey';
export { strandContext, type HomeTab, type StrandContext } from './home-strand-model';
export { drawnFor, pickRows, rawHeld, rawWords, type StrandPanelOptions } from './home-strand-acts';

export const READ_ONLY_LINE = 'The owner or a co-builder chooses the strand.';

/** S3, G16: a tab when the strand has a story, or when some slot is writable here. */
export function strandTabShows(worldId: string, c: StrandContext | null = strandContext(worldId)): boolean {
  if (!c) return false;
  return !!c.strand.narrative || anySlotWritable(c.entry, c.meta, c.strand, c.byId);
}

/**
 * R1: the tab head, as a Home opening decides it: `strandTabShows`, and a counted element outside the
 * strand's five bodies or all five filled.
 */
export function strandHeadShows(c: StrandContext): boolean {
  return strandTabShows(c.worldId, c) && (countedOutsideStrand(c.all, c.kept, c.strand) || strandWhole(c.strand));
}

/** What a Home opening draws: the strand with its tab head, the strand alone, or the picture alone. */
export type HomeShape = 'head' | 'alone' | 'picture';

/** R1 whole: no strand to show here, the picture; else the head when it is earned, else the strand alone. */
export function homeShapeOf(c: StrandContext): HomeShape {
  if (!strandTabShows(c.worldId, c)) return 'picture';
  return strandHeadShows(c) ? 'head' : 'alone';
}

/**
 * R1's latch: one per Home opening (Home's mount). The first loaded reading of a world decides the whole
 * shape for the visit, `strandTabShows` included (the code gate's C3): a make, a pull giving or taking
 * the strand, or a role kept by the first round changes nothing; another world, or Home opened again,
 * reads afresh. The whole line's Picture shows the head on a press (`reveal`).
 */
export class StrandHeadLatch {
  private worldId: string | null = null;
  private shape: HomeShape = 'picture';
  constructor(private readonly onReveal: () => void = () => {}) {}
  read(c: StrandContext): HomeShape {
    if (this.worldId !== c.worldId) {
      this.worldId = c.worldId;
      this.shape = homeShapeOf(c);
    }
    return this.shape;
  }
  reveal(worldId: string): void {
    if (this.worldId !== worldId || this.shape !== 'alone') return;
    this.shape = 'head';
    this.onReveal();
  }
}

let currentLatch: StrandHeadLatch | null = null;

/** Home opened: its latch for this visit, and the rows' and the lines' held heights let go (W5, G2). */
export function openHeadLatch(onReveal: () => void): StrandHeadLatch {
  currentLatch = new StrandHeadLatch(onReveal);
  rowHold = null;
  resetLineHold();
  return currentLatch;
}

/** Test seam: the open Home's head shown, as the whole line's Picture shows it (a spec of the grid on an empty world). */
export function showStrandHeadForTests(): void {
  const w = getState().active?.worldId;
  if (w) currentLatch?.reveal(w);
}

/** The tab chosen for this world: the first draw in a session is recorded as if pressed (G13). */
export function chosenTab(worldId: string, c: StrandContext | null = strandContext(worldId)): HomeTab {
  let t = memory.tabs.get(worldId);
  if (!t) {
    // A world with nothing in it yet opens on Strand. Not recorded: once the world holds something made
    // elsewhere, the next draw reads it afresh; a press on a tab is recorded as always.
    if (!c?.strand.narrative && worldEmptyForPath()) return 'strand';
    t = c?.strand.narrative ? 'strand' : 'picture';
    memory.tabs.set(worldId, t);
  }
  return t;
}

/** The whole line's Picture: the Picture tab chosen, as a press on the tab records it. */
export function choosePicture(worldId: string): void {
  memory.tabs.set(worldId, 'picture');
}

/**
 * Home drew its picture with no tab head (no strand and nothing writable here, G16): recorded as the
 * Picture tab if nothing is yet, so a strand pulled later never takes the picture from under the
 * person (C4).
 */
export function notePictureShown(worldId: string): void {
  if (worldEmptyForPath()) return;
  if (!memory.tabs.has(worldId)) memory.tabs.set(worldId, 'picture');
}

/** Home on the Strand tab (S7's Open it, S8's Pick on Home): with `slot`, that slot asked, the focus in its Name. */
export function openStrandTab(worldId: string, slot?: StrandSlot): void {
  memory.tabs.set(worldId, 'strand');
  if (slot) {
    askSlot(worldId, slot);
    memory.askFocus = { worldId, key: `card:${slot}:name` };
  } else memory.askFocus = { worldId, key: 'tab-strand' };
  navigate(worldHash(worldId));
}

// ---- Focus across Home's redraws ----

/** The strand control holding the focus in `root`, by its key, before a redraw takes it. */
export function strandFocusKey(root: HTMLElement): string | null {
  const a = document.activeElement;
  if (!(a instanceof HTMLElement) || !root.contains(a)) return null;
  return a.closest<HTMLElement>('[data-strand-key]')?.getAttribute('data-strand-key') ?? null;
}

/** A key for a selector: the browser's escape where there is one (jsdom has no `CSS`); the keys are Atlas's own words. */
const cssEscape = (s: string): string => (typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&'));

const panelFirst = (root: ParentNode): HTMLElement | null =>
  root.querySelector<HTMLElement>('[data-role="home-strand"] input:not([type="hidden"]), [data-role="home-strand"] textarea, [data-role="home-strand"] button');

/** The journey's next stop after a write on `slot` (S10): the asked card's Name, else the box, else the whole line. */
function nextStop(root: ParentNode, slot: string): HTMLElement | null {
  return root.querySelector<HTMLElement>('[data-role="strand-card"][data-mode="make"] [data-field="name"]')
    ?? root.querySelector<HTMLElement>(`[data-strand-key="${cssEscape(slot)}:open"]`)
    ?? root.querySelector<HTMLElement>('[data-role="strand-whole"]')
    // Skip for now on the last card it could ask: the slot's own "Add" that just appeared (the code gate's C5).
    ?? root.querySelector<HTMLElement>(`[data-strand-key="${cssEscape(slot)}:add"]`)
    ?? panelFirst(root);
}

/** After a draw: the control a press asked for, else the one that held the focus before it. */
export function settleStrandFocus(root: HTMLElement, kept: string | null): void {
  const worldId = getState().active?.worldId;
  const ask = memory.askFocus && memory.askFocus.worldId === worldId ? memory.askFocus.key : null;
  memory.askFocus = null;
  const key = ask ?? kept;
  if (!key) return;
  let target: HTMLElement | null;
  if (key.startsWith('next:')) target = nextStop(root, key.slice(5));
  else if (key.startsWith('box:')) {
    const cell = root.querySelector<HTMLElement>(`[data-role="home-strand"] [data-slot="${cssEscape(key.slice(4))}"]`);
    target = cell ? cell.querySelector<HTMLElement>('[data-strand-key]') ?? null : null;
  } else target = root.querySelector<HTMLElement>(`[data-strand-key="${cssEscape(key)}"]`);
  // An asked control not drawn (no head for "tab-strand", a slot not asked): the panel's first control.
  if (!target && ask && (key.startsWith('tab-') || key.startsWith('card:'))) target = panelFirst(root);
  if (!target) return;
  target.focus({ preventScroll: true });
  if (ask) target.scrollIntoView?.({ block: 'nearest' });
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
    memory.askFocus = { worldId, key: `tab-${t}` };
    if (memory.tabs.get(worldId) === t) { settleStrandFocus(head, null); return; }
    memory.tabs.set(worldId, t);
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

// ---- The grid ----

/** The joining words at the head of a right-hand cell (inside the cell, never a child of the list). */
function join(words: string): HTMLElement {
  const s = document.createElement('span');
  s.className = 'atlas-home-strand-join';
  s.setAttribute('data-role', 'strand-join');
  s.textContent = words;
  return s;
}

/** The Strand panel: Seethe's grid, one box asked at a time. */
export function buildStrandPanel(worldId: string, opts: StrandPanelOptions): HTMLElement {
  const section = document.createElement('section');
  section.className = 'atlas-home-strand';
  section.setAttribute('data-role', 'home-strand');
  const c = opts.context !== undefined ? opts.context : strandContext(worldId);
  if (!c) return section;
  const titled = opts.alone && opts.heading !== false;
  if (titled) {
    const h = document.createElement('h2');
    h.className = 'atlas-home-section-title';
    h.textContent = 'Strand';
    section.appendChild(h);
  } else section.setAttribute('aria-label', 'Strand');
  // The cards' question is the panel's first heading when nothing heads it.
  const level: 2 | 3 = opts.alone && opts.heading === false ? 2 : 3;
  const may = (slot: StrandSlot): boolean => maySetSlot(slot, c.entry, c.meta, c.strand, c.byId);
  const writable = STRAND_SLOTS.filter(may);
  if (writable.length === 0) {
    const p = document.createElement('p');
    p.className = 'atlas-home-strand-note';
    p.setAttribute('data-role', 'strand-read-only');
    p.textContent = READ_ONLY_LINE;
    section.appendChild(p);
  }
  // An open change lets go once its slot moved (a pull, another tab, a write elsewhere).
  const o = memory.opened;
  if (o && (o.worldId !== worldId || !writable.includes(o.slot) || o.stamp !== stampNow(o.slot, c))) memory.opened = null;
  // An Edit lets go once its box holds another element, or none.
  const ed = memory.editing;
  if (ed && (ed.worldId !== worldId || c.strand[ed.slot]?.id !== ed.id || !c.byId.get(ed.id))) memory.editing = null;
  // An Edit draft lives only while its slot holds that element (the code gate's C2).
  for (const slot of STRAND_SLOTS) dropEditDraftsNotOn(worldId, slot, c.strand[slot]?.id ?? null);
  const asked = askedSlot(c.strand, may, s => isSkipped(worldId, s), forcedSlot(worldId));

  const grid = document.createElement('ol');
  grid.className = 'atlas-home-strand-grid';
  for (const slot of STRAND_SLOTS) grid.appendChild(cell(slot, c, opts, asked, may(slot), level));
  const sayLine = document.createElement('p');
  sayLine.className = 'atlas-home-strand-say';
  sayLine.setAttribute('data-role', 'strand-say');
  sayLine.setAttribute('role', 'status');
  sayLine.textContent = memory.said && memory.said.worldId === worldId ? memory.said.text : '';
  section.append(grid, sayLine);
  if (strandWhole(c.strand)) section.appendChild(buildWholeLine(c, opts));
  // A write in flight anywhere in the panel: every act waits (C1, D1), so no other press races it.
  if (flying(worldId)) holdActs(section);
  return section;
}

function cell(slot: StrandSlot, c: StrandContext, opts: StrandPanelOptions, asked: StrandSlot | null, writable: boolean, level: 2 | 3): HTMLElement {
  const li = document.createElement('li');
  li.className = `atlas-home-strand-cell is-${slot}`;
  li.setAttribute('data-slot', slot);
  if (memory.inFlight.has(flightKey(c.worldId, slot))) li.setAttribute('aria-busy', 'true');
  const joinWords = slot === 'location' ? JOIN_PLACE : slot === 'now' ? JOIN_NOW : null;
  const filled = c.strand[slot];
  if (filled) {
    if (slot === 'now' && c.strand.same === true) {
      li.classList.add('is-same');
      li.appendChild(buildSameLine(c, opts));
      return li;
    }
    const el = c.byId.get(filled.id);
    // The line above the box (1.122.0), the cell's and never the box's; the join words between them (G11).
    const line = el ? buildStrandLine(slot, el, c, opts.redraw) : null;
    if (line) li.appendChild(line);
    if (joinWords) li.appendChild(join(joinWords));
    const ed = memory.editing;
    if (ed && ed.worldId === c.worldId && ed.slot === slot && el) li.appendChild(buildEditCard(slot, c, el, opts, level));
    else li.appendChild(buildFilledBox(slot, c, opts));
    return li;
  }
  if (slot === asked) {
    // 1.122.0: no join words over an asked card (its question already says them). Above the card in the
    // box's column (G11) they made the Location's card taller than the Event's card beside it, so the
    // Event make grew the row and moved the main character's box below (W5).
    li.appendChild(buildMakeCard(slot, c, opts, level));
    return li;
  }
  if (writable && isSkipped(c.worldId, slot)) {
    li.classList.add('is-add');
    li.appendChild(act(`Add ${SLOT_WORD[slot].toLowerCase()}`, `${slot}:add`, () => {
      askSlot(c.worldId, slot);
      memory.askFocus = { worldId: c.worldId, key: `card:${slot}:name` };
      opts.redraw();
    }, 'atlas-btn-link atlas-home-strand-quiet'));
    return li;
  }
  // Nothing asked here yet: the cell keeps its place in the grid, and takes none in one column.
  li.classList.add('is-empty');
  li.setAttribute('aria-hidden', 'true');
  return li;
}

// ---- W5: a row never gets shorter within a visit ----

/**
 * The grid's rows as this visit to Home has drawn them (1.121.2): per cell, the tallest it stood while a
 * filled box lay below it, read at the grid's width. A card giving way to a shorter box (the Event's card
 * beside the Location's, a Location's card) would shorten its row and lift every filled box below; the
 * cell keeps that height instead, so no filled box moves when another is made. A row may still grow. Read
 * only where a filled box lies below, so the story's card never holds its row once it is a box, and the
 * last row never holds. Let go at Home's next opening, another world or another width; never stored. One
 * column holds nothing (the stylesheet), where each make draws the next card above the boxes anyway.
 */
let rowHold: { worldId: string; width: number; tallest: Map<string, number> } | null = null;

const HOLD_VAR = '--strand-hold';

function strandGridIn(root: ParentNode): HTMLElement | null {
  const g = root.querySelector<HTMLElement>('[data-role="home-strand"] .atlas-home-strand-grid');
  return g && g.isConnected ? g : null;
}

/**
 * After Home's draw: each cell held at its tallest this visit (the stylesheet reads it as a min-height),
 * then the draw read. A draw while a write runs is read too: its card keeps the Pick it had when pressed
 * (`pickAtPress`), so it stands as tall as it did, never a passing height.
 */
export function holdStrandRows(root: ParentNode, worldId: string): void {
  const grid = strandGridIn(root);
  if (!grid) return;
  const width = grid.getBoundingClientRect().width;
  if (width <= 0) return;
  // The lines above the boxes keep their tallest height too, at every width, one column included (G2).
  holdStrandLines(grid, worldId, width);
  if (!rowHold || rowHold.worldId !== worldId || Math.abs(width - rowHold.width) > 0.5) rowHold = { worldId, width, tallest: new Map() };
  const cells = [...grid.querySelectorAll<HTMLElement>(':scope > .atlas-home-strand-cell')];
  for (const li of cells) {
    const h = rowHold.tallest.get(li.getAttribute('data-slot') ?? '');
    if (h) li.style.setProperty(HOLD_VAR, `${h}px`);
  }
  const boxTops = [...grid.querySelectorAll<HTMLElement>('[data-box]')].map(b => b.getBoundingClientRect().top);
  for (const li of cells) {
    const slot = li.getAttribute('data-slot');
    const r = li.getBoundingClientRect();
    if (!slot || r.height <= 0 || !boxTops.some(t => t >= r.bottom - 0.5)) continue;
    if (r.height > (rowHold.tallest.get(slot) ?? 0)) rowHold.tallest.set(slot, r.height);
  }
}

/** Test seam. */
export function resetStrandTabForTests(): void {
  resetStrandMemoryForTests();
  currentLatch = null;
  rowHold = null;
  resetLineHold();
}
