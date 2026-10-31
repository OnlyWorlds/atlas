/**
 * Make this the world's strand (the strand profile; Atlas's contract S7): a keeper's offer on a story
 * Narrative's page (under its name, beside the charter's Mark) and in the writing room's sticky bar.
 * One predicate with the Strand tab's Pick (`offerable`): never a proposed Narrative, a known-of stub,
 * a room element or a reading aid; a chapter may be the story.
 *
 *   Not the strand: "Make this the world's strand" ("…instead of <name>" when another story is), one
 *   press writes the story change and says "The world's strand · Open it" (Home on the Strand tab;
 *   no Open it while the path shows, where Home draws no tab).
 *   Already the strand: the page says "This is the world's strand · Open it · Not the strand", Not the
 *   strand after a promise line and a second press; the sticky bar shows nothing.
 */

import type { Element } from '../core/types';
import { getState } from '../core/state';
import { isStrandKeeper, memberIds, offerable, storedMark, strandView } from '../core/strand';
import { worldIsViewOnly } from '../core/view-only';
import { pathShowing } from '../core/guide-path';
import { isKeptHere } from '../sync/sync-attach';
import { clearStrand, writeStrandSlot, STRAND_MOVED, type StrandDrawn } from '../ui/strand-write';
import { toastManager } from '../ui/toast-manager';
import { openStrandTab } from './home-strand';

export type StrandOffer = { kind: 'make'; instead: string | null } | { kind: 'is' };

const nameOf = (n: { name?: unknown } | null | undefined): string =>
  (n && typeof n.name === 'string' && n.name.trim() ? n.name.trim() : 'Unnamed');

/** What this Narrative's page or bar offers the person here, or null. */
export function strandOfferFor(el: Element, worldId: string): StrandOffer | null {
  const s = getState();
  if (!s.active || s.active.worldId !== worldId || worldIsViewOnly(worldId)) return null;
  const entry = s.registry.worlds.find(w => w.id === worldId);
  // A kept-here copy is outside the key's view: a strand on it would read empty here (C9).
  if (!isStrandKeeper(entry, s.active.meta) || !offerable(el, 'narrative') || isKeptHere(worldId, el.id)) return null;
  const strand = strandView(s.active.meta, s.data.elements, id => isKeptHere(worldId, id));
  if (strand.narrative?.id === el.id) return { kind: 'is' };
  return { kind: 'make', instead: strand.narrative ? nameOf(strand.narrative) : null };
}

/** The drawn state a press writes against: the mark's ids as stored now. */
function drawnNow(worldId: string): StrandDrawn {
  const ids = memberIds(storedMark(getState().active?.meta));
  return { worldId, narrative: ids.narrative ?? null, event: ids.event ?? null, location: ids.location ?? null };
}

/**
 * The page's and the bar's writes under way, by world and story (C1): set before the first await, so a
 * second press while one runs is dropped, never a second write and never "changed meanwhile".
 */
const pressing = new Set<string>();
const pressKey = (worldId: string, el: Element): string => `${worldId}\u0000${el.id}`;

/** Whether a press on this story's offer is under way (its buttons draw disabled). */
export function strandPressing(worldId: string, el: Element): boolean {
  return pressing.has(pressKey(worldId, el));
}

async function hold<T>(worldId: string, el: Element, run: () => Promise<T>): Promise<T | 'held'> {
  const key = pressKey(worldId, el);
  if (pressing.has(key)) return 'held';
  pressing.add(key);
  try {
    return await run();
  } finally {
    pressing.delete(key);
  }
}

/** The button's words. */
export function makeLabel(offer: { instead: string | null }): string {
  return offer.instead ? `Make this the world's strand instead of ${offer.instead}` : "Make this the world's strand";
}

/** The press: S4's story change, then the line that says it. */
export async function makeThisTheStrand(el: Element, worldId: string, drawn: StrandDrawn = drawnNow(worldId)): Promise<void> {
  const result = await hold(worldId, el, () => writeStrandSlot('narrative', drawn, el.id));
  if (result === 'held') return;
  if (result === 'refused') { toastManager.info(STRAND_MOVED); return; }
  if (result !== 'wrote') return;
  if (pathShowing(worldId)) toastManager.success("The world's strand");
  else toastManager.show("The world's strand", 'success', 6000, { actions: [{ label: 'Open it', run: () => openStrandTab(worldId) }], dedupeKey: 'strand-made' });
}

/** Not the strand's promise, waiting for its second press: this tab's memory, by element. */
let confirming: string | null = null;

/** The page's block under the name, or null. */
export function buildPageStrandOffer(el: Element, worldId: string): HTMLElement | null {
  const offer = strandOfferFor(el, worldId);
  if (confirming && (!offer || offer.kind !== 'is' || confirming !== el.id)) confirming = null;
  if (!offer) return null;
  const box = document.createElement('div');
  box.className = 'atlas-strand-offer';
  box.dataset.role = 'strand-offer';
  const btn = (label: string, action: string, run: () => void, cls = 'atlas-btn-link'): HTMLButtonElement => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.dataset.action = action;
    b.textContent = label;
    b.addEventListener('click', run);
    // A redraw while a press runs keeps its writes waiting (C1).
    if (action !== 'strand-open' && strandPressing(worldId, el)) b.disabled = true;
    return b;
  };
  const sep = (): HTMLSpanElement => {
    const s = document.createElement('span');
    s.className = 'atlas-strand-offer-sep';
    s.setAttribute('aria-hidden', 'true');
    s.textContent = '·';
    return s;
  };
  if (offer.kind === 'make') {
    const drawn = drawnNow(worldId);
    const b = btn(makeLabel(offer), 'strand-make', () => { b.disabled = true; void makeThisTheStrand(el, worldId, drawn).finally(() => { b.disabled = false; }); }, 'atlas-btn atlas-btn--secondary');
    box.appendChild(b);
    return box;
  }
  const line = document.createElement('p');
  line.className = 'atlas-strand-offer-line';
  const word = document.createElement('span');
  word.textContent = "This is the world's strand";
  line.appendChild(word);
  if (!pathShowing(worldId)) line.append(sep(), btn('Open it', 'strand-open', () => openStrandTab(worldId)));
  if (confirming !== el.id) {
    line.append(sep(), btn('Not the strand', 'strand-clear', () => {
      confirming = el.id;
      const now = box.parentElement;
      const next = buildPageStrandOffer(el, worldId);
      if (now && next) { box.replaceWith(next); next.querySelector<HTMLElement>('[data-action="strand-clear-confirm"]')?.focus(); }
    }));
    box.appendChild(line);
    return box;
  }
  box.appendChild(line);
  const promise = document.createElement('p');
  promise.className = 'atlas-strand-offer-line';
  promise.dataset.role = 'strand-clear-promise';
  promise.textContent = `${nameOf(el)} will no longer be the world's strand, and the world will have none. The story and its links stay as they are.`;
  box.appendChild(promise);
  const drawn = drawnNow(worldId);
  const row = document.createElement('div');
  row.className = 'atlas-strand-offer-acts';
  row.append(
    btn('Not the strand', 'strand-clear-confirm', () => {
      if (strandPressing(worldId, el)) return;
      for (const b of row.querySelectorAll<HTMLButtonElement>('button')) b.disabled = true;
      confirming = null;
      void hold(worldId, el, () => clearStrand(drawn)).then(r => { if (r === 'refused') toastManager.info(STRAND_MOVED); });
    }, 'atlas-btn atlas-btn--secondary'),
    btn('Cancel', 'strand-clear-cancel', () => {
      confirming = null;
      const next = buildPageStrandOffer(el, worldId);
      if (next) { box.replaceWith(next); next.querySelector<HTMLElement>('[data-action="strand-clear"]')?.focus(); }
    }, 'atlas-btn-ghost'),
  );
  box.appendChild(row);
  return box;
}

/** The sticky bar's offer (right cluster): only while this story is not the strand. */
export function buildBarStrandOffer(el: Element, worldId: string): HTMLElement | null {
  const offer = strandOfferFor(el, worldId);
  if (!offer || offer.kind !== 'make') return null;
  const drawn = drawnNow(worldId);
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'atlas-btn-ghost atlas-writing-workspace-strand';
  b.dataset.action = 'strand-make';
  b.textContent = makeLabel(offer);
  b.title = makeLabel(offer);
  if (strandPressing(worldId, el)) b.disabled = true;
  b.addEventListener('click', () => { b.disabled = true; void makeThisTheStrand(el, worldId, drawn).finally(() => { b.disabled = false; }); });
  return b;
}

/** Test seam. */
export function resetStrandOfferForTests(): void {
  confirming = null;
  pressing.clear();
}
