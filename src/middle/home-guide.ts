/**
 * The guide's strip on the home (onboarding step 1): five marks for what the
 * world can do, lit from the world (`core/guide.ts`), in the onboarding block
 * where the cards were. A mark always does what its label says: unlit, its
 * one way in; lit, it opens the thing. The press is the person asking, so it
 * works whatever the notes' switch and memory say, and never stamps a note
 * seen.
 *
 * Contract: a design note of 2026-10-27 (the guide, step 1, draft 2, §2).
 */

import { dateOf } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { getState } from '../core/state';
import { elementHash, navigate, settingsHash, timelineHash, writingHash } from '../core/router';
import { DOTS, guideElements, newestOf, placeIdOf, unplacedCharacters, type DotId, type Dots } from '../core/guide';
import { parseTemporalValue } from '../visualization/timeline/temporal-fields';
import { getTierForNarrative } from './writing-helpers';
import { ElementCreateModal } from '../ui/element-create-modal';
import { showPlaceOffer } from '../ui/guide-note';
import type { ToastManager } from '../ui/toast-manager';

const HINT: Record<DotId, { todo: string; done: string }> = {
  someone: { todo: 'Create a Character', done: 'Open the newest Character' },
  placed: { todo: 'Place a Character at a Location', done: 'Open where a Character is' },
  happened: { todo: 'Make an Event with a year', done: 'Open the chart' },
  story: { todo: 'Start a story', done: 'Open the writing room' },
  copy: { todo: 'Keep a copy outside this browser', done: 'Open This world in Settings' },
};

/** The mark that opened a dialog: focus goes back to its rebuilt twin when the dialog closes. */
let focusDot: DotId | null = null;
let focusWired = false;

function wireFocusReturn(): void {
  if (focusWired) return;
  focusWired = true;
  document.addEventListener('atlas:modal-closed', () => {
    const dot = focusDot;
    focusDot = null;
    if (!dot) return;
    const active = document.activeElement;
    if (active && active !== document.body) return; // the person moved on: never steal focus
    document.querySelector<HTMLElement>(`[data-role="guide-strip"] [data-dot="${dot}"]`)?.focus({ preventScroll: true });
  });
}

export function buildGuideStrip(dots: Dots, worldId: string, toasts: ToastManager): HTMLElement {
  wireFocusReturn();
  const strip = document.createElement('div');
  strip.className = 'atlas-guide-strip';
  strip.setAttribute('data-role', 'guide-strip');
  const marks = document.createElement('div');
  marks.className = 'atlas-guide-marks';
  const next = DOTS.find(d => !dots[d.id])?.id ?? null;
  for (const d of DOTS) {
    const lit = dots[d.id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'atlas-guide-mark' + (lit ? ' is-lit' : '') + (d.id === next ? ' is-next' : '');
    b.setAttribute('data-dot', d.id);
    b.setAttribute('data-lit', String(lit));
    b.setAttribute('aria-label', `${d.label}: ${lit ? 'done' : 'not yet'}. ${lit ? HINT[d.id].done : HINT[d.id].todo}.`);
    b.innerHTML = '<span class="atlas-guide-dot" aria-hidden="true"></span><span class="atlas-guide-mark-label"></span>';
    b.querySelector('.atlas-guide-mark-label')!.textContent = d.label;
    b.addEventListener('click', () => pressMark(d.id, lit, worldId, toasts));
    marks.appendChild(b);
  }
  strip.appendChild(marks);

  // "Anything else": the create modal on any type; hovering it with a mouse
  // pulses the sidebar +, the permanent home of creating (a tap never pins it, conv. 141).
  const any = document.createElement('button');
  any.type = 'button';
  any.className = 'atlas-btn-link atlas-guide-any';
  any.setAttribute('data-create-any', '');
  any.textContent = 'Anything else';
  any.addEventListener('click', () => new ElementCreateModal(toasts, { suppressNavigate: true }).open());
  const sidebarCreate = (): HTMLElement | null => document.querySelector('[data-action="create-element"]');
  any.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') sidebarCreate()?.classList.add('atlas-create-pulse'); });
  any.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') sidebarCreate()?.classList.remove('atlas-create-pulse'); });
  strip.appendChild(any);
  return strip;
}

function create(type: 'character' | 'location' | 'event' | 'narrative', dot: DotId, toasts: ToastManager, extra: { temporalContext?: { defaultDate?: number } } = {}): void {
  focusDot = dot;
  new ElementCreateModal(toasts, { initialType: type, suppressNavigate: true, ...extra }).open();
}

/** The world's latest whole-number date: what a new Event's year field starts at. None: the field starts empty, so the year is the person's own (1.98.0 started it at 1, a year nobody chose). */
function latestDate(els: readonly Element[]): number | undefined {
  let best: number | null = null;
  for (const e of els) {
    const d = dateOf(e);
    if (d !== null && (best === null || d > best)) best = d;
  }
  return best ?? undefined;
}

function pressMark(dot: DotId, lit: boolean, worldId: string, toasts: ToastManager): void {
  const els = guideElements(getState().data.elements);
  const ofType = (t: string) => els.filter(e => e.type === t);
  const locationIds = new Set(ofType('location').map(e => e.id));
  switch (dot) {
    case 'someone': {
      const ch = newestOf(ofType('character'));
      if (lit && ch) navigate(elementHash(worldId, ch.id));
      else create('character', dot, toasts);
      return;
    }
    case 'placed': {
      if (lit) {
        const placed = newestOf(ofType('character').filter(c => locationIds.has(placeIdOf(c) ?? '')));
        const where = placed && placeIdOf(placed);
        if (where) navigate(elementHash(worldId, where));
        return;
      }
      const loc = newestOf(ofType('location'));
      if (!loc) { create('location', dot, toasts); return; }
      const free = newestOf(unplacedCharacters(els));
      if (free) { showPlaceOffer(free.id, loc.id); return; }
      // Only Characters whose place is gone, or none at all.
      const gone = newestOf(ofType('character'));
      if (gone) navigate(elementHash(worldId, gone.id));
      else create('character', dot, toasts);
      return;
    }
    case 'happened': {
      if (lit) { navigate(timelineHash(worldId)); return; }
      // An Event the chart already draws (a date keel would not read as whole): lead to its date.
      const drawn = newestOf(ofType('event').filter(e =>
        dateOf(e) === null && parseTemporalValue((e as { start_date?: unknown }).start_date) !== null));
      if (drawn) { navigate(elementHash(worldId, drawn.id)); return; }
      create('event', dot, toasts, { temporalContext: { defaultDate: latestDate(els) } });
      return;
    }
    case 'story': {
      if (!lit) { create('narrative', dot, toasts); return; }
      const book = newestOf(ofType('narrative').filter(n => getTierForNarrative(n, worldId) !== null));
      navigate(writingHash(worldId, book?.id));
      return;
    }
    case 'copy':
      navigate(settingsHash(worldId, 'world'));
      return;
  }
}
