/**
 * The home that grows: a new world's card, right under its name, with the
 * world's grid inside it. Every act of the path is in the grid: a + square
 * makes the next kind, a drag or two presses places. The card is read from
 * the dots on every draw (`cardStep`), whatever made the element, so there is
 * no Next: each card also says what the step before made possible.
 *
 *   The card's head (the step, the dots, the ×) is one line; the grid sits
 *   right under it, and every word that changes with an act (the step's line,
 *   the hint, a promise, the "just now" line, the buttons) sits under the
 *   grid, so nothing above the squares moves when something is made or placed.
 *
 *   Where the step names no kind to make, the + square is a plain +: "add",
 *   with a list of kinds. Only the path's own named + starts the path.
 *
 *   When the grid is not drawn (past its height), the card carries its step's
 *   act as a button, the same function the + square and the drop call, says
 *   so, and says where the whole world is; the "just now" line with its Undo
 *   stays on the card either way.
 *
 * Contract: a design note of 2026-10-30 (the home that grows, draft 3), and
 * its addendum for every pair the table offers.
 */

import { dateOf, dragField } from '@onlyworlds/sdk';
import type { Element, ElementType } from '../core/types';
import { getState, patchSlice } from '../core/state';
import { showProblem } from '../ui/problem-fixes';
import { toastManager } from '../ui/toast-manager';
import { elementHash, navigate, timelineHash, writingHash } from '../core/router';
import { DOTS, cardStep, guideElements, newestOf, placeIdOf, unplacedCharacters, type Dots, type StepId } from '../core/guide';
import { advancePath, doorOf, pathShowing, setDoor, startPath } from '../core/guide-path';
import { isStoryNarrative } from '../core/narrative-kind';
import { isPartialSlice } from '../core/provenance';
import { hasFolderMode } from '../core/capabilities';
import { mayAdd, mayChange } from '../core/may-change';
import { isMoppetopiaOpen } from '../core/moppetopia';
import { getWritingLabels } from './writing-helpers';
import { labelStoryFromCard, stampPathNotesSeen } from '../ui/guide-note';
import { makeFromSquare } from '../ui/home-grid-make';
import { justNowIn, placeIn, promiseFor, undoJustNow, writeBetween } from '../ui/home-grid-place';
import { buildGridPicture, gridInput, type GridPicture } from './home-grid-picture';
import { arrivalOf } from '../core/home-grid';
import { plusWord, type PlusSquare } from './home-grid-view';
import { selectedIn, wireGridActs } from './home-grid-acts';
import { GRID_OPEN_ATTR, afterPress, gridClosed, openKindList, watchLeave } from './home-grid-kinds';
import { bringInWays } from './home-guide';
import { homeCentre } from './home-picture';
import { openWebOn } from '../ui/open-web';
import { typeName } from '../core/type-words';
import type { ToastManager } from '../ui/toast-manager';

/** What takes focus after the next draw, by a selector the new card answers to. */
let focusAfter: string | null = null;

const nameOf = (el: Element | null | undefined): string => {
  const n = typeof el?.name === 'string' ? el.name.trim() : '';
  return n || (el ? `this ${typeName(el.type)}` : '');
};

/** The plain + square: no kind named, a list of kinds on a press. */
const PLAIN_PLUS: PlusSquare = { type: null, word: 'add' };

/**
 * Where the grid acts: a + square and lit targets. Never on the demo, Moppetopia or a world this
 * reader only views; there a press opens nothing but the selection's Open line.
 */
export function gridActsIn(worldId: string): boolean {
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  return entry?.demo !== true && !isMoppetopiaOpen(worldId) && mayAdd(entry);
}

interface Speech {
  /** The step's sentence. */
  line: string;
  /** How to do it, one line. */
  hint?: string;
  /** What the step before made possible: sentences with an optional link. */
  recap: { text: string; link?: { label: string; run: () => void; role: string } }[];
  /** The + square's kind, or null for none named (a plain +). */
  plus: ElementType | null;
  /** The act as a button, when the grid is not drawn. */
  fallback?: { label: string; run: () => void; role: string };
  /** The card's line once the grid gives way, up to its link to the Web ("…, or see the whole world in "). */
  handOver: string;
}

const withButton = (act: string): string => `${act} with this button, or see the whole world in `;
const thenWeb = (line: string): string => `${line} See the whole world in `;

/** What the card says at a step, read from the world. */
function speak(step: StepId, dots: Dots, worldId: string): Speech {
  const s = getState();
  const entry = s.registry.worlds.find(w => w.id === worldId);
  const els = guideElements(s.data.elements);
  const ofType = (t: string) => els.filter(e => e.type === t);
  const mine = (e: Element) => mayChange(entry, e);
  const byId = new Map(els.map(e => [e.id, e] as const));
  const recap: Speech['recap'] = [];
  const open = (el: Element) => ({ label: `Open ${nameOf(el)}`, role: 'open-element', run: () => navigate(elementHash(worldId, el.id)) });
  const make = (type: ElementType) => withButton(`Make ${stepWord(type)}`);

  switch (step) {
    case 'someone':
      return { line: 'Start with someone.', hint: 'Press the + and type a name.', recap, plus: 'character',
        fallback: { label: 'Create a Character', role: 'create-character', run: () => focusPlus() }, handOver: make('character') };
    case 'placed': {
      const location = newestOf(ofType('location'));
      const someone = newestOf(ofType('character'));
      if (!location) {
        return { line: `Now somewhere for ${nameOf(someone)} to be.`, hint: 'Press the + and type a name.', recap, plus: 'location',
          fallback: { label: 'Create a Location', role: 'create-location', run: () => focusPlus() }, handOver: make('location') };
      }
      const free = newestOf(unplacedCharacters(els).filter(mine));
      const place = newestOf(ofType('location').filter(l => free && writeBetween(free.id, l.id)));
      if (free && place) {
        const w = writeBetween(free.id, place.id)!;
        const act = `Place ${nameOf(free)} in ${nameOf(place)}`;
        return {
          line: `${promiseFor(w, free, place)}.`,
          hint: `Drag ${nameOf(free)} onto ${nameOf(place)}, or press ${nameOf(free)}, then ${nameOf(place)}.`,
          recap, plus: null,
          fallback: { label: act, role: 'place', run: () => void drop(worldId, free.id, place.id) },
          handOver: withButton(act),
        };
      }
      // Only Characters whose place is gone: the field is someone's data, never overwritten.
      const gone = newestOf(ofType('character').filter(c => mine(c) && placeIdOf(c) && !byId.has(placeIdOf(c)!)));
      if (gone) {
        const line = `${nameOf(gone)}'s place was deleted.`;
        return { line, recap: [{ text: '', link: open(gone) }], plus: null, handOver: thenWeb(line) };
      }
      return { line: 'Make someone of your own to place.', hint: 'Press the + and type a name.', recap, plus: 'character',
        fallback: { label: 'Create a Character', role: 'create-character', run: () => focusPlus() },
        handOver: withButton('Make someone of your own to place') };
    }
    case 'happened': {
      const undated = newestOf(ofType('event').filter(e => dateOf(e) === null));
      if (undated) recap.push({ text: `Give ${nameOf(undated)} a year to see it on the chart.`, link: open(undated) });
      return { line: 'Something happened in your world.', hint: 'Press the + and give it a name and a year.', recap, plus: 'event',
        fallback: { label: 'Create an Event', role: 'create-event', run: () => focusPlus() }, handOver: make('event') };
    }
    case 'story': {
      const dated = newestOf(ofType('event').filter(e => dateOf(e) !== null));
      if (dated) recap.push({ text: `${nameOf(dated)} is on the chart at year ${dateOf(dated)}.`, link: { label: 'See it on the chart', role: 'open-chart', run: () => navigate(timelineHash(worldId, dated.id)) } });
      return { line: 'Tell a story in your world.', hint: 'Press the + and give it a title.', recap, plus: 'narrative',
        fallback: { label: 'Start a story', role: 'create-story', run: () => focusPlus() }, handOver: make('narrative') };
    }
    default: {
      const tale = newestOf(ofType('narrative').filter(n => isStoryNarrative(n) && (n as { supertype?: unknown }).supertype !== 'Chronicle'));
      const event = newestOf(ofType('event'));
      if (tale && event && writeBetween(event.id, tale.id) && mine(tale)) {
        const w = writeBetween(event.id, tale.id)!;
        recap.push({ text: `Drag ${nameOf(event)} onto ${nameOf(tale)}: ${promiseFor(w, tale, event)}.` });
      }
      if (tale) recap.push({ text: '', link: { label: 'Open the writing room', role: 'open-writing', run: () => navigate(writingHash(worldId, tale.id)) } });
      const line = dots.copy ? 'That is a world. Keep making.' : 'That is a world. Keep it, or keep making.';
      return { line, recap, plus: null, handOver: thenWeb(line) };
    }
  }
}

/** The + square, focused and opened for a name (the fallback's own way in). */
function focusPlus(): void {
  const plus = document.querySelector<HTMLElement>('[data-role="guide-block"] [data-grid-plus]');
  plus?.click();
}

/**
 * Whether this member may place `from` on `to` now: the grid acts here, the pair writes, and the
 * element written is one this member may change. Asked again at the press (Place, a drop), never
 * only when the target was lit: a role can change between the light and the press.
 */
export function mayPlace(worldId: string, from: string, to: string): boolean {
  if (!gridActsIn(worldId)) return false;
  const w = writeBetween(from, to);
  if (!w) return false;
  const s = getState();
  const on = s.data.elements.find(e => e.id === w.on);
  return !!on && mayChange(s.registry.worlds.find(x => x.id === worldId), on);
}

async function drop(worldId: string, from: string, to: string): Promise<void> {
  if (!mayPlace(worldId, from, to)) return;
  focusAfter = `[data-grid-id="${from}"]`;
  const r = await placeIn(worldId, from, to);
  if (r !== 'wrote') focusAfter = null;
}

/**
 * A line under the grid that a press can speak in: a promise with its Place button, or that a pair
 * cannot be linked. `base` is what it says otherwise (the card's step line; nothing on Home's grid).
 */
function sayer(line: HTMLElement, base: () => string): (text: string | null, place?: () => void) => void {
  return (text, place) => {
    line.innerHTML = '';
    if (text === null) { line.textContent = base(); line.removeAttribute('data-said'); return; }
    line.setAttribute('data-said', place ? 'promise' : 'note');
    line.append(document.createTextNode(`${text}.`));
    if (place) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'atlas-btn-primary atlas-home-grow-place';
      b.setAttribute('data-action', 'grid-place');
      b.textContent = 'Place';
      b.addEventListener('click', place);
      line.append(document.createTextNode(' '), b);
    }
  };
}

/** The element the Web opens on, for "the whole world in the Web": Home's picture's centre, else the newest. */
function webCentre(worldId: string): string | null {
  const els = getState().data.elements;
  return homeCentre(worldId, JSON.stringify(els)) ?? newestOf(guideElements(els))?.id ?? null;
}

export interface GrowBlock {
  section: HTMLElement;
  mount(): void;
  destroy(): void;
}

export function buildGrowBlock(dots: Dots, worldId: string, toasts: ToastManager, onDismiss: () => void, onHandOver: () => void = () => {}): GrowBlock {
  const s = getState();
  const entry = s.registry.worlds.find(w => w.id === worldId);
  const step = cardStep(dots, entry?.guide_step);
  const may = mayAdd(entry);
  const said = speak(step, dots, worldId);

  const section = document.createElement('section');
  section.className = 'atlas-home-onboarding atlas-guide-block atlas-home-grow';
  section.setAttribute('data-role', 'guide-block');
  section.setAttribute('data-state', 'path');
  section.setAttribute('data-step', step);
  // The card carries the keep-safe ways: the home holds its keep-safe card back (one voice for a copy).
  if (step === 'copy' && !dots.copy) section.setAttribute('data-holds-copy', '');

  // The head: where on the path, the five dots, the ×. One line of one height, whatever the step.
  const head = document.createElement('div');
  head.className = 'atlas-home-grow-head';
  const at = document.createElement('span');
  at.className = 'atlas-home-grow-at';
  const i = DOTS.findIndex(d => d.id === step);
  at.textContent = `Step ${i + 1} of ${DOTS.length}`;
  const marks = document.createElement('span');
  marks.className = 'atlas-home-grow-dots';
  marks.setAttribute('role', 'list');
  marks.setAttribute('aria-label', 'Your world so far');
  for (const d of DOTS) {
    const dot = document.createElement('span');
    dot.className = 'atlas-home-grow-dot' + (dots[d.id] ? ' is-lit' : '') + (d.id === step ? ' is-next' : '');
    dot.setAttribute('role', 'listitem');
    dot.setAttribute('data-dot', d.id);
    dot.setAttribute('data-lit', String(dots[d.id]));
    dot.setAttribute('aria-label', `${d.label}, ${dots[d.id] ? 'done' : d.id === step ? 'now' : 'not yet'}`);
    marks.appendChild(dot);
  }
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'atlas-home-have-dismiss';
  x.setAttribute('data-action', 'cards-dismiss');
  x.title = 'Hide these for this world. They come back from Settings, World.';
  x.setAttribute('aria-label', 'Hide these for this world');
  x.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
  x.addEventListener('click', onDismiss);
  head.append(at, marks, x);
  section.appendChild(head);

  // Under the grid: the step's line (a press's promise speaks in it), then the hint.
  const line = document.createElement('p');
  line.className = 'atlas-home-grow-line';
  line.setAttribute('data-role', 'grow-line');
  line.setAttribute('aria-live', 'polite');
  line.textContent = said.line;
  const say = sayer(line, () => said.line);
  let hint: HTMLElement | null = null;
  if (said.hint && may) {
    hint = document.createElement('p');
    hint.className = 'atlas-home-grow-hint';
    hint.textContent = said.hint;
  }

  // The grid, right under the head: the + square carries the step's kind, or is a plain + where none is named.
  const input = gridInput(getState().data.elements, getState().data.elements);
  const plus: PlusSquare | null = !may ? null
    : said.plus ? { type: said.plus, word: stepWord(said.plus) }
      : gridActsIn(worldId) ? PLAIN_PLUS : null;
  const fallbackSlot = document.createElement('div');
  fallbackSlot.className = 'atlas-home-grow-fallback';
  fallbackSlot.hidden = true;
  if (said.fallback && may) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-btn-primary';
    b.setAttribute('data-step-action', said.fallback.role);
    b.textContent = said.fallback.label;
    b.addEventListener('click', () => {
      // With no grid, a make opens the create dialog for the step's kind, as the card did before.
      if (said.plus && !section.querySelector('[data-grid-plus]')) void openCreate(said.plus, worldId, toasts);
      else said.fallback!.run();
    });
    fallbackSlot.appendChild(b);
  }
  // The grid gave way (decided at mount, never at build): the hint goes, and the line says what the
  // button does and where the whole world is.
  const handOver = (): void => {
    fallbackSlot.hidden = false;
    hint?.remove();
    hint = null;
    line.innerHTML = '';
    line.append(document.createTextNode(said.fallback && may ? said.handOver : thenWeb(said.line)));
    const web = document.createElement('button');
    web.type = 'button';
    web.className = 'atlas-btn-link';
    web.setAttribute('data-action', 'grow-web');
    web.textContent = 'the Web';
    web.addEventListener('click', () => { const id = webCentre(worldId); if (id) openWebOn(worldId, id); });
    line.append(web, document.createTextNode('.'));
    onHandOver();
  };
  let picture: GridPicture | null = null;
  if (input) {
    picture = buildGridPicture(input, plus, handOver, host => {
      wirePlus(host, worldId, plus);
      return wireActs(host, worldId, input, section, say);
    });
    section.appendChild(picture.section);
  }
  section.appendChild(line);
  if (hint) section.appendChild(hint);
  section.appendChild(fallbackSlot);

  appendOpenAndJustNow(section, worldId);

  for (const r of said.recap) {
    const p = document.createElement('p');
    p.className = 'atlas-home-grow-recap';
    if (r.text) p.append(document.createTextNode(r.text + (r.link ? ' ' : '')));
    if (r.link) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'atlas-btn-link';
      b.setAttribute('data-step-action', r.link.role);
      b.textContent = r.link.label;
      b.addEventListener('click', r.link.run);
      p.appendChild(b);
    }
    section.appendChild(p);
  }

  if (step === 'copy') section.appendChild(keepWays(dots, worldId, toasts));

  // Bring it in, quiet, under everything: today's three ways, opened in place.
  const bring = document.createElement('div');
  bring.className = 'atlas-home-grow-bring';
  const open = doorOf(worldId) === 'bring';
  const ask = document.createElement('p');
  ask.className = 'atlas-home-grow-bring-ask';
  ask.append(document.createTextNode('Already have something written down? '));
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'atlas-btn-link';
  toggle.setAttribute('data-action', 'grow-bring');
  toggle.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Hide the ways' : 'Bring it in';
  toggle.addEventListener('click', () => { focusAfter = open ? '[data-action="grow-bring"]' : '[data-bring-action]'; setDoor(worldId, open ? null : 'bring'); });
  ask.appendChild(toggle);
  bring.appendChild(ask);
  if (open) bring.appendChild(bringInWays(worldId, toasts));
  section.appendChild(bring);

  return {
    section,
    mount(): void {
      // No grid at all (too big at any width): Home's centred picture, under the card (the code gate's C1).
      if (picture) picture.mount(); else handOver();
      if (focusAfter) {
        const t = section.querySelector<HTMLElement>(focusAfter);
        focusAfter = null;
        t?.focus({ preventScroll: true });
      }
    },
    destroy(): void { picture?.destroy(); },
  };
}

/** The selection's Open line (the near door to an element the card made), then what changed just now with its Undo. */
function appendOpenAndJustNow(section: HTMLElement, worldId: string): void {
  const openLine = document.createElement('p');
  openLine.className = 'atlas-home-grow-open';
  openLine.setAttribute('data-role', 'grow-open');
  section.appendChild(openLine);
  paintOpen(section, worldId, selectedIn(worldId), openLine);
  const j = justNowIn(worldId);
  if (!j) return;
  const row = document.createElement('p');
  row.className = 'atlas-home-grow-just';
  row.setAttribute('data-role', 'grow-just');
  const tag = document.createElement('span');
  tag.className = 'atlas-home-grow-just-tag';
  tag.textContent = 'just now';
  const text = document.createElement('span');
  text.textContent = j.sentence;
  const undo = document.createElement('button');
  undo.type = 'button';
  undo.className = 'atlas-btn-link atlas-home-grow-undo';
  undo.setAttribute('data-action', 'grow-undo');
  undo.textContent = 'Undo';
  undo.addEventListener('click', () => {
    focusAfter = '[data-role="grow-line"], [data-role="home-grid"] [data-grid-id]';
    void undoJustNow(worldId).then(r => {
      // The field moved since the line was drawn: say so, and draw again without the line.
      if (r === 'nothing') { focusAfter = null; toastManager.info('Nothing to undo: that changed since.'); patchSlice('data', { ...getState().data }); }
    });
  });
  row.append(tag, text, undo);
  section.appendChild(row);
}

type Input = NonNullable<ReturnType<typeof gridInput>>;

/** The grid's acts on a drawn host: one wiring for the card's grid and Home's own. */
function wireActs(host: HTMLElement, worldId: string, input: Input, section: HTMLElement, say: ReturnType<typeof sayer>): () => void {
  const el = (id: string) => getState().data.elements.find(e => e.id === id);
  return wireGridActs(host, {
    worldId,
    targetsOf: id => targetsOf(id, input, worldId),
    writeOf: (from, to) => {
      const w = writeBetween(from, to);
      return w ? { promise: promiseFor(w, el(w.on), el(w.target)), holds: w.holds } : null;
    },
    cannotLink: (from, to) => {
      if (!gridActsIn(worldId)) return null;
      const a = el(from);
      const b = el(to);
      if (!a || !b || dragField(a.type, b.type)) return null;
      return `${nameOf(a)} and ${nameOf(b)} cannot be linked by placing`;
    },
    say,
    drop: (from, to) => void drop(worldId, from, to),
    open: id => navigate(elementHash(worldId, id)),
    onSelect: id => paintOpen(section, worldId, id),
  });
}

/**
 * Home's picture after the path (or with the card closed): the same grid with its acts and a plain +;
 * past its height, `onHandOver` draws today's centred picture in its place. Null when the world is too
 * big for a grid at any width, or has nothing to draw and no + to offer.
 */
export function buildHomeGrid(worldId: string, onHandOver: () => void): GrowBlock | null {
  const els = getState().data.elements;
  const input = gridInput(els, els);
  const acts = gridActsIn(worldId);
  if (!input || (input.count === 0 && !acts)) return null;
  const section = document.createElement('section');
  section.className = 'atlas-home-grow-picture';
  section.setAttribute('data-role', 'home-grow-picture');
  const plus = acts ? PLAIN_PLUS : null;
  const sayLine = document.createElement('p');
  sayLine.className = 'atlas-home-grow-line atlas-home-grid-say';
  sayLine.setAttribute('data-role', 'grid-say');
  sayLine.setAttribute('aria-live', 'polite');
  const say = sayer(sayLine, () => '');
  const picture = buildGridPicture(input, plus, () => { section.hidden = true; onHandOver(); }, host => {
    wirePlus(host, worldId, plus);
    return wireActs(host, worldId, input, section, say);
  });
  section.append(picture.section, sayLine);
  // The newest element linked to nothing in the world, said once (the dim squares are the list).
  const loose = input.ids.filter(id => input.names.isLoose(id))
    .map(id => els.find(e => e.id === id)!)
    .filter(Boolean)
    .sort((a, b) => arrivalOf(b) - arrivalOf(a))[0];
  if (loose) {
    const p = document.createElement('p');
    p.className = 'atlas-home-grow-recap';
    p.setAttribute('data-role', 'grow-loose');
    p.textContent = `${nameOf(loose)} isn't connected to anything yet.`;
    section.appendChild(p);
  }
  appendOpenAndJustNow(section, worldId);
  return {
    section,
    mount(): void {
      picture.mount();
      if (focusAfter) {
        const t = section.querySelector<HTMLElement>(focusAfter);
        focusAfter = null;
        t?.focus({ preventScroll: true });
      }
    },
    destroy(): void { picture.destroy(); },
  };
}

/** The squares a selected one can go to: the pair's write in the world as drawn, and only on what this member may change. */
function targetsOf(id: string, input: Input, worldId: string): string[] {
  if (!gridActsIn(worldId)) return [];
  const s = getState();
  const entry = s.registry.worlds.find(w => w.id === worldId);
  const byId = new Map(s.data.elements.map(e => [e.id, e] as const));
  const out: string[] = [];
  for (const other of input.ids) {
    if (other === id) continue;
    const w = writeBetween(id, other);
    if (!w) continue;
    const on = byId.get(w.on);
    if (on && mayChange(entry, on)) out.push(other);
  }
  return out;
}

function paintOpen(section: HTMLElement, worldId: string, id: string | null, el?: HTMLElement): void {
  const line = el ?? section.querySelector<HTMLElement>('[data-role="grow-open"]');
  if (!line) return;
  line.innerHTML = '';
  const target = id ? getState().data.elements.find(e => e.id === id) : null;
  if (!target) return;
  const a = document.createElement('a');
  a.href = elementHash(worldId, target.id);
  a.className = 'atlas-btn-link';
  a.setAttribute('data-action', 'grow-open');
  a.textContent = `Open ${nameOf(target)}`;
  line.appendChild(a);
}

/**
 * The + square. A named + (the path's step) opens a name box in place (and a year for an Event); a
 * plain + opens the list of kinds first, and a kind picked opens the same box. Enter keeps, Escape
 * leaves nothing made. Only a named + starts the path, and only while the path showed at the press:
 * a plain + never writes the pointer, so a world past the path gets no card back from a make.
 */
function wirePlus(host: HTMLElement, worldId: string, plus: PlusSquare | null): void {
  const cell = host.querySelector<HTMLElement>('[data-grid-plus]');
  if (!cell || !plus) return;
  const named = plus.type as ElementType | null;
  cell.setAttribute('role', 'button');
  cell.tabIndex = 0;
  if (named) cell.setAttribute('aria-label', `Make ${stepWord(named)}`);
  else {
    cell.setAttribute('aria-label', 'Add');
    cell.setAttribute('aria-haspopup', 'menu');
    cell.setAttribute('aria-expanded', 'false');
  }
  const openBox = (type: ElementType, startsPath: boolean): void => {
    if (cell.querySelector('input')) return;
    const form = document.createElement('form');
    form.className = 'atlas-home-grid-make';
    // While it is open, a resize or a sync redraw waits (the redraw would take it).
    form.setAttribute(GRID_OPEN_ATTR, '');
    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'atlas-input';
    name.setAttribute('aria-label', `Name of ${stepWord(type)}`);
    name.placeholder = 'Name';
    form.appendChild(name);
    let year: HTMLInputElement | null = null;
    if (type === 'event') {
      year = document.createElement('input');
      year.type = 'number';
      year.className = 'atlas-input';
      year.setAttribute('aria-label', 'Year');
      year.placeholder = 'Year';
      const latest = latestYear();
      if (latest !== null) year.value = String(latest);
      form.appendChild(year);
    }
    const note = document.createElement('span');
    note.className = 'atlas-home-grid-make-note';
    note.setAttribute('role', 'status');
    form.appendChild(note);
    /**
     * Nothing made, the box gone (Escape, a press outside it, the focus leaving it): a hold never
     * outlives the person's attention. Escape gives the focus back to the +; a press elsewhere acts
     * as a press, so the redraw that waited runs only after it has landed.
     */
    let closed = false;
    const close = (how: 'escape' | 'press' | 'blur'): void => {
      if (closed) return;
      closed = true;
      unwatch();
      form.remove();
      cell.classList.remove('is-making');
      if (how === 'escape') { cell.focus(); gridClosed(host); }
      else if (how === 'press') afterPress(() => gridClosed(host));
      else setTimeout(() => gridClosed(host), 0);
    };
    const unwatch = watchLeave(form, t => cell.contains(t), how => close(how));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const n = name.value.trim();
      if (!n) { note.textContent = 'Type a name first'; name.focus(); return; }
      const y = year && year.value.trim() !== '' ? Number(year.value) : null;
      // The make's own writes redraw the home: the box no longer holds a redraw back.
      closed = true;
      unwatch();
      form.removeAttribute(GRID_OPEN_ATTR);
      // The path's start is the named + only (a press, never a render): written here, not when the
      // box opens, since the registry write redraws the home and would take the box.
      if (startsPath) startPath(worldId);
      // Asked after that redraw, so the draw that shows the new square is the one that takes it.
      focusAfter = '[data-grid-plus], [data-role="home-grid"] [data-grid-id]:last-of-type';
      void makeFromSquare(type, n, Number.isFinite(y) ? y : null).then(made => {
        if (made && type === 'narrative') {
          // The label is a second write and a second redraw: the focus is asked for it too.
          focusAfter = '[data-grid-plus], [data-role="home-grid"] [data-grid-id]:last-of-type';
          // A label that wrote nothing drew nothing: the ask goes, so no later draw takes the focus.
          void labelStoryFromCard(worldId, made.id, getWritingLabels(worldId).l1).finally(() => { focusAfter = null; });
        }
      }).catch(err => {
        // A make that failed is said, never silent (the code gate's SHOULD).
        focusAfter = null;
        showProblem(err, { doing: 'making the element', toasts: toastManager });
      });
      gridClosed(host);
    });
    form.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); close('escape'); }
      // Two inputs and no submit button: a browser submits on Enter in neither, so both ask (the code gate's C3).
      if (e.key === 'Enter' && (e.target === year || e.target === name)) { e.preventDefault(); form.requestSubmit(); }
    });
    cell.classList.add('is-making');
    cell.appendChild(form);
    name.focus();
  };
  const press = (): void => {
    if (cell.querySelector('form')) return;
    if (named) { openBox(named, pathShowing(worldId)); return; }
    if (host.querySelector('.atlas-home-grid-kinds')) return;
    openKindList(host, cell, kind => {
      if (kind === 'other') void openAnother(cell);
      else openBox(kind, false);
    });
  };
  cell.addEventListener('click', e => {
    // A press on the + while its list was open closed the list: this click leaves it closed.
    if (cell.hasAttribute('data-kinds-just-closed')) { cell.removeAttribute('data-kinds-just-closed'); return; }
    if (!(e.target as HTMLElement).closest('form')) press();
  });
  cell.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target === cell) { e.preventDefault(); press(); }
  });
}

/**
 * "Another kind…": the New element dialog, staying on Home (the new square is the plain +'s place).
 * Its type is the dialog's own default; a cancel gives the focus back to the plain +. A Map made
 * there is map space and draws no square: the dialog's own result says what was made.
 */
async function openAnother(cell: HTMLElement): Promise<void> {
  // Focused first, so the dialog's close gives the focus back here: the + as it is drawn now (a
  // redraw that waited on the list has run, and may have replaced the square the list opened from).
  const live = cell.isConnected ? cell : document.querySelector<HTMLElement>('[data-role="home-grid"] [data-grid-plus]');
  live?.focus({ preventScroll: true });
  const { ElementCreateModal } = await import('../ui/element-create-modal');
  new ElementCreateModal(toastManager, {
    suppressNavigate: true,
    afterCreate: id => {
      queueMicrotask(() => {
        const made = document.querySelector<HTMLElement>(`[data-role="home-grid"] [data-grid-id="${CSS.escape(id)}"]`)
          ?? document.querySelector<HTMLElement>('[data-role="home-grid"] [data-grid-plus]');
        made?.focus({ preventScroll: true });
      });
    },
  }).open();
}

function latestYear(): number | null {
  let best: number | null = null;
  for (const e of getState().data.elements) {
    const d = dateOf(e);
    if (d !== null && (best === null || d > best)) best = d;
  }
  return best;
}

async function openCreate(type: ElementType, worldId: string, toasts: ToastManager): Promise<void> {
  startPath(worldId);
  const { ElementCreateModal } = await import('../ui/element-create-modal');
  new ElementCreateModal(toasts, {
    initialType: type, suppressNavigate: true,
    ...(type === 'event' ? { temporalContext: { defaultDate: latestYear() ?? undefined } } : {}),
    ...(type === 'narrative' ? { afterCreate: (id: string, t: ElementType) => { if (t === 'narrative') void labelStoryFromCard(worldId, id, getWritingLabels(worldId).l1); } } : {}),
  }).open();
}

/** The copy card's keep ways (today's three) and Done. */
function keepWays(dots: Dots, worldId: string, toasts: ToastManager): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-guide-card-actions atlas-home-grow-keep';
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  const add = (verb: string, label: string, primary: boolean, run: (b: HTMLButtonElement) => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = primary ? 'atlas-btn-primary' : 'atlas-btn-ghost';
    b.setAttribute('data-step-action', verb);
    b.textContent = label;
    b.addEventListener('click', () => run(b));
    row.appendChild(b);
  };
  if (!dots.copy) {
    add('download', 'Download', true, async b => {
      const now = getState().registry.worlds.find(w => w.id === worldId);
      if (!now || b.disabled) return;
      const { downloadWorldFromClick } = await import('../ui/download-world');
      await downloadWorldFromClick(now, toasts, on => { b.disabled = on; b.textContent = on ? 'Saving…' : 'Download'; });
    });
    if (hasFolderMode()) {
      add('move', 'Move to a folder', false, async () => {
        const now = getState().registry.worlds.find(w => w.id === worldId);
        if (!now) return;
        const { MoveBrowserWorldModal } = await import('../ui/move-browser-world-modal');
        new MoveBrowserWorldModal(now, toasts).open();
      });
    }
    if (entry && entry.state !== 'api-linked' && !entry.copy_of && !isPartialSlice(getState().active?.meta)) {
      add('online', 'Make online', false, async () => {
        const { MakeOnlineModal } = await import('../ui/make-online-modal');
        new MakeOnlineModal(toasts).open();
      });
    }
  }
  add('done', 'Done', dots.copy, () => {
    if (advancePath(worldId, 'done') === 'done') stampPathNotesSeen();
  });
  return row;
}

/** The + square's word on the path: the story step makes "a story" (a Narrative labelled as the world's first writing label). */
function stepWord(type: ElementType): string {
  return type === 'narrative' ? 'a story' : plusWord(type);
}
