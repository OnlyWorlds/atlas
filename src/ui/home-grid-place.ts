/**
 * The home grid's one write (the home that grows): a drop, two presses and
 * the keyboard all call `placeIn`. It reads the pair's field, writes it on
 * the element that carries it inside that element's lock, refusing there
 * too when the field moved since the light (never overwrite, never repeat),
 * and keeps what it wrote for the sentence and its Undo.
 */

import { fieldLabel } from '@onlyworlds/sdk';
import type { Element } from '../core/types';
import { getState } from '../core/state';
import { getActiveStore } from '../core/active-store';
import { pairWrite, patchFor, undoPatchFor, type PairWrite } from '../core/home-grid-pair';
import { refreshElementsAfterWrite, requestPushIfLinked } from '../sync/sync-attach';
import { typeName } from '../core/type-words';
import { showProblem } from './problem-fixes';
import { toastManager } from './toast-manager';
import { reportGesture } from './guide-note';
import { worldIsViewOnly } from '../core/view-only';

/** What the last write said, for the card's "just now" line and its Undo. */
export interface JustNow { worldId: string; write: PairWrite; sentence: string; undone?: boolean }

let justNow: JustNow | null = null;

/** The last write in this world, or null. */
export function justNowIn(worldId: string): JustNow | null {
  return justNow && justNow.worldId === worldId ? justNow : null;
}

const nameOf = (el: Element | undefined): string => {
  const n = typeof el?.name === 'string' ? el.name.trim() : '';
  return n || (el ? `this ${typeName(el.type)}` : 'this element');
};

const recordOf = (el: Element): Record<string, unknown> => el as unknown as Record<string, unknown>;

/** The sentence a write says, true of its field: "is in" for a Character's place only; "now lists" for a list. */
export function sentenceFor(w: PairWrite, on: Element | undefined, target: Element | undefined): string {
  if (w.single && w.field === 'location' && on?.type === 'character') return `${nameOf(on)} is in ${nameOf(target)}`;
  if (w.single) return `${nameOf(on)}'s ${fieldLabel(w.field).toLowerCase()} is ${nameOf(target)}`;
  return `${nameOf(on)} now lists ${nameOf(target)}`;
}

/** The line before a drop: what the write would say, in the future. */
export function promiseFor(w: PairWrite, on: Element | undefined, target: Element | undefined): string {
  if (w.single && w.field === 'location' && on?.type === 'character') return `${nameOf(on)} will be in ${nameOf(target)}`;
  if (w.single) return `${nameOf(on)}'s ${fieldLabel(w.field).toLowerCase()} will be ${nameOf(target)}`;
  return `${nameOf(on)} will list ${nameOf(target)}`;
}

/** What dropping `a` on `b` would write in the world as it is drawn, or null. */
export function writeBetween(aId: string, bId: string): PairWrite | null {
  const els = getState().data.elements;
  const a = els.find(e => e.id === aId);
  const b = els.find(e => e.id === bId);
  if (!a || !b) return null;
  return pairWrite({ id: a.id, type: a.type, record: recordOf(a) }, { id: b.id, type: b.type, record: recordOf(b) });
}

async function writeLocked(
  worldId: string,
  id: string,
  mutate: (ex: Element) => Record<string, unknown> | null,
  /** Run once the write landed, before the list refreshes: the refresh redraws the home, which reads it. */
  onWrote: () => void = () => {},
): Promise<'wrote' | 'nothing' | 'failed'> {
  const store = getActiveStore();
  // A view-only world lights no target; this is the write's own refusal too.
  if (!store || getState().active?.worldId !== worldId || worldIsViewOnly(worldId)) return 'nothing';
  let wrote = false;
  try {
    await store.updateElementWith(id, ex => {
      const patch = mutate(ex);
      wrote = patch !== null;
      return patch as Partial<Element> | null;
    });
  } catch (err) {
    showProblem(err, { doing: 'saving the change', toasts: toastManager });
    return 'failed';
  }
  if (!wrote) return 'nothing';
  onWrote();
  await refreshElementsAfterWrite(store);
  requestPushIfLinked();
  return 'wrote';
}

/** Drop `a` on `b`: the pair's one write, or nothing when the pair is no target now. */
export async function placeIn(worldId: string, aId: string, bId: string): Promise<'wrote' | 'nothing' | 'failed'> {
  const w = writeBetween(aId, bId);
  if (!w) return 'nothing';
  const els = getState().data.elements;
  const on = els.find(e => e.id === w.on);
  const sentence = sentenceFor(w, on, els.find(e => e.id === w.target));
  const result = await writeLocked(worldId, w.on, ex => patchFor(w, recordOf(ex)), () => {
    justNow = { worldId, write: w, sentence };
  });
  if (result !== 'wrote') return result;
  if (w.field === 'location' && on?.type === 'character') reportGesture({ kind: 'location-set', character: on.id }, { fromAction: true });
  return 'wrote';
}

/** Undo the last write: only while its field still holds what it wrote. */
export async function undoJustNow(worldId: string): Promise<'wrote' | 'nothing' | 'failed'> {
  const j = justNowIn(worldId);
  if (!j || j.undone) return 'nothing';
  const result = await writeLocked(worldId, j.write.on, ex => undoPatchFor(j.write, recordOf(ex)), () => { justNow = null; });
  if (result === 'nothing') justNow = null;
  return result;
}

/** Test seam. */
export function resetJustNowForTests(): void {
  justNow = null;
}
