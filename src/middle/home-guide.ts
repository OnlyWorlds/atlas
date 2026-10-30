/**
 * The guide's block on the home (#964): a new world's first screen as two
 * doors, and the path as a bar that shows and one card that leads.
 *
 *   The head row is one fixed-height row in every state: a Back slot, the
 *   heading, the ×. The doors open in place; Back returns to them.
 *
 *   The bar is the five dots as lit from the world (`core/guide.ts`), a list
 *   nothing on which is pressable. The card under it speaks for the current
 *   step: a sentence and its buttons, and Next once the step is done, so the
 *   person confirms each step with a press.
 *
 *   Every write from the card is a press: into an empty field only, inside the
 *   element's lock, on the ids the card drew (`ui/guide-note.ts`).
 *
 * Contract: a design note of 2026-10-29 (a new world's first screen, draft 2,
 * with the states sheet's §7).
 */

import { dateOf } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { getState } from '../core/state';
import { elementHash, importHash, navigate, timelineHash, writingHash } from '../core/router';
import {
  DOTS, guideElements, newestOf, nextStep, placeIdOf, stepDone, unplacedCharacters,
  type DotId, type Dots, type StepId,
} from '../core/guide';
import { advancePath, setDoor, startPath, type Door } from '../core/guide-path';
import { hasFolderMode } from '../core/capabilities';
import { isPartialSlice } from '../core/provenance';
import { linkIdsOf } from '../core/link-ids';
import { typeName } from '../core/type-words';
import { isStoryNarrative } from '../core/narrative-kind';
import { getTierForNarrative, getWritingLabels } from './writing-helpers';
import { ElementCreateModal } from '../ui/element-create-modal';
import { labelStoryFromCard, placeFromCard, stampPathNotesSeen, wereThereFromCard } from '../ui/guide-note';
import type { ToastManager } from '../ui/toast-manager';

/** What the block shows: the doors, a door's content, or the path at a step. */
export type BlockState =
  | { kind: 'doors' }
  | { kind: 'bring' }
  | { kind: 'path'; step: StepId; back: boolean };

// ---- Focus across the home's rebuild (#964's G11) ----

/** What takes focus once the block is drawn again, by a stable attribute; null leaves focus alone. */
let focusAfterDraw: string | null = null;
/** A door was pressed: bring the block into view after the draw (a phone, §5 3). */
let scrollAfterDraw = false;
/** The world a room's Back asked for; null for the home's own presses. */
let askWorld: string | null = null;
let focusWired = false;

// The home that grows: the card's own buttons (the fallback act, a recap link, the keep ways).
const CARD_BUTTON = '[data-role="guide-block"] :not([hidden]) > [data-step-action]';
// A grid square and the + square keep their focus across the home's rebuilds too (the home that grows).
const FOCUS_KEYS = ['data-step-action', 'data-guide-door', 'data-bring-action', 'data-action', 'data-grid-id', 'data-grid-plus'] as const;

/**
 * The control focus is on inside the block, as a selector the rebuilt block answers to; null when
 * focus is elsewhere. Read before the home clears itself, so a rebuild gives focus back to the same
 * control, never another (the code gate's C9).
 */
export function blockFocusKey(): string | null {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement) || !el.closest('[data-role="guide-block"]')) return null;
  for (const attr of FOCUS_KEYS) {
    const v = el.getAttribute(attr);
    if (v) return `[${attr}="${v}"]`;
  }
  return null;
}

/**
 * After the home appended the block: the focus a press asked for, else the control that held it
 * before the rebuild (a card button that is gone, as after a dialog's own write: the card's first),
 * and the scroll a door asked for.
 */
export function settleAfterDraw(block: HTMLElement | null, kept: string | null = null): void {
  // An ask made for one world is never taken by another's home (gate 2's G8: a switch before the draw).
  const mine = askWorld === null || askWorld === getState().active?.worldId;
  const asked = mine ? focusAfterDraw : null;
  const scroll = mine && scrollAfterDraw;
  focusAfterDraw = null;
  scrollAfterDraw = false;
  askWorld = null;
  if (!block) return;
  // The block's own mount already placed the focus a press asked for (the grow card's Bring it in, a
  // make): the control held before the rebuild never takes it back (the e2e's red at Bring it in).
  if (!asked && kept && document.activeElement instanceof HTMLElement && document.activeElement !== document.body
    && block.contains(document.activeElement)) return;
  const target = asked ? block.querySelector<HTMLElement>(asked) ?? (asked === NEXT_BUTTON ? block.querySelector<HTMLElement>(CARD_BUTTON) : null)
    : kept ? block.querySelector<HTMLElement>(kept) ?? (kept.startsWith('[data-step-action') ? block.querySelector<HTMLElement>(CARD_BUTTON) : null)
    : null;
  target?.focus({ preventScroll: true });
  // The grid draws once the home is laid out (its width), which can be a frame or two after this:
  // a room's Back that found nothing yet looks again for a few frames (the code gate's C6).
  if (!target && asked === NEXT_BUTTON) {
    const world = getState().active?.worldId;
    let tries = 6;
    const again = (): void => {
      if (!block.isConnected || getState().active?.worldId !== world) return;
      const t = block.querySelector<HTMLElement>(NEXT_BUTTON);
      if (t) { if (document.activeElement === document.body) t.focus({ preventScroll: true }); return; }
      if (--tries > 0) requestAnimationFrame(again);
    };
    requestAnimationFrame(again);
  }
  if (!scroll) return;
  const top = block.getBoundingClientRect().top;
  const bottom = (target ?? block).getBoundingClientRect().bottom;
  if (top < 0 || bottom > window.innerHeight) block.scrollIntoView({ block: 'start' });
}

// Where a room's Back lands (the code gate's C6): the grid's own Tab stop, else its + square.
const NEXT_BUTTON = '[data-role="home-grid"] [data-grid-id][tabindex="0"], [data-role="home-grid"] [data-grid-plus]';

/**
 * A room's Back to Grow your world (#975): the home's next draw focuses Next, else the card's first
 * button (the visit not stamped, another tab moved on), brought into view on a phone. The home that
 * draws no block drops the ask, and so does another world's home.
 */
export function askFocusAfterHome(worldId: string): void {
  focusAfterDraw = NEXT_BUTTON;
  scrollAfterDraw = true;
  askWorld = worldId;
}

/** A press asked for focus after its redraw: a press whose write landed nothing drew nothing, so the ask goes (the gate's C3). */
function dropAskAfter(run: void | Promise<unknown>): void {
  void Promise.resolve(run).finally(() => { focusAfterDraw = null; scrollAfterDraw = false; });
}

function wireFocusReturn(): void {
  if (focusWired) return;
  focusWired = true;
  // A dialog the card opened closed: focus back to the card's first button, unless the person moved on.
  document.addEventListener('atlas:modal-closed', () => {
    if (!cardOpenedDialog) return;
    cardOpenedDialog = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    document.querySelector<HTMLElement>(CARD_BUTTON)?.focus({ preventScroll: true });
  });
}
let cardOpenedDialog = false;

// ---- The block ----

export function buildGuideBlock(
  state: BlockState,
  dots: Dots,
  worldId: string,
  toasts: ToastManager,
  onDismiss: () => void,
): HTMLElement {
  wireFocusReturn();
  const section = document.createElement('section');
  section.className = 'atlas-home-onboarding atlas-home-have atlas-guide-block';
  section.setAttribute('data-role', 'guide-block');
  section.setAttribute('data-state', state.kind);
  if (state.kind === 'path') {
    section.setAttribute('data-step', state.step);
    // The card carries the keep-safe ways: the home holds its keep-safe card back (one voice for a copy).
    if (state.step === 'copy' && !dots.copy) section.setAttribute('data-holds-copy', '');
  }
  const back = state.kind === 'bring' || (state.kind === 'path' && state.back);
  const title = state.kind === 'path' ? 'Grow your world' : 'What do you have?';
  section.appendChild(headRow(title, back ? state.kind === 'bring' ? 'bring' : 'nothing' : null, worldId, onDismiss));

  if (state.kind === 'doors') section.appendChild(doors(worldId));
  else if (state.kind === 'bring') section.appendChild(bringInWays(worldId, toasts));
  else {
    section.appendChild(bar(dots, state.step, toasts));
    if (state.step !== 'done') section.appendChild(card(state.step, dots, worldId, toasts));
  }
  return section;
}

/** Back slot (collapsed when there is no Back), the heading, the ×: one row, one height, every state. */
function headRow(title: string, backFrom: Door | null, worldId: string, onDismiss: () => void): HTMLElement {
  const head = document.createElement('div');
  head.className = 'atlas-home-have-head atlas-guide-head';
  const slot = document.createElement('span');
  slot.className = 'atlas-guide-back-slot';
  if (backFrom) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-btn-link atlas-guide-back';
    b.setAttribute('data-action', 'guide-back');
    b.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">chevron_left</span><span>Back</span>';
    b.addEventListener('click', () => {
      focusAfterDraw = `[data-guide-door="${backFrom}"]`;
      setDoor(worldId, null);
    });
    slot.appendChild(b);
  }
  const h = document.createElement('h2');
  h.className = 'atlas-home-have-title';
  h.textContent = title;
  const x = document.createElement('button');
  x.type = 'button';
  x.className = 'atlas-home-have-dismiss';
  x.setAttribute('data-action', 'cards-dismiss');
  x.title = 'Hide these for this world';
  x.setAttribute('aria-label', 'Hide these for this world');
  x.innerHTML = '<span class="material-symbols-outlined" aria-hidden="true">close</span>';
  x.addEventListener('click', onDismiss);
  head.append(slot, h, x);
  return head;
}

function doors(worldId: string): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-guide-doors';
  const door = (id: Door, title: string, line: string, open: () => void): void => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-guide-door';
    b.setAttribute('data-guide-door', id);
    const t = document.createElement('span');
    t.className = 'atlas-guide-door-title';
    t.textContent = title;
    const l = document.createElement('span');
    l.className = 'atlas-guide-door-line';
    l.textContent = line;
    b.append(t, l);
    b.addEventListener('click', () => { scrollAfterDraw = true; open(); });
    wrap.appendChild(b);
  };
  door('nothing', 'Start from nothing', 'Make someone, give them somewhere, and grow it from there.', () => {
    // The press is the gesture: the path starts here, written in the handler, never in a render (G2).
    // The door first, quietly: the pointer's write redraws, and that first draw must already be the
    // path, or it takes the focus and the scroll this press asked for (the gate's C8).
    focusAfterDraw = CARD_BUTTON;
    setDoor(worldId, 'nothing', { quiet: true });
    startPath(worldId, { restart: true });
    setDoor(worldId, 'nothing');
  });
  // A folder only where this browser can open one, as Bring in's own rows.
  const what = hasFolderMode() ? 'A file, notes, a folder, or a world on OnlyWorlds.' : 'A file, notes, or a world on OnlyWorlds.';
  door('bring', 'Bring in a world I have', what, () => {
    focusAfterDraw = '[data-bring-action]';
    setDoor(worldId, 'bring');
  });
  return wrap;
}

export function bringInWays(worldId: string, toasts: ToastManager): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'atlas-guide-ways';
  let first = true;
  const way = (verb: string, label: string, line: string, run: () => void): void => {
    const row = document.createElement('div');
    row.className = 'atlas-guide-way';
    const b = document.createElement('button');
    b.type = 'button';
    b.className = first ? 'atlas-btn-primary' : 'atlas-btn-ghost';
    first = false;
    b.setAttribute('data-bring-action', verb);
    b.textContent = label;
    b.addEventListener('click', run);
    const l = document.createElement('p');
    l.className = 'atlas-home-have-line';
    l.textContent = line;
    row.append(b, l);
    wrap.appendChild(row);
  };
  way('file', 'Bring in a file',
    'Opens the Data room: drop a world file, OnlyWorlds JSON, or notes an AI assistant has turned into JSON. You review it before anything is added.',
    () => {
      // Back on the home with the world still empty, the block opens on Start from nothing (Titus's call).
      setDoor(worldId, 'nothing', { quiet: true });
      navigate(importHash(worldId));
    });
  if (hasFolderMode()) {
    way('folder', 'Open a folder', 'Opens a world folder where it is, from Atlas, another tool or your AI. Nothing is copied.', () => {
      void import('../setup/world-doors').then(m => m.pickAndOpenWorldFolder(toasts));
    });
  }
  way('download', 'Download a world', 'Downloads a full copy with its API key and PIN, and keeps the copy and the world in sync.', () => {
    void import('../setup/world-doors').then(m => m.runAddWorldAction('link-api', toasts));
  });
  return wrap;
}

// ---- The bar ----

const STATE_WORD = (lit: boolean, current: boolean): string => (lit ? 'done' : current ? 'now' : 'not yet');

function bar(dots: Dots, step: StepId, toasts: ToastManager): HTMLElement {
  const row = document.createElement('div');
  row.className = 'atlas-guide-strip';
  row.setAttribute('data-role', 'guide-strip');
  const marks = document.createElement('div');
  marks.className = 'atlas-guide-marks';
  marks.setAttribute('role', 'list');
  marks.setAttribute('aria-label', 'Your world so far');
  for (const d of DOTS) {
    const lit = dots[d.id];
    const current = d.id === step;
    const item = document.createElement('div');
    item.className = 'atlas-guide-mark' + (lit ? ' is-lit' : '') + (current ? ' is-next' : '');
    item.setAttribute('role', 'listitem');
    item.setAttribute('data-dot', d.id);
    item.setAttribute('data-lit', String(lit));
    item.setAttribute('aria-label', `${d.label}, ${STATE_WORD(lit, current)}`);
    item.innerHTML = '<span class="atlas-guide-dot" aria-hidden="true"></span><span class="atlas-guide-mark-label" aria-hidden="true"></span>';
    item.querySelector('.atlas-guide-mark-label')!.textContent = d.label;
    marks.appendChild(item);
  }
  row.appendChild(marks);

  // "Anything else": the create modal on any type, beside the path and not part of it; hovering
  // it with a mouse pulses the sidebar +, the permanent home of creating (a tap never pins it, conv. 141).
  const any = document.createElement('button');
  any.type = 'button';
  any.className = 'atlas-btn-link atlas-guide-any';
  any.setAttribute('data-create-any', '');
  any.textContent = 'Anything else';
  any.addEventListener('click', () => new ElementCreateModal(toasts, { suppressNavigate: true }).open());
  const sidebarCreate = (): HTMLElement | null => document.querySelector('[data-action="create-element"]');
  any.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') sidebarCreate()?.classList.add('atlas-create-pulse'); });
  any.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') sidebarCreate()?.classList.remove('atlas-create-pulse'); });
  row.appendChild(any);
  return row;
}

// ---- The card ----

interface CardAction {
  verb: string;
  label: string;
  run: (button: HTMLButtonElement) => void | Promise<unknown>;
  /** A short clause under the button, saying where this way puts things. */
  hint?: string;
  /** The press stays on the home and redraws the card (Next, Place, Were there): focus goes to the new card's button. */
  stays?: boolean;
}

/** An element's name as text; an empty one reads as its type ("this Character"). */
function nameOf(el: Element | null | undefined, type: string): string {
  const name = typeof el?.name === 'string' ? el.name.trim() : '';
  return name || `this ${typeName(type)}`;
}

const STEP_LABEL: Record<DotId, string> = Object.fromEntries(DOTS.map(d => [d.id, d.label])) as Record<DotId, string>;

/** The world's latest whole-number date: what a new Event's year field starts at. None: the field starts empty. */
function latestDate(els: readonly Element[]): number | undefined {
  let best: number | null = null;
  for (const e of els) {
    const d = dateOf(e);
    if (d !== null && (best === null || d > best)) best = d;
  }
  return best ?? undefined;
}

function card(step: DotId, dots: Dots, worldId: string, toasts: ToastManager): HTMLElement {
  const els = guideElements(getState().data.elements);
  const entry = getState().registry.worlds.find(w => w.id === worldId);
  const ofType = (t: string) => els.filter(e => e.type === t);
  const byId = new Map(els.map(e => [e.id, e] as const));
  const locationIds = new Set(ofType('location').map(e => e.id));
  const placedChars = ofType('character').filter(c => locationIds.has(placeIdOf(c) ?? ''));
  const actions: CardAction[] = [];
  let line = '';

  const create = (type: 'character' | 'location' | 'event' | 'narrative', extra: Partial<ConstructorParameters<typeof ElementCreateModal>[1]> = {}): void => {
    cardOpenedDialog = true;
    new ElementCreateModal(toasts, { initialType: type, suppressNavigate: true, ...extra }).open();
  };
  const next = (): CardAction => {
    const to = nextStep(step, dots);
    return {
      verb: 'next',
      label: to === 'done' ? 'Done' : `Next: ${STEP_LABEL[to]}`,
      stays: to !== 'done',
      run: () => {
        if (advancePath(worldId, to) === 'done') stampPathNotesSeen();
      },
    };
  };
  const done = stepDone(step, dots, entry?.guide_visited);

  switch (step) {
    case 'someone': {
      const ada = newestOf(ofType('character'));
      if (!dots.someone || !ada) {
        line = 'Start with someone.';
        actions.push({ verb: 'create-character', label: 'Create a Character', run: () => create('character') });
      } else {
        line = `${nameOf(ada, 'character')} is in your world.`;
        actions.push(next());
      }
      break;
    }
    case 'placed': {
      if (dots.placed) {
        const ada = newestOf(placedChars);
        line = `${nameOf(ada, 'character')} is at ${nameOf(byId.get(placeIdOf(ada!) ?? ''), 'location')}.`;
        actions.push(next());
        break;
      }
      const chars = ofType('character');
      const keep = newestOf(ofType('location'));
      const free = newestOf(unplacedCharacters(els));
      if (chars.length === 0) {
        line = 'Start with someone.';
        actions.push({ verb: 'create-character', label: 'Create a Character', run: () => create('character') });
      } else if (!keep) {
        line = 'Give them somewhere.';
        actions.push({ verb: 'create-location', label: 'Create a Location', run: () => create('location') });
      } else if (free) {
        const ada = nameOf(free, 'character');
        const hollow = nameOf(keep, 'location');
        const [character, location] = [free.id, keep.id];
        line = `${ada} has no place yet. ${hollow} could be it.`;
        actions.push({ verb: 'place', label: `Place ${ada} at ${hollow}`, stays: true, run: () => placeFromCard(worldId, character, location) });
      } else {
        // Only Characters whose place is gone: the field is someone's data, never overwritten.
        const gone = newestOf(chars)!;
        line = `${nameOf(gone, 'character')}'s place was deleted.`;
        actions.push({ verb: 'open-character', label: `Open ${nameOf(gone, 'character')}`, run: () => navigate(elementHash(worldId, gone.id)) });
      }
      break;
    }
    case 'happened': {
      const dated = newestOf(ofType('event').filter(e => dateOf(e) !== null));
      if (!dots.happened || !dated) {
        line = 'Something happened in your world. Give it a year.';
        // An Event already made without a whole year (none yet, or one keel would not read as whole):
        // lead to it first, its year is what the step asks (the gate's C6); a new one stays offered.
        const undated = newestOf(ofType('event').filter(e => dateOf(e) === null));
        if (undated) actions.push({ verb: 'open-event', label: `Open ${nameOf(undated, 'event')}`, run: () => navigate(elementHash(worldId, undated.id)) });
        actions.push({ verb: 'create-event', label: 'Create an Event', run: () => create('event', { temporalContext: { defaultDate: latestDate(els) } }) });
        break;
      }
      const founding = nameOf(dated, 'event');
      const year = dateOf(dated);
      const pairChar = newestOf(placedChars);
      const names = (f: string) => linkIdsOf((dated as Record<string, unknown>)[f]);
      const pair = pairChar && !names('characters').includes(pairChar.id) && !names('locations').includes(placeIdOf(pairChar)!)
        ? { character: pairChar.id, location: placeIdOf(pairChar)! } : null;
      const chart: CardAction = { verb: 'open-chart', label: 'Open the chart', run: () => navigate(timelineHash(worldId, dated.id)) };
      if (pair) {
        const ada = nameOf(pairChar, 'character');
        const hollow = nameOf(byId.get(pair.location), 'location');
        const event = dated.id;
        line = `${founding} happened in year ${year}. Were ${ada} and ${hollow} at ${founding}?`;
        actions.push({ verb: 'were-there', label: `Add ${ada} and ${hollow} to ${founding}`, stays: true, run: () => wereThereFromCard(worldId, event, pair) });
      } else {
        // Not yet seen: the sentence says the chart is the way on, since Next waits for it.
        line = `${founding} is on the chart at year ${year}.${done ? '' : ' Open the chart to see it, then go on.'}`;
      }
      // Were there is offered, never required: Next stands once the chart was seen.
      actions.push(done ? next() : chart);
      break;
    }
    case 'story': {
      const labels = getWritingLabels(worldId);
      const tale = newestOf(ofType('narrative').filter(n => isStoryNarrative(n) && (n as { supertype?: unknown }).supertype !== 'Chronicle'));
      if (!dots.story || !tale) {
        line = 'Tell a story in your world.';
        actions.push({
          verb: 'create-story', label: 'Start a story',
          // The world's first writing label, set on what the dialog made if it is a Narrative with none (G12).
          run: () => create('narrative', { afterCreate: (id, type) => { if (type === 'narrative') void labelStoryFromCard(worldId, id, labels.l1); } }),
        });
        break;
      }
      const tier = getTierForNarrative(tale, worldId);
      const word = tier ? labels[tier].toLowerCase() : null;
      // The world's own word arrives with its place, not as a jump from "story".
      line = word ? `${nameOf(tale, 'narrative')} is in your world, listed as ${/^[aeiou]/.test(word) ? 'an' : 'a'} ${word}.` : `${nameOf(tale, 'narrative')} is a story.`;
      actions.push(done ? next() : { verb: 'open-writing', label: 'Open the writing room', run: () => navigate(writingHash(worldId, tale.id)) });
      break;
    }
    case 'copy': {
      const world = getState().active?.meta.name || 'This world';
      if (dots.copy) {
        line = `${world} has a copy outside this browser.`;
        actions.push(next());
        break;
      }
      line = `${world} is kept only in this browser.`;
      actions.push({
        verb: 'download', label: 'Download', hint: 'a file on this computer', run: async (button) => {
          const now = getState().registry.worlds.find(w => w.id === worldId);
          if (!now || button.disabled) return;
          const { downloadWorldFromClick } = await import('../ui/download-world');
          // Busy while it saves, as the keep-safe card's: a second press starts no second download.
          await downloadWorldFromClick(now, toasts, on => { button.disabled = on; button.textContent = on ? 'Saving…' : 'Download'; });
        },
      });
      if (hasFolderMode()) {
        actions.push({
          verb: 'move', label: 'Move to a folder', hint: 'files you keep yourself', run: async () => {
            const now = getState().registry.worlds.find(w => w.id === worldId);
            if (!now) return;
            cardOpenedDialog = true;
            const { MoveBrowserWorldModal } = await import('../ui/move-browser-world-modal');
            new MoveBrowserWorldModal(now, toasts).open();
          },
        });
      }
      if (entry && entry.state !== 'api-linked' && !entry.copy_of && !isPartialSlice(getState().active?.meta)) {
        actions.push({
          // keel: a world is read only by the people its owner invites until the owner turns public reading on.
          verb: 'online', label: 'Make online', hint: 'on onlyworlds.com, private to you until you share it', run: async () => {
            cardOpenedDialog = true;
            const { MakeOnlineModal } = await import('../ui/make-online-modal');
            new MakeOnlineModal(toasts).open();
          },
        });
      }
      break;
    }
  }

  const el = document.createElement('div');
  el.className = 'atlas-guide-card';
  el.setAttribute('data-role', 'guide-card');
  el.setAttribute('data-step', step);
  el.setAttribute('data-done', String(done));
  const p = document.createElement('p');
  p.className = 'atlas-guide-card-line';
  p.textContent = line;
  const row = document.createElement('div');
  row.className = 'atlas-guide-card-actions';
  actions.forEach((a, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = i === 0 ? 'atlas-btn-primary' : 'atlas-btn-ghost';
    b.setAttribute('data-step-action', a.verb);
    b.textContent = a.label;
    // A way with a hint stands over its clause (the copy step: three ways that would read alike).
    let slot: HTMLElement = b;
    if (a.hint) {
      slot = document.createElement('span');
      slot.className = 'atlas-guide-card-way';
      const hint = document.createElement('span');
      hint.className = 'atlas-guide-card-hint';
      hint.textContent = a.hint;
      slot.append(b, hint);
    }
    b.addEventListener('click', () => {
      // A world on the path with no pointer (imported, older): the first press on its card holds the
      // step, so the step it leads to is confirmed with Next instead of moving on unseen.
      if (!entry?.guide_step) startAt(worldId, step);
      // Set before the write: the write redraws the home at once, and the draw takes the focus it finds here.
      if (a.stays) {
        focusAfterDraw = CARD_BUTTON;
        dropAskAfter(a.run(b));
      } else void a.run(b);
    });
    row.appendChild(slot);
  });
  el.append(p, row);
  return el;
}

/** The pointer held at a step by a press on its card, when the world had none. */
function startAt(worldId: string, step: DotId): void {
  advancePath(worldId, step);
}
